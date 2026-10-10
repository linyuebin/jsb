'use strict';
// 业务 API：账号 / 笔记 / 媒体 / 分享
var fs = require('fs');
var path = require('path');
var U = require('./util');
var sanitize = require('./sanitize');
var auth = require('./auth');

var VERSION = '1.2.0';
var USERNAME_RE = /^[a-zA-Z0-9_\-一-龥]{2,30}$/;
var MAX_CONTENT = 1.5 * 1024 * 1024; // 笔记 HTML 上限
var IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp'
};

// ---------- 简单内存限流 ----------
function Limiter() { this.map = new Map(); }
// 是否处于锁定期
Limiter.prototype.blocked = function (k) {
  var e = this.map.get(k);
  if (!e) return false;
  if (e.until > Date.now()) return true;
  if (e.until) this.map.delete(k);
  return false;
};
// 记录一次失败，返回窗口内累计失败次数
Limiter.prototype.fail = function (k, windowMs) {
  var now = Date.now();
  var e = this.map.get(k);
  if (!e || now - e.first > (windowMs || 10 * 60 * 1000)) e = { count: 0, first: now, until: 0 };
  e.count++;
  this.map.set(k, e);
  return e.count;
};
Limiter.prototype.lock = function (k, lockMs) {
  var e = this.map.get(k) || { count: 0, first: Date.now(), until: 0 };
  e.until = Date.now() + lockMs;
  this.map.set(k, e);
};
Limiter.prototype.clear = function (k) { this.map.delete(k); };

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

// ---------- 图片魔数校验 ----------
function sniffImage(buf, mime) {
  if (!buf || buf.length < 12) return false;
  try {
    if (mime === 'image/png') return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (mime === 'image/gif') return buf.slice(0, 3).toString('latin1') === 'GIF';
    if (mime === 'image/webp') return buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
    if (mime === 'image/bmp') return buf[0] === 0x42 && buf[1] === 0x4d;
  } catch (e) { return false; }
  return false;
}

// ---------- 工具 ----------
function findUser(db, id) {
  for (var i = 0; i < db.users.items.length; i++) if (db.users.items[i].id === id) return db.users.items[i];
  return null;
}
function findNote(db, id) {
  for (var i = 0; i < db.notes.items.length; i++) if (db.notes.items[i].id === id) return db.notes.items[i];
  return null;
}
function findMedia(db, file) {
  for (var i = 0; i < db.media.items.length; i++) if (db.media.items[i].file === file) return db.media.items[i];
  return null;
}
function findGroup(db, id, ownerId) {
  for (var i = 0; i < db.groups.items.length; i++) {
    var g = db.groups.items[i];
    if (g.id === id && g.ownerId === ownerId) return g;
  }
  return null;
}
function findGroupByName(db, ownerId, name) {
  for (var i = 0; i < db.groups.items.length; i++) {
    var g = db.groups.items[i];
    if (g.ownerId === ownerId && g.name === name) return g;
  }
  return null;
}
// 笔记的 groupId 仅允许归属本人的分组，非法值一律归为未分组
function validGroupId(db, user, v) {
  if (v === null || v === undefined || v === '') return null;
  return findGroup(db, String(v), user.id) ? String(v) : null;
}
function pubUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt };
}
function listItem(n) {
  return {
    id: n.id,
    title: n.title,
    snippet: U.snippet(n.content, 80),
    pinned: !!n.pinned,
    deleted: !!n.deleted,
    groupId: n.groupId || null,
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    share: n.share ? { mode: n.share.mode } : null
  };
}
function fullNote(n) {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    pinned: !!n.pinned,
    deleted: !!n.deleted,
    groupId: n.groupId || null,
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    share: n.share ? { mode: n.share.mode, createdAt: n.share.createdAt } : null
  };
}
function hashPass(pw) { return auth.hashPassword(pw); }

// ---------- API 主体 ----------
function createApi(deps) {
  var cfg = deps.cfg;
  var db = deps.db;
  var sessions = deps.sessions;
  var limits = deps.limits;
  var shareKeys = deps.shareKeys; // token -> { k, exp }
  var mediaDir = deps.mediaDir;

  function deleteMediaFile(m) {
    try { fs.unlinkSync(path.join(mediaDir, m.file)); } catch (e) {}
  }

  var routes = [];

  function route(method, pattern, opts, handler) {
    routes.push({ method: method, pattern: pattern, opts: opts || {}, handler: handler });
  }

  // ===== 公共 =====
  route('GET', '/api/status', { auth: 'none' }, function (c) {
    U.json(c.res, 200, {
      needsSetup: db.users.items.length === 0,
      siteName: cfg.siteName,
      version: VERSION
    });
  });

  route('POST', '/api/setup', { auth: 'none', body: 'json' }, function (c) {
    if (db.users.items.length > 0) return U.fail(c.res, 403, '系统已初始化');
    var b = c.body || {};
    var username = String(b.username || '').trim();
    var name = sanitize.textOnly(b.name, 30) || username;
    if (!USERNAME_RE.test(username)) return U.fail(c.res, 400, '用户名格式不正确（2-30位字母/数字/下划线/中文）');
    if (!b.password || String(b.password).length < 6) return U.fail(c.res, 400, '密码至少 6 位');
    var u = {
      id: U.uid(10), username: username, name: name, role: 'admin',
      disabled: false, pass: hashPass(b.password), createdAt: U.nowIso()
    };
    db.users.items.push(u);
    db.users.save();
    var token = sessions.create(u.id);
    c.res.setHeader('Set-Cookie', auth.sessionCookie(token));
    U.json(c.res, 200, { user: pubUser(u) });
  });

  route('POST', '/api/login', { auth: 'none', body: 'json' }, function (c) {
    var b = c.body || {};
    var username = String(b.username || '').trim().toLowerCase();
    var lk = 'login:' + username + ':' + clientIp(c.req);
    if (limits.blocked(lk)) return U.fail(c.res, 429, '尝试过于频繁，请 10 分钟后再试');
    var u = null;
    for (var i = 0; i < db.users.items.length; i++) {
      if (db.users.items[i].username.toLowerCase() === username) { u = db.users.items[i]; break; }
    }
    if (!u || !auth.verifyPassword(b.password || '', u.pass.salt, u.pass.hash)) {
      var n = limits.fail(lk, 10 * 60 * 1000);
      if (n >= 8) limits.lock(lk, 10 * 60 * 1000);
      return U.fail(c.res, 401, '用户名或密码错误');
    }
    if (u.disabled) return U.fail(c.res, 403, '账号已被停用，请联系管理员');
    limits.clear(lk);
    var token = sessions.create(u.id);
    c.res.setHeader('Set-Cookie', auth.sessionCookie(token));
    U.json(c.res, 200, { user: pubUser(u) });
  });

  route('POST', '/api/logout', { auth: 'user' }, function (c) {
    sessions.destroy(c.token);
    c.res.setHeader('Set-Cookie', auth.clearCookie());
    U.json(c.res, 200, { ok: true });
  });

  route('GET', '/api/me', { auth: 'user' }, function (c) {
    U.json(c.res, 200, { user: pubUser(c.user) });
  });

  route('POST', '/api/me/password', { auth: 'user', body: 'json' }, function (c) {
    var b = c.body || {};
    if (!auth.verifyPassword(b.oldPassword || '', c.user.pass.salt, c.user.pass.hash)) {
      return U.fail(c.res, 400, '原密码不正确');
    }
    if (!b.newPassword || String(b.newPassword).length < 6) return U.fail(c.res, 400, '新密码至少 6 位');
    c.user.pass = hashPass(b.newPassword);
    db.users.save();
    U.json(c.res, 200, { ok: true });
  });

  // ===== 管理员：用户管理（管理员无法查看成员笔记内容） =====
  route('GET', '/api/admin/users', { auth: 'admin' }, function (c) {
    var list = db.users.items.map(pubUser);
    list.sort(function (a, b2) { return a.createdAt < b2.createdAt ? -1 : 1; });
    U.json(c.res, 200, { users: list });
  });

  route('POST', '/api/admin/users', { auth: 'admin', body: 'json' }, function (c) {
    var b = c.body || {};
    var username = String(b.username || '').trim();
    if (!USERNAME_RE.test(username)) return U.fail(c.res, 400, '用户名格式不正确（2-30位字母/数字/下划线/中文）');
    for (var i = 0; i < db.users.items.length; i++) {
      if (db.users.items[i].username.toLowerCase() === username.toLowerCase()) {
        return U.fail(c.res, 400, '用户名已存在');
      }
    }
    if (!b.password || String(b.password).length < 6) return U.fail(c.res, 400, '密码至少 6 位');
    var role = b.role === 'admin' ? 'admin' : 'user';
    var u = {
      id: U.uid(10), username: username,
      name: sanitize.textOnly(b.name, 30) || username,
      role: role, disabled: false,
      pass: hashPass(b.password), createdAt: U.nowIso()
    };
    db.users.items.push(u);
    db.users.save();
    U.json(c.res, 200, { user: pubUser(u) });
  });

  route('POST', '/api/admin/users/:id', { auth: 'admin', body: 'json' }, function (c) {
    var u = findUser(db, c.params.id);
    if (!u) return U.fail(c.res, 404, '用户不存在');
    var b = c.body || {};
    if (b.name !== undefined) u.name = sanitize.textOnly(b.name, 30) || u.username;
    if (b.role !== undefined) {
      var role = b.role === 'admin' ? 'admin' : 'user';
      if (u.id === c.user.id && role !== 'admin') return U.fail(c.res, 400, '不能取消自己的管理员角色');
      u.role = role;
    }
    if (b.disabled !== undefined) {
      if (u.id === c.user.id && b.disabled) return U.fail(c.res, 400, '不能停用自己');
      u.disabled = !!b.disabled;
      if (u.disabled) sessions.destroyByUser(u.id);
    }
    if (b.password) {
      if (String(b.password).length < 6) return U.fail(c.res, 400, '密码至少 6 位');
      u.pass = hashPass(b.password);
      sessions.destroyByUser(u.id);
    }
    db.users.save();
    U.json(c.res, 200, { user: pubUser(u) });
  });

  route('DELETE', '/api/admin/users/:id', { auth: 'admin' }, function (c) {
    var u = findUser(db, c.params.id);
    if (!u) return U.fail(c.res, 404, '用户不存在');
    if (u.id === c.user.id) return U.fail(c.res, 400, '不能删除自己');
    if (u.role === 'admin') {
      var admins = db.users.items.filter(function (x) { return x.role === 'admin' && !x.disabled; });
      if (admins.length <= 1) return U.fail(c.res, 400, '系统至少保留一名管理员');
    }
    // 一并删除该用户的笔记与媒体文件
    var kept = [];
    db.notes.items.forEach(function (n) {
      if (n.ownerId === u.id) {
        db.media.items.forEach(function (m) { if (m.noteId === n.id) deleteMediaFile(m); });
      } else {
        kept.push(n);
      }
    });
    db.notes.items = kept;
    db.media.items = db.media.items.filter(function (m) {
      if (m.ownerId === u.id) { deleteMediaFile(m); return false; }
      return true;
    });
    db.users.items = db.users.items.filter(function (x) { return x.id !== u.id; });
    db.groups.items = db.groups.items.filter(function (g) { return g.ownerId !== u.id; });
    sessions.destroyByUser(u.id);
    db.users.save(); db.notes.save(); db.media.save(); db.groups.save();
    U.json(c.res, 200, { ok: true });
  });

  // ===== 笔记 =====
  route('GET', '/api/notes', { auth: 'user' }, function (c) {
    var q = U.plainText(c.query.q || '').toLowerCase();
    var trash = c.query.trash === '1';
    var group = c.query.group || ''; // '' 全部 | 'none' 未分组 | 分组 ID
    var list = [];
    db.notes.items.forEach(function (n) {
      if (n.ownerId !== c.user.id) return;
      if (!!n.deleted !== trash) return;
      if (!trash) {
        if (group === 'none') { if (n.groupId) return; }
        else if (group) { if (n.groupId !== group) return; }
      }
      if (q) {
        var hay = (n.title + ' ' + U.plainText(n.content)).toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      list.push(listItem(n));
    });
    list.sort(function (a, b2) {
      if (!!a.pinned !== !!b2.pinned) return a.pinned ? -1 : 1;
      return a.updatedAt < b2.updatedAt ? 1 : -1;
    });
    U.json(c.res, 200, { notes: list });
  });

  route('POST', '/api/notes', { auth: 'user', body: 'json' }, function (c) {
    var n = {
      id: U.uid(10), ownerId: c.user.id,
      title: sanitize.textOnly((c.body || {}).title, 200),
      content: sanitize.sanitizeHtml((c.body || {}).content, MAX_CONTENT),
      groupId: validGroupId(db, c.user, (c.body || {}).groupId),
      pinned: false, deleted: false, deletedAt: null,
      share: null, createdAt: U.nowIso(), updatedAt: U.nowIso()
    };
    db.notes.items.push(n);
    db.notes.save();
    U.json(c.res, 200, { note: fullNote(n) });
  });

  route('GET', '/api/notes/:id', { auth: 'user' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    U.json(c.res, 200, { note: fullNote(n) });
  });

  route('PUT', '/api/notes/:id', { auth: 'user', body: 'json' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    var b = c.body || {};
    var changed = false;
    if (b.title !== undefined) { n.title = sanitize.textOnly(b.title, 200); changed = true; }
    if (b.content !== undefined && typeof b.content === 'string' && b.content.length <= MAX_CONTENT) {
      n.content = sanitize.sanitizeHtml(b.content, MAX_CONTENT);
      changed = true;
    }
    if (b.groupId !== undefined) n.groupId = validGroupId(db, c.user, b.groupId); // 移动分组不更新时间
    if (changed) n.updatedAt = U.nowIso();
    db.notes.save();
    U.json(c.res, 200, { note: fullNote(n) });
  });

  route('DELETE', '/api/notes/:id', { auth: 'user' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    if (c.query.purge === '1') {
      db.media.items.forEach(function (m) { if (m.noteId === n.id) deleteMediaFile(m); });
      db.media.items = db.media.items.filter(function (m) { return m.noteId !== n.id; });
      if (n.share) shareKeys.delete(n.share.token);
      db.notes.items = db.notes.items.filter(function (x) { return x.id !== n.id; });
      db.media.save();
    } else {
      n.deleted = true;
      n.deletedAt = U.nowIso();
      if (n.share) shareKeys.delete(n.share.token); // 进回收站即失效分享
    }
    db.notes.save();
    U.json(c.res, 200, { ok: true });
  });

  route('POST', '/api/notes/:id/restore', { auth: 'user', body: 'json' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    n.deleted = false;
    n.deletedAt = null;
    db.notes.save();
    U.json(c.res, 200, { note: fullNote(n) });
  });

  route('POST', '/api/notes/:id/pin', { auth: 'user', body: 'json' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    n.pinned = !!(c.body || {}).pinned;
    db.notes.save();
    U.json(c.res, 200, { note: fullNote(n) });
  });

  // ===== 自定义分组 =====
  route('GET', '/api/groups', { auth: 'user' }, function (c) {
    var uid = c.user.id;
    var groups = db.groups.items.filter(function (g) { return g.ownerId === uid; });
    groups.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    var list = groups.map(function (g) {
      return {
        id: g.id, name: g.name, createdAt: g.createdAt,
        count: db.notes.items.filter(function (n) {
          return n.ownerId === uid && !n.deleted && n.groupId === g.id;
        }).length
      };
    });
    var ungrouped = 0, total = 0;
    db.notes.items.forEach(function (n) {
      if (n.ownerId !== uid || n.deleted) return;
      total++;
      if (!n.groupId) ungrouped++;
    });
    U.json(c.res, 200, { groups: list, ungrouped: ungrouped, total: total });
  });

  route('POST', '/api/groups', { auth: 'user', body: 'json' }, function (c) {
    var name = sanitize.textOnly((c.body || {}).name, 30);
    if (!name) return U.fail(c.res, 400, '请输入分组名称');
    if (findGroupByName(db, c.user.id, name)) return U.fail(c.res, 400, '同名分组已存在');
    var g = { id: U.uid(8), ownerId: c.user.id, name: name, createdAt: U.nowIso() };
    db.groups.items.push(g);
    db.groups.save();
    U.json(c.res, 200, { group: { id: g.id, name: g.name, createdAt: g.createdAt } });
  });

  route('PUT', '/api/groups/:id', { auth: 'user', body: 'json' }, function (c) {
    var g = findGroup(db, c.params.id, c.user.id);
    if (!g) return U.fail(c.res, 404, '分组不存在');
    var name = sanitize.textOnly((c.body || {}).name, 30);
    if (!name) return U.fail(c.res, 400, '请输入分组名称');
    var dup = findGroupByName(db, c.user.id, name);
    if (dup && dup.id !== g.id) return U.fail(c.res, 400, '同名分组已存在');
    g.name = name;
    db.groups.save();
    U.json(c.res, 200, { group: { id: g.id, name: g.name, createdAt: g.createdAt } });
  });

  route('DELETE', '/api/groups/:id', { auth: 'user' }, function (c) {
    var g = findGroup(db, c.params.id, c.user.id);
    if (!g) return U.fail(c.res, 404, '分组不存在');
    // 组内笔记移回未分组，笔记本身不删除
    db.notes.items.forEach(function (n) {
      if (n.ownerId === c.user.id && n.groupId === g.id) n.groupId = null;
    });
    db.groups.items = db.groups.items.filter(function (x) { return x.id !== g.id; });
    db.groups.save();
    db.notes.save();
    U.json(c.res, 200, { ok: true });
  });

  // ===== 分享 =====
  route('POST', '/api/notes/:id/share', { auth: 'user', body: 'json' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    var b = c.body || {};
    var mode = b.mode === 'password' ? 'password' : 'open';
    if (n.share) shareKeys.delete(n.share.token); // 重新生成即吊销旧链接
    var share = { token: U.uid(22), mode: mode, createdAt: U.nowIso(), salt: '', hash: '' };
    if (mode === 'password') {
      var pw = String(b.password == null ? '' : b.password);
      if (pw.length < 1 || pw.length > 64) return U.fail(c.res, 400, '请设置 1-64 位访问密码');
      var h = hashPass(pw);
      share.salt = h.salt;
      share.hash = h.hash;
    }
    n.share = share;
    db.notes.save();
    U.json(c.res, 200, { token: share.token, mode: mode, url: '/s/' + share.token });
  });

  route('DELETE', '/api/notes/:id/share', { auth: 'user' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    if (n.share) shareKeys.delete(n.share.token);
    n.share = null;
    db.notes.save();
    U.json(c.res, 200, { ok: true });
  });

  // ===== 图片上传（原始字节 + 头部声明类型） =====
  route('POST', '/api/notes/:id/media', { auth: 'user', body: 'raw' }, function (c) {
    var n = findNote(db, c.params.id);
    if (!n || n.ownerId !== c.user.id) return U.fail(c.res, 404, '笔记不存在');
    var mime = String(c.req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    var ext = IMAGE_TYPES[mime];
    if (!ext) return U.fail(c.res, 400, '仅支持 png / jpg / gif / webp / bmp 图片');
    var buf = c.body || Buffer.alloc(0);
    if (!buf.length) return U.fail(c.res, 400, '上传内容为空');
    if (!sniffImage(buf, mime)) return U.fail(c.res, 400, '文件内容与图片格式不符');
    var file = U.uid(14) + '.' + ext;
    fs.writeFileSync(path.join(mediaDir, file), buf);
    db.media.items.push({
      file: file, noteId: n.id, ownerId: c.user.id,
      mime: mime, size: buf.length, createdAt: U.nowIso()
    });
    db.media.save();
    U.json(c.res, 200, { url: '/media/' + file, size: buf.length });
  });

  // ===== 公开分享（无需登录） =====
  function findSharedNote(token) {
    for (var i = 0; i < db.notes.items.length; i++) {
      var n = db.notes.items[i];
      if (n.share && n.share.token === token && !n.deleted) return n;
    }
    return null;
  }

  function validShareKey(token, k) {
    var e = shareKeys.get(token);
    if (!e || !k || e.k !== k) return false;
    if (e.exp < Date.now()) { shareKeys.delete(token); return false; }
    e.exp = Date.now() + 30 * 60 * 1000; // 滑动续期 30 分钟
    return true;
  }

  // 输出给分享页的 HTML：媒体地址追加访问凭据
  function shareHtml(n, token, k) {
    return String(n.content || '').replace(/(src=")(\/media\/[^"]+)(")/g, function (all, a, u, z) {
      return a + u + '?st=' + token + (k ? '&k=' + k : '') + z;
    });
  }

  route('GET', '/api/share/:token', { auth: 'none' }, function (c) {
    var n = findSharedNote(c.params.token);
    if (!n) return U.fail(c.res, 404, '分享不存在或已关闭');
    var k = null;
    if (n.share.mode === 'password') {
      k = c.query.k || null;
      if (!validShareKey(n.share.token, k)) {
        return U.json(c.res, 401, { needPassword: true });
      }
    }
    var owner = findUser(db, n.ownerId);
    U.json(c.res, 200, {
      title: n.title || '无标题笔记',
      html: shareHtml(n, n.share.token, k),
      updatedAt: n.updatedAt,
      authorName: owner ? (owner.name || owner.username) : '',
      mode: n.share.mode
    });
  });

  route('POST', '/api/share/:token/unlock', { auth: 'none', body: 'json' }, function (c) {
    var n = findSharedNote(c.params.token);
    if (!n) return U.fail(c.res, 404, '分享不存在或已关闭');
    if (n.share.mode !== 'password') return U.fail(c.res, 400, '该分享无需密码');
    var lk = 'share:' + n.share.token + ':' + clientIp(c.req);
    if (limits.blocked(lk)) return U.fail(c.res, 429, '尝试过于频繁，请 10 分钟后再试');
    if (!auth.verifyPassword((c.body || {}).password == null ? '' : c.body.password, n.share.salt, n.share.hash)) {
      var fails = limits.fail(lk, 10 * 60 * 1000);
      if (fails >= 10) limits.lock(lk, 10 * 60 * 1000);
      return U.fail(c.res, 401, '访问密码不正确');
    }
    limits.clear(lk);
    var k = U.uid(32);
    shareKeys.set(n.share.token, { k: k, exp: Date.now() + 30 * 60 * 1000 });
    U.json(c.res, 200, { k: k });
  });

  return {
    routes: routes,
    // 媒体访问鉴权 + 输出（供 server.js 静态层调用）
    serveMedia: function (req, res, file, query, user) {
      var m = findMedia(db, file);
      if (!m) return U.fail(res, 404, 'Not Found');
      var note = findNote(db, m.noteId);

      var ok = false;
      if (query.st && note && note.share && note.share.token === query.st && !note.deleted) {
        if (note.share.mode === 'open') {
          ok = true;
        } else if (validShareKey(note.share.token, query.k || '')) {
          ok = true;
        }
      }
      if (!ok && user && (user.id === m.ownerId || user.role === 'admin')) {
        ok = true;
      }
      if (!ok) return U.fail(res, 404, 'Not Found');

      var fp = path.join(mediaDir, m.file);
      fs.readFile(fp, function (e, buf) {
        if (e) return U.fail(res, 404, 'Not Found');
        res.writeHead(200, {
          'Content-Type': m.mime,
          'Content-Length': buf.length,
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(buf);
      });
    },
    // 启动时清理孤儿媒体（笔记已删或内容不再引用）
    sweepMedia: function () {
      var removed = 0;
      db.media.items = db.media.items.filter(function (m) {
        var note = findNote(db, m.noteId);
        var ref = note && note.content && note.content.indexOf('/media/' + m.file) !== -1;
        if (!ref) { deleteMediaFile(m); removed++; return false; }
        return true;
      });
      if (removed) {
        db.media.save();
        console.log('[api] 已清理未引用媒体文件 ' + removed + ' 个');
      }
    }
  };
}

module.exports = { createApi: createApi, Limiter: Limiter, VERSION: VERSION };
