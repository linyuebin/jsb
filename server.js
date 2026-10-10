'use strict';
// 记事簿 · 私有化部署的团队记事本
// 零依赖 Node 服务：静态前端 + JSON API + 媒体文件
// 启动：node server.js （可用 PORT / HOST / DATA_DIR 环境变量覆盖，或 config.json）
var http = require('http');
var fs = require('fs');
var path = require('path');

var U = require('./lib/util');
var authLib = require('./lib/auth');
var Store = require('./lib/store');
var apiLib = require('./lib/api');

// ---------- 配置 ----------
function loadConfig() {
  var cfg = {
    port: 5320,
    host: '0.0.0.0',
    dataDir: path.join(__dirname, 'data'),
    maxUploadMB: 10,
    siteName: '记事簿'
  };
  try {
    var f = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    for (var k in f) if (f[k] !== undefined && f[k] !== null) cfg[k] = f[k];
  } catch (e) { /* 无 config.json 时使用默认值 */ }
  if (process.env.PORT) cfg.port = parseInt(process.env.PORT, 10);
  if (process.env.HOST) cfg.host = process.env.HOST;
  if (process.env.DATA_DIR) cfg.dataDir = process.env.DATA_DIR;
  return cfg;
}

var cfg = loadConfig();
var mediaDir = path.join(cfg.dataDir, 'media');
var publicDir = path.join(__dirname, 'public');
var websiteDir = path.join(__dirname, 'website');

// ---------- 数据目录 ----------
try { fs.mkdirSync(cfg.dataDir, { recursive: false }); } catch (e) {}
try { fs.mkdirSync(mediaDir, { recursive: false }); } catch (e) {}

var db = {
  users: new Store.Collection(path.join(cfg.dataDir, 'users.json')),
  notes: new Store.Collection(path.join(cfg.dataDir, 'notes.json')),
  media: new Store.Collection(path.join(cfg.dataDir, 'media.json')),
  groups: new Store.Collection(path.join(cfg.dataDir, 'groups.json'))
};

var sessions = new authLib.Sessions();
var limits = new apiLib.Limiter(); // 登录 / 分享解锁限流
var shareKeys = new Map();         // 分享访问凭据 token -> { k, exp }
var api = apiLib.createApi({
  cfg: cfg, db: db, sessions: sessions,
  limits: limits, shareKeys: shareKeys, mediaDir: mediaDir
});

// ---------- 路由匹配 ----------
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

function matchRoute(method, pathname) {
  for (var i = 0; i < api.routes.length; i++) {
    var r = api.routes[i];
    if (r.method !== method) continue;
    var pp = r.pattern.split('/');
    var up = pathname.split('/');
    if (pp.length !== up.length) continue;
    var params = {};
    var ok = true;
    for (var j = 0; j < pp.length; j++) {
      if (pp[j].charAt(0) === ':') params[pp[j].slice(1)] = safeDecode(up[j]);
      else if (pp[j] !== up[j]) { ok = false; break; }
    }
    if (ok) return { route: r, params: params };
  }
  return null;
}

// ---------- 安全响应头 ----------
var CSP = "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
// 推广官网为纯静态单文件页（含内联脚本、无任何用户内容），单独放宽 script-src
var CSP_SITE = "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function secureHeaders(res, csp) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', csp || CSP);
}

// ---------- 静态文件 ----------
function serveFile(res, filePath, cache, csp) {
  fs.readFile(filePath, function (e, buf) {
    if (e) return U.fail(res, 404, 'Not Found');
    var ext = path.extname(filePath).toLowerCase();
    var mime = U.MIME[ext] || 'application/octet-stream';
    secureHeaders(res, csp);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      'Cache-Control': cache || 'no-cache'
    });
    res.end(buf);
  });
}

function serveStatic(req, res, pathname, user) {
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(publicDir, 'index.html'), 'no-cache');
  }
  // 分享页
  if (pathname === '/s' || pathname.indexOf('/s/') === 0) {
    return serveFile(res, path.join(publicDir, 'share.html'), 'no-cache');
  }
  // 推广官网（单文件页，可独立部署，也可从服务直接访问）
  if (pathname === '/site' || pathname === '/site/' || pathname === '/site/index.html') {
    return serveFile(res, path.join(websiteDir, 'index.html'), 'no-cache', CSP_SITE);
  }
  if (pathname === '/site/favicon.svg') {
    return serveFile(res, path.join(websiteDir, 'favicon.svg'), 'max-age=86400');
  }
  // 媒体（带鉴权）
  if (pathname.indexOf('/media/') === 0) {
    var file = pathname.slice('/media/'.length);
    if (!/^[A-Za-z0-9_\-]+\.(png|jpe?g|gif|webp|bmp)$/i.test(file)) return U.fail(res, 404, 'Not Found');
    var q = parseQuery(req.url);
    return api.serveMedia(req, res, file, q, user);
  }
  // 其余静态资源
  var safe = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  var fp = path.join(publicDir, safe);
  if (fp.indexOf(publicDir) !== 0) return U.fail(res, 404, 'Not Found');
  serveFile(res, fp, 'no-cache');
}

function parseQuery(url) {
  var q = {};
  var i = url.indexOf('?');
  if (i < 0) return q;
  url.slice(i + 1).split('&').forEach(function (kv) {
    if (!kv) return;
    var p = kv.split('=');
    q[safeDecode(p[0])] = safeDecode((p[1] || '').replace(/\+/g, '%20'));
  });
  return q;
}

// ---------- 主处理 ----------
function handle(req, res) {
  var method = req.method === 'HEAD' ? 'GET' : req.method;
  var url = req.url || '/';
  var pathname = url.split('?')[0];
  var query = parseQuery(url);

  // 会话解析（静态媒体也会用到）
  var token = null;
  var user = null;
  var cookies = U.parseCookies(req);
  if (cookies[authLib.COOKIE_NAME]) {
    token = cookies[authLib.COOKIE_NAME];
    var sess = sessions.get(token);
    if (sess) {
      user = db.users.items.filter(function (u) { return u.id === sess.userId; })[0] || null;
      if (user && !user.disabled) {
        sessions.touch(token);
      } else {
        user = null;
      }
    }
  }

  // API
  if (pathname.indexOf('/api/') === 0) {
    var m = matchRoute(method, pathname);
    if (!m) return U.fail(res, 404, '接口不存在');
    var r = m.route;
    if (r.opts.auth === 'user' && !user) return U.fail(res, 401, '请先登录');
    if (r.opts.auth === 'admin' && (!user || user.role !== 'admin')) return U.fail(res, 403, '需要管理员权限');
    if (user && token) res.setHeader('Set-Cookie', authLib.sessionCookie(token)); // 滑动续期

    if (method === 'POST' || method === 'PUT') {
      var isRaw = r.opts.body === 'raw';
      var limit = isRaw ? cfg.maxUploadMB * 1024 * 1024 : 2 * 1024 * 1024;
      var read = isRaw ? U.readBody(req, limit) : U.readJson(req, limit);
      read.then(function (body) {
        dispatch(req, res, m, query, body, user, token);
      }, function (err) {
        U.fail(res, err && err.code ? err.code : 400, err && err.error ? err.error : '请求读取失败');
      });
    } else {
      dispatch(req, res, m, query, null, user, token);
    }
    return;
  }

  // 静态 / 分享页 / 媒体
  if (method !== 'GET') return U.fail(res, 405, 'Method Not Allowed');
  secureHeaders(res);
  serveStatic(req, res, pathname, user);
}

function dispatch(req, res, m, query, body, user, token) {
  var ctx = {
    req: req, res: res, params: m.params, query: query,
    body: body, user: user, token: token
  };
  try {
    m.route.handler(ctx);
  } catch (e) {
    console.error('[api] 处理异常: ' + (e && e.stack || e));
    if (!res.headersSent) U.fail(res, 500, '服务器内部错误');
  }
}

// ---------- 启动 ----------
api.sweepMedia();

var server = http.createServer(handle);
server.on('clientError', function (err, socket) {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {}
});
server.listen(cfg.port, cfg.host, function () {
  console.log('======================================');
  console.log('  记事簿 v' + apiLib.VERSION + ' 已启动');
  console.log('  访问地址: http://localhost:' + cfg.port + '/');
  console.log('  数据目录: ' + cfg.dataDir);
  console.log('  首次使用请打开页面完成管理员初始化');
  console.log('======================================');
});

process.on('SIGINT', function () {
  db.users.flush(); db.notes.flush(); db.media.flush(); db.groups.flush();
  process.exit(0);
});
process.on('SIGTERM', function () {
  db.users.flush(); db.notes.flush(); db.media.flush(); db.groups.flush();
  process.exit(0);
});
