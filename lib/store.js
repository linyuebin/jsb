'use strict';
// 极简 JSON 持久化：内存态 + 防抖原子写盘（tmp + rename）
// 数据量级为个人/小团队笔记，JSON 足够，且便于客户备份
var fs = require('fs');
var path = require('path');

function Collection(file) {
  this.file = file;
  this.items = [];
  this._timer = null;
  this._loading = true;
  try {
    var raw = fs.readFileSync(file, 'utf8');
    var data = JSON.parse(raw);
    if (Array.isArray(data)) this.items = data;
    else throw new Error('格式错误');
  } catch (e) {
    // 文件不存在（首次启动）或损坏：损坏时留档备份，重新开始
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (e2) {}
      console.error('[store] 数据文件损坏，已备份并重建: ' + file);
    }
  }
  this._loading = false;
  this.flush();
}

Collection.prototype.save = function () {
  if (this._loading) return;
  if (this._timer) return;
  var self = this;
  this._timer = setTimeout(function () {
    self._timer = null;
    self.flush();
  }, 300);
};

Collection.prototype.flush = function () {
  try {
    var tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.items));
    fs.renameSync(tmp, this.file);
  } catch (e) {
    console.error('[store] 写盘失败: ' + this.file + ' -> ' + e.message);
  }
};

module.exports = { Collection: Collection };
