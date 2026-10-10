/* ============================================================
   记事簿 · 前端主逻辑
   视图：初始化 / 登录 / 笔记列表 + 编辑器 / 回收站 / 用户管理
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function e(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- API 封装 ----------
  function api(method, url, body) {
    var opt = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(url, opt).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (err) {}
        if (res.status === 401 && url !== '/api/login' && url !== '/api/setup') {
          onUnauthorized();
          throw { status: 401, message: (data && data.error) || '请先登录' };
        }
        if (!res.ok) throw { status: res.status, message: (data && data.error) || ('请求失败 (' + res.status + ')') };
        return data;
      });
    });
  }

  // ---------- 状态 ----------
  var S = {
    user: null,
    notes: [],
    tab: 'notes',       // notes | trash
    group: 'all',       // 'all' | 'none' | 分组 ID（仅 tab=notes 时生效）
    groups: [],
    total: 0,
    ungrouped: 0,
    q: '',
    cur: null,          // 当前笔记 { id, title, content, pinned, share, groupId }
    virtual: false,     // 新建未落库
    dirty: false,
    saveTimer: null,
    saveChain: Promise.resolve(),
    editor: null,
    inAdmin: false
  };

  // ---------- DOM ----------
  var viewSetup = $('#view-setup'), viewLogin = $('#view-login'), viewApp = $('#view-app');
  var noteList = $('#note-list'), searchInput = $('#search');
  var emptyPane = $('#empty'), editorPane = $('#editor-pane'), adminPane = $('#admin-pane');
  var titleInput = $('#ed-title'), saveStatus = $('#save-status');
  var pinBtn = $('#pin-btn'), wordCount = $('#word-count'), shareBadge = $('#share-badge');
  var modalMask = $('#modal-mask'), modalTitle = $('#modal-title'), modalBody = $('#modal-body');

  // ---------- 视图切换 ----------
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function showSetup() { hide(viewLogin); hide(viewApp); show(viewSetup); show($('#theme-btn-auth')); }
  function showLogin() {
    hide(viewSetup); hide(viewApp); show(viewLogin);
    show($('#theme-btn-auth'));
    $('#login-form').reset();
    setTimeout(function () { $('#login-form [name=username]').focus(); }, 50);
  }
  function showApp() {
    hide(viewSetup); hide(viewLogin); show(viewApp);
    hide($('#theme-btn-auth')); // 应用内改用侧边栏切换入口
  }

  function onUnauthorized() {
    if (!viewApp.classList.contains('hidden')) {
      showLogin();
      toast('登录已失效，请重新登录', 'err');
    }
  }

  // ---------- Toast ----------
  var toastWrap = $('#toast-wrap');
  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    toastWrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 320);
    }, 2200);
  }

  // ---------- 弹窗 ----------
  var modalOnClose = null;
  function openModal(title, node) {
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    modalBody.appendChild(node);
    show(modalMask);
  }
  function closeModal() {
    hide(modalMask);
    if (modalOnClose) { var f = modalOnClose; modalOnClose = null; f(); }
  }
  $('#modal-close').addEventListener('click', closeModal);
  modalMask.addEventListener('mousedown', function (ev) {
    if (ev.target === modalMask) closeModal();
  });

  function confirmModal(title, text, okText) {
    return new Promise(function (resolve) {
      var box = document.createElement('div');
      box.innerHTML = '<p style="color:var(--text-2);line-height:1.7">' + e(text) + '</p>' +
        '<div class="modal-actions">' +
        '<button class="btn" data-r="0">取消</button>' +
        '<button class="btn btn-danger" data-r="1">' + e(okText || '确定') + '</button></div>';
      openModal(title, box);
      $$('button', box).forEach(function (b) {
        b.addEventListener('click', function () {
          closeModal();
          resolve(b.getAttribute('data-r') === '1');
        });
      });
    });
  }

  // ---------- 时间格式 ----------
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtClock(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function fmtList(iso) {
    var d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtClock(d);
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ============================================================
     启动
     ============================================================ */
  function boot() {
    bindAuthForms();
    api('GET', '/api/status').then(function (st) {
      $('#brand-name').textContent = st.siteName || '记事簿';
      document.title = st.siteName || '记事簿';
      if (st.needsSetup) return showSetup();
      return api('GET', '/api/me').then(function (me) {
        enterApp(me.user);
      }).catch(function () { showLogin(); });
    }).catch(function () { showLogin(); });
  }

  function bindAuthForms() {
    $('#setup-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var err = $('#setup-error');
      err.textContent = '';
      if (f.password.value !== f.password2.value) { err.textContent = '两次输入的密码不一致'; return; }
      api('POST', '/api/setup', {
        username: f.username.value.trim(),
        name: f.name.value.trim(),
        password: f.password.value
      }).then(function (r) {
        enterApp(r.user);
      }).catch(function (er) { err.textContent = er.message || '初始化失败'; });
    });

    $('#login-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var err = $('#login-error');
      err.textContent = '';
      api('POST', '/api/login', {
        username: f.username.value.trim(),
        password: f.password.value
      }).then(function (r) {
        enterApp(r.user);
      }).catch(function (er) { err.textContent = er.message || '登录失败'; });
    });
  }

  function enterApp(user) {
    S.user = user;
    showApp();
    $('#user-name').textContent = user.name || user.username;
    $('#avatar').textContent = (user.name || user.username).charAt(0).toUpperCase();
    if (user.role === 'admin') show($('#menu-admin'));
    initEditor();
    bindAppEvents();
    loadGroups();
    loadList();
    showListPane(); // 移动端默认列表
  }

  /* ============================================================
     编辑器
     ============================================================ */
  function initEditor() {
    if (S.editor) return;
    S.editor = new RichEditor($('#ed-workspace'), {
      placeholder: '开始记录… 支持文字、图片混排，图片可直接粘贴或拖入',
      maxUploadMB: 10,
      uploadFile: uploadImage,
      onChanged: function () { onContentChange(); }
    });
    S.editor.onToast = function (m) { toast(m, 'err'); };
  }

  function uploadImage(file) {
    return ensureNote().then(function () {
      return fetch('/api/notes/' + S.cur.id + '/media', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data && data.error || '图片上传失败');
          return data.url;
        });
      });
    });
  }

  // 新建笔记首次插入图片时先落库（上传需要笔记 ID）
  function ensureNote() {
    if (S.cur && S.cur.id) return Promise.resolve();
    return doSave(true);
  }

  function onContentChange() {
    S.dirty = true;
    setStatus('未保存');
    wordCount.textContent = S.editor.textLength() + ' 字';
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(function () { saveCurrent(); }, 800);
  }

  function setStatus(text, cls) {
    saveStatus.textContent = text;
    saveStatus.className = 'ed-meta' + (cls ? ' ' + cls : '');
  }

  function saveCurrent() {
    S.saveChain = S.saveChain.then(function () { return doSave(false); })
      .catch(function (err) {
        if (err && err.status !== 401) toast(err.message || '保存失败', 'err');
        setStatus('保存失败', 'err');
      });
    return S.saveChain;
  }

  function doSave(force) {
    if (!S.cur) return Promise.resolve();
    var title = titleInput.value.trim();
    var html = S.editor.getHtml();
    var isEmptyNew = S.virtual && !title && S.editor.isEmpty();
    var wasVirtual = S.virtual;

    if (!force && !S.dirty && !S.virtual) return Promise.resolve();
    if (isEmptyNew) return Promise.resolve();

    setStatus('保存中…', 'saving');
    var p;
    if (S.virtual) {
      p = api('POST', '/api/notes', { title: title, content: html, groupId: S.cur.groupId || null }).then(function (r) {
        S.cur.id = r.note.id;
        S.cur.share = r.note.share;
        S.virtual = false;
      });
    } else {
      if (!S.dirty && !force) { p = Promise.resolve(); }
      else p = api('PUT', '/api/notes/' + S.cur.id, { title: title, content: html });
    }
    return p.then(function () {
      S.dirty = false;
      S.cur.title = title;
      setStatus('已保存 · ' + fmtClock(new Date()), 'saved');
      loadList();
      if (wasVirtual) loadGroups(); // 新建落库后刷新分组计数
    });
  }

  /* ============================================================
     笔记列表
     ============================================================ */
  function loadList() {
    var url = '/api/notes' + (S.tab === 'trash' ? '?trash=1' : '');
    if (S.tab === 'notes' && S.group !== 'all') {
      url += (url.indexOf('?') < 0 ? '?' : '&') + 'group=' + encodeURIComponent(S.group);
    }
    if (S.q) url += (url.indexOf('?') < 0 ? '?' : '&') + 'q=' + encodeURIComponent(S.q);
    return api('GET', url).then(function (r) {
      S.notes = r.notes;
      renderList();
    }).catch(function () {});
  }

  /* ============================================================
     自定义分组
     ============================================================ */
  function loadGroups() {
    return api('GET', '/api/groups').then(function (r) {
      S.groups = r.groups;
      S.total = r.total;
      S.ungrouped = r.ungrouped;
      renderNav();
    }).catch(function () {});
  }

  function renderNav() {
    $('#count-all').textContent = S.total || '';
    $('#count-none').textContent = S.ungrouped || '';
    $$('#side-nav .nav-item').forEach(function (t) {
      var nav = t.getAttribute('data-nav');
      var active = nav === 'trash' ? S.tab === 'trash' : (S.tab === 'notes' && S.group === nav);
      t.classList.toggle('active', active);
    });
    var box = $('#group-list');
    box.innerHTML = '';
    if (!S.groups.length) {
      var d = document.createElement('div');
      d.className = 'group-empty';
      d.textContent = '暂无分组，点右上 + 创建';
      box.appendChild(d);
      return;
    }
    S.groups.forEach(function (g) {
      var row = document.createElement('div');
      row.className = 'group-row' + (S.tab === 'notes' && S.group === g.id ? ' active' : '');
      row.setAttribute('data-gid', g.id);
      row.innerHTML =
        '<span class="g-name">' + e(g.name) + '</span>' +
        '<span class="g-count">' + (g.count || '') + '</span>' +
        '<span class="g-acts">' +
        '<button type="button" data-ga="rename" title="重命名"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg></button>' +
        '<button type="button" data-ga="del" title="删除分组"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
        '</span>';
      box.appendChild(row);
    });
  }

  function groupEditModal(g) {
    var box = document.createElement('div');
    box.innerHTML =
      '<label>分组名称<input maxlength="30" placeholder="如：工作 / 账号 / 灵感"></label>' +
      '<div class="form-error"></div>' +
      '<div class="modal-actions"><button class="btn" data-a="c">取消</button>' +
      '<button class="btn btn-primary" data-a="s">' + (g ? '保存' : '创建') + '</button></div>';
    var input = box.querySelector('input');
    input.value = g ? g.name : '';
    openModal(g ? '重命名分组' : '新建分组', box);
    setTimeout(function () { input.focus(); }, 30);
    box.querySelector('[data-a=c]').addEventListener('click', closeModal);
    box.querySelector('[data-a=s]').addEventListener('click', function () {
      var err = box.querySelector('.form-error');
      err.textContent = '';
      var name = input.value.trim();
      if (!name) { err.textContent = '请输入分组名称'; return; }
      var p = g ? api('PUT', '/api/groups/' + g.id, { name: name })
                : api('POST', '/api/groups', { name: name });
      p.then(function () {
        toast(g ? '已重命名' : '分组已创建', 'ok');
        closeModal();
        loadGroups();
        if (S.tab === 'notes') loadList(); // 列表项上的分组徽标需刷新
      }).catch(function (er) { err.textContent = er.message; });
    });
  }

  function deleteGroupConfirm(g) {
    confirmModal('删除分组', '删除分组「' + g.name + '」不会删除笔记，组内笔记将移至「未分组」。', '删除').then(function (ok) {
      if (!ok) return;
      api('DELETE', '/api/groups/' + g.id).then(function () {
        toast('分组已删除', 'ok');
        if (S.group === g.id) { S.group = 'all'; }
        loadGroups();
        loadList();
      }).catch(function (er) { toast(er.message, 'err'); });
    });
  }

  // 移动笔记到分组
  function moveModal() {
    if (!S.cur || !S.cur.id) { toast('请先保存笔记再移动', 'err'); return; }
    saveCurrent().then(function () {
      var cur = S.cur.groupId || null;
      var box = document.createElement('div');
      var html = moveOptRow('', '未分组', cur === null);
      S.groups.forEach(function (g) {
        html += moveOptRow(g.id, e(g.name), cur === g.id);
      });
      box.innerHTML =
        '<div class="move-list">' + html + '</div>' +
        '<div class="move-new">' +
        '<input maxlength="30" placeholder="新建分组并移入…">' +
        '<button class="btn btn-sm" type="button" data-a="new">创建并移入</button></div>';
      openModal('移动到分组', box);
      $$('.move-opt', box).forEach(function (o) {
        o.addEventListener('click', function () {
          applyMove(o.getAttribute('data-gid') || null, null);
        });
      });
      box.querySelector('[data-a=new]').addEventListener('click', function () {
        var name = box.querySelector('.move-new input').value.trim();
        if (!name) { toast('请输入分组名称', 'err'); return; }
        applyMove('__new__', name);
      });
      function applyMove(gid, newName) {
        var p;
        if (gid === '__new__') {
          p = api('POST', '/api/groups', { name: newName }).then(function (r) {
            return api('PUT', '/api/notes/' + S.cur.id, { groupId: r.group.id }).then(function () {
              return r.group.id;
            });
          });
        } else {
          p = api('PUT', '/api/notes/' + S.cur.id, { groupId: gid }).then(function () { return gid; });
        }
        p.then(function (newGid) {
          S.cur.groupId = newGid;
          closeModal();
          toast('已移动', 'ok');
          loadGroups();
          loadList();
        }).catch(function (er) { toast(er.message, 'err'); });
      }
    });
  }

  function moveOptRow(gid, label, on) {
    return '<div class="move-opt' + (on ? ' on' : '') + '" data-gid="' + gid + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' +
      '<span class="mo-name">' + label + '</span>' +
      (on ? '<span class="mo-cur">当前</span>' : '') + '</div>';
  }

  function renderList() {
    noteList.innerHTML = '';
    if (!S.notes.length) {
      var t = S.q ? '未找到相关笔记' : (S.tab === 'trash' ? '回收站为空' : '暂无笔记，点击下方按钮新建');
      var d = document.createElement('div');
      d.className = 'list-empty';
      d.textContent = t;
      noteList.appendChild(d);
      return;
    }
    S.notes.forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'note-item' + (S.cur && S.cur.id === n.id ? ' active' : '');
      var badges = '';
      if (n.pinned) badges += '<span class="ni-badge pin-badge">置顶</span>';
      if (n.share) badges += '<span class="ni-badge' + (n.share.mode === 'password' ? ' share-pwd' : '') + '">' + (n.share.mode === 'password' ? '密码分享' : '已分享') + '</span>';
      if (S.tab === 'notes' && S.group === 'all' && n.groupId) {
        var gname = '';
        S.groups.forEach(function (g) { if (g.id === n.groupId) gname = g.name; });
        if (gname) badges += '<span class="ni-badge g-chip">' + e(gname) + '</span>';
      }
      item.innerHTML =
        '<div class="ni-title">' + (e(n.title) || '<span style="color:var(--text-3)">无标题</span>') + '</div>' +
        '<div class="ni-snippet">' + (e(n.snippet) || '&nbsp;') + '</div>' +
        '<div class="ni-meta"><span>' + fmtList(n.updatedAt) + '</span>' + badges + '</div>';
      if (S.tab === 'trash') {
        var row = document.createElement('div');
        row.className = 'tr-row';
        row.innerHTML =
          '<button class="btn btn-sm" data-a="restore">还原</button>' +
          '<button class="btn btn-sm btn-danger" data-a="purge">彻底删除</button>';
        item.appendChild(row);
        $$('button', row).forEach(function (b) {
          b.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (b.getAttribute('data-a') === 'restore') {
              api('POST', '/api/notes/' + n.id + '/restore', {}).then(function () {
                toast('已还原', 'ok');
                loadList();
                loadGroups();
              }).catch(function (er) { toast(er.message, 'err'); });
            } else {
              confirmModal('彻底删除', '笔记「' + (n.title || '无标题') + '」将被永久删除，无法恢复。', '彻底删除').then(function (ok) {
                if (!ok) return;
                api('DELETE', '/api/notes/' + n.id + '?purge=1').then(function () {
                  toast('已彻底删除', 'ok');
                  loadList();
                  loadGroups();
                }).catch(function (er) { toast(er.message, 'err'); });
              });
            }
          });
        });
      } else {
        item.addEventListener('click', function () { openNote(n.id); });
      }
      noteList.appendChild(item);
    });
  }

  function markActive(id) {
    $$('.note-item').forEach(function (el, i) {
      el.classList.toggle('active', !!(id && S.notes[i] && S.notes[i].id === id));
    });
  }

  /* ============================================================
     打开 / 新建 / 删除
     ============================================================ */
  function openNote(id) {
    return saveCurrent().then(function () {
      return api('GET', '/api/notes/' + id);
    }).then(function (r) {
      S.cur = r.note;
      S.virtual = false;
      titleInput.value = r.note.title;
      S.editor.setHtml(r.note.content);
      afterNoteLoaded();
      showMainPane();
      markActive(id);
    }).catch(function (er) { toast(er.message || '打开失败', 'err'); });
  }

  function newNote() {
    return saveCurrent().then(function () {
      // 在某个分组下新建时自动归入该分组
      var gid = (S.tab === 'notes' && S.group !== 'all' && S.group !== 'none' && S.group) || null;
      S.cur = { id: null, title: '', content: '', pinned: false, share: null, groupId: gid };
      S.virtual = true;
      S.dirty = false;
      titleInput.value = '';
      S.editor.setHtml('');
      afterNoteLoaded();
      setStatus('');
      showMainPane();
      markActive(null);
      titleInput.focus();
    });
  }

  function afterNoteLoaded() {
    pinBtn.classList.toggle('active', !!(S.cur && S.cur.pinned));
    wordCount.textContent = S.editor.textLength() + ' 字';
    updateShareBadge();
  }

  function updateShareBadge() {
    if (S.cur && S.cur.share) {
      shareBadge.textContent = S.cur.share.mode === 'password' ? '🔒 密码分享中' : '🔗 开放分享中';
    } else {
      shareBadge.textContent = '';
    }
  }

  function deleteCurrent(purge) {
    var doDelete = function () {
      if (S.virtual || !S.cur || !S.cur.id) {
        resetEditor();
        return Promise.resolve();
      }
      return api('DELETE', '/api/notes/' + S.cur.id + (purge ? '?purge=1' : '')).then(function () {
        toast(purge ? '已彻底删除' : '已移到回收站', 'ok');
        resetEditor();
        loadList();
        loadGroups();
      });
    };
    if (purge) {
      confirmModal('彻底删除', '笔记「' + (S.cur && S.cur.title || '无标题') + '」将被永久删除，无法恢复。', '彻底删除')
        .then(function (ok) { if (ok) doDelete().catch(function (er) { toast(er.message, 'err'); }); });
    } else {
      doDelete().catch(function (er) { toast(er.message, 'err'); });
    }
  }

  function resetEditor() {
    S.cur = null;
    S.virtual = false;
    S.dirty = false;
    titleInput.value = '';
    S.editor.setHtml('');
    setStatus('');
    wordCount.textContent = '';
    shareBadge.textContent = '';
    showListPane();
  }

  /* ============================================================
     分享
     ============================================================ */
  function shareModal() {
    if (!S.cur || !S.cur.id) { toast('请先保存笔记再分享', 'err'); return; }
    saveCurrent().then(function () {
      var curMode = S.cur.share ? S.cur.share.mode : 'off';
      var box = document.createElement('div');

      function optHtml(v, title, desc) {
        return '<label class="share-opt' + (curMode === v ? ' on' : '') + '" data-v="' + v + '">' +
          '<input type="radio" name="share-mode" value="' + v + '"' + (curMode === v ? ' checked' : '') + '>' +
          '<span><span class="so-title">' + title + '</span><br><span class="so-desc">' + desc + '</span></span></label>';
      }

      box.innerHTML =
        (curMode !== 'off'
          ? '<div class="share-status gray">当前：' + (curMode === 'password' ? '密码保护分享' : '互联网公开分享') + '</div>'
          : '') +
        optHtml('off', '关闭分享', '只有自己（登录后）可以查看') +
        optHtml('open', '互联网公开', '任何拿到链接的人都可以查看') +
        optHtml('password', '密码保护', '访问者需输入密码才能查看') +
        '<div class="pw-row hidden" style="margin:2px 0 10px">' +
        '<input type="text" id="share-pw" placeholder="访问密码（1-64 位）" maxlength="64"></div>' +
        '<div class="modal-actions">' +
        '<button class="btn" data-a="cancel">关闭</button>' +
        '<button class="btn btn-primary" data-a="save">生成 / 更新分享</button></div>';

      var pwRow = box.querySelector('.pw-row');
      var pwInput = box.querySelector('#share-pw');
      $$('.share-opt', box).forEach(function (o) {
        o.addEventListener('click', function () {
          $$('.share-opt', box).forEach(function (x) { x.classList.remove('on'); });
          o.classList.add('on');
          o.querySelector('input').checked = true;
          pwRow.classList.toggle('hidden', o.getAttribute('data-v') !== 'password');
        });
      });

      function close() { closeModal(); }

      box.querySelector('[data-a=cancel]').addEventListener('click', close);
      box.querySelector('[data-a=save]').addEventListener('click', function () {
        var mode = (box.querySelector('input[name=share-mode]:checked') || {}).value || 'off';
        if (mode === 'off') {
          api('DELETE', '/api/notes/' + S.cur.id + '/share').then(function () {
            S.cur.share = null;
            updateShareBadge();
            loadList();
            toast('已关闭分享', 'ok');
            close();
          }).catch(function (er) { toast(er.message, 'err'); });
          return;
        }
        var body = { mode: mode };
        if (mode === 'password') {
          body.password = pwInput.value;
          if (!body.password) { toast('请设置访问密码', 'err'); return; }
        }
        api('POST', '/api/notes/' + S.cur.id + '/share', body).then(function (r) {
          S.cur.share = { mode: mode };
          updateShareBadge();
          loadList();
          showLinkModal(r.token, mode);
        }).catch(function (er) { toast(er.message, 'err'); });
      });

      openModal('分享笔记', box);
      modalOnClose = null;
    });
  }

  function showLinkModal(token, mode) {
    var url = location.origin + '/s/' + token;
    var box = document.createElement('div');
    box.innerHTML =
      '<div class="share-status">分享链接已生成' + (mode === 'password' ? '（密码保护）' : '（互联网公开）') + '</div>' +
      '<div class="share-link-box">' +
      '<input readonly value="' + e(url) + '">' +
      '<button class="btn btn-primary btn-sm" data-a="copy">复制</button></div>' +
      '<p class="share-hint">' +
      (mode === 'password'
        ? '访问者打开链接后需输入访问密码。<br>'
        : '任何拿到此链接的人都可以查看内容，请谨慎传播。<br>') +
      '重新生成分享或把笔记移入回收站后，旧链接立即失效。</p>' +
      '<div class="modal-actions"><button class="btn btn-primary" data-a="ok">完成</button></div>';
    openModal('分享笔记', box);
    box.querySelector('[data-a=copy]').addEventListener('click', function () {
      copyText(url).then(function () { toast('链接已复制', 'ok'); });
    });
    box.querySelector('[data-a=ok]').addEventListener('click', closeModal);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return copyFallback(text); });
    }
    return copyFallback(text);
  }
  function copyFallback(text) {
    return new Promise(function (resolve) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-999px;top:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) {}
      ta.remove();
      if (ok) resolve();
      else toast('复制失败，请手动复制', 'err');
    });
  }

  /* ============================================================
     修改密码
     ============================================================ */
  function settingsModal() {
    var box = document.createElement('div');
    box.innerHTML =
      '<label>原密码<input type="password" id="pw-old"></label>' +
      '<label>新密码（至少 6 位）<input type="password" id="pw-new"></label>' +
      '<label>确认新密码<input type="password" id="pw-new2"></label>' +
      '<div class="form-error" id="pw-err"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn" data-a="cancel">取消</button>' +
      '<button class="btn btn-primary" data-a="save">修改密码</button></div>';
    openModal('修改密码', box);
    var err = box.querySelector('#pw-err');
    box.querySelector('[data-a=cancel]').addEventListener('click', closeModal);
    box.querySelector('[data-a=save]').addEventListener('click', function () {
      err.textContent = '';
      if (box.querySelector('#pw-new').value !== box.querySelector('#pw-new2').value) {
        err.textContent = '两次输入的新密码不一致'; return;
      }
      api('POST', '/api/me/password', {
        oldPassword: box.querySelector('#pw-old').value,
        newPassword: box.querySelector('#pw-new').value
      }).then(function () {
        toast('密码已修改', 'ok');
        closeModal();
      }).catch(function (er) { err.textContent = er.message; });
    });
  }

  /* ============================================================
     用户管理
     ============================================================ */
  function showAdmin() {
    S.inAdmin = true;
    hide(emptyPane); hide(editorPane); show(adminPane);
    loadAdmin();
  }
  function hideAdmin() {
    S.inAdmin = false;
    hide(adminPane);
    if (S.cur) show(editorPane); else show(emptyPane);
  }
  function loadAdmin() {
    api('GET', '/api/admin/users').then(function (r) {
      renderAdmin(r.users);
    }).catch(function (er) { toast(er.message, 'err'); });
  }
  function renderAdmin(users) {
    var tb = $('#admin-table');
    var html = '<tr><th>成员</th><th>角色</th><th>状态</th><th style="text-align:right">操作</th></tr>';
    users.forEach(function (u) {
      var self = S.user && u.id === S.user.id;
      html += '<tr>' +
        '<td><div class="au-name">' + e(u.name || u.username) + (self ? '（我）' : '') + '</div>' +
        '<div class="au-sub">' + e(u.username) + '</div></td>' +
        '<td><span class="role-tag' + (u.role === 'admin' ? '' : ' role-user') + '">' + (u.role === 'admin' ? '管理员' : '成员') + '</span></td>' +
        '<td><span class="status-tag' + (u.disabled ? ' off' : '') + '">' + (u.disabled ? '已停用' : '正常') + '</span></td>' +
        '<td><div class="au-actions">' +
        '<button class="btn btn-sm" data-act="resetpw" data-id="' + u.id + '">重置密码</button>' +
        '<button class="btn btn-sm" data-act="role" data-id="' + u.id + '">' + (u.role === 'admin' ? '设为成员' : '设为管理员') + '</button>' +
        (self ? '' :
          '<button class="btn btn-sm" data-act="toggle" data-id="' + u.id + '">' + (u.disabled ? '启用' : '停用') + '</button>' +
          '<button class="btn btn-sm btn-danger" data-act="del" data-id="' + u.id + '">删除</button>') +
        '</div></td></tr>';
    });
    tb.innerHTML = html;
    $$('button[data-id]', tb).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var u = null;
        users.forEach(function (x) { if (x.id === id) u = x; });
        adminAction(b.getAttribute('data-act'), u, users);
      });
    });
  }

  function adminAction(act, u) {
    if (act === 'resetpw') {
      var box = document.createElement('div');
      box.innerHTML =
        '<p style="margin-bottom:12px;color:var(--text-2)">为 <b>' + e(u.name || u.username) + '</b> 设置新密码：</p>' +
        '<label>新密码（至少 6 位）<input type="text" id="npw"></label>' +
        '<div class="form-error" id="npw-err"></div>' +
        '<div class="modal-actions"><button class="btn" data-a="c">取消</button>' +
        '<button class="btn btn-primary" data-a="s">保存</button></div>';
      openModal('重置密码', box);
      box.querySelector('[data-a=c]').addEventListener('click', closeModal);
      box.querySelector('[data-a=s]').addEventListener('click', function () {
        var v = box.querySelector('#npw').value;
        if (v.length < 6) { box.querySelector('#npw-err').textContent = '密码至少 6 位'; return; }
        api('POST', '/api/admin/users/' + u.id, { password: v }).then(function () {
          toast('密码已重置', 'ok');
          closeModal(); loadAdmin();
        }).catch(function (er) { box.querySelector('#npw-err').textContent = er.message; });
      });
      return;
    }
    if (act === 'role') {
      var to = u.role === 'admin' ? 'user' : 'admin';
      confirmModal('切换角色', '确认将 ' + (u.name || u.username) + ' 设为' + (to === 'admin' ? '管理员' : '普通成员') + '？', '确认').then(function (ok) {
        if (!ok) return;
        api('POST', '/api/admin/users/' + u.id, { role: to }).then(loadAdmin)
          .catch(function (er) { toast(er.message, 'err'); });
      });
      return;
    }
    if (act === 'toggle') {
      var dis = !u.disabled;
      api('POST', '/api/admin/users/' + u.id, { disabled: dis }).then(loadAdmin)
        .catch(function (er) { toast(er.message, 'err'); });
      return;
    }
    if (act === 'del') {
      confirmModal('删除成员', '将删除 ' + (u.name || u.username) + ' 的账号及其全部笔记（含图片），不可恢复。', '删除').then(function (ok) {
        if (!ok) return;
        api('DELETE', '/api/admin/users/' + u.id).then(function () {
          toast('已删除', 'ok');
          loadAdmin();
        }).catch(function (er) { toast(er.message, 'err'); });
      });
    }
  }

  function addUserModal() {
    var box = document.createElement('div');
    box.innerHTML =
      '<label>用户名<input id="au-username" maxlength="30" placeholder="字母 / 数字 / 中文"></label>' +
      '<label>姓名（选填）<input id="au-name" maxlength="30"></label>' +
      '<label>初始密码（至少 6 位）<input id="au-pw" type="text"></label>' +
      '<label>角色<select id="au-role"><option value="user">成员</option><option value="admin">管理员</option></select></label>' +
      '<div class="form-error" id="au-err"></div>' +
      '<div class="modal-actions"><button class="btn" data-a="c">取消</button>' +
      '<button class="btn btn-primary" data-a="s">添加</button></div>';
    openModal('添加成员', box);
    box.querySelector('[data-a=c]').addEventListener('click', closeModal);
    box.querySelector('[data-a=s]').addEventListener('click', function () {
      var err = box.querySelector('#au-err');
      err.textContent = '';
      api('POST', '/api/admin/users', {
        username: box.querySelector('#au-username').value.trim(),
        name: box.querySelector('#au-name').value.trim(),
        password: box.querySelector('#au-pw').value,
        role: box.querySelector('#au-role').value
      }).then(function () {
        toast('成员已添加', 'ok');
        closeModal(); loadAdmin();
      }).catch(function (er) { err.textContent = er.message; });
    });
  }

  /* ============================================================
     面板切换（桌面并存 / 移动端互斥）
     ============================================================ */
  function showMainPane() {
    viewApp.classList.add('show-main');
    hide(emptyPane); hide(adminPane); show(editorPane);
  }
  function showListPane() {
    viewApp.classList.remove('show-main');
    if (S.inAdmin) { hide(emptyPane); hide(editorPane); show(adminPane); return; }
    hide(adminPane);
    if (S.cur) { show(editorPane); hide(emptyPane); }
    else { show(emptyPane); hide(editorPane); }
  }

  /* ============================================================
     事件绑定
     ============================================================ */
  var bound = false;
  function bindAppEvents() {
    if (bound) return;
    bound = true;

    // 新建
    $('#new-note').addEventListener('click', newNote);

    // 标题输入
    titleInput.addEventListener('input', function () {
      S.dirty = true;
      setStatus('未保存');
      clearTimeout(S.saveTimer);
      S.saveTimer = setTimeout(function () { saveCurrent(); }, 800);
    });
    titleInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); S.editor.focus(); }
    });

    // 移动端返回
    $('#back-btn').addEventListener('click', function () {
      saveCurrent().then(function () { showListPane(); });
    });

    // 置顶
    pinBtn.addEventListener('click', function () {
      if (!S.cur || !S.cur.id) { toast('请先保存笔记', 'err'); return; }
      var to = !S.cur.pinned;
      saveCurrent().then(function () {
        return api('POST', '/api/notes/' + S.cur.id + '/pin', { pinned: to });
      }).then(function () {
        S.cur.pinned = to;
        pinBtn.classList.toggle('active', to);
        loadList();
      }).catch(function (er) { toast(er.message, 'err'); });
    });

    // 分享
    $('#share-btn').addEventListener('click', shareModal);

    // 更多菜单
    $('#more-btn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      $('#more-menu').classList.toggle('hidden');
    });
    $$('#more-menu button').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#more-menu').classList.add('hidden');
        var act = b.getAttribute('data-act');
        if (act === 'move') moveModal();
        else if (act === 'delete') deleteCurrent(false);
        else deleteCurrent(true);
      });
    });

    // 用户菜单
    $('#user-btn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      $('#user-menu').classList.toggle('hidden');
    });
    $$('#user-menu button').forEach(function (b) {
      b.addEventListener('click', function () {
        $('#user-menu').classList.add('hidden');
        var act = b.getAttribute('data-act');
        if (act === 'settings') settingsModal();
        else if (act === 'admin') showAdmin();
        else if (act === 'logout') {
          api('POST', '/api/logout').catch(function () {}).then(function () { location.reload(); });
        }
      });
    });

    // 点击空白处关闭下拉
    document.addEventListener('click', function () {
      $('#more-menu').classList.add('hidden');
      $('#user-menu').classList.add('hidden');
    });

    // 搜索
    var sTimer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(sTimer);
      sTimer = setTimeout(function () {
        S.q = searchInput.value.trim();
        loadList();
      }, 250);
    });

    // 侧边导航（全部 / 未分组 / 回收站）
    $$('#side-nav .nav-item').forEach(function (t) {
      t.addEventListener('click', function () {
        var nav = t.getAttribute('data-nav');
        if (nav === 'trash') S.tab = 'trash';
        else { S.tab = 'notes'; S.group = nav; }
        renderNav();
        saveCurrent().then(loadList);
        showListPane();
      });
    });

    // 分组区：折叠 / 新建 / 行点击 / 行内操作
    $('#group-toggle').addEventListener('click', function () {
      var block = $('#group-block');
      block.classList.toggle('collapsed');
    });
    $('#group-add').addEventListener('click', function (ev) {
      ev.stopPropagation();
      groupEditModal(null);
    });
    $('#group-list').addEventListener('click', function (ev) {
      var row = ev.target.closest ? ev.target.closest('.group-row') : null;
      if (!row) return;
      var gid = row.getAttribute('data-gid');
      var btn = ev.target.closest ? ev.target.closest('[data-ga]') : null;
      if (btn) {
        var g = null;
        S.groups.forEach(function (x) { if (x.id === gid) g = x; });
        if (!g) return;
        if (btn.getAttribute('data-ga') === 'rename') groupEditModal(g);
        else deleteGroupConfirm(g);
        return;
      }
      S.tab = 'notes';
      S.group = gid;
      renderNav();
      saveCurrent().then(loadList);
      showListPane();
    });

    // 管理页返回 / 添加
    $('#admin-back').addEventListener('click', hideAdmin);
    $('#add-user-btn').addEventListener('click', addUserModal);

    // 离开页面前提醒
    window.addEventListener('beforeunload', function (ev) {
      if (S.dirty) { ev.preventDefault(); ev.returnValue = ''; }
    });
    // 切后台时顺手保存
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveCurrent();
    });
  }

  boot();
})();
