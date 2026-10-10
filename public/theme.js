/* ============================================================
   主题切换（应用 / 分享页共用，在 <head> 中引入）
   - 未手动切换：不设置 data-theme，由 CSS 媒体查询自动跟随系统
   - 手动切换后：localStorage 记忆偏好，强制覆盖系统设置
   - 页面中任何 .theme-btn 元素点击即切换，图标自动刷新
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'jsb_theme';
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function systemDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
    catch (e) { return false; }
  }
  function effective() {
    var t = stored();
    if (t === 'light' || t === 'dark') return t;
    return systemDark() ? 'dark' : 'light';
  }

  function paint() {
    var t = stored();
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme'); // 跟随系统

    var icon = effective() === 'dark' ? SUN : MOON;
    var title = effective() === 'dark' ? '切换为亮色主题' : '切换为暗色主题';
    var btns = document.querySelectorAll('.theme-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].innerHTML = icon;
      btns[i].title = title;
    }
  }

  function toggle() {
    var next = effective() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    paint();
  }

  // 委托绑定：页面内所有 .theme-btn（含后续渲染的）都可点击切换
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el !== document) {
      if (el.classList && el.classList.contains('theme-btn')) { toggle(); return; }
      el = el.parentNode;
    }
  });

  // 自动模式下系统主题变化时，刷新按钮图标（配色由媒体查询即时生效）
  var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (mq) {
    var onChange = function () { if (!stored()) paint(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  paint(); // <head> 中执行：首帧前应用偏好，避免闪烁
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint); // 按钮渲染后再刷一次图标
  }

  window.JsbTheme = { toggle: toggle, effective: effective };
})();
