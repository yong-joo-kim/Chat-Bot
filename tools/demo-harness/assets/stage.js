/* 무대 제어 — 하네스가 page.evaluate로 window.__stage 를 호출한다(ui-spec §3·§4).
   이 스크립트의 타이머는 화면 갱신용이며 설계 H-S2(고정 지연 금지) 검사 대상이 아니다(src 아래 ts 파일만 검사 — ui-spec A-8). 문자열은 모두 textContent로만 넣는다. */
(function () {
  'use strict';
  var cfg = window.__STAGE_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var BUDGETS = [30, 90, 80, 55, 95, 95, 70, 70, 15]; // 구간 예산(초) — 진행 막대 폭
  var timer = { baseMs: 0, at: Date.now(), paused: false, total: 600 };
  var captionNotice = '';

  function fmt(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function renderTimer() {
    var elapsed = (timer.baseMs + (timer.paused ? 0 : Date.now() - timer.at)) / 1000;
    var remain = timer.total - elapsed;
    var el = $('timer-val');
    if (timer.ended) { el.textContent = '종료'; return; }
    if (remain <= 0) { el.textContent = '+' + fmt(-remain); $('timer').querySelector('.lbl').textContent = '예정 시간 초과'; }
    else { el.textContent = fmt(remain); $('timer').querySelector('.lbl').textContent = '남은 시간'; }
  }
  setInterval(renderTimer, 1000);

  // 진행 막대 — 9구간, 예산에 비례한 폭
  (function buildProgress() {
    var p = $('progress');
    BUDGETS.forEach(function (b) { var s = document.createElement('div'); s.className = 'seg'; s.style.flex = String(b) + ' 1 0'; s.appendChild(document.createElement('i')); p.appendChild(s); });
  })();

  // 1280x720처럼 오른쪽 칸이 1024 미만이면 관리자 화면 iframe을 논리 폭 1024로 두고 축소(ui-spec §3.2)
  function layoutFrames() {
    var box = $('pane-console').querySelector('.frame-box');
    var f = $('console');
    var w = box.clientWidth, h = box.clientHeight;
    if (w > 0 && w < 1024) { var sc = w / 1024; f.style.width = '1024px'; f.style.height = (h / sc) + 'px'; f.style.transform = 'scale(' + sc + ')'; }
    else { f.style.width = '100%'; f.style.height = '100%'; f.style.transform = 'none'; }
    var sbox = $('pane-site').querySelector('.frame-box'); var s = $('site');
    s.style.width = '100%'; s.style.height = '100%';
  }
  window.addEventListener('resize', layoutFrames);

  var api = {
    version: 1,
    setLayout: function (name) {
      var main = $('main'), panes = $('panes');
      main.setAttribute('data-layout', name); panes.setAttribute('data-layout', name);
      layoutFrames();
    },
    /** 구간 칩·제목(상단 바) */
    setSegment: function (chip, title) { $('seg-chip').textContent = chip; $('seg-title').textContent = title; },
    /** {elapsedMs, paused, totalSec?} 스냅샷 — 로컬 1초 갱신이 이어받는다 */
    setTimer: function (s) { timer.baseMs = s.elapsedMs || 0; timer.at = Date.now(); timer.paused = !!s.paused; if (s.totalSec) timer.total = s.totalSec; timer.ended = !!s.ended; renderTimer(); },
    /** fractions: 9개(0~1) — 구간별 채움 비율 */
    setProgress: function (fractions) { var segs = $('progress').querySelectorAll('.seg i'); for (var i = 0; i < segs.length; i++) segs[i].style.width = Math.round(100 * Math.min(1, Math.max(0, fractions[i] || 0))) + '%'; },
    setPaneLabel: function (which, text) { $(which === 'site' ? 'label-site' : 'label-console').textContent = text; },
    setFrameSrc: function (which, src) { $(which).src = src; layoutFrames(); },
    /** iframe을 이동하고 load 이벤트까지 기다린다(같은 주소면 새로고침). 20초 안에 안 오면 false. */
    navigate: function (which, src) {
      return new Promise(function (resolve) {
        var f = $(which); var finished = false;
        function done(ok) { if (finished) return; finished = true; f.removeEventListener('load', onload); resolve(ok); }
        function onload() { done(true); }
        f.addEventListener('load', onload);
        setTimeout(function () { done(false); }, 20000);
        var same = false; try { same = f.contentWindow.location.href === src; } catch (e) { same = false; }
        if (same) { try { f.contentWindow.location.reload(); } catch (e) { f.src = src; } } else { f.src = src; }
        layoutFrames();
      });
    },
    /** 카드(시작·마무리·로드맵): kind = system | system-end | roadmap */
    showCard: function (kind) {
      var url = kind === 'roadmap' ? '/roadmap' : kind === 'system-end' ? '/system?phase=end' : '/system';
      $('card-frame').src = cfg.cardBase + url;
      api.setLayout('card');
    },
    showCaption: function (c) {
      $('caption').removeAttribute('data-paused');
      var b = $('cap-badges'); b.textContent = '';
      (c.badges || []).slice(0, 2).forEach(function (t) { var e = document.createElement('span'); e.className = 'badge'; e.textContent = t; b.appendChild(e); });
      var body = $('cap-body'); body.textContent = '';
      (c.lines || []).slice(0, 2).forEach(function (t) { var d = document.createElement('div'); d.textContent = t; body.appendChild(d); });
      var n = $('cap-notice'); n.textContent = '';
      captionNotice = c.notice || '';
      if (captionNotice) { var chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = '시연 안내'; n.appendChild(chip); n.appendChild(document.createTextNode(captionNotice)); }
    },
    clearCaption: function () { $('cap-badges').textContent = ''; $('cap-body').textContent = ''; $('cap-notice').textContent = ''; captionNotice = ''; },
    pauseCaption: function (on) { var c = $('caption'); if (on) { c.setAttribute('data-paused', '1'); $('cap-body').textContent = ''; var d = document.createElement('div'); d.textContent = '잠시 멈춤 — 진행자가 설명하는 중입니다'; $('cap-body').appendChild(d); } else c.removeAttribute('data-paused'); },
    /** none | paused | fallback | failed */
    setStateChip: function (state) {
      var chip = $('state-chip'); chip.setAttribute('data-state', state || 'none');
      var text = { paused: '잠시 멈춤', fallback: '대체 화면', failed: '이번 시연에서 보여 드리지 못한 장면' }[state] || '';
      $('state-text').textContent = text;
    },
    /** 대기 화면(#ready) 켜고 끄기 */
    setReady: function (on) {
      var o = $('overlay'); o.setAttribute('data-on', on ? '1' : '0');
      document.body.setAttribute('data-phase', on ? 'ready' : 'show');
      if (on) { $('overlay-big').textContent = '시연 준비가 끝났습니다'; $('overlay-sub').textContent = '진행자가 시작하면 시연이 시작됩니다'; }
    },
    setFinishing: function () { var o = $('overlay'); o.setAttribute('data-on', '1'); document.body.setAttribute('data-phase', 'finishing'); $('overlay-big').textContent = '시연을 마칩니다. 정리하는 중입니다'; $('overlay-sub').textContent = ''; },
    /** 레이아웃 변경용 크로스페이드(아웃 120ms -> fn -> 인 180ms, 합 300ms 이내) */
    transition: function (fn, done) {
      var main = $('main');
      if (document.documentElement.getAttribute('data-motion') === 'off') { fn(); if (done) done(); return; }
      main.setAttribute('data-fade', 'out');
      setTimeout(function () { fn(); main.style.transition = 'opacity 180ms linear'; main.removeAttribute('data-fade'); setTimeout(function () { main.style.transition = ''; if (done) done(); }, 180); }, 120);
    },
    /** 콘솔 iframe의 현재 주소(점검용) */
    consoleUrl: cfg.consoleUrl,
    siteUrl: cfg.siteUrl,
  };
  window.__stage = api;
  layoutFrames();
  renderTimer();
})();
