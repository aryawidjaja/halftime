// Halftime's course page: one self-contained HTML file that loads nothing from anywhere.
// web.ts fills in __TITLE__ and __DATA__. Written as a raw string, so the HTML below is exactly what is saved.
export const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>__TITLE__</title>
<link rel="icon" href="data:,">
<style>
:root {
  --bg: #f4f5f7; --surface: #ffffff; --sunk: #eef0f3; --ink: #16181d; --ink-2: #596070; --ink-3: #8a909c; --line: #e2e5ea;
  --you: #3556e0; --you-soft: #e8edfd; --claude: #c8623f; --claude-soft: #fbece6;
  --good: #14804f; --good-soft: #e5f5ec; --bad: #c43d33; --bad-soft: #fcebe9; --open: #9a6a12;
  --add: #e6f4ea; --add-ink: #1d6b3c; --del: #fbe9e7; --del-ink: #9c2f25;
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --logo-tile: #1f1e1d; --logo-page: #e4e0d8; --logo-claude: #d97757; --on-you: #ffffff;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root {
  --bg: #0f1115; --surface: #181b21; --sunk: #21252d; --ink: #eceef2; --ink-2: #a2a8b4; --ink-3: #737a87; --line: #2a2f38;
  --you: #8aa2ff; --you-soft: #1f2744; --claude: #ec9474; --claude-soft: #33221c;
  --good: #4fcf8f; --good-soft: #13291e; --bad: #f07a70; --bad-soft: #301816; --open: #e3b25a;
  --add: #12281b; --add-ink: #7fd8a0; --del: #2e1715; --del-ink: #f19a90;
  --logo-tile: #ece8e1; --logo-page: #3a3b40; --on-you: #0f1115; color-scheme: dark; } }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--surface); color: var(--ink); font: 16px/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
p { margin: 0; }
.app { height: 100%; display: flex; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
/* The outline beside the lesson: shown when the window is wide enough for it. */
.side { width: 300px; flex: none; border-right: 1px solid var(--line); background: var(--bg); display: none; flex-direction: column; gap: 22px; padding: 22px 18px; overflow-y: auto; }
.side .brand { padding: 2px 8px; }
.side .course { display: flex; flex-direction: column; gap: 6px; padding: 0 8px; }
.side .course b { font-family: var(--display); font-weight: 620; font-size: 1.02rem; line-height: 1.3; letter-spacing: -0.01em; }
.meter { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--you); border-radius: 3px; transition: width .4s cubic-bezier(.2,.8,.2,1); }
.outline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.outline button { width: 100%; text-align: left; font: inherit; color: var(--ink); background: none; border: 0; border-radius: 10px; padding: 9px 8px; display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: center; cursor: pointer; }
.outline button:hover { background: var(--sunk); }
.outline .here { background: var(--you-soft); }
.outline .here .o-title { color: var(--you); font-weight: 600; }
.outline .dot { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--surface); box-shadow: inset 0 0 0 1.5px var(--line); font-size: .78rem; font-weight: 650; color: var(--ink-3); }
.outline .done .dot { background: var(--you); box-shadow: none; color: var(--on-you); }
.outline .dot svg { width: 14px; height: 14px; }
.outline .o-text { min-width: 0; display: flex; flex-direction: column; }
.o-title { font-size: .93rem; line-height: 1.3; }
.o-sub { font-size: .8rem; color: var(--ink-3); }
.side .back { margin-top: auto; display: flex; flex-direction: column; gap: 8px; padding: 14px 10px 4px; border-top: 1px solid var(--line); }
.side .back .when { display: flex; align-items: center; gap: 10px; font-size: .92rem; }
.side .back .when b { font-weight: 600; font-variant-numeric: tabular-nums; }
.bar .in, .foot .in { max-width: 760px; width: 100%; margin: 0 auto; display: flex; align-items: center; gap: 14px; }
@media (min-width: 1100px) {
  html { font-size: 17px; }
  .side { display: flex; }
  .bar .brand, .bar .clock, .bar .home-btn { display: none; }
  .main .stage { max-width: 760px; padding-top: 56px; gap: 24px; }
  .bar { min-height: 57px; }
  .main .bar, .main .foot { padding-inline: 0; }
  .bar .in, .foot .in { padding-inline: 24px; }   /* the same edges as the text below */
}
.bar { display: flex; align-items: center; gap: 16px; padding: 14px max(22px, env(safe-area-inset-left)); padding-top: max(14px, env(safe-area-inset-top)); border-bottom: 1px solid var(--line); }
.brand { font-family: var(--display); font-weight: 650; letter-spacing: -0.01em; font-size: 1.02rem; display: flex; align-items: center; gap: 8px; }
.brand svg { width: 24px; height: 24px; }
.clock { display: flex; align-items: center; gap: 8px; font-size: .88rem; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.clock b { color: var(--ink); font-weight: 600; }
.iconbtn { border: 0; background: none; color: var(--ink-2); font: inherit; padding: 6px 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: .92rem; }
.iconbtn:hover { background: var(--sunk); color: var(--ink); }
.scroll { flex: 1; overflow-y: auto; }
.stage { max-width: 680px; margin: 0 auto; padding: 40px 24px 48px; display: flex; flex-direction: column; gap: 22px; }
.foot { border-top: 1px solid var(--line); padding: 14px 22px; padding-bottom: max(14px, env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 12px; background: var(--surface); }

.grow { flex: 1; min-width: 0; }
.foot.good { background: var(--good-soft); border-color: transparent; animation: rise .25s ease-out; }
.foot.bad { background: var(--bad-soft); border-color: transparent; animation: rise .25s ease-out; }
.verdict { display: flex; flex-direction: column; gap: 2px; }
.verdict strong { font-family: var(--display); font-size: 1.08rem; font-weight: 640; }
.foot.good .verdict strong { color: var(--good); } .foot.bad .verdict strong { color: var(--bad); }
.verdict span { font-size: .93rem; color: var(--ink-2); }
.mark { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; color: #fff; animation: pop .35s cubic-bezier(.3,1.5,.5,1); }
.foot.good .mark { background: var(--good); } .foot.bad .mark { background: var(--bad); }
.btn { font: inherit; font-weight: 600; font-size: .98rem; border-radius: 12px; padding: 12px 22px; border: 0; cursor: pointer; transition: transform .08s ease-out, background .2s; }
.btn:active { transform: scale(.97); }
.btn.primary { background: var(--you); color: var(--on-you); }
.foot.good .btn.primary { background: var(--good); } .foot.bad .btn.primary { background: var(--bad); }
.btn.primary:disabled { background: var(--line); color: var(--ink-3); cursor: default; transform: none; }
.btn.quiet { background: transparent; color: var(--ink-2); padding-inline: 14px; }
.btn.quiet:hover { color: var(--ink); background: var(--sunk); }
:focus-visible { outline: 2.5px solid var(--you); outline-offset: 2px; border-radius: 10px; }
[tabindex="-1"]:focus { outline: none; }   /* the heading takes focus when a screen opens, for screen readers; no ring */
.eyebrow { font-size: .9rem; color: var(--ink-3); }
.title-xl { font-family: var(--display); font-size: clamp(1.65rem, 3.6vw, 2.15rem); line-height: 1.15; letter-spacing: -0.02em; font-weight: 650; text-wrap: balance; }
.title-l { font-family: var(--display); font-size: clamp(1.35rem, 3vw, 1.65rem); line-height: 1.22; letter-spacing: -0.015em; font-weight: 630; text-wrap: balance; }
.body { font-size: 1.05rem; }
.muted { color: var(--ink-2); }
.small { font-size: .88rem; color: var(--ink-3); }
.fits { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: 14px; background: var(--you-soft); font-size: .96rem; }
.path { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.step { display: grid; grid-template-columns: 44px 1fr auto; gap: 14px; align-items: center; padding: 10px 0; position: relative; cursor: pointer; }
.step:hover .s-title { color: var(--you); }
.step::before { content: ""; position: absolute; left: 21px; top: -10px; height: 20px; width: 2px; background: var(--line); }
.step:first-child::before { display: none; }
.node { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--sunk); color: var(--ink-3); font-weight: 650; font-size: .95rem; position: relative; z-index: 1; }
.step.done .node { background: var(--you); color: var(--on-you); }
.step.current .node { background: var(--surface); color: var(--you); box-shadow: inset 0 0 0 2.5px var(--you); }
.s-text { min-width: 0; display: flex; flex-direction: column; }
.s-title { font-weight: 600; transition: color .15s; }
.s-sub { font-size: .9rem; color: var(--ink-2); }
.s-min { font-size: .85rem; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.groups { display: flex; flex-direction: column; gap: 20px; }
.group { display: flex; flex-direction: column; gap: 8px; }
.group h4 { margin: 0; font-size: .92rem; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.group h4 i { width: 8px; height: 8px; border-radius: 50%; display: block; }
.g-issue h4 { color: var(--bad); } .g-issue i { background: var(--bad); }
.g-fixed h4 { color: var(--good); } .g-fixed i { background: var(--good); }
.g-open h4 { color: var(--open); } .g-open i { background: var(--open); }
.group ul, .list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.note { border-radius: 14px; background: var(--sunk); padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; }
.note b { font-weight: 600; }
.seg { display: flex; gap: 6px; flex: 1; max-width: 360px; }
.seg i { flex: 1; height: 6px; border-radius: 3px; background: var(--line); display: block; overflow: hidden; position: relative; }
.seg i.on { background: var(--you); }
.seg i.now::after { content: ""; position: absolute; inset: 0; background: var(--you); border-radius: 3px; animation: fill .4s cubic-bezier(.2,.8,.2,1) both; }
.like { border-radius: 14px; background: var(--sunk); padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
.lbl { font-size: .86rem; color: var(--ink-3); }
.like .breaks { font-size: .92rem; color: var(--ink-2); padding-top: 8px; border-top: 1px solid var(--line); }
.file { align-self: flex-start; font-family: var(--mono); font-size: .82rem; color: var(--ink-2); background: var(--sunk); padding: 4px 10px; border-radius: 8px; overflow-wrap: anywhere; }
.diff { font-family: var(--mono); font-size: .84rem; line-height: 1.6; border-radius: 12px; overflow-x: auto; background: var(--sunk); padding: 10px 0; }
.diff div { padding-inline: 14px; display: grid; grid-template-columns: 1.4em minmax(0, 1fr); }
.diff div span:last-child { white-space: pre-wrap; overflow-wrap: anywhere; }
.diff .a { background: var(--add); color: var(--add-ink); } .diff .d { background: var(--del); color: var(--del-ink); } .diff .x { color: var(--ink-2); }
.opts { display: flex; flex-direction: column; gap: 10px; }
.opt { text-align: left; font: inherit; font-size: 1rem; color: var(--ink); background: var(--surface); border: 1.5px solid var(--line); border-radius: 14px; padding: 14px 16px; cursor: pointer; display: grid; grid-template-columns: 28px 1fr; gap: 12px; align-items: center; transition: border-color .15s, background .15s, transform .08s; }
.opt:hover { border-color: var(--ink-3); }
.opt:active { transform: scale(.99); }
.opt .k { width: 28px; height: 28px; border-radius: 8px; border: 1.5px solid var(--line); display: grid; place-items: center; font-size: .82rem; color: var(--ink-3); font-weight: 600; }
.opt.sel { border-color: var(--you); background: var(--you-soft); } .opt.sel .k { border-color: var(--you); color: var(--you); }
.opt.right { border-color: var(--good); background: var(--good-soft); } .opt.right .k { border-color: var(--good); color: var(--good); }
.opt.wrong { border-color: var(--bad); background: var(--bad-soft); } .opt.wrong .k { border-color: var(--bad); color: var(--bad); }
.opt.claude { border-color: var(--claude); background: var(--claude-soft); } .opt.claude .k { border-color: var(--claude); color: var(--claude); }
.opt[disabled] { cursor: default; } .opt[disabled]:not(.sel):not(.right):not(.wrong):not(.claude) { opacity: .55; }
.tag { font-size: .78rem; font-weight: 600; margin-left: 8px; }
.tag.c { color: var(--claude); } .tag.y { color: var(--you); }
.reveal { display: flex; flex-direction: column; gap: 14px; animation: rise .3s ease-out; }
.kv { display: flex; flex-direction: column; gap: 3px; }
.kv.cl .lbl { color: var(--claude); }
.take { font-family: var(--display); font-size: clamp(1.35rem, 3vw, 1.7rem); line-height: 1.28; letter-spacing: -0.015em; font-weight: 620; text-wrap: balance; }
.ask { display: flex; gap: 14px; align-items: flex-start; border: 1.5px solid var(--line); border-radius: 14px; padding: 14px 16px; }
.ask .grow { display: flex; flex-direction: column; gap: 4px; }
.copy { font: inherit; font-size: .9rem; font-weight: 600; border-radius: 10px; border: 1.5px solid var(--you); color: var(--you); background: transparent; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
.copy.done { background: var(--you); color: var(--on-you); }
.done-screen { align-items: center; text-align: center; padding-top: 64px; gap: 14px; }
.big { width: 128px; height: 128px; flex: none; position: relative; display: grid; place-items: center; }
.big svg { position: absolute; inset: 0; }
.big svg circle:last-child { animation: draw 1s cubic-bezier(.2,.8,.2,1) both; }
.num { font-family: var(--display); font-size: 2rem; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.num small { font-size: 1rem; color: var(--ink-3); font-weight: 500; }
.score { display: flex; align-items: center; gap: 26px; flex-wrap: wrap; }
.badge { display: flex; gap: 16px; align-items: center; padding: 16px; border-radius: 16px; border: 1px solid var(--line); }
.badge svg { width: 60px; height: 60px; flex: none; }
.badge .grow { display: flex; flex-direction: column; gap: 2px; }
.share { font-size: .95rem; border-radius: 12px; background: var(--sunk); padding: 14px 16px; }
@keyframes fill { from { transform: translateX(-100%); } to { transform: none; } }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes pop { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes draw { from { stroke-dasharray: 0 999; } }
@media (max-width: 600px) {
  .bar { padding-inline: 14px; gap: 10px; } .stage { padding: 26px 16px 34px; } .foot { padding-inline: 14px; }
  .clock .long { display: none; }
}
@media (prefers-reduced-motion: reduce) { *, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<div class="app"><aside class="side" id="side" aria-label="Course outline"></aside><div class="main" id="app"></div></div>
<noscript><p style="padding:24px">This course page needs JavaScript. You can read the same course in the Halftime pane in Claude Code.</p></noscript>
<script>
var DATA = __DATA__;
(function () {
  'use strict';
  // The tab icon: Halftime's mark, light or dark with the system.
  var ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><style>.t{fill:#1F1E1D}.p{fill:#E4E0D8}' +
    '@media (prefers-color-scheme: dark){.t{fill:#ECE8E1}.p{fill:#3A3B40}}</style>' +
    '<rect class="t" width="128" height="128" rx="30"/><path class="p" d="M64 40 C53 32 39 31 26 33 V93 C39 91 53 92 64 100 Z"/>' +
    '<path fill="#D97757" d="M64 40 C75 32 89 31 102 33 V93 C89 91 75 92 64 100 Z"/>' +
    '<rect class="t" x="74" y="50" width="7" height="30" rx="3.5"/><rect class="t" x="86" y="50" width="7" height="30" rx="3.5"/></svg>';
  document.querySelector('link[rel=icon]').href = 'data:image/svg+xml,' + encodeURIComponent(ICON);
  var C = DATA.course, L = C.lessons, F = C.final;
  var KEY = 'halftime.course.' + C.id;
  var S = { view: 'home', i: 0, card: 0, done: [], picks: {}, answers: {}, briefed: false, q: 0, sel: null };
  // Start from where you were in the pane, then remember progress in this browser.
  var seed = DATA.progress || {};
  S.done = (seed.done || []).slice(); S.answers = Object.assign({}, seed.answers || {}); S.briefed = !!seed.briefed;
  try { var kept = JSON.parse(localStorage.getItem(KEY) || 'null'); if (kept) { S.done = kept.done || S.done; S.answers = kept.answers || S.answers; S.picks = kept.picks || {}; S.briefed = !!kept.briefed; } } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ done: S.done, answers: S.answers, picks: S.picks, briefed: S.briefed })); } catch (e) {} }
  var app = document.getElementById('app');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function has(list, x) { return list.indexOf(x) >= 0; }

  var CHECK = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.4 3.3L15.5 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CROSS = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  // Halftime's mark: an open book with a pause on Claude's page. A break spent learning.
  var BOOK = '<path fill="var(--logo-page)" d="M64 40 C53 32 39 31 26 33 V93 C39 91 53 92 64 100 Z"/><path fill="var(--logo-claude)" d="M64 40 C75 32 89 31 102 33 V93 C89 91 75 92 64 100 Z"/>';
  var PAUSE = '<rect fill="var(--logo-tile)" x="74" y="50" width="7" height="30" rx="3.5"/><rect fill="var(--logo-tile)" x="86" y="50" width="7" height="30" rx="3.5"/>';
  var LOGO = '<svg viewBox="0 0 128 128" aria-hidden="true"><rect fill="var(--logo-tile)" width="128" height="128" rx="30"/>' + BOOK + PAUSE + '</svg>';
  function ring(frac, size, stroke, color) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r, h = size / 2;
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true"><circle cx="' + h + '" cy="' + h + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + h + '" cy="' + h + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + (c * Math.max(0, Math.min(1, frac))) + ' ' + c + '" transform="rotate(-90 ' + h + ' ' + h + ')"/></svg>';
  }

  // When Claude is back: the reset time Halftime knew when it wrote this page.
  function clockTime(ms) { var d = new Date(ms), hr = d.getHours(), m = d.getMinutes(); return ((hr + 11) % 12 + 1) + ':' + (m < 10 ? '0' : '') + m + ' ' + (hr < 12 ? 'AM' : 'PM'); }
  function minsLeft() { return DATA.resetsAt ? Math.max(0, Math.round((DATA.resetsAt - Date.now()) / 60000)) : null; }
  function clock() {
    var left = minsLeft();
    if (left === null) return '';
    if (left <= 0) return '<div class="clock"><b>Claude is back</b></div>';
    return '<div class="clock"><span>' + ring(Math.min(1, left / 60), 18, 3, 'var(--you)') + '</span><span class="long">Claude is back at</span><b>' + clockTime(DATA.resetsAt) + '</b></div>';
  }
  function bar(middle) {
    var left = S.view === 'home'
      ? '<div class="brand">' + LOGO + 'Halftime</div>'
      : '<button class="iconbtn home-btn" data-go="home" aria-label="Back to course home"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Course</button>';
    return '<div class="bar"><div class="in">' + left + (middle || '<div class="grow"></div>') + clock() + '</div></div>';
  }
  function foot(inner, cls) { return '<div class="foot ' + (cls || '') + '"><div class="in">' + inner + '</div></div>'; }
  function shell(middle, body, footer) {
    app.innerHTML = bar(middle) + '<div class="scroll"><div class="stage">' + body + '</div></div>' + (footer || '');
    side();
    app.querySelector('.scroll').scrollTop = 0;
    var first = app.querySelector('.stage .title-xl, .stage .title-l, .stage .take');
    if (first) { first.setAttribute('tabindex', '-1'); first.focus({ preventScroll: true }); }
  }
  function segs(n, at) { var h = '<div class="seg" aria-label="Step ' + (at + 1) + ' of ' + n + '">'; for (var k = 0; k < n; k++) h += '<i class="' + (k < at ? 'on' : k === at ? 'now' : '') + '"></i>'; return h + '</div>'; }

  /* ---------- the outline beside the lesson ---------- */
  function steps() {
    var list = [{ t: 'Briefing', s: '1 min', done: S.briefed, go: 'briefing', here: S.view === 'briefing' }];
    L.forEach(function (l, i) { list.push({ t: l.topic, s: 'Lesson ' + (i + 1) + ' · 3 min', done: has(S.done, i), go: 'lesson:' + i, here: (S.view === 'lesson' || S.view === 'lessonDone') && S.i === i }); });
    list.push({ t: 'Final quiz', s: F.length + ' questions', done: F.every(function (_, j) { return S.answers['final:' + j] !== undefined; }), go: 'final', here: S.view === 'final' || S.view === 'score' });
    return list;
  }
  function side() {
    var list = steps(), n = list.filter(function (x) { return x.done; }).length, left = minsLeft();
    document.getElementById('side').innerHTML =
      '<button class="iconbtn brand" data-go="home" style="color:var(--ink)">' + LOGO + 'Halftime</button>' +
      '<div class="course"><span class="small">' + esc(DATA.kind) + ' in ' + esc(DATA.project) + '</span><b>' + esc(C.title) + '</b>' +
      '<div class="meter" role="img" aria-label="' + n + ' of ' + list.length + ' done"><i style="width:' + (100 * n / list.length) + '%"></i></div><span class="small">' + n + ' of ' + list.length + ' done</span></div>' +
      '<ol class="outline">' + list.map(function (x, k) {
        return '<li><button class="' + (x.done ? 'done ' : '') + (x.here ? 'here' : '') + '" data-go="' + x.go + '"><span class="dot">' + (x.done ? CHECK : k === 0 ? 'B' : k === list.length - 1 ? 'Q' : k) + '</span>' +
          '<span class="o-text"><span class="o-title">' + esc(x.t) + '</span><span class="o-sub">' + esc(x.s) + '</span></span></button></li>';
      }).join('') + '</ol>' +
      '<div class="back">' + (left === null ? '' : left <= 0 ? '<div class="when"><b>Claude is back</b></div>'
        : '<div class="when">' + ring(Math.min(1, left / 60), 22, 3.5, 'var(--you)') + '<span>Claude is back at <b>' + clockTime(DATA.resetsAt) + '</b><br><span class="small">in ' + left + ' min</span></span></div>') +
      '<span class="small">Your answers here stay in this browser. The Halftime pane keeps its own.</span></div>';
  }
  document.getElementById('side').addEventListener('click', function (e) { var t = e.target.closest('[data-go]'); if (t) go(t.dataset.go); });

  /* ---------- home ---------- */
  function home() {
    var steps = [{ t: 'Briefing', s: 'What went wrong, what got fixed, what is left', m: 1, done: S.briefed, go: 'briefing' }];
    L.forEach(function (l, i) { steps.push({ t: l.topic, s: l.summary, m: 3, done: has(S.done, i), go: 'lesson:' + i }); });
    var quizDone = F.every(function (_, j) { return S.answers['final:' + j] !== undefined; });
    steps.push({ t: 'Final quiz', s: F.length + ' questions that tie it together', m: 2, done: quizDone, go: 'final' });
    var cur = -1; for (var k = 0; k < steps.length; k++) if (!steps[k].done) { cur = k; break; }
    var total = steps.reduce(function (a, s) { return a + s.m; }, 0), rest = cur < 0 ? 0 : steps.slice(cur).reduce(function (a, s) { return a + s.m; }, 0);
    var left = minsLeft(), doneN = steps.filter(function (s) { return s.done; }).length;
    var fits = cur < 0 ? 'All done. Nice work.'
      : (cur === 0 ? 'About ' + total + ' minutes.' : doneN + ' of ' + steps.length + ' done, about ' + rest + ' minutes left.') +
        (left ? (left >= rest ? ' Claude is back in ' + left + ', so you have time for all of it.' : ' Claude is back in ' + left + ', so start with what interests you most.') : '');
    var path = steps.map(function (s, k) {
      var node = s.done ? CHECK : k === 0 ? 'B' : k === steps.length - 1 ? 'Q' : String(k);
      return '<li class="step ' + (s.done ? 'done' : k === cur ? 'current' : '') + '" data-go="' + s.go + '" tabindex="0" role="button">' +
        '<span class="node">' + node + '</span><span class="s-text"><span class="s-title">' + esc(s.t) + '</span><span class="s-sub">' + esc(s.s) + '</span></span><span class="s-min">' + s.m + ' min</span></li>';
    }).join('');
    shell('', '<span class="eyebrow">Your course from this session · ' + esc(DATA.kind) + ' in ' + esc(DATA.project) + '</span>' +
      '<div class="title-xl">' + esc(C.title) + '</div>' +
      '<div class="fits">' + ring(doneN / steps.length, 28, 4, 'var(--you)') + '<span>' + fits + '</span></div>' +
      '<ol class="path">' + path + '</ol>' +
      '<p class="small">Your answers here stay in this browser. The Halftime pane in Claude Code keeps its own.</p>',
      foot('<div class="grow muted">' + (cur < 0 ? 'You finished the course.' : cur === 0 ? 'Start with a one-minute briefing.' : 'Pick up where you left off.') + '</div>' +
        '<button class="btn primary" data-go="' + (cur < 0 ? 'score' : steps[cur].go) + '">' + (cur < 0 ? 'See your score' : cur === 0 ? 'Start' : 'Continue') + '</button>'));
  }

  /* ---------- briefing ---------- */
  function briefing() {
    var b = C.briefing, st = C.stats || {};
    var did = [];
    if (st.commands) did.push('ran ' + st.commands + ' command' + (st.commands === 1 ? '' : 's'));
    if (st.files) did.push('changed ' + st.files + ' file' + (st.files === 1 ? '' : 's'));
    if (st.helpers) did.push('used ' + st.helpers + ' helper agent' + (st.helpers === 1 ? '' : 's'));
    shell('', '<span class="eyebrow">Briefing · 1 minute</span><div class="title-l">Here is what happened while you worked.</div>' +
      '<div class="groups"><div class="group g-issue"><h4><i></i>What went wrong</h4><p class="body">' + esc(b.issue) + '</p></div>' +
      (b.fixed.length ? '<div class="group g-fixed"><h4><i></i>What Claude fixed</h4><ul>' + b.fixed.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
      (b.holding.length ? '<div class="group g-open"><h4><i></i>Still to do</h4><ul>' + b.holding.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>' +
      (did.length ? '<p class="muted">In this session Claude ' + did.join(' and ') + '.' + (st.failed ? ' A check failed along the way and passed after the fix.' : '') + '</p>' : '') +
      (b.trivia ? '<div class="note"><b>Did you know?</b><span>' + esc(b.trivia) + '</span></div>' : ''),
      foot('<div class="grow"></div><button class="btn primary" data-act="brief-done">Start lesson 1</button>'));
  }

  /* ---------- a lesson: five short screens ---------- */
  var CARDS = ['The idea', 'In your code', 'Your turn', 'Remember this', 'Quick check'];
  function diff(code) {
    var rows = code.split('\n').slice(1), pad = Infinity;
    rows.forEach(function (r) { if (r.slice(1).trim()) pad = Math.min(pad, r.slice(1).match(/^ */)[0].length); });
    if (pad === Infinity) pad = 0;
    return '<div class="diff" role="img" aria-label="The change Claude made">' + rows.map(function (r) {
      var op = r.charAt(0); return '<div class="' + (op === '+' ? 'a' : op === '-' ? 'd' : 'x') + '"><span>' + esc(op === ' ' ? '' : op) + '</span><span>' + esc(r.slice(1 + pad)) + '</span></div>';
    }).join('') + '</div>';
  }
  function opts(list, cls, locked, tag) {
    return '<div class="opts">' + list.map(function (o, k) {
      return '<button class="opt ' + cls(k) + '" data-opt="' + k + '"' + (locked ? ' disabled' : '') + '><span class="k">' + (k + 1) + '</span><span>' + esc(o) + (tag ? tag(k) : '') + '</span></button>';
    }).join('') + '</div>';
  }
  function next(label) { return '<div class="grow"></div><button class="btn primary" data-act="next">' + (label || 'Continue') + '</button>'; }
  function lesson() {
    var l = L[S.i], c = S.card, top = segs(5, c);
    var head = '<span class="eyebrow">Lesson ' + (S.i + 1) + ' of ' + L.length + ' · ' + esc(l.topic) + ' · ' + CARDS[c] + '</span>';
    var back = c > 0 ? '<button class="btn quiet" data-act="back">Back</button>' : '';
    if (c === 0) {
      var w = l.what, like = '';
      if (w.analogy) like = '<div class="like"><span class="lbl">Think of it like this</span><span>' + esc(cap(w.analogy.replace(/^Like\s+/i, ''))) + '</span>' +
        (w.breaks ? '<span class="breaks">Where that stops working: ' + esc(w.breaks.charAt(0).toLowerCase() + w.breaks.slice(1)) + '</span>' : '') + '</div>';
      return shell(top, head + '<div class="title-l">' + esc(w.title) + '</div><p class="body">' + esc(w.body) + '</p>' + like +
        (w.more ? '<details class="note"><summary>Go deeper</summary><p>' + esc(w.more) + '</p></details>' : ''), foot(back + next()));
    }
    if (c === 1) return shell(top, head + '<div class="title-l">Where this lives in ' + esc(DATA.project) + '</div><p class="body">' + esc(l.where.body) + '</p>' +
      (l.where.file ? '<span class="file">' + esc(l.where.file) + '</span>' : '') + (l.where.code ? diff(l.where.code) : ''), foot(back + next()));
    if (c === 2) {
      var d = l.did;
      if (d.kind !== 'choice') return shell(top, head + '<div class="title-l">What Claude did, and why</div>' +
        '<div class="kv cl"><span class="lbl">Claude</span><span class="body">' + esc(d.what) + '</span></div>' +
        '<div class="kv"><span class="lbl">Why</span><span class="body">' + esc(d.why) + '</span></div>' +
        (d.evidence ? '<div class="kv"><span class="lbl">How you can tell</span><span class="body">' + esc(d.evidence) + '</span></div>' : ''), foot(back + next()));
      var picked = S.picks[S.i];
      if (picked === undefined) return shell(top, head + '<div class="title-l">What would you have done?</div><p class="body">' + esc(d.problem) + '</p>' +
        opts(d.options, function (k) { return S.sel === k ? 'sel' : ''; }) + '<p class="muted">Not graded. Pick what you would try, then see what Claude chose.</p>',
        foot(back + '<div class="grow"></div><button class="btn primary" data-act="pick"' + (S.sel === null ? ' disabled' : '') + '>Show me</button>'));
      var same = picked === d.picked;
      return shell(top, head + '<div class="title-l">' + (same ? 'Same call as Claude.' : 'Claude went another way.') + '</div>' +
        opts(d.options, function (k) { return k === d.picked ? 'claude' : k === picked ? 'sel' : ''; }, true,
          function (k) { return (k === d.picked ? '<span class="tag c">Claude</span>' : '') + (k === picked && !same ? '<span class="tag y">You</span>' : ''); }) +
        '<div class="reveal"><div class="kv cl"><span class="lbl">Why Claude chose it</span><span class="body">' + esc(d.why) + '</span></div>' +
        '<div class="kv"><span class="lbl">What it costs</span><span class="body">' + esc(d.cost) + '</span></div></div>', foot(back + next()));
    }
    if (c === 3) return shell(top, head + '<div class="take">' + esc(l.takeaway) + '</div>' +
      (l.next ? '<div class="ask"><div class="grow"><span class="lbl">Something to ask Claude when it is back</span><span id="ask' + S.i + '">' + esc(l.next) + '</span></div><button class="copy" data-copy="ask' + S.i + '">Copy</button></div>' : ''),
      foot(back + next('Quick check')));
    return quiz(l.check, 'lesson:' + S.i, top, head);
  }

  /* ---------- a question: a lesson's check, or the final quiz ---------- */
  function quiz(q, key, middle, head) {
    var ans = S.answers[key];
    if (ans === undefined) return shell(middle, head + '<div class="title-l">' + esc(q.ask) + '</div>' + opts(q.options, function (k) { return S.sel === k ? 'sel' : ''; }),
      foot('<div class="grow"></div><button class="btn primary" data-act="check" data-key="' + key + '"' + (S.sel === null ? ' disabled' : '') + '>Check</button>'));
    var ok = ans === q.right;
    shell(middle, head + '<div class="title-l">' + esc(q.ask) + '</div>' + opts(q.options, function (k) { return k === q.right ? 'right' : k === ans ? 'wrong' : ''; }, true),
      foot('<span class="mark">' + (ok ? CHECK : CROSS) + '</span><div class="grow verdict"><strong>' + (ok ? 'That is it.' : 'Not quite.') + '</strong><span>' +
        esc(ok ? q.why : 'The answer is "' + q.options[q.right] + '". ' + q.why) + '</span></div><button class="btn primary" data-act="after">Continue</button>', ok ? 'good' : 'bad'));
  }
  function final() { quiz(F[S.q], 'final:' + S.q, segs(F.length, S.q), '<span class="eyebrow">Final quiz · question ' + (S.q + 1) + ' of ' + F.length + '</span>'); }

  function lessonDone() {
    var n = S.done.length, left = L.length - n, l = L[S.i], more = S.i + 1 < L.length;
    shell('', '<div class="stage done-screen" style="padding:0"><div class="big">' + ring(n / L.length, 128, 10, 'var(--you)') + '</div>' +
      '<span class="eyebrow">Lesson ' + (S.i + 1) + ' of ' + L.length + ' done</span><div class="title-l">' + esc(l.topic) + '</div>' +
      '<p class="muted">' + (left ? left + ' to go, about ' + (left * 3 + 2) + ' minutes.' : 'That was the last lesson. One short quiz and you are done.') + '</p></div>',
      foot('<button class="btn quiet" data-go="home">Course home</button><div class="grow"></div><button class="btn primary" data-go="' + (more ? 'lesson:' + (S.i + 1) : 'final') + '">' + (more ? 'Start lesson ' + (S.i + 2) : 'Final quiz') + '</button>'));
  }

  /* ---------- score ---------- */
  function score() {
    var qs = L.map(function (l, i) { return { key: 'lesson:' + i, q: l.check }; }).concat(F.map(function (q, j) { return { key: 'final:' + j, q: q }; }));
    var right = qs.filter(function (x) { return S.answers[x.key] === x.q.right; }).length, total = qs.length;
    var missed = qs.filter(function (x) { return S.answers[x.key] !== undefined && S.answers[x.key] !== x.q.right; });
    var share = 'I spent my Claude usage-limit break learning my own project: ' + L.length + ' lessons, ' + right + '/' + total + ' on the quiz. Made with Halftime for Claude Code: github.com/aryawidjaja/halftime';
    var asks = L.filter(function (l) { return l.next; }).map(function (l) { return l.next; });
    var line = right === total ? 'Every one. Nicely done.' : right >= total - 2 ? 'Nice work.' : 'Good start. Have another look at the ones you missed.';
    shell('', '<span class="eyebrow">Course complete</span>' +
      '<div class="score"><div class="big">' + ring(right / total, 128, 12, 'var(--good)') + '<span class="num">' + right + '<small>/' + total + '</small></span></div>' +
      '<div><div class="title-xl">' + right + ' out of ' + total + ' right</div><p class="muted">' + line + '</p></div></div>' +
      '<div class="badge"><svg viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="60" fill="var(--logo-tile)"/><circle cx="64" cy="64" r="52" fill="none" stroke="var(--logo-claude)" stroke-width="3" stroke-dasharray="3 7"/>' +
        '<g transform="translate(16 18) scale(.75)">' + BOOK + PAUSE + '</g></svg>' +
      '<div class="grow"><b>' + esc(C.title) + '</b><span class="muted">' + L.map(function (l) { return esc(l.topic); }).join(' · ') + '</span></div></div>' +
      (missed.length ? '<div class="note"><b>' + (missed.length === 1 ? 'One question to look at again' : missed.length + ' questions to look at again') + '</b>' +
        missed.map(function (x) { return '<span>' + esc(x.q.ask) + ' The answer: ' + esc(x.q.options[x.q.right]) + '.</span>'; }).join('') + '</div>' : '') +
      (DATA.saved.length ? '<div class="group"><h4>Waiting in your prompt box when Claude is back</h4><ol class="list">' + DATA.saved.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol><span class="small">You saved these in the pane. Nothing is sent until you press enter.</span></div>' : '') +
      (asks.length ? '<div class="group"><h4>Things to ask Claude next</h4><ol class="list">' + asks.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>' : '') +
      '<div class="group"><h4>Share it</h4><div class="share" id="share">' + esc(share) + '</div><span class="small">Your project name stays out of it.</span></div>',
      foot('<button class="btn quiet" data-go="home">Course home</button><div class="grow"></div><button class="btn primary" data-copy="share">Copy to share</button>'));
  }

  /* ---------- moving around ---------- */
  function render() {
    if (S.view === 'briefing') briefing(); else if (S.view === 'lesson') lesson(); else if (S.view === 'lessonDone') lessonDone();
    else if (S.view === 'final') final(); else if (S.view === 'score') score(); else home();
  }
  function go(to) {
    S.sel = null;
    if (to.indexOf('lesson:') === 0) { S.view = 'lesson'; S.i = +to.slice(7); S.card = 0; }
    else if (to === 'final') { S.view = 'final'; S.q = 0; for (var j = 0; j < F.length; j++) if (S.answers['final:' + j] === undefined) { S.q = j; break; } }
    else S.view = to;
    render();
  }
  function copy(btn, id) {
    var el = document.getElementById(id), text = el ? el.textContent : '';
    var ok = function () { btn.textContent = 'Copied'; btn.classList.add('done'); };
    var pick = function () { var r = document.createRange(); r.selectNodeContents(el); var s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = 'Selected, press Copy'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, pick); else pick();
  }
  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go],[data-act],[data-opt],[data-copy]');
    if (!t || t.disabled) return;
    if (t.dataset.copy) return copy(t, t.dataset.copy);
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.opt !== undefined) { S.sel = +t.dataset.opt; render(); var o = app.querySelectorAll('.opt')[S.sel]; if (o) o.focus(); return; }
    var a = t.dataset.act;
    if (a === 'brief-done') { S.briefed = true; save(); return go('lesson:0'); }
    if (a === 'back') { S.card--; S.sel = null; return render(); }
    if (a === 'next') { S.card++; S.sel = null; return render(); }
    if (a === 'pick') { S.picks[S.i] = S.sel; S.sel = null; save(); return render(); }
    if (a === 'check') { S.answers[t.dataset.key] = S.sel; S.sel = null; save(); return render(); }
    if (a === 'after') {
      if (S.view === 'lesson') { if (!has(S.done, S.i)) S.done.push(S.i); save(); S.view = 'lessonDone'; return render(); }
      for (var j = S.q + 1; j < F.length; j++) if (S.answers['final:' + j] === undefined) { S.q = j; S.sel = null; return render(); }
      return go('score');
    }
  });
  app.addEventListener('keydown', function (e) {
    if (e.target.classList && e.target.classList.contains('step') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(e.target.dataset.go); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    var n = parseInt(e.key, 10), o = app.querySelectorAll('.opt:not([disabled])');
    if (n >= 1 && n <= o.length) { e.preventDefault(); o[n - 1].click(); return; }
    if (e.key === 'Enter' && !(document.activeElement && document.activeElement.matches('button, [role=button], summary'))) {
      var p = app.querySelector('.foot .btn.primary:not(:disabled)'); if (p) { e.preventDefault(); p.click(); }
    }
    if (e.key === 'Escape' && S.view !== 'home') go('home');
  });
  setInterval(function () { var c = app.querySelector('.clock'); if (c) c.outerHTML = clock(); side(); }, 30000);
  render();
})();
</script>
</body>
</html>
`;
