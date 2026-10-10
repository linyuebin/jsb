/* ============================================================
   RichEditor —— 零依赖 contenteditable 富文本编辑器
   支持图文混排：标题/加粗斜体/列表/引用/代码块/链接/分割线/图片
   图片通过 opts.uploadFile(file) -> Promise<url> 上传后插入
   ============================================================ */
(function () {
  'use strict';

  // ---------- SVG 图标 ----------
  var I = {
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>',
    redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>',
    h1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h6M4 6v12M14 6v12M14 18h6"/></svg>',
    h2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h6M4 6v12M14.5 8a2.5 2.5 0 0 1 4.5 1.5c0 2-4.5 4-4.5 4H20"/></svg>',
    para: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    bold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/></svg>',
    italic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    underline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a6 6 0 0 0 12 0V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>',
    strike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3-1.8 4-4.5 4-9H3V6h7v6c0 5.5-2.5 8-7 9z"/><path d="M14 21c3-1.8 4-4.5 4-9h-4V6h7v6c0 5.5-2.5 8-7 9z" transform="translate(-1,0)"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    ul: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>',
    ol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><text x="2" y="8" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2" y="14.5" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2" y="20.5" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    unlink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M5.17 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>',
    hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="3" rx="1" fill="currentColor" stroke="none" opacity=".35"/><rect x="4" y="10.5" width="16" height="3" rx="1" fill="currentColor" stroke="none"/><rect x="4" y="16" width="16" height="3" rx="1" fill="currentColor" stroke="none" opacity=".35"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0l5.2 5.2a2 2 0 0 1 0 2.8L13 19.4"/><line x1="7.5" y1="10.5" x2="13.5" y2="16.5"/></svg>'
  };

  function RichEditor(mount, opts) {
    opts = opts || {};
    this.mount = mount;
    this.uploadFile = opts.uploadFile || null;
    this.maxUploadMB = opts.maxUploadMB || 10;
    this.onChanged = opts.onChanged || null;
    this._savedRange = null;

    mount.innerHTML = '';
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'ed-toolbar';
    this.area = document.createElement('div');
    this.area.className = 'ed-area rich';
    this.area.contentEditable = 'true';
    this.area.setAttribute('data-placeholder', opts.placeholder || '开始记录… 支持文字、图片混排');
    this.area.setAttribute('spellcheck', 'false');
    mount.appendChild(this.toolbar);
    mount.appendChild(this.area);

    this._buildToolbar();
    this._bind();
  }

  RichEditor.prototype._buildToolbar = function () {
    var self = this;
    var defs = [
      { icon: 'undo', title: '撤销', run: function () { self.exec('undo'); } },
      { icon: 'redo', title: '重做', run: function () { self.exec('redo'); } },
      { sep: true },
      { icon: 'h1', title: '大标题', block: 'h2', group: 'block' },
      { icon: 'h2', title: '小标题', block: 'h3', group: 'block' },
      { icon: 'para', title: '正文', block: 'p', group: 'block' },
      { sep: true },
      { icon: 'bold', title: '加粗', cmd: 'bold' },
      { icon: 'italic', title: '斜体', cmd: 'italic' },
      { icon: 'underline', title: '下划线', cmd: 'underline' },
      { icon: 'strike', title: '删除线', cmd: 'strikeThrough' },
      { sep: true },
      { icon: 'quote', title: '引用', block: 'blockquote', group: 'block' },
      { icon: 'code', title: '代码块', block: 'pre', group: 'block' },
      { icon: 'ul', title: '无序列表', cmd: 'insertUnorderedList' },
      { icon: 'ol', title: '有序列表', cmd: 'insertOrderedList' },
      { sep: true },
      { icon: 'link', title: '插入链接', run: function () { self._linkDialog(); } },
      { icon: 'unlink', title: '取消链接', run: function () { self.exec('unlink'); } },
      { icon: 'hr', title: '分割线', run: function () { self.exec('insertHorizontalRule'); } },
      { icon: 'image', title: '插入图片', run: function () { self._pickImage(); } },
      { sep: true },
      { icon: 'clear', title: '清除格式', run: function () { self.exec('removeFormat'); self._setBlock('p'); } }
    ];
    this._btns = [];
    defs.forEach(function (d) {
      if (d.sep) {
        var s = document.createElement('span');
        s.className = 'tb-sep';
        self.toolbar.appendChild(s);
        return;
      }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn';
      b.title = d.title;
      b.innerHTML = I[d.icon];
      b.setAttribute('data-title', d.title);
      if (d.group) b.setAttribute('data-block', d.block);
      if (d.cmd) b.setAttribute('data-cmd', d.cmd);
      b.addEventListener('mousedown', function (e) {
        // 防止点击按钮时编辑区失焦
        e.preventDefault();
      });
      b.addEventListener('click', function () {
        self.area.focus();
        if (d.run) d.run();
        else if (d.block) self._setBlock(d.block);
        else if (d.cmd) self.exec(d.cmd);
        self._fireChange();
        self._refreshStates();
      });
      self.toolbar.appendChild(b);
      self._btns.push({ el: b, def: d });
    });
  };

  RichEditor.prototype._bind = function () {
    var self = this;

    // 记录光标，供弹窗后恢复
    this.area.addEventListener('keyup', function () { self._saveRange(); });
    this.area.addEventListener('mouseup', function () { self._saveRange(); });
    this.area.addEventListener('focus', function () { self._saveRange(); });

    var fireTimer = null;
    this.area.addEventListener('input', function () {
      self._saveRange();
      clearTimeout(fireTimer);
      fireTimer = setTimeout(function () { self._fireChange(); }, 120);
    });

    document.addEventListener('selectionchange', function () {
      if (document.activeElement === self.area) {
        self._saveRange();
        self._refreshStates();
      }
    });

    // 粘贴图片 / 拖拽图片 → 上传
    this.area.addEventListener('paste', function (e) {
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) {
        e.preventDefault();
        self._uploadFiles(files);
        return;
      }
      // 纯文本粘贴（去除外来样式，多行按 <br> 处理）
      var html = e.clipboardData && e.clipboardData.getData('text/html');
      if (html) {
        e.preventDefault();
        var text = e.clipboardData.getData('text/plain');
        if (text.indexOf('\n') === -1) {
          document.execCommand('insertText', false, text);
        } else {
          var lines = text.replace(/\r\n?/g, '\n').split('\n').map(function (l) {
            return escapeHtml(l) || '<br>';
          });
          document.execCommand('insertHTML', false, lines.join('<br>'));
        }
      }
    });

    this.area.addEventListener('dragover', function (e) { e.preventDefault(); });
    this.area.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        e.preventDefault();
        self._uploadFiles(files);
      }
    });

    // Tab 键在代码块中插入缩进
    this.area.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    });
  };

  RichEditor.prototype._saveRange = function () {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && self_or_child(this.area, sel.getRangeAt(0).commonAncestorContainer)) {
      this._savedRange = sel.getRangeAt(0).cloneRange();
    }
  };

  function self_or_child(root, node) {
    if (node === root) return true;
    var n = node;
    while (n) {
      if (n === root) return true;
      n = n.parentNode;
    }
    return false;
  }

  RichEditor.prototype._restoreRange = function () {
    if (this._savedRange) {
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(this._savedRange);
    }
  };

  RichEditor.prototype.exec = function (cmd, val) {
    try { document.execCommand(cmd, false, val === undefined ? null : val); } catch (e) {}
  };

  RichEditor.prototype._setBlock = function (tag) {
    this.exec('formatBlock', '<' + tag + '>');
  };

  RichEditor.prototype._refreshStates = function () {
    var self = this;
    var block = '';
    try { block = (document.queryCommandValue('formatBlock') || 'p').toLowerCase(); } catch (e) {}
    this._btns.forEach(function (b) {
      var on = false;
      if (b.def.cmd) {
        try { on = document.queryCommandState(b.def.cmd); } catch (e) {}
      } else if (b.def.group === 'block') {
        on = block === b.def.block;
      }
      b.el.classList.toggle('on', !!on);
    });
  };

  RichEditor.prototype._fireChange = function () {
    if (this.onChanged) this.onChanged(this);
  };

  RichEditor.prototype.getHtml = function () {
    return this.area.innerHTML;
  };

  RichEditor.prototype.setHtml = function (html) {
    this.area.innerHTML = html || '';
    this._savedRange = null;
    this._refreshStates();
  };

  RichEditor.prototype.isEmpty = function () {
    return this.area.textContent.replace(/​/g, '').trim() === '' && this.area.getElementsByTagName('img').length === 0;
  };

  RichEditor.prototype.textLength = function () {
    return this.area.textContent.replace(/\s+/g, ' ').trim().length;
  };

  RichEditor.prototype.focus = function () {
    this.area.focus();
    // 光标移到末尾
    var rng = document.createRange();
    rng.selectNodeContents(this.area);
    rng.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rng);
  };

  // ---------- 图片 ----------
  RichEditor.prototype._pickImage = function () {
    var self = this;
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
    input.multiple = true;
    input.onchange = function () {
      if (input.files && input.files.length) self._uploadFiles(input.files);
    };
    input.click();
  };

  RichEditor.prototype._uploadFiles = function (fileList) {
    var self = this;
    if (!this.uploadFile) return;
    var files = Array.prototype.slice.call(fileList);
    this._fireChange(); // 先触发保存，确保笔记已落库（上传需要笔记 ID）
    var seq = Promise.resolve();
    files.forEach(function (f) {
      seq = seq.then(function () {
        if (f.size > self.maxUploadMB * 1024 * 1024) {
          if (self.onToast) self.onToast('图片 ' + f.name + ' 超过 ' + self.maxUploadMB + 'MB，已跳过');
          return null;
        }
        return self.uploadFile(f).then(function (url) {
          self.insertImage(url);
          self._fireChange();
          return url;
        }).catch(function (e) {
          if (self.onToast) self.onToast((e && e.message) || '图片上传失败');
          return null;
        });
      });
    });
  };

  RichEditor.prototype.insertImage = function (url) {
    this._restoreRange();
    this.area.focus();
    this.exec('insertHTML', '<img src="' + url + '" alt="">');
  };

  // ---------- 链接弹窗 ----------
  RichEditor.prototype._linkDialog = function () {
    var self = this;
    var sel = window.getSelection();
    var selected = sel ? String(sel) : '';
    this._linkPrompt(selected ? '为选中文字设置链接，直接输入网址：' : '输入网址（将插入链接文字）：', 'https://')
      .then(function (url) {
        if (!url) return;
        self._restoreRange();
        self.area.focus();
        if (selected) {
          self.exec('createLink', url);
        } else {
          self.exec('insertHTML', '<a href="' + escapeAttr(url) + '">' + escapeHtml(url) + '</a>&nbsp;');
        }
        self._fireChange();
        self._refreshStates();
      });
  };

  // 轻量输入弹窗（避免原生 prompt 的观感问题）
  RichEditor.prototype._linkPrompt = function (msg, value) {
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="modal" style="max-width:360px">' +
        '<div class="modal-head"><h3>插入链接</h3></div>' +
        '<div class="modal-body">' +
        '<label>' + escapeHtml(msg) + '<input type="text" class="lp-input"></label>' +
        '<div class="modal-actions">' +
        '<button class="btn lp-cancel">取消</button>' +
        '<button class="btn btn-primary lp-ok">确定</button></div></div></div>';
      document.body.appendChild(mask);
      var input = mask.querySelector('.lp-input');
      input.value = value || '';
      setTimeout(function () { input.focus(); input.select(); }, 30);
      function close(v) {
        mask.remove();
        resolve(v);
      }
      mask.querySelector('.lp-cancel').addEventListener('click', function () { close(null); });
      mask.querySelector('.lp-ok').addEventListener('click', function () { close(input.value.trim() || null); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') close(input.value.trim() || null);
        if (e.key === 'Escape') close(null);
      });
      mask.addEventListener('mousedown', function (e) {
        if (e.target === mask) close(null);
      });
    });
  };

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  window.RichEditor = RichEditor;
})();
