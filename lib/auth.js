'use strict';
// 口令哈希（scrypt）与会话管理（内存态，重启后需重新登录）
var crypto = require('crypto');

var COOKIE_NAME = 'jsb_sid';
var SESSION_TTL = 7 * 24 * 3600 * 1000; // 7 天

function hashPassword(pw) {
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt: salt, hash: hash };
}

function verifyPassword(pw, salt, hash) {
  try {
    var h = crypto.scryptSync(String(pw), String(salt), 64);
    return crypto.timingSafeEqual(h, Buffer.from(String(hash), 'hex'));
  } catch (e) {
    return false;
  }
}

function Sessions() {
  this.map = new Map(); // token -> { userId, expires }
  var self = this;
  setInterval(function () { self.sweep(); }, 10 * 60 * 1000).unref();
}

Sessions.prototype.create = function (userId) {
  var token = crypto.randomBytes(32).toString('hex');
  this.map.set(token, { userId: userId, expires: Date.now() + SESSION_TTL });
  return token;
};

Sessions.prototype.get = function (token) {
  if (!token) return null;
  var s = this.map.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    this.map.delete(token);
    return null;
  }
  return s;
};

// 滑动续期：临近过期时延长
Sessions.prototype.touch = function (token) {
  var s = this.map.get(token);
  if (s && s.expires - Date.now() < 3 * 24 * 3600 * 1000) {
    s.expires = Date.now() + SESSION_TTL;
  }
};

Sessions.prototype.destroy = function (token) {
  if (token) this.map.delete(token);
};

Sessions.prototype.destroyByUser = function (userId) {
  var self = this;
  this.map.forEach(function (s, token) {
    if (s.userId === userId) self.map.delete(token);
  });
};

Sessions.prototype.sweep = function () {
  var now = Date.now();
  this.map.forEach(function (s, token) {
    if (s.expires < now) this.delete(token);
  }, this.map);
};

function sessionCookie(token) {
  return COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL / 1000);
}

function clearCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

module.exports = {
  COOKIE_NAME: COOKIE_NAME,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  Sessions: Sessions,
  sessionCookie: sessionCookie,
  clearCookie: clearCookie
};
