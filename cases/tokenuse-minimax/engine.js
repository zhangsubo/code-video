/* =====================================================================
 * TokenUse · MiniMax 三模态发布视频 —— 纯函数帧渲染引擎
 *
 * 唯一画面入口： window.seek(t)
 *   · 禁用 CSS transition / @keyframes / rAF 自跑循环
 *   · 禁用缩放层 will-change
 *   · 禁用 ES Module（经典 <script src> 挂载 window.ASSETS / TIMELINE / Engine）
 *   · 动态数字 font-variant-numeric: tabular-nums
 *   · 按钮与胶囊标签 white-space: nowrap
 *   · 弹簧阻尼比 ζ ∈ [0.82, 0.88]（闭式解，无过冲果冻感）
 * ===================================================================== */
(function () {
  'use strict';

  var TL = window.TIMELINE;
  var AS = window.ASSETS;
  var FPS = TL.fps;

  /* ---------------- 数学工具 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function easeOutCubic(k) { k = clamp(k, 0, 1); return 1 - Math.pow(1 - k, 3); }
  function easeInOutCubic(k) { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
  function easeOutExpo(k) { k = clamp(k, 0, 1); return k >= 1 ? 1 : 1 - Math.pow(2, -10 * k); }
  function smoothstep(a, b, x) { var k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); }

  /**
   * 闭式阻尼弹簧阶跃响应（ζ<1），超调量 ≈ e^(-πζ/√(1-ζ²))，ζ=0.85 时约 0.63%，肉眼不可见。
   * @param t    当前场景相对时间（秒）
   * @param zeta 阻尼比 ∈ [0.82, 0.88]
   * @param omega 自然角频率
   * @param delay 延迟（秒）
   */
  function spring(t, zeta, omega, delay) {
    if (t <= 0) return 0;
    var td = t - (delay || 0);
    if (td <= 0) return 0;
    var wd = omega * Math.sqrt(1 - zeta * zeta);
    var e = Math.exp(-zeta * omega * td);
    return 1 - e * (Math.cos(wd * td) + (zeta * omega / wd) * Math.sin(wd * td));
  }

  /* 通用：入场位移 + 淡入 */
  function enter(rel, delay, dur) {
    return { k: easeOutCubic((rel - delay) / dur), raw: (rel - delay) / dur };
  }

  /* ---------------- 品牌数据（真实 TokenUse 模型） ---------------- */
  var BRANDS = [
    { key: 'codex',       name: 'Codex',       vendor: 'OpenAI',  accent: '#4faefa', remain: 64, win: '5h 窗口',       reset: 4360,  accounts: '3 账号', badge: '7d 周限额' },
    { key: 'antigravity', name: 'Antigravity', vendor: 'Google',  accent: '#f570ad', remain: 81, win: 'Gemini 配额池', reset: 16572, accounts: '2 账号', badge: '5h + 7d' },
    { key: 'mimo',        name: 'MiMo',        vendor: 'Xiaomi',  accent: '#ff8f3d', remain: 73, win: '月度 Token Plan', reset: 224640, accounts: '1 账号', badge: '月度额度' },
    { key: 'kimi',        name: 'Kimi',        vendor: 'Moonshot', accent: '#947dfa', remain: 88, win: '5h 并发窗口',  reset: 8885,  accounts: '2 账号', badge: '7d 周限额' },
    { key: 'minimax',     name: 'MiniMax',     vendor: 'MiniMax', accent: '#57d6a3', remain: 96, win: 'Coding Plan', reset: 1036800, accounts: '4 账号', badge: '全模型池' }
  ];

  var STATS = [
    { t: '今日 Token',    v: 2840000,   fmt: 'count', sub: '本机 + 官方云端对账', cost: '$38.42' },
    { t: '30d Token',     v: 41600000,  fmt: 'count', sub: '近 30 天聚合',         cost: '$1,284.60' },
    { t: 'Cache Read',    v: 18200000,  fmt: 'count', sub: '缓存命中 63.4%',       cost: '$41.07' },
    { t: '输出 Token',    v: 1090000,   fmt: 'count', sub: '含思考 Token',         cost: '$62.18' },
    { t: '等效 API 价值', v: 1284.60,   fmt: 'usd',   sub: 'LiteLLM 分级定价折算',  cost: '≈ $1,284.60' }
  ];

  /* ---------------- DOM 引用 ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var bdEls = { 'obsidian-wave': $('bd-obsidian-wave'), 'warm-studio': $('bd-warm-studio'), 'aurora-prism': $('bd-aurora-prism') };
  var sceneEls = [$('s1'), $('s2'), $('s3'), $('s4'), $('s5'), $('s6')];
  var poolEls = [$('s1-pool'), $('s2-pool'), $('s3-pool'), $('s4-pool'), $('s5-pool'), $('s6-pool')];
  var capEl = $('caption'), capFill = $('capbar-fill');
  var cursorEl = $('cursor'), rippleEl = $('ripple');
  var dockEl = $('dock'), dockToday = $('dock-today'), dockGauges = $('dock-gauges');
  var provGrid = $('prov-grid'), statPanel = $('stat-panel'), painIcons = $('s1-icons');
  var toastEl = $('toast');
  var scrimWarm = $('scrim-warm'), scrimDark = $('scrim-dark'), scrimBase = $('scrim-base');

  /* ---------------- 动态 DOM 构建（一次性） ---------------- */
  function ringSVG(percent, accent, r, sw) {
    var C = 2 * Math.PI * r;
    var off = C * (1 - percent / 100);
    return '<svg width="' + (r * 2 + sw) + '" height="' + (r * 2 + sw) + '" viewBox="0 0 ' + (r * 2 + sw) + ' ' + (r * 2 + sw) + '">' +
      '<circle cx="' + (r + sw / 2) + '" cy="' + (r + sw / 2) + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="' + sw + '"/>' +
      '<circle cx="' + (r + sw / 2) + '" cy="' + (r + sw / 2) + '" r="' + r + '" fill="none" stroke="' + accent + '" stroke-width="' + sw +
      '" stroke-linecap="round" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) +
      '" transform="rotate(-90 ' + (r + sw / 2) + ' ' + (r + sw / 2) + ')"/></svg>';
  }

  function buildPainIcons() {
    var pos = [[26, 34], [212, 12], [402, 46], [96, 226], [316, 238]];
    var html = '';
    for (var i = 0; i < BRANDS.length; i++) {
      var b = BRANDS[i];
      var p = pos[i];
      html += '<div class="pain-ring" data-pain="' + i + '" style="left:' + p[0] + 'px;top:' + p[1] + 'px">' +
        '<div class="badge" style="background:' + hexA(b.accent, 0.16) + ';border-color:' + hexA(b.accent, 0.42) + '">' +
        '<img src="' + AS[b.key] + '" alt="' + b.name + '"></div>' +
        '<div class="meter"><i data-pain-bar="' + i + '" style="width:' + b.remain + '%;background:linear-gradient(90deg,' + b.accent + ',' + hexA(b.accent, 0.55) + ')"></i></div>' +
        '<div class="cap">' + b.name + ' · 剩余 ' + b.remain + '%</div></div>';
    }
    painIcons.innerHTML = html;
  }

  function buildDockGauges() {
    var html = '';
    for (var i = 0; i < BRANDS.length; i++) {
      var b = BRANDS[i];
      html += '<div class="gauge" data-gauge="' + i + '">' + ringSVG(b.remain, b.accent, 9.4, 2.1) + '</div>';
    }
    dockGauges.innerHTML = html;
  }

  function buildProviderCards() {
    var html = '';
    for (var i = 0; i < BRANDS.length; i++) {
      var b = BRANDS[i];
      html += '<div class="pcard" data-card="' + i + '">' +
        '<div class="top">' +
          '<div class="ic" style="background:' + hexA(b.accent, 0.18) + ';border:1px solid ' + hexA(b.accent, 0.45) + '">' +
            '<img src="' + AS[b.key] + '" alt="' + b.name + '"></div>' +
          '<div><div class="nm">' + b.name + '</div><div class="vd">' + b.vendor + ' · ' + b.accounts + '</div></div>' +
        '</div>' +
        '<div class="big num">' + b.remain + '%</div>' +
        '<div class="bl">剩余 · ' + b.win + '</div>' +
        '<div class="battery"><i data-bar="' + i + '" style="width:0%;background:linear-gradient(90deg,' + b.accent + ',' + hexA(b.accent, 0.5) + ')"></i></div>' +
        '<div class="row"><span>已用 ' + (100 - b.remain) + '%</span><span class="rs" data-reset="' + i + '">重置 00:00:00</span></div>' +
        '<div class="reset">⌛ ' + b.badge + ' · 本地日志已直读</div>' +
      '</div>';
    }
    provGrid.innerHTML = html;
  }

  function buildStatPanel() {
    var html = '';
    for (var i = 0; i < STATS.length; i++) {
      var s = STATS[i];
      html += '<div class="stat" data-stat="' + i + '">' +
        '<div class="t">' + s.t + '</div>' +
        '<div class="v num" data-stat-v="' + i + '">0</div>' +
        '<div class="cost num"><span data-stat-c="' + i + '">' + s.cost + '</span></div>' +
        '<div class="sub">' + s.sub + '</div>' +
      '</div>';
    }
    statPanel.innerHTML = html;
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function fmtCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(Math.round(n));
  }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtHMS(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtHMSD(sec) {
    var d = Math.floor(sec / 86400);
    if (d > 0) return d + ' 天';
    return fmtHMS(sec);
  }

  buildPainIcons(); buildDockGauges(); buildProviderCards(); buildStatPanel();

  /* ---------------- 分句细分（基于真实毫秒时间戳按字符数比例分配） ---------------- */
  function splitClauses(text, begin, end) {
    var parts = text.split(/[，,；;：:。.！!？?、]/).filter(function (s) { return s.trim().length > 0; });
    if (parts.length <= 1) return [{ text: text, begin: begin, end: end }];
    var total = 0, lens = [];
    for (var i = 0; i < parts.length; i++) { lens.push(parts[i].length); total += lens[i]; }
    var out = [], cur = begin, span = end - begin;
    for (var j = 0; j < parts.length; j++) {
      var d = span * (lens[j] / total);
      out.push({ text: parts[j], begin: cur, end: cur + d });
      cur += d;
    }
    return out;
  }

  var CLAUSES = {};
  for (var si = 0; si < TL.scenes.length; si++) {
    var sc = TL.scenes[si];
    var list = [];
    for (var k = 0; k < sc.subtitles.length; k++) {
      var s = sc.subtitles[k];
      list = list.concat(splitClauses(s.text, s.begin, s.end));
    }
    CLAUSES[sc.id] = list;
  }

  /* ---------------- 运行时靶心（真实 getBoundingClientRect） ---------------- */
  var rectCache = {};
  function rectOf(id) {
    if (rectCache[id]) return rectCache[id];
    var el = $(id);
    var r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    rectCache[id] = { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    return rectCache[id];
  }

  /* ---------------- 光标轨迹 ---------------- */
  function cursorTarget(sceneId, rel) {
    if (sceneId === 'five') {
      var card = document.querySelector('[data-card="4"]');
      var r = card ? card.getBoundingClientRect() : null;
      var from = { x: 1560, y: 760 }, to = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 1400, y: 560 };
      var k = clamp((rel - 5.6) / 1.5, 0, 1);
      return { from: from, to: to, k: k, visible: rel > 5.4 };
    }
    if (sceneId === 'switch') {
      var btn = $('s4-btn');
      var rr = btn ? btn.getBoundingClientRect() : null;
      var f = { x: 1620, y: 800 };
      var t = rr ? { x: rr.left + rr.width / 2 + 8, y: rr.top + rr.height / 2 + 8 } : { x: 400, y: 700 };
      var kk = clamp((rel - 1.2) / 1.35, 0, 1);
      return { from: f, to: t, k: kk, visible: rel > 1.0 };
    }
    return { from: { x: 960, y: 540 }, to: { x: 960, y: 540 }, k: 1, visible: false };
  }

  /* ---------------- 场景动画 ---------------- */
  function setText(el, txt) { if (el && el.textContent !== txt) el.textContent = txt; }
  function setStyle(el, prop, val) { if (el) el.style[prop] = val; }

  var painBars = [], dockGaugeEls = [], cardEls = [], barEls = [], resetEls = [], statEls = [], statVEls = [], statCEEls = [];
  function cacheEls() {
    painBars = document.querySelectorAll('[data-pain-bar]');
    dockGaugeEls = document.querySelectorAll('[data-gauge]');
    cardEls = document.querySelectorAll('[data-card]');
    barEls = document.querySelectorAll('[data-bar]');
    resetEls = document.querySelectorAll('[data-reset]');
    statEls = document.querySelectorAll('[data-stat-v]');
    statCEEls = document.querySelectorAll('[data-stat-c]');
  }

  function animateScene(sc, rel, t) {
    var i = sc.index;
    var id = sc.id;

    if (id === 'pain') {
      var e0 = enter(rel, 0.10, 0.85);
      setStyle($('s1-kicker'), 'opacity', e0.k);
      setStyle($('s1-kicker'), 'transform', 'translateY(' + ((1 - e0.k) * 16).toFixed(2) + 'px)');
      setStyle($('s1-h1'), 'opacity', clamp((rel - 0.26) / 0.9, 0, 1));
      setStyle($('s1-h1'), 'transform', 'translateY(' + ((1 - easeOutCubic(clamp((rel - 0.26) / 0.9, 0, 1))) * 26).toFixed(2) + 'px)');
      var l0 = clamp((rel - 1.05) / 0.85, 0, 1);
      setStyle($('s1-lead'), 'opacity', l0);
      setStyle($('s1-lead'), 'transform', 'translateY(' + ((1 - easeOutCubic(l0)) * 18).toFixed(2) + 'px)');

      for (var p = 0; p < 5; p++) {
        var ke = spring(rel, 0.85, 8.2, 0.5 + p * 0.17);
        var node = painIcons.children[p];
        if (!node) continue;
        setStyle(node, 'opacity', clamp(ke, 0, 1));
        setStyle(node, 'transform', 'translateY(' + ((1 - ke) * 22).toFixed(2) + 'px) scale(' + (0.9 + 0.1 * ke).toFixed(4) + ')');
      }
      // 告警条 + Codex 额度告急
      var al = clamp((rel - 3.05) / 0.5, 0, 1);
      setStyle($('s1-alert'), 'opacity', easeOutCubic(al));
      setStyle($('s1-alert'), 'transform', 'translateY(' + ((1 - easeOutCubic(al)) * -14).toFixed(2) + 'px)');
      if (painBars[0]) {
        var low = rel > 3.05 ? 8 : BRANDS[0].remain;
        var lb = easeOutCubic(clamp((rel - (rel > 3.05 ? 3.05 : 0.9)) / 0.9, 0, 1));
        painBars[0].style.width = (BRANDS[0].remain + (low - BRANDS[0].remain) * lb).toFixed(1) + '%';
        painBars[0].style.background = rel > 3.05 ? 'linear-gradient(90deg,#ff5f6d,#ff8b95)' : 'linear-gradient(90deg,' + BRANDS[0].accent + ',rgba(79,174,250,0.55))';
      }
    }

    if (id === 'hero') {
      var dk = spring(rel, 0.85, 7.4, 0.15);
      setStyle(dockEl, 'opacity', clamp(dk, 0, 1));
      setStyle(dockEl, 'transform', 'translateX(' + ((1 - dk) * 90).toFixed(2) + 'px)');
      setText(dockToday, '2.84M');
      var b0 = clamp((rel - 0.5) / 0.85, 0, 1);
      setStyle($('s2-kicker'), 'opacity', b0);
      setStyle($('s2-appicon'), 'opacity', clamp((rel - 0.2) / 0.7, 0, 1));
      setStyle($('s2-h2'), 'opacity', clamp((rel - 0.95) / 0.95, 0, 1));
      setStyle($('s2-h2'), 'transform', 'translateY(' + ((1 - easeOutCubic(clamp((rel - 0.95) / 0.95, 0, 1))) * 24).toFixed(2) + 'px)');
      setStyle($('s2-lead'), 'opacity', clamp((rel - 1.75) / 0.9, 0, 1));
      for (var g = 0; g < dockGaugeEls.length; g++) {
        var ge = spring(rel, 0.84, 9.0, 0.6 + g * 0.13);
        setStyle(dockGaugeEls[g], 'opacity', clamp(ge, 0, 1));
        setStyle(dockGaugeEls[g], 'transform', 'scale(' + (0.72 + 0.28 * clamp(ge, 0, 1.02)).toFixed(4) + ')');
      }
    }

    if (id === 'five') {
      for (var c = 0; c < cardEls.length; c++) {
        var ce = spring(rel, 0.86, 8.6, 0.35 + c * 0.16);
        var cc = clamp(ce, 0, 1.04);
        setStyle(cardEls[c], 'opacity', clamp(ce, 0, 1));
        setStyle(cardEls[c], 'transform', 'translateY(' + ((1 - cc) * 30).toFixed(2) + 'px) scale(' + (0.965 + 0.035 * cc).toFixed(4) + ')');
        if (barEls[c]) {
          var bk = easeOutCubic(clamp((rel - (0.95 + c * 0.16)) / 1.15, 0, 1));
          barEls[c].style.width = (BRANDS[c].remain * bk).toFixed(2) + '%';
        }
        if (resetEls[c]) {
          var remain = Math.max(0, BRANDS[c].reset - (rel - 1.4));
          var b2 = BRANDS[c];
          setText(resetEls[c], '重置 ' + (b2.reset > 86400 ? fmtHMSD(remain) : fmtHMS(remain)));
        }
      }
      setStyle($('s3-kicker'), 'opacity', clamp((rel - 0.15) / 0.7, 0, 1));
      setStyle($('s3-h2'), 'opacity', clamp((rel - 0.35) / 0.8, 0, 1));
      setStyle($('s3-lead'), 'opacity', clamp((rel - 0.85) / 0.8, 0, 1));
    }

    if (id === 'switch') {
      setStyle($('s4-kicker'), 'opacity', clamp((rel - 0.1) / 0.6, 0, 1));
      setStyle($('s4-h2'), 'opacity', clamp((rel - 0.25) / 0.7, 0, 1));
      var a1 = spring(rel, 0.86, 8.4, 0.35);
      var a2 = spring(rel, 0.86, 8.4, 0.5);
      setStyle($('s4-a1'), 'opacity', clamp(a1, 0, 1));
      setStyle($('s4-a1'), 'transform', 'translateX(' + ((1 - clamp(a1, 0, 1)) * -34).toFixed(2) + 'px)');
      setStyle($('s4-a2'), 'opacity', clamp(a2, 0, 1));
      setStyle($('s4-a2'), 'transform', 'translateX(' + ((1 - clamp(a2, 0, 1)) * 34).toFixed(2) + 'px)');

      var clickT = 3.35;               // 精确对齐交互时刻
      var pressed = clamp((rel - clickT) / 0.12, 0, 1);
      var released = clamp((rel - (clickT + 0.22)) / 0.3, 0, 1);
      var btn = $('s4-btn');
      if (btn) {
        var ps = 1 - 0.05 * pressed + 0.05 * released;
        setStyle(btn, 'transform', 'scale(' + ps.toFixed(4) + ')');
        setStyle(btn, 'background', released > 0.5
          ? 'linear-gradient(135deg,#3ec48c,#22996c)'
          : 'linear-gradient(135deg,#4f8cff,#2f63e0)');
        setText(btn, released > 0.5 ? '✓ 已切换' : '一键切换到备用账号');
      }
      var switched = clamp((rel - (clickT + 0.18)) / 0.5, 0, 1);
      setStyle($('s4-a1'), 'opacity', (1 - 0.45 * switched).toFixed(3));
      setStyle($('s4-a2'), 'opacity', (1 + 0.0 * switched).toFixed(3));
      var a2g = $('s4-a2');
      if (a2g) {
        setStyle(a2g, 'borderColor', 'rgba(' + Math.round(lerp(255, 87, switched)) + ',' + Math.round(lerp(255, 214, switched)) + ',' + Math.round(lerp(255, 163, switched)) + ',' + (0.15 + 0.45 * switched).toFixed(3) + ')');
      }
      var tk = clamp((rel - (clickT + 0.35)) / 0.55, 0, 1);
      setStyle(toastEl, 'opacity', easeOutCubic(tk));
      setStyle(toastEl, 'transform', 'translateX(-50%) translateY(' + ((1 - easeOutCubic(tk)) * 26).toFixed(2) + 'px)');
    }

    if (id === 'local') {
      setStyle($('s5-kicker'), 'opacity', clamp((rel - 0.1) / 0.6, 0, 1));
      setStyle($('s5-h2'), 'opacity', clamp((rel - 0.25) / 0.75, 0, 1));
      setStyle($('s5-lead'), 'opacity', clamp((rel - 0.7) / 0.75, 0, 1));
      var m1 = spring(rel, 0.86, 8.0, 0.5), m2 = spring(rel, 0.86, 8.0, 0.72);
      setStyle($('monitors').children[0], 'opacity', clamp(m1, 0, 1));
      setStyle($('monitors').children[0], 'transform', 'translateY(' + ((1 - clamp(m1, 0, 1)) * 26).toFixed(2) + 'px)');
      setStyle($('monitors').children[1], 'opacity', clamp(m2, 0, 1));
      setStyle($('monitors').children[1], 'transform', 'translateY(' + ((1 - clamp(m2, 0, 1)) * 26).toFixed(2) + 'px)');
      var d1 = spring(rel, 0.86, 9.5, 1.25), d2 = spring(rel, 0.86, 9.5, 1.45);
      setStyle($('s5-dock1'), 'opacity', clamp(d1, 0, 1));
      setStyle($('s5-dock1'), 'transform', 'translateX(' + ((1 - clamp(d1, 0, 1)) * 26).toFixed(2) + 'px)');
      setStyle($('s5-dock2'), 'opacity', clamp(d2, 0, 1));
      setStyle($('s5-dock2'), 'transform', 'translateX(' + ((1 - clamp(d2, 0, 1)) * -26).toFixed(2) + 'px)');
      for (var s = 0; s < statEls.length; s++) {
        var se = spring(rel, 0.86, 8.2, 1.55 + s * 0.14);
        var sk = clamp(se, 0, 1);
        var card = statEls[s].parentNode;
        setStyle(card, 'opacity', sk);
        setStyle(card, 'transform', 'translateY(' + ((1 - sk) * 24).toFixed(2) + 'px)');
        var ck = easeOutCubic(clamp((rel - (1.9 + s * 0.14)) / 1.5, 0, 1));
        if (STATS[s].fmt === 'usd') {
          setText(statEls[s], '$' + (STATS[s].v * ck).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        } else {
          setText(statEls[s], fmtCount(STATS[s].v * ck));
        }
      }
    }

    if (id === 'outro') {
      var mc = spring(rel, 0.85, 7.0, 0.15);
      setStyle($('s6-mascot'), 'opacity', clamp(mc, 0, 1));
      setStyle($('s6-mascot'), 'transform', 'translateY(' + ((1 - clamp(mc, 0, 1)) * 26).toFixed(2) + 'px) scale(' + (0.94 + 0.06 * clamp(mc, 0, 1)).toFixed(4) + ')');
      var lk = clamp((rel - 0.55) / 0.8, 0, 1);
      setStyle($('s6-lock'), 'opacity', easeOutCubic(lk));
      setStyle($('s6-lock'), 'transform', 'translateY(' + ((1 - easeOutCubic(lk)) * 22).toFixed(2) + 'px)');
      var ch = clamp((rel - 1.25) / 0.9, 0, 1);
      setStyle($('s6-chips'), 'opacity', easeOutCubic(ch));
      setStyle($('s6-chips'), 'transform', 'translateY(' + ((1 - easeOutCubic(ch)) * 16).toFixed(2) + 'px)');
      for (var ch2 = 0; ch2 < $('s6-chips').children.length; ch2++) {
        var c2 = $('s6-chips').children[ch2];
        var k2 = spring(rel, 0.85, 9.0, 1.25 + ch2 * 0.09);
        setStyle(c2, 'opacity', clamp(k2, 0, 1));
        setStyle(c2, 'transform', 'translateY(' + ((1 - clamp(k2, 0, 1)) * 14).toFixed(2) + 'px)');
      }
    }
  }

  /* ---------------- 主 seek ---------------- */
  var lastScene = -1;
  function seek(t) {
    if (lastScene < 0) cacheEls();

    /* 场景定位（硬切） */
    var idx = 0;
    for (var i = 0; i < TL.scenes.length; i++) {
      if (t >= TL.scenes[i].start && t < TL.scenes[i].end) { idx = i; break; }
      if (t >= TL.scenes[i].end) idx = i;
    }
    if (t >= TL.duration) idx = TL.scenes.length - 1;
    var sc = TL.scenes[idx];
    var rel = clamp(t - sc.start, 0, sc.end - sc.start);

    /* Layer 0 · 底板微推镜（scale 1.02 → 1.07，线性缓推，无 will-change） */
    var push = 1.02 + 0.05 * clamp(rel / Math.max(0.001, sc.end - sc.start), 0, 1);
    for (var key in bdEls) {
      var el = bdEls[key];
      if (!el) continue;
      var on = (key === sc.backdrop);
      setStyle(el, 'opacity', on ? 1 : 0);
      setStyle(el, 'transform', 'scale(' + (on ? push.toFixed(4) : 1.04) + ')');
    }

    /* Layer 1 · Scrim（暖光幕压暗为暖墨色，保证白字对比度 > 7:1；暗幕再压暗） */
    var warm = sc.backdrop === 'warm-studio';
    setStyle(scrimBase, 'opacity', warm ? 0 : 1);
    setStyle(scrimWarm, 'opacity', warm ? 1 : 0);
    setStyle(scrimDark, 'opacity', warm ? 0 : 1);

    /* Layer 2 · 场景可见性 */
    for (var s = 0; s < sceneEls.length; s++) {
      setStyle(sceneEls[s], 'opacity', s === idx ? 1 : 0);
      if (s !== idx) setStyle(sceneEls[s], 'visibility', 'hidden');
    }
    setStyle(sceneEls[idx], 'visibility', 'visible');

    /* 舞台光池 */
    var b = BRANDS[idx % BRANDS.length];
    var pool = poolEls[idx];
    if (pool) {
      var pk = easeOutCubic(clamp(rel / 1.1, 0, 1));
      var accent = sc.accent || b.accent;
      setStyle(pool, 'opacity', (0.30 * pk).toFixed(3));
      setStyle(pool, 'left', (idx % 2 === 0 ? 250 : 760) + 'px');
      setStyle(pool, 'top', '120px');
      setStyle(pool, 'width', '760px');
      setStyle(pool, 'height', '760px');
      setStyle(pool, 'background', 'radial-gradient(circle at 50% 50%, ' + hexA(accent, 0.55) + ' 0%, ' + hexA(accent, 0) + ' 70%)');
    }

    animateScene(sc, rel, t);

    /* 光标（真实 getBoundingClientRect 靶心 + 闭式弹簧） */
    var ct = cursorTarget(sc.id, rel);
    if (ct.visible) {
      var sk2 = spring(rel, 0.86, 8.0, 0);
      var cx = lerp(ct.from.x, ct.to.x, sk2);
      var cy = lerp(ct.from.y, ct.to.y, sk2);
      setStyle(cursorEl, 'opacity', 1);
      setStyle(cursorEl, 'transform', 'translate(' + (cx - 6).toFixed(2) + 'px,' + (cy - 6).toFixed(2) + 'px)');
      if (sc.id === 'switch') {
        var cr = clamp((rel - 3.35) / 0.55, 0, 1);
        var rp = (rel > 3.35 && rel < 3.95) ? 1 - cr : 0;
        setStyle(rippleEl, 'opacity', (rp * 0.85).toFixed(3));
        setStyle(rippleEl, 'transform', 'scale(' + (0.25 + (1 - rp) * 1.0).toFixed(3) + ')');
        setStyle(rippleEl, 'left', ct.to.x.toFixed(2) + 'px');
        setStyle(rippleEl, 'top', ct.to.y.toFixed(2) + 'px');
      } else {
        setStyle(rippleEl, 'opacity', 0);
      }
    } else {
      setStyle(cursorEl, 'opacity', 0);
      setStyle(rippleEl, 'opacity', 0);
    }

    /* Layer 3 · 毫秒级同步字幕条 */
    var clauses = CLAUSES[sc.id] || [];
    var active = null;
    for (var q = 0; q < clauses.length; q++) {
      if (t >= clauses[q].begin && t < clauses[q].end) { active = clauses[q]; break; }
    }
    if (active) {
      var html = '';
      for (var w = 0; w < clauses.length; w++) {
        html += (w ? '，' : '') + (clauses[w] === active
          ? '<span class="hl">' + clauses[w].text + '</span>'
          : clauses[w].text);
      }
      if (capEl.innerHTML !== html) capEl.innerHTML = html;
      var co = clamp((t - active.begin) / 0.22, 0, 1);
      var co2 = clamp((active.end - t) / 0.22, 0, 1);
      setStyle(capEl, 'opacity', Math.min(easeOutCubic(co), easeOutCubic(co2)).toFixed(3));
    } else {
      setStyle(capEl, 'opacity', 0);
    }
    var prog = clamp((t - sc.voiceStart) / Math.max(0.001, sc.voiceEnd - sc.voiceStart), 0, 1);
    setStyle(capFill, 'width', (prog * 100).toFixed(2) + '%');

    lastScene = idx;
  }

  /* ---------------- 引导 ---------------- */
  window.seek = seek;          // 画面唯一入口（渲染器直接调用）
  window.Engine = {
    seek: seek,
    fps: FPS,
    duration: TL.duration,
    totalFrames: TL.totalFrames,
    scenes: TL.scenes
  };

  /* 静态资源注入（真实品牌图标） */
  $('s2-appicon').src = AS.appIcon;
  $('s6-icon').src = AS.appIcon;
  $('s6-mascot').src = AS.mascot;
  $('s4-a1-icon').src = AS.codex;
  $('s4-a2-icon').src = AS.codex;
  var edgeG = document.querySelectorAll('.edge-dock .g');
  for (var e = 0; e < edgeG.length; e++) {
    var key = edgeG[e].getAttribute('data-g');
    var bi = -1;
    for (var z = 0; z < BRANDS.length; z++) if (BRANDS[z].key === key) bi = z;
    if (bi >= 0) {
      edgeG[e].style.background = 'radial-gradient(circle at 50% 50%, ' + hexA(BRANDS[bi].accent, 0.55) + ' 0%, ' + hexA(BRANDS[bi].accent, 0.12) + ' 70%)';
      edgeG[e].style.border = '1.5px solid ' + hexA(BRANDS[bi].accent, 0.9);
    }
  }

  cacheEls();
  seek(0);
})();
