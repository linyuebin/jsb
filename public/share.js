/* ============================================================
   分享页逻辑：加载 / 密码解锁 / 渲染（内容由服务端净化后输出）
   ============================================================ */
(function () {
  'use strict';

  var token = (location.pathname.replace(/^\/s\/?/, '').split('/')[0]) || '';
  var kKey = 'jsb_share_k_' + token;

  var gate = document.getElementById('gate');
  var content = document.getElementById('content');
  var notfound = document.getElementById('notfound');

  function $(id) { return document.getElementById(id); }

  function k() {
    try { return sessionStorage.getItem(kKey) || ''; } catch (e) { return ''; }
  }
  function saveK(v) {
    try { sessionStorage.setItem(kKey, v); } catch (e) {}
  }

  function load() {
    var url = '/api/share/' + encodeURIComponent(token) + (k() ? '?k=' + encodeURIComponent(k()) : '');
    fetch(url, { credentials: 'same-origin' }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (r) {
      if (r.status === 404) { show(notfound); return; }
      if (r.status === 401 && r.data && r.data.needPassword) { show(gate); $('gate-pw').focus(); return; }
      if (r.status !== 200) { show(notfound); return; }
      render(r.data);
    }).catch(function () { show(notfound); });
  }

  function render(data) {
    document.title = (data.title || '分享的笔记') + ' · 记事簿';
    $('s-title').textContent = data.title || '无标题笔记';
    var meta = [];
    if (data.authorName) meta.push(data.authorName);
    if (data.updatedAt) {
      var d = new Date(data.updatedAt);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      meta.push(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' 更新');
    }
    $('s-meta').textContent = meta.join(' · ');
    // html 已由服务端白名单净化，媒体地址已带访问凭据
    $('s-body').innerHTML = data.html || '<p style="color:var(--text-3)">（空白内容）</p>';
    show(content);
  }

  function show(el) {
    gate.classList.add('hidden');
    content.classList.add('hidden');
    notfound.classList.add('hidden');
    el.classList.remove('hidden');
  }

  $('gate-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('gate-err');
    err.textContent = '';
    fetch('/api/share/' + encodeURIComponent(token) + '/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('gate-pw').value })
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (r) {
      if (r.status === 200 && r.data && r.data.k) {
        saveK(r.data.k);
        load();
      } else {
        err.textContent = (r.data && r.data.error) || '密码不正确';
      }
    }).catch(function () { err.textContent = '网络错误，请重试'; });
  });

  $('print-btn').addEventListener('click', function () { window.print(); });

  if (!token) { show(notfound); } else { load(); }
})();
