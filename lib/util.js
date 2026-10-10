'use strict';
// 通用工具：ID 生成、JSON 响应、请求体读取、Cookie 解析等
var crypto = require('crypto');

var B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// 随机 base62 字符串（用于笔记 ID、分享 token、媒体文件名等）
function uid(len) {
  len = len || 10;
  var bytes = crypto.randomBytes(len);
  var s = '';
  for (var i = 0; i < len; i++) s += B62[bytes[i] % 62];
  return s;
}

function nowIso() { return new Date().toISOString(); }

function json(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function fail(res, code, msg) { json(res, code, { error: msg }); }

// 读取请求体（原始 Buffer），超过 limit 抛错
function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    var done = false;
    req.on('data', function (c) {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        reject({ code: 413, error: '内容超过大小限制' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', function (e) {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

function readJson(req, limit) {
  return readBody(req, limit).then(function (buf) {
    if (!buf.length) return {};
    try { return JSON.parse(buf.toString('utf8')); }
    catch (e) { throw { code: 400, error: '请求体不是合法 JSON' }; }
  });
}

function parseCookies(req) {
  var header = req.headers.cookie || '';
  var out = {};
  header.split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i < 0) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// HTML 转纯文本（用于摘要 / 搜索）
function plainText(html) {
  var s = String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return s.replace(/\s+/g, ' ').trim();
}

function snippet(html, n) {
  var t = plainText(html);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

module.exports = {
  uid: uid,
  nowIso: nowIso,
  json: json,
  fail: fail,
  readBody: readBody,
  readJson: readJson,
  parseCookies: parseCookies,
  plainText: plainText,
  snippet: snippet,
  MIME: MIME
};
