'use strict';
// HTML 白名单净化器（零依赖）
// 笔记内容以 HTML 存储，保存前过滤：只保留白名单标签/属性，
// 链接仅允许 http(s)/mailto/站内相对路径，图片仅允许本站 /media/ 资源，
// 彻底移除 script/iframe/style 等标签及其内容，防 XSS。

var ALLOWED = {
  p: [], br: [], hr: [], h1: [], h2: [], h3: [], h4: [],
  strong: [], b: [], em: [], i: [], u: [], s: [], del: [], strike: [],
  blockquote: [], pre: [], code: [],
  ul: ['start'], ol: ['start'], li: [],
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  div: [], span: [],
  table: [], thead: [], tbody: [], tfoot: [], tr: [],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan']
};

var VOID = { br: 1, hr: 1, img: 1 };

// 这些标签连同其内容一起丢弃
var DROP_CONTENT = {
  script: 1, style: 1, iframe: 1, object: 1, embed: 1, applet: 1,
  textarea: 1, title: 1, noscript: 1, head: 1, meta: 1, link: 1, base: 1,
  form: 1, input: 1, button: 1, select: 1, option: 1,
  svg: 1, math: 1, canvas: 1, frame: 1, frameset: 1
};

// 本站媒体路径：/media/<随机文件名>.(png|jpg|jpeg|gif|webp|bmp)
var MEDIA_SRC = /^\/media\/[A-Za-z0-9_\-]{6,40}\.(png|jpe?g|gif|webp|bmp)$/i;

function safeUrl(u) {
  if (!u) return null;
  var t = String(u).replace(/\s+/g, '');
  if (/^(javascript|data|vbscript):/i.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^mailto:/i.test(t)) return t;
  if (t.charAt(0) === '/' && t.charAt(1) !== '/' && t.indexOf('\\') === -1) return t;
  return null;
}

function escAttr(v) {
  return String(v).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

var TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
var ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

function sanitizeHtml(html, maxLen) {
  html = String(html == null ? '' : html);
  if (maxLen && html.length > maxLen) html = html.slice(0, maxLen);

  var drop = {}; // 处于 DROP_CONTENT 子树时的计数
  function dropping() {
    for (var k in drop) if (drop[k] > 0) return true;
    return false;
  }

  var out = '';
  var last = 0;
  var m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    if (!dropping()) out += escText(html.slice(last, m.index));
    last = TAG_RE.lastIndex;

    if (m[0].charAt(1) === '!') continue; // 注释

    var closing = m[1] === '/';
    var name = m[2].toLowerCase();
    var attrStr = m[3] || '';

    if (DROP_CONTENT[name]) {
      if (!closing) drop[name] = (drop[name] || 0) + 1;
      else if (drop[name] > 0) drop[name]--;
      continue;
    }
    if (dropping()) continue;

    var allowed = ALLOWED[name];
    if (!allowed) continue; // 未知标签：丢弃标签本身，保留内容

    if (closing) {
      if (!VOID[name]) out += '</' + name + '>';
      continue;
    }

    var kept = [];
    var hasSrc = false;
    var am;
    ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(attrStr)) !== null) {
      var an = am[1].toLowerCase();
      var av = am[2];
      if (av.length > 1 && (av.charAt(0) === '"' || av.charAt(0) === "'") && av.charAt(av.length - 1) === av.charAt(0)) {
        av = av.slice(1, -1);
      }
      if (allowed.indexOf(an) === -1) continue;
      if (an === 'href') {
        var u = safeUrl(av);
        if (!u) continue;
        av = u;
      }
      if (name === 'img' && an === 'src') {
        if (!MEDIA_SRC.test(av)) continue;
        hasSrc = true;
      }
      if (an === 'width' || an === 'height') {
        if (!/^\d{1,4}%?$/.test(av)) continue;
      }
      if (an === 'colspan' || an === 'rowspan' || an === 'start') {
        if (!/^\d{1,3}$/.test(av)) continue;
      }
      if (av.length > 2000) continue;
      kept.push(an + '="' + escAttr(av) + '"');
    }
    // 无合法 src 的图片整个丢弃（避免误引用外部资源）
    if (name === 'img' && !hasSrc) continue;

    out += '<' + name + (kept.length ? ' ' + kept.join(' ') : '') + (VOID[name] ? ' />' : '>');
  }
  if (!dropping()) out += escText(html.slice(last));
  return out;
}

// 文本节点中的裸 < 一律转义（防止未闭合标签拼接出可执行结构）
function escText(t) {
  return t.replace(/</g, '&lt;');
}

// 标题等纯文本字段：只留文本
function textOnly(s, maxLen) {
  var t = String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return t.slice(0, maxLen || 200);
}

module.exports = { sanitizeHtml: sanitizeHtml, textOnly: textOnly };
