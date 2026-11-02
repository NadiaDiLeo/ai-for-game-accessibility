/* AI for game accessibility. Talk runtime.
   Plain script (no modules) so it also runs from file:// with no server. */
(function () {
  'use strict';

  var WG = window.WG;
  var W = 1600, H = 900;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var root = document.documentElement;
  var stage = $('#stage');
  var scale = 1, fluid = false, lk = 0.6;
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  // next frame, with a timer fallback so a throttled tab never stalls a transition
  var frame = function () { return new Promise(function (r) { var done = false; var go = function () { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); }); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ------------------------------------------------------------------ prefs */
  var osReduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var prefs = { reduceMotion: osReduce };
  try {
    var saved = JSON.parse(localStorage.getItem('aig-prefs') || '{}');
    if (typeof saved.reduceMotion === 'boolean') prefs.reduceMotion = saved.reduceMotion;
  } catch (e) { /* storage unavailable: keep defaults */ }
  function savePrefs() { try { localStorage.setItem('aig-prefs', JSON.stringify(prefs)); } catch (e) { /* ignore */ } }
  function rm() { return prefs.reduceMotion; }
  // stage-wide effects (zoom rects, dither wipe, the case flight) only make sense on the fixed stage
  function fxOff() { return prefs.reduceMotion || fluid; }
  function applyPrefs() {
    root.classList.toggle('rm', rm());
    $('#opt-motion').checked = rm();
  }

  /* ------------------------------------------------------------------ layout mode */
  function fit() {
    // the layout viewport: unlike innerWidth, it does not grow when a phone zooms out
    var w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    var s = Math.min(w / W, h / H);
    var wasFluid = fluid;
    // phones and tablets reflow instead of shrinking the text; a projector or laptop keeps the stage
    var touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    fluid = s < 0.6 || (touch && s < 0.7);
    root.classList.toggle('fluid', fluid);
    scale = fluid ? 1 : s;
    root.style.setProperty('--s', scale);
    if (fluid) {
      lk = clamp(h * 0.48 / 570, 0.42, 0.8);
      root.style.setProperty('--lk', lk);
      root.style.setProperty('--tk', Math.min(1, (w - 32) / 470, h * 0.66 / 665));
    }
    if (wasFluid !== fluid) { hideLabel(); if (popupOpen()) closePopup(true); }
  }
  function sRect(el) {
    var r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
  }
  // layout box inside the library scene (unaffected by the scene's scaling on small screens)
  function oRect(el) { return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }; }

  /* ------------------------------------------------------------------ sequence */
  var items = WG.items, byId = {}, seq = [];
  items.forEach(function (it, i) {
    it.index = i; byId[it.id] = it;
    it.pages.forEach(function (p, j) { seq.push({ item: it, pi: j, id: p.id }); });
  });
  function seqIndex(itemId, pi) {
    for (var i = 0; i < seq.length; i++) if (seq[i].item.id === itemId && seq[i].pi === (pi || 0)) return i;
    return -1;
  }
  var pos = -1;            // current index in seq while in the deck
  var visited = {};        // item id -> true
  var screen = 'title';
  var busy = false;

  function live(msg) { $('#live').textContent = msg; }

  /* ================================================================== FX */

  /* Classic Mac "zoom rects": dotted outlines travelling from a to b. */
  function zoomRects(a, b, opts) {
    opts = opts || {};
    if (fxOff() || !a || !b) return Promise.resolve();
    var layer = $('#zoom-layer'), n = opts.n || 7, dur = opts.dur || 240, made = [];
    return new Promise(function (resolve) {
      var i = 0;
      function step() {
        i++;
        var t = i / n, e = 1 - Math.pow(1 - t, 2);
        var d = document.createElement('div');
        d.className = 'zr';
        d.style.left = (a.x + (b.x - a.x) * e) + 'px';
        d.style.top = (a.y + (b.y - a.y) * e) + 'px';
        d.style.width = (a.w + (b.w - a.w) * e) + 'px';
        d.style.height = (a.h + (b.h - a.h) * e) + 'px';
        layer.appendChild(d); made.push(d);
        if (made.length > 3) layer.removeChild(made.shift());
        if (i < n) setTimeout(step, dur / n);
        else setTimeout(function () { made.forEach(function (m) { if (m.parentNode) m.parentNode.removeChild(m); }); resolve(); }, dur / n);
      }
      step();
    });
  }

  /* Ordered-dither wipe across the stage, sweeping left to right. */
  var BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  var fx = $('#fx'), fctx = fx.getContext('2d'), CW = 160, CH = 90;
  fx.width = CW; fx.height = CH;
  var fimg = fctx.createImageData(CW, CH), fbuf = new Uint32Array(fimg.data.buffer);
  var thr = new Float32Array(CW * CH);
  for (var yy = 0; yy < CH; yy++) for (var xx = 0; xx < CW; xx++) {
    thr[yy * CW + xx] = 0.62 * (BAYER[(yy & 7) * 8 + (xx & 7)] / 64) + 0.37 * (xx / (CW - 1));
  }
  var COVER = (255 << 24) | (0xec << 16) | (0xe1 << 8) | 0xe7; // #e7e1ec, little-endian ABGR
  function drawFx(t, covering) {
    for (var i = 0; i < thr.length; i++) {
      var on = covering ? thr[i] < t : thr[i] >= t;
      fbuf[i] = on ? COVER : 0;
    }
    fctx.putImageData(fimg, 0, 0);
  }
  function animate(dur, fn) {
    return new Promise(function (resolve) {
      var t0 = performance.now(), ended = false;
      function tick() {
        if (ended) return;
        var t = clamp((performance.now() - t0) / dur, 0, 1);
        fn(t);
        if (t < 1) requestAnimationFrame(tick); else { ended = true; resolve(); }
      }
      requestAnimationFrame(tick);
      // if frames are throttled, still finish on time
      setTimeout(function () { if (!ended) { fn(1); ended = true; resolve(); } }, dur + 250);
    });
  }
  function wipe(mid) {
    if (fxOff()) { mid(); return Promise.resolve(); }
    fx.style.display = 'block';
    return animate(260, function (t) { drawFx(t, true); })
      .then(function () { mid(); return frame(); })
      .then(function () { return animate(300, function (t) { drawFx(t, false); }); })
      .then(function () { fx.style.display = 'none'; });
  }

  /* Dithered fade for a single element, using a stepped Bayer mask. */
  var maskCache = [];
  function bayerMask(k) { // k in 0..64 cells visible
    if (maskCache[k]) return maskCache[k];
    var r = '';
    for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) if (BAYER[y * 8 + x] < k) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" shape-rendering="crispEdges">' + r + '</svg>';
    maskCache[k] = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    return maskCache[k];
  }
  function ditherIn(el, dur, cell) {
    if (rm()) { el.style.opacity = 1; return Promise.resolve(); }
    cell = cell || 6;
    el.style.opacity = 1;
    var set = function (k) {
      if (k >= 64) { el.style.webkitMaskImage = el.style.maskImage = ''; return; }
      el.style.webkitMaskImage = el.style.maskImage = bayerMask(k);
      el.style.webkitMaskSize = el.style.maskSize = (cell * 8) + 'px ' + (cell * 8) + 'px';
    };
    set(0);
    return animate(dur, function (t) { set(Math.round(t * 64)); });
  }

  /* timers that belong to the current page: cleared when the page is left */
  var pageTimers = [];
  function later(fn, ms) { pageTimers.push(setTimeout(fn, ms)); }
  function clearPageTimers() { pageTimers.forEach(clearTimeout); pageTimers = []; }

  /* ================================================================== LIGHTBOX */
  var lb = $('#lightbox');
  function openLightbox(img) {
    var i = $('img', lb);
    i.src = img.currentSrc || img.src; i.alt = img.alt;
    lb.hidden = false;
    $('.lb-close', lb).focus();
  }
  function closeLightbox() { lb.hidden = true; }
  lb.addEventListener('click', closeLightbox);

  /* ================================================================== FLOATING WINDOWS */
  var zTop = 30;
  function openWin(id, fromEl) {
    var w = document.getElementById(id);
    if (!w) return;
    var page = w.closest('.page');
    $$('.win-float', page).forEach(function (o) { if (o !== w) o.hidden = true; });
    w.hidden = false;
    w.style.zIndex = ++zTop;
    var to = sRect(w);
    w.style.visibility = 'hidden';
    var from = fromEl ? sRect(fromEl) : { x: to.x + to.w / 2 - 20, y: to.y + to.h / 2 - 20, w: 40, h: 40 };
    syncOpeners(page);
    return zoomRects(from, to).then(function () {
      w.style.visibility = '';
      var sc = $('.win-scroll', w); if (sc) sc.scrollTop = 0;
    });
  }
  function closeFloats(page) {
    $$('.win-float', page || document).forEach(function (w) { w.hidden = true; w.classList.remove('max'); });
    syncOpeners(page || document);
  }
  // the button whose window is open is marked .open (theme buttons show it)
  function syncOpeners(scope) {
    $$('[data-open]', scope).forEach(function (o) {
      var w = document.getElementById(o.dataset.open);
      o.classList.toggle('open', !!w && !w.hidden);
    });
  }

  stage.addEventListener('click', function (e) {
    var close = e.target.closest('.win-float .win-close');
    if (close) { var cw = close.closest('.win-float'); cw.hidden = true; syncOpeners(cw.closest('.page') || document); return; }
    var zoom = e.target.closest('button.win-zoom');
    if (zoom) {
      var win = zoom.closest('.win');
      if ($('.win-scroll', win)) { win.classList.toggle('max'); return; }
      var img = $('.win-img img', win);
      if (img) openLightbox(img);
      return;
    }
    var im = e.target.closest('.win-img img');
    if (im) { openLightbox(im); return; }
    // figure icons that are not part of the step sequence
    var op = e.target.closest('[data-open]:not([data-step])');
    if (op) { e.preventDefault(); op.classList.add('is-done'); openWin(op.dataset.open, op); }
  });

  // drag floating windows by their title bar (large screens only)
  (function () {
    var drag = null;
    stage.addEventListener('pointerdown', function (e) {
      if (fluid) return;
      var bar = e.target.closest('.win-float .win-bar');
      if (!bar || e.target.closest('button')) return;
      var w = bar.parentNode;
      w.style.zIndex = ++zTop;
      drag = { w: w, x: e.clientX, y: e.clientY, l: w.offsetLeft, t: w.offsetTop };
      w.classList.add('dragging');
      bar.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.w.style.left = clamp(drag.l + (e.clientX - drag.x) / scale, -200, W - 120) + 'px';
      drag.w.style.top = clamp(drag.t + (e.clientY - drag.y) / scale, 0, H - 60) + 'px';
    });
    stage.addEventListener('pointerup', function () { if (drag) { drag.w.classList.remove('dragging'); drag = null; } });
  })();

  // hover: figures, windows and file icons pop once, the first time the pointer reaches them,
  // then stay still. The pop waits for the slide's entry animation, so it is never lost in it;
  // showPage() also checks for a pointer already resting where a figure appears.
  var lastPt = null;
  document.addEventListener('pointermove', function (e) { lastPt = { x: e.clientX, y: e.clientY }; }, { passive: true });
  function popTarget(t) {
    var el = t && t.closest ? t.closest('.jit, .file') : null;
    if (!el || el.classList.contains('settled') || el._popWait) return;
    var pg = el.closest('.page');
    if (pg && !pg.classList.contains('is-current')) return;
    var play = function () {
      el._popWait = false;
      if (el.classList.contains('settled') || !el.offsetParent) return;
      el.classList.add('settled');
      if (rm() || el.classList.contains('dragging')) return;
      el.classList.add('pop');
      setTimeout(function () { el.classList.remove('pop'); }, 650);
    };
    var a = (el.closest('.in') || {})._in;
    el._popWait = true;
    if (a && a.playState === 'running') a.finished.then(function () { setTimeout(play, 60); }, function () { el._popWait = false; });
    else play();
  }
  stage.addEventListener('pointerover', function (e) { popTarget(e.target); });

  /* ================================================================== LIBRARY */
  var FLOOR = 760;
  // x: left edge, w/h: size of the case seen from the side (from each cover's real format),
  // lying: stacked flat (b = height above the shelf), lean: tilt in degrees
  var LAYOUT = {
    title:      { x: 104, w: 42, h: 470 },
    intro:      { x: 152, w: 37, h: 309 },
    awards:     { x: 380, w: 26, h: 420 },
    pointcheck: { x: 410, w: 36, h: 338 },
    builds:     { x: 450, w: 35, h: 420 },
    model:      { x: 522, w: 25, h: 420, lean: -6 },
    attention:  { x: 580, w: 470, h: 37, lying: true, b: 0 },
    cipt:       { x: 600, w: 425, h: 37, lying: true, b: 37 },
    checklists: { x: 592, w: 420, h: 33, lying: true, b: 74 },
    llm:        { x: 1062, w: 37, h: 425 },
    record:     { x: 1228, w: 37, h: 338 },
    limits:     { x: 1269, w: 36, h: 425 },
    claims:     { x: 1309, w: 26, h: 420 },
    end:        { x: 1348, w: 36, h: 338 },
    refs:       { x: 1412, w: 16, h: 372, lean: -4 },
    part1:      { tag: true, x: 380 },
    part2:      { tag: true, x: 580 }
  };
  // decorative objects: dithered photos (public domain, Evan-Amos) and a jewel case shown face-out
  var OBJECTS = [
    { src: 'crash', jewel: true, x: 196, w: 172, h: 163, lean: -2 },
    { src: 'controller', x: 640, b: 107, w: 260, h: 166 },
    { src: 'gameboy', x: 1108, w: 107, h: 179 },
    { src: 'memcard', x: 1446, w: 62, h: 55, lean: -6 },
    { src: '3ds', x: 1316, top: 121, w: 152, h: 138, sill: true }
  ];
  var shelf = $('#shelf');
  var caseEls = {};
  var selId = null;

  // url() inside a custom property resolves against style.css, hence the ../ paths
  function artStyle(dir, file, color) {
    var css = '--sp:url(\'../' + dir + '/' + file + '\');';
    if (color) {
      var c = file.replace(/\.png$/, '-c.png');
      css += '--sp-c:url(\'../' + dir + '/' + c + '\');';
      new Image().src = 'assets/' + dir + '/' + c; // preload, so the hover swap does not flicker
    }
    return css;
  }
  function spineStyle(item) {
    var sp = WG.spines[item.id];
    return sp ? artStyle('spines', sp.file, sp.color) : '';
  }

  function buildShelf() {
    OBJECTS.forEach(function (o) {
      var el = document.createElement('span');
      el.className = (o.jewel ? 'jewel' : 'obj') + (o.sill ? ' on-sill' : '');
      el.setAttribute('aria-hidden', 'true');
      el.style.cssText = 'left:' + o.x + 'px;top:' + (o.top != null ? o.top : FLOOR - (o.b || 0) - o.h) + 'px;width:' + o.w + 'px;height:' + o.h + 'px;' +
        (o.lean ? '--lean:' + o.lean + 'deg;' : '');
      el.innerHTML = '<span class="sp" style="' + artStyle('deco', o.src + '.png', true) + '"></span>';
      shelf.appendChild(el);
    });

    items.forEach(function (it) {
      var L = LAYOUT[it.id];
      if (!L) return;
      var el = document.createElement('button');
      el.type = 'button';
      el.dataset.id = it.id;
      if (L.tag) {
        el.className = 'shelf-tag';
        el.style.left = L.x + 'px';
        el.textContent = it.title;
        el.setAttribute('aria-label', 'Part ' + it.part + ': ' + it.title);
      } else {
        el.className = 'case' + (L.lying ? ' lying' : '');
        el.style.left = L.x + 'px';
        el.style.width = L.w + 'px';
        el.style.height = L.h + 'px';
        el.style.top = (FLOOR - (L.b || 0) - L.h) + 'px';
        if (L.lean) {
          el.style.setProperty('--lean', L.lean + 'deg');
          el.style.setProperty('--ox', L.lean < 0 ? '0%' : '100%');
        }
        el.setAttribute('aria-label', (it.num ? it.num + '. ' : '') + it.title);
        var inner;
        if (it.kind === 'title') {
          inner = '<span class="sp-own"><span class="spine-own"><span class="so-title">' + WG.spineTitle + '</span><span class="so-author">DI LEO</span></span></span>';
        } else if (L.lying) {
          inner = '<span class="sp" style="width:' + L.h + 'px;height:' + L.w + 'px;left:' + ((L.w - L.h) / 2) + 'px;top:' + ((L.h - L.w) / 2) + 'px;transform:rotate(-90deg);' + spineStyle(it) + '"></span>';
        } else {
          inner = '<span class="sp" style="' + spineStyle(it) + '"></span>';
        }
        el.innerHTML = inner + (it.num ? '<span class="sticker">' + it.num + '</span>' : '');
      }
      shelf.appendChild(el);
      caseEls[it.id] = el;
    });
  }

  var label = $('#hover-label');
  function showLabel(id) {
    var el = caseEls[id];
    if (!el) return;
    var r = oRect(el);
    label.textContent = byId[id].title;
    label.classList.add('on');
    var lh = label.offsetHeight;
    var top = r.y - lh - (el.classList.contains('shelf-tag') ? 24 : 16);
    label.style.left = clamp(r.x + r.w / 2, 190, W - 190) + 'px';
    label.style.top = Math.max(fluid ? 240 : 180, top) + 'px';
  }
  function hideLabel() { label.classList.remove('on'); }

  function select(id) {
    if (selId && caseEls[selId]) caseEls[selId].classList.remove('is-sel');
    selId = id;
    if (id && caseEls[id]) { caseEls[id].classList.add('is-sel'); showLabel(id); } else hideLabel();
  }

  shelf.addEventListener('pointerover', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (el && !popupOpen()) showLabel(el.dataset.id);
  });
  shelf.addEventListener('pointerout', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (el && !el.contains(e.relatedTarget)) { if (selId && !popupOpen()) showLabel(selId); else if (!popupOpen()) hideLabel(); }
  });
  shelf.addEventListener('focusin', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (el && !popupOpen()) select(el.dataset.id);
  });
  shelf.addEventListener('click', function (e) {
    var el = e.target.closest('.case, .shelf-tag');
    if (!el || busy) return;
    openPopup(el.dataset.id);
  });

  /* ---------- pop-up ---------- */
  var popup = $('#popup');
  var popId = null;
  function popupOpen() { return !popup.hidden; }
  function openPopup(id) {
    var it = byId[id], el = caseEls[id];
    if (!it || !el) return;
    if (popupOpen()) closePopup(true);
    popId = id;
    select(id);
    hideLabel();
    el.classList.add('is-pulled');
    $('#pop-num').textContent = it.num ? 'No. ' + it.num : (it.part ? 'Part ' + it.part : '');
    $('#pop-title').textContent = it.title;
    $('#pop-blurb').textContent = it.blurb;
    var sp = WG.spines[id];
    $('#pop-spine').textContent = sp && sp.game ? 'On the spine: ' + sp.game + ' (' + sp.platform + ')' : '';
    $('#pop-spine').hidden = !(sp && sp.game);
    var ol = $('#pop-pages');
    ol.innerHTML = '';
    if (it.pages.length > 1) {
      it.pages.forEach(function (p, j) {
        var li = document.createElement('li');
        li.innerHTML = '<button type="button" data-pi="' + j + '"><span class="pp-n">' + (j + 1) + '</span><span></span></button>';
        li.lastChild.lastChild.textContent = p.label;
        ol.appendChild(li);
      });
      ol.hidden = false;
    } else ol.hidden = true;
    $('#pop-open').innerHTML = (it.kind === 'title' ? 'Title screen' : 'Open') + ' <svg class="ic"><use href="#i-arrow"/></svg>';

    popup.hidden = false;
    if (fluid) { ($('#pop-pages button') || $('#pop-open')).focus({ preventScroll: true }); return; }
    popup.style.visibility = 'hidden';
    var r = oRect(el), pw = popup.offsetWidth, ph = popup.offsetHeight;
    var left = (r.x + r.w / 2 < W / 2 + 40) ? r.x + r.w + 34 : r.x - 34 - pw;
    if (el.classList.contains('lying') || el.classList.contains('shelf-tag')) left = r.x + Math.min(r.w, 260) + 30;
    left = clamp(left, 40, W - pw - 40);
    var top = clamp(r.y - 10, 180, FLOOR - ph - 20);
    if (el.classList.contains('shelf-tag')) top = clamp(FLOOR - ph - 60, 180, 600);
    popup.style.left = left + 'px'; popup.style.top = top + 'px';
    zoomRects(sRect(el), { x: left, y: top, w: pw, h: ph }, { n: 6, dur: 200 }).then(function () {
      if (popId !== id) return;
      popup.style.visibility = '';
      ($('#pop-pages button') || $('#pop-open')).focus({ preventScroll: true });
    });
  }
  function closePopup(quiet) {
    if (popId && caseEls[popId]) caseEls[popId].classList.remove('is-pulled');
    popup.hidden = true;
    var id = popId; popId = null;
    if (!quiet && id && caseEls[id]) caseEls[id].focus({ preventScroll: true });
  }
  $('#pop-open').addEventListener('click', function () { if (popId) openItem(popId, 0); });
  $('#pop-pages').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pi]');
    if (b && popId) openItem(popId, +b.dataset.pi);
  });
  $('#scr-library').addEventListener('click', function (e) {
    if (e.target.closest('[data-act="pop-close"]')) { closePopup(); return; }
    if (popupOpen() && !e.target.closest('#popup') && !e.target.closest('.case, .shelf-tag')) closePopup(true);
  });

  function openItem(id, pi) {
    var it = byId[id];
    if (it.kind === 'title') { closePopup(true); toTitle(); return; }
    var idx = seqIndex(id, pi);
    if (idx < 0) return;
    enterDeck(idx, caseEls[id]);
  }

  function refreshLibrary() {
    Object.keys(caseEls).forEach(function (id) { caseEls[id].classList.toggle('seen', !!visited[id]); });
    $('#btn-continue .lbl').textContent = pos > 0 ? 'Continue' : 'Start';
  }
  function resumeIndex() {
    if (pos < 1) return 1;
    return Math.min(pos + 1, seq.length - 1);
  }
  // on small screens, scroll the shelf strip so a case is in view
  function revealCase(id) {
    if (!fluid || !caseEls[id]) return;
    var sc = $('.lib-scroll'), r = oRect(caseEls[id]);
    sc.scrollLeft = Math.max(0, (r.x + r.w / 2) * lk - sc.clientWidth / 2);
  }

  $('#btn-continue').addEventListener('click', continueFromLibrary);
  function continueFromLibrary() {
    if (busy) return;
    var idx = resumeIndex(), it = seq[idx].item;
    closePopup(true);
    select(it.id);
    var el = caseEls[it.id];
    if (el) el.classList.add('is-pulled');
    busy = true;
    wait(fxOff() ? 0 : 320).then(function () { busy = false; enterDeck(idx, el); });
  }

  /* ================================================================== SCREENS */
  function show(name) {
    $$('.screen').forEach(function (s) { s.classList.toggle('is-active', s.id === 'scr-' + name); });
    screen = name;
    if (fluid) window.scrollTo(0, 0);
  }

  function enterDeck(idx, fromEl) {
    if (busy) return;
    busy = true;
    var from = fromEl ? sRect(fromEl) : null;
    closePopup(true);
    hideLabel();
    var go = function () {
      $$('.case.is-pulled').forEach(function (c) { c.classList.remove('is-pulled'); });
      select(null);
      show('deck');
      showPage(idx, { dir: 1 });
      busy = false;
    };
    if (from && !fxOff()) zoomRects(from, { x: 24, y: 24, w: W - 48, h: H - 48 }, { n: 8, dur: 300 }).then(go);
    else go();
  }

  function toLibrary() {
    if (busy) return;
    busy = true;
    var cur = seq[pos], el = cur && caseEls[cur.item.id];
    leavePage();
    show('library');
    refreshLibrary();
    var done = function () {
      busy = false;
      if (el) { revealCase(cur.item.id); select(cur.item.id); el.focus({ preventScroll: true }); }
    };
    if (el && !fxOff()) {
      el.style.visibility = 'hidden';
      zoomRects({ x: 24, y: 24, w: W - 48, h: H - 48 }, sRect(el), { n: 8, dur: 300 }).then(function () { el.style.visibility = ''; done(); });
    } else done();
    live('Library');
  }

  /* ---------- title screen and the case flight ---------- */
  var wrap = $('.case3d-wrap'), box = $('#title-case');
  var CASE = { x: 565, y: 34, w: 470, h: 665 };
  var TURN = 'translateZ(-235px) rotateY(90deg)', FLAT = 'translateZ(-30px) rotateY(0deg)';
  function flightTransform() {
    var target = sRect(caseEls.title);
    var k = target.h / CASE.h;
    var dx = (target.x + target.w / 2) - (CASE.x + CASE.w / 2), dy = (target.y + target.h / 2) - (CASE.y + CASE.h / 2);
    return 'translate(' + dx + 'px,' + dy + 'px) scale(' + k + ')';
  }
  function titleUi(on) {
    $$('.title-cta, .cover-band, .cover-title, .cover-sub, .cover-author').forEach(function (e) { e.style.opacity = on ? '' : 0; });
  }

  function startGame() {
    if (busy || screen !== 'title') return;
    busy = true;
    var lib = $('#scr-library');
    refreshLibrary();
    if (fxOff()) { show('library'); busy = false; caseEls.intro.focus({ preventScroll: true }); return; }
    $('.title-cta').style.opacity = 0;
    box.style.transition = 'transform .6s cubic-bezier(.5,0,.3,1)';
    box.style.transform = TURN;
    wait(560).then(function () {
      // the library appears underneath while the case flies to its slot
      lib.classList.add('is-active');
      lib.style.opacity = 0;
      caseEls.title.style.visibility = 'hidden';
      return frame();
    }).then(function () {
      var tf = flightTransform();
      lib.style.transition = 'opacity .45s';
      lib.style.opacity = 1;
      wrap.style.transition = 'transform .65s cubic-bezier(.6,0,.25,1)';
      wrap.style.transform = tf;
      return wait(680);
    }).then(function () {
      caseEls.title.style.visibility = '';
      show('library');
      lib.style.transition = lib.style.opacity = '';
      wrap.style.transition = box.style.transition = '';
      wrap.style.transform = '';
      box.style.transform = FLAT;
      $('.title-cta').style.opacity = '';
      busy = false;
      select('title');
      wait(240).then(function () { if (selId === 'title') select(null); });
      live('Library. Pick a case from the shelf.');
    });
  }

  function toTitle() {
    if (busy) return;
    leavePage();
    if (screen === 'deck' || fxOff()) {
      wipe(function () { show('title'); titleUi(true); box.style.transform = FLAT; });
      return;
    }
    busy = true;
    var lib = $('#scr-library'), tit = $('#scr-title');
    titleUi(false);
    box.style.transition = 'none';
    box.style.transform = TURN;
    wrap.style.transition = 'none';
    wrap.style.transform = flightTransform();
    caseEls.title.style.visibility = 'hidden';
    tit.classList.add('is-active');
    frame().then(frame).then(function () {
      wrap.style.transition = 'transform .6s cubic-bezier(.6,0,.25,1)';
      wrap.style.transform = '';
      lib.style.transition = 'opacity .45s';
      lib.style.opacity = 0;
      return wait(620);
    }).then(function () {
      show('title');
      lib.style.transition = lib.style.opacity = '';
      caseEls.title.style.visibility = '';
      box.style.transition = 'transform .55s cubic-bezier(.5,0,.3,1)';
      box.style.transform = FLAT;
      return wait(560);
    }).then(function () {
      box.style.transition = wrap.style.transition = '';
      titleUi(true);
      busy = false;
      $('#btn-start').focus({ preventScroll: true });
    });
  }

  /* typing for the cover title and the dialog boxes */
  function typeInto(el, text, speed) {
    el.textContent = '';
    if (rm()) { el.textContent = text; return Promise.resolve(); }
    return new Promise(function (resolve) {
      var i = 0;
      (function step() {
        i++;
        el.textContent = text.slice(0, i);
        if (i < text.length) setTimeout(step, speed); else resolve();
      })();
    });
  }

  function intro() {
    var tts = $$('.cover-title .tt'), texts = tts.map(function (t) { return t.textContent; });
    var art = $('.cover-art'), sub = $('.cover-sub'), author = $('.cover-author'), band = $('.cover-band'), cta = $('.title-cta');
    if (rm()) return;
    tts.forEach(function (t) { t.textContent = ''; });
    [art, sub, author, band, cta].forEach(function (e) { e.style.opacity = 0; });
    wrap.animate([
      { translate: '0 -70px', opacity: 0 },
      { translate: '0 8px', opacity: 1, offset: .72 },
      { translate: '0 0', opacity: 1 }
    ], { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' });
    wait(380).then(function () {
      band.style.opacity = '';
      return ditherIn(art, 650, 5);
    }).then(function () {
      return typeInto(tts[0], texts[0], 60);
    }).then(function () {
      return typeInto(tts[1], texts[1], 50);
    }).then(function () {
      sub.style.transition = author.style.transition = 'opacity .35s';
      sub.style.opacity = ''; return wait(200);
    }).then(function () {
      author.style.opacity = ''; return wait(260);
    }).then(function () {
      return ditherIn(cta, 380, 3);
    }).then(function () { cta.style.opacity = ''; });
  }

  /* ================================================================== DECK */
  var pagesEl = $('#pages');
  function pageEl(i) { return document.getElementById(seq[i].id); }

  function leavePage() {
    if (pos < 0) return;
    var p = pageEl(pos);
    if (!p) return;
    closeFloats(p);
    clearPageTimers();
    var w = PAGES[p.id];
    if (w && w.leave) w.leave(p);
  }

  // entry animation; uses the separate `translate` property, so the hover pop (transform) is untouched
  function enterAnim(p) {
    $$('.in', p).forEach(function (el, k) {
      if (el._in) el._in.cancel();
      if (rm()) return;
      el._in = el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }],
        { duration: 500, delay: 80 + k * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
  }

  function showPage(i, opts) {
    opts = opts || {};
    if (i < 1 || i >= seq.length) return;
    if (pos >= 0 && pos !== i) leavePage();
    pos = i;
    var s = seq[i], p = pageEl(i), back = opts.dir < 0;
    $$('.page.is-current').forEach(function (o) { if (o !== p) o.classList.remove('is-current'); });
    p.classList.add('is-current');
    if (fluid) window.scrollTo(0, 0);
    var w = PAGES[p.id] || {};
    // widgets go back to their first state, then the steps: forwards resets them, backwards shows everything
    if (w.init) w.init(p);
    resetSteps(p, back);
    enterAnim(p);
    countUp(p, back);
    if (w.enter) w.enter(p, back || rm());
    visited[s.item.id] = true;
    updateHud();
    // a pointer already resting on a figure counts as reaching it
    if (lastPt && !fluid) popTarget(document.elementFromPoint(lastPt.x, lastPt.y));
    live(s.item.title + (s.item.pages.length > 1 ? ', part ' + (s.pi + 1) + ' of ' + s.item.pages.length : ''));
  }

  function go(i, dir) {
    if (busy || i < 0 || i >= seq.length || i === pos) return;
    if (i === 0) { toTitle(); return; }
    var sameItem = pos >= 0 && seq[i].item === seq[pos].item;
    if (sameItem || fxOff()) { showPage(i, { dir: dir }); return; }
    busy = true;
    wipe(function () { showPage(i, { dir: dir }); }).then(function () { busy = false; });
  }

  function next() {
    if (screen !== 'deck') return;
    var st = nextStep(pageEl(pos));
    if (st) { doStep(st); return; }
    if (pos < seq.length - 1) go(pos + 1, 1);
  }
  function prev() {
    if (screen !== 'deck') return;
    if (pos > 1) go(pos - 1, -1);
    else toLibrary();
  }

  /* ---------- steps (figures, demos, statements revealed one at a time) ---------- */
  function steps(p) {
    return $$('[data-step]', p).sort(function (a, b) { return (+a.dataset.step) - (+b.dataset.step); });
  }
  function nextStep(p) {
    var all = steps(p);
    for (var i = 0; i < all.length; i++) if (!all[i].classList.contains('is-done')) return all[i];
    return null;
  }
  function resetSteps(p, revealAll) {
    steps(p).forEach(function (el) {
      el.classList.remove('is-done', 'shown', 'typed');
      if (el.classList.contains('dialog')) $('.dlg-text', el).textContent = '';
    });
    closeFloats(p);
    if (revealAll) {
      steps(p).forEach(function (el) {
        if (el.dataset.open) { el.classList.add('is-done'); return; }
        doStep(el, true);
      });
    }
  }
  // data-fn names the widget a step belongs to
  var STEP = {};
  function doStep(el, instant) {
    if (el.classList.contains('is-done') && !el.classList.contains('game-tab')) {
      if (el.dataset.open) openWin(el.dataset.open, el);
      return;
    }
    el.classList.add('is-done');
    if (el.dataset.open) { openWin(el.dataset.open, el); return; }
    if (el.classList.contains('dialog')) { typeDialog(el, instant); return; }
    if (el.classList.contains('game-tab')) { selectGame(+el.dataset.g, instant); return; }
    var fn = STEP[el.dataset.fn];
    if (fn) fn(el, instant || rm());
  }

  // clicks on step elements
  pagesEl.addEventListener('click', function (e) {
    var page = e.target.closest('.page');
    var st = e.target.closest('[data-step]');
    if (st && st.tagName === 'A') e.preventDefault();
    if (st) {
      if (st.classList.contains('game-tab')) {
        // mark earlier tabs as done too, so the arrow key continues from here
        var n = +st.dataset.step;
        steps(page).forEach(function (o) { if (o.classList.contains('game-tab') && +o.dataset.step < n) o.classList.add('is-done'); });
      }
      if (st.dataset.open) {
        // a figure window opened by hand: the arrow key continues with the next window after it
        var m = +st.dataset.step;
        steps(page).forEach(function (o) { if (o.dataset.open && +o.dataset.step < m) o.classList.add('is-done'); });
      }
      if (st.classList.contains('is-done') && st.dataset.fn) {
        // controls (presets, tabs) can be used again; statements and observations just move the page on
        if (/^(preset|cov|rec|scatter)$/.test(st.dataset.fn)) STEP[st.dataset.fn](st, rm());
        else { var nd = nextStep(page); if (nd) doStep(nd); }
        return;
      }
      doStep(st);
      return;
    }
    // a button that advances its own widget ("Next check")
    var nb = e.target.closest('[data-fn-next]');
    if (nb) { var nx = nextStep(page); if (nx && nx.dataset.fn === nb.dataset.fnNext) doStep(nx); return; }
    // clicking an area marked data-advance (timeline, statements) reveals the next item
    if (e.target.closest('[data-advance]')) { var nc = nextStep(page); if (nc) doStep(nc); return; }
    var gt = e.target.closest('.game-tab');
    if (gt) selectGame(+gt.dataset.g);
  });

  /* ---------- dialog boxes ---------- */
  function typeDialog(el, instant) {
    var t = el.dataset.text, out = $('.dlg-text', el);
    el.classList.add('shown');
    if (instant || rm()) { out.textContent = t; el.classList.add('typed'); return; }
    typeInto(out, t, 24).then(function () { el.classList.add('typed'); });
  }

  /* counters (data-count) */
  function countUp(p, instant) {
    $$('[data-count]', p).forEach(function (el) {
      var to = +el.dataset.count, sep = !!el.dataset.sep;
      var fmt = function (v) { v = Math.round(v); return sep ? v.toLocaleString('en-GB') : String(v); };
      if (instant || rm()) { el.textContent = fmt(to); return; }
      el.textContent = fmt(0);
      animate(1100, function (t) { el.textContent = fmt(to * (1 - Math.pow(1 - t, 3))); });
    });
  }

  /* ================================================================== WIDGETS */
  var PAGES = {};
  var fmt1 = function (v) { return v.toFixed(1); };
  var TICK = '<svg class="ic-mark"><use href="#i-tick"/></svg>', CROSS = '<svg class="ic-mark"><use href="#i-cross"/></svg>';

  /* ---------- part 1: the audit sheet ---------- */
  var sheet = $('#sheet');
  function setCell(c, s) {
    c.dataset.s = s || '';
    c.innerHTML = s === 'y' ? TICK : s === 'n' ? CROSS : s === 'q' ? '<b class="q-mark">?</b>' : '';
  }
  function sheetRows() { return $$('tbody tr', sheet); }
  PAGES['p-part1'] = {
    init: function () {
      sheetRows().forEach(function (r) { r.classList.remove('cur'); $$('.cell', r).forEach(function (c) { setCell(c, ''); }); });
    },
    enter: function (p, instant) {
      var fill = function (r) { var v = r.dataset.v.split(' '); $$('.cell', r).forEach(function (c, k) { setCell(c, v[k]); }); };
      if (instant) { sheetRows().forEach(fill); return; }
      var t = 900;
      sheetRows().forEach(function (r) {
        var v = r.dataset.v.split(' ');
        later(function () { sheetRows().forEach(function (o) { o.classList.toggle('cur', o === r); }); }, t);
        $$('.cell', r).forEach(function (c, k) { later(function () { setCell(c, v[k]); }, t + 260 + k * 200); });
        t += 960;
      });
      later(function () { sheetRows().forEach(function (o) { o.classList.remove('cur'); }); }, t);
    }
  };
  sheet.addEventListener('click', function (e) {
    var c = e.target.closest('.cell'); if (!c) return;
    clearPageTimers();
    sheetRows().forEach(function (o) { o.classList.remove('cur'); });
    var order = ['', 'y', 'n', 'q'];
    setCell(c, order[(order.indexOf(c.dataset.s || '') + 1) % order.length]);
  });

  /* ---------- 02 the nominees: bar chart ---------- */
  var barsBuilt = false;
  function growBars(p, instant) {
    var bars = $('#bars');
    if (!barsBuilt) {
      barsBuilt = true;
      var html = '';
      [25, 50, 75, 100].forEach(function (g) { html += '<div class="grid" style="bottom:' + g + '%"><span>' + g + '</span></div>'; });
      WG.awards.forEach(function (a) {
        html += '<div class="bar-g"><div class="bar bar-impl" data-v="' + a.impl + '"><b>' + fmt1(a.impl) + '</b></div><div class="bar bar-doc" data-v="' + a.doc + '"><b>' + fmt1(a.doc) + '</b></div></div>';
      });
      bars.innerHTML = html;
      var names = document.createElement('div');
      names.className = 'bar-names';
      names.innerHTML = WG.awards.map(function (a) { return '<p>' + a.name + (a.tag ? '<em>' + a.tag + '</em>' : '') + '</p>'; }).join('');
      bars.parentNode.insertBefore(names, bars.nextSibling);
    }
    var bs = $$('.bar', bars);
    bs.forEach(function (b) { b.style.transition = 'none'; b.style.height = '0'; });
    void bars.offsetWidth;
    bs.forEach(function (b, k) {
      b.style.transition = instant ? 'none' : '';
      b.style.transitionDelay = instant ? '' : (300 + k * 70) + 'ms';
      b.style.height = b.dataset.v + '%';
    });
  }
  PAGES['p-awards-1'] = { enter: growBars };

  /* ---------- heatmaps ---------- */
  var HEAT = ['#f4f1f7', '#e3dbea', '#cbbfd7', '#ae9fbf', '#8e80a2', '#6f6280', '#4e4560'];
  function heatBin(v) { return v >= 90 ? 6 : v >= 75 ? 5 : v >= 60 ? 4 : v >= 45 ? 3 : v >= 30 ? 2 : v >= 15 ? 1 : 0; }
  function buildHeat(el, rows) {
    var html = '<span></span>' + WG.heatCols.map(function (c) { return '<span class="h-col">' + c + '</span>'; }).join('');
    rows.forEach(function (r) { html += '<span class="h-row">' + r + '</span><span class="h-c"></span><span class="h-c"></span><span class="h-c"></span>'; });
    el.innerHTML = html;
    var key = el.parentNode.querySelector('.heat-key');
    if (key && !key.children.length) {
      key.innerHTML = '<span>0</span>' + HEAT.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '<span>100%</span>' +
        (el.classList.contains('heat-cov') ? '' : '<i class="h-na hk-na"></i><span>no applicable guidelines</span>');
    }
  }
  function paintHeat(el, data, instant, label) {
    var cells = $$('.h-c', el);
    var parts = [];
    cells.forEach(function (c, i) {
      var v = data[Math.floor(i / 3)][i % 3];
      var paint = function () {
        if (v === null) { c.className = 'h-c h-na'; c.style.backgroundColor = ''; c.textContent = '–'; return; }
        var b = heatBin(v);
        c.className = 'h-c' + (b >= 4 ? ' dark' : '');
        c.style.backgroundColor = HEAT[b];
        c.textContent = v;
      };
      parts.push(WG.heatCols[i % 3] + ' ' + (v === null ? 'not applicable' : v + '%'));
      if (instant) { paint(); return; }
      c.className = 'h-c'; c.style.backgroundColor = '#fbfafc'; c.textContent = '';
      later(paint, 60 + (i % 3) * 90 + Math.floor(i / 3) * 70);
    });
    if (label) {
      var rows = el.querySelectorAll('.h-row'), txt = [];
      for (var r = 0; r < rows.length; r++) txt.push(rows[r].textContent + ': ' + parts.slice(r * 3, r * 3 + 3).join(', '));
      el.setAttribute('aria-label', label + '. ' + txt.join('; ') + '.');
    }
  }

  /* ---------- 02 game by game ---------- */
  var gamesBuilt = false;
  function buildGames() {
    $('#game-list').innerHTML = WG.awards.map(function (a, i) {
      return '<button class="game-tab" type="button" role="tab" data-g="' + i + '"' + (i > 0 ? ' data-step="' + i + '"' : '') + '>' +
        '<span class="gt-name">' + a.name + (a.tag ? '<span class="gt-tag">' + a.tag + '</span>' : '') + '</span>' +
        '<span class="gt-stats">Implemented ' + fmt1(a.impl) + '%, documented ' + fmt1(a.doc) + '%</span></button>';
    }).join('');
    buildHeat($('#gv-heat'), WG.heatRows);
    gamesBuilt = true;
  }
  function selectGame(i, instant) {
    if (!gamesBuilt) buildGames();
    var a = WG.awards[i];
    $$('.game-tab').forEach(function (t, k) { t.classList.toggle('on', k === i); t.setAttribute('aria-selected', k === i); });
    $('#gv-title').textContent = a.name;
    $('#gv-note').textContent = a.note;
    clearPageTimers();
    paintHeat($('#gv-heat'), a.heat, instant || rm(), 'Share of applicable guidelines implemented in ' + a.name);
  }
  PAGES['p-awards-2'] = {
    init: function () { selectGame(0, true); },
    enter: function (p, back) { if (!back) selectGame(0); }
  };

  /* ---------- 02 what the five games share: scatter ---------- */
  var scatter = $('#scatter');
  var SC = { x0: 70, x1: 88, y0: 20, y1: 55 };
  var SC_LABEL = { ac: 'left', atom: 'right', doom: 'right', fc: 'right', som: 'below' };
  (function buildScatter() {
    var anns = $$('.sc-ann', scatter), axes = $$('.sc-ax', scatter);
    var plot = document.createElement('div');
    plot.className = 'sc-plot';
    var html = '';
    [70, 75, 80, 85].forEach(function (v) { html += '<span class="sc-gx" style="left:' + ((v - SC.x0) / (SC.x1 - SC.x0) * 100) + '%">' + v + '</span>'; });
    [20, 30, 40, 50].forEach(function (v) { html += '<span class="sc-gy" style="top:' + (100 - (v - SC.y0) / (SC.y1 - SC.y0) * 100) + '%">' + v + '</span>'; });
    WG.awards.forEach(function (a) {
      var x = (a.impl - SC.x0) / (SC.x1 - SC.x0) * 100, y = 100 - (a.doc - SC.y0) / (SC.y1 - SC.y0) * 100;
      var hi = (a.id === 'fc' || a.id === 'som') ? ' hi' : '';
      html += '<span class="sc-pt' + hi + '" data-g="' + a.id + '" style="left:' + x + '%;top:' + y + '%" title="' + a.name + ': ' + fmt1(a.impl) + '% implemented, ' + fmt1(a.doc) + '% documented"></span>';
      var side = SC_LABEL[a.id], pos = side === 'left' ? 'right:' + (100 - x) + '%;margin-right:16px;top:' + y + '%;transform:translateY(-50%);text-align:right' :
        side === 'below' ? 'left:' + x + '%;top:' + y + '%;transform:translate(-50%, 16px);text-align:center' :
        'left:' + x + '%;margin-left:16px;top:' + y + '%;transform:translateY(-50%)';
      html += '<span class="sc-lb' + hi + '" style="' + pos + '">' + a.short + '<small>' + fmt1(a.impl) + ' / ' + fmt1(a.doc) + '</small></span>';
    });
    plot.innerHTML = html;
    scatter.innerHTML = '';
    scatter.appendChild(plot);
    axes.forEach(function (a) { scatter.appendChild(a); });
    // the dashed link between the two extremes, and their annotations
    var pt = function (id) { var a = WG.awards.filter(function (g) { return g.id === id; })[0]; return a; };
    var fc = pt('fc'), som = pt('som');
    var link = document.createElement('span'); link.className = 'sc-link'; link.dataset.a = fc.id; link.dataset.b = som.id;
    plot.appendChild(link);
    anns.forEach(function (n) {
      var a = pt(n.dataset.g), x = (a.impl - SC.x0) / (SC.x1 - SC.x0) * 100, y = 100 - (a.doc - SC.y0) / (SC.y1 - SC.y0) * 100;
      n.style.top = y + '%';
      if (a.id === 'fc') { n.style.left = x + '%'; n.style.transform = 'translate(-20px, -54px)'; }
      else { n.style.right = (100 - x) + '%'; n.style.transform = 'translate(20px, -54px)'; }
      plot.appendChild(n);
    });
  })();
  function placeLink() {
    var link = $('.sc-link', scatter), plot = $('.sc-plot', scatter);
    var a = $('.sc-pt[data-g="fc"]', plot), b = $('.sc-pt[data-g="som"]', plot);
    var ax = a.offsetLeft, ay = a.offsetTop, bx = b.offsetLeft, by = b.offsetTop;
    var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    link.style.left = ax + 'px'; link.style.top = ay + 'px'; link.style.width = len + 'px';
    link.style.transform = 'rotate(' + Math.atan2(by - ay, bx - ax) + 'rad)';
  }
  STEP.scatter = function () { placeLink(); scatter.classList.add('cmp'); };
  PAGES['p-awards-3'] = {
    init: function () { scatter.classList.remove('cmp'); },
    enter: function (p, instant) {
      if (instant) return;
      $$('.sc-pt', scatter).forEach(function (d, k) {
        d.animate([{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, delay: 500 + k * 120, easing: 'steps(3)', fill: 'backwards' });
      });
    }
  };

  /* ---------- 03 pointcheck: the focus check, step by step ---------- */
  var pc = $('#pc-demo');
  function pcPoint(target) {
    var pt = $('#pc-point'), page = $('.pc-page', pc);
    if (!target) { pt.classList.remove('on'); return; }
    var x = target.offsetLeft + target.offsetWidth / 2, y = target.offsetTop + target.offsetHeight / 2;
    pt.style.left = x + 'px'; pt.style.top = y + 'px';
    $('#pc-xy').textContent = 'x ' + (x / page.offsetWidth * 100).toFixed(1) + ', y ' + (y / page.offsetHeight * 100).toFixed(1);
    pt.classList.add('on');
  }
  function pcLog(s, instant) {
    $$('#pc-log li[data-s="' + s + '"]').forEach(function (li, k) {
      if (instant) { li.classList.add('on'); return; }
      later(function () { li.classList.add('on'); }, 150 + k * 550);
    });
  }
  STEP.pc = function (el, instant) {
    var n = +el.dataset.step, email = $('.pc-in[data-focus="1"]', pc), btn = $('.pc-btn', pc);
    if (n === 1) { email.classList.add('focus'); pcPoint(email); }
    if (n === 2) { email.classList.remove('focus'); pcPoint(btn); }
    if (n === 3) { pcPoint(null); $('.pc-go', pc).classList.add('gone'); }
    pcLog(n, instant);
  };
  PAGES['p-pointcheck'] = {
    init: function () {
      $$('.pc-in', pc).forEach(function (i) { i.classList.remove('focus'); });
      pcPoint(null);
      $$('#pc-log li').forEach(function (li) { li.classList.remove('on'); });
      $('.pc-go', pc).classList.remove('gone');
    }
  };

  /* ---------- 04 builds: observations pinned to the screen ---------- */
  STEP.obs = function (el, instant) {
    var n = el.dataset.step, pin = $('.gs-pin[data-pin="' + n + '"]');
    if (pin) pin.classList.add('on');
    if (!instant) {
      el.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 320, easing: 'steps(4)' });
      if (pin) pin.animate([{ transform: 'scale(2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 280, easing: 'steps(4)' });
    }
  };
  PAGES['p-builds'] = { init: function (p) { $$('.gs-pin', p).forEach(function (pin) { pin.classList.remove('on'); }); } };

  /* ---------- 05 a model for games: quest log ---------- */
  PAGES['p-model'] = {
    init: function () { $$('#quest li').forEach(function (li) { li.classList.remove('ticked'); }); },
    enter: function (p, instant) {
      var lis = $$('#quest li');
      lis.forEach(function (li, k) {
        if (!instant) li.animate([{ opacity: 0, translate: '-8px 0' }, { opacity: 1, translate: '0 0' }], { duration: 260, delay: 600 + k * 140, easing: 'steps(3)', fill: 'backwards' });
      });
      $$('#quest li.done').forEach(function (li, k) {
        if (instant) li.classList.add('ticked'); else later(function () { li.classList.add('ticked'); }, 1700 + k * 380);
      });
    }
  };

  /* ---------- part 2: guidelines x reviews, scanned column by column ---------- */
  var matrix = $('#matrix'), MX = 26, MY = 14, mstate = [];
  (function buildMatrix() {
    var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var html = '';
    for (var y = 0; y < MY; y++) for (var x = 0; x < MX; x++) {
      // rows near the top play the part of the much-mentioned basic guidelines
      var p = 0.42 - y * 0.026, r = rnd();
      mstate.push(r < p * 0.72 ? 'y' : r < p ? 'n' : '');
      html += '<i></i>';
    }
    matrix.innerHTML = html;
  })();
  function scanMatrix(instant) {
    var cells = $$('i', matrix);
    clearPageTimers();
    cells.forEach(function (c, i) { c.className = instant ? mstate[i] : ''; });
    if (instant) return;
    for (var x = 0; x < MX; x++) (function (x) {
      later(function () { for (var y = 0; y < MY; y++) cells[y * MX + x].className = 'scan'; }, 700 + x * 70);
      later(function () { for (var y = 0; y < MY; y++) cells[y * MX + x].className = mstate[y * MX + x]; }, 770 + x * 70);
    })(x);
  }
  PAGES['p-part2'] = { enter: function (p, instant) { scanMatrix(instant); } };
  $('.map-panel').addEventListener('click', function () { scanMatrix(rm()); });

  /* ---------- 06 more material to map: timeline, one event per step ---------- */
  STEP.tl = function (el, instant) {
    if (!instant) el.animate([{ opacity: 0, translate: '-10px 0' }, { opacity: 1, translate: '0 0' }], { duration: 300, easing: 'steps(4)' });
  };

  /* ---------- 07 448 reviews: one square per review ---------- */
  var waffle = $('#waffle');
  (function () { var h = ''; for (var i = 0; i < 448; i++) h += '<i></i>'; waffle.innerHTML = h; })();
  PAGES['p-cipt'] = {
    init: function () { $$('i', waffle).forEach(function (c) { c.classList.remove('on'); }); $('#waffle-n').textContent = '0'; },
    enter: function (p, instant) {
      var cells = $$('i', waffle), n = $('#waffle-n');
      if (instant) { cells.forEach(function (c) { c.classList.add('on'); }); n.textContent = '448'; return; }
      var order = cells.map(function (c, i) { return i; });
      for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
      var done = 0;
      animate(1600, function (t) {
        var k = Math.round(t * 448);
        for (; done < k; done++) cells[order[done]].classList.add('on');
        n.textContent = k;
      });
    }
  };

  /* ---------- 08 weighted score ---------- */
  var scYes = $('#sc-yes'), scNo = $('#sc-no');
  function score() {
    var y = +scYes.value, n = +scNo.value, T = y + n;
    $('#sc-yes-v').textContent = y; $('#sc-no-v').textContent = n;
    var rate = T ? y / T : 0, w = T / (T + 10), s = rate * w;
    $('#f-t').textContent = T;
    $('#f-rate').textContent = T ? rate.toFixed(2) : '–';
    $('#f-w').textContent = w.toFixed(2);
    $('#f-score').textContent = T ? s.toFixed(2) : 'no data';
    $('#sc-fill').style.width = (s * 100) + '%';
  }
  function setScore(y, n) { scYes.value = y; scNo.value = n; score(); }
  [scYes, scNo].forEach(function (inp) {
    inp.addEventListener('input', function () { $$('.sc-pre').forEach(function (b) { b.classList.remove('on'); }); score(); });
  });
  STEP.preset = function (el, instant, again) {
    $$('.sc-pre').forEach(function (b) { b.classList.toggle('on', b === el); });
    var y1 = +el.dataset.yes, n1 = +el.dataset.no;
    if (instant) { setScore(y1, n1); return; }
    var y0 = +scYes.value, n0 = +scNo.value;
    animate(500, function (t) { setScore(Math.round(y0 + (y1 - y0) * t), Math.round(n0 + (n1 - n0) * t)); });
  };
  PAGES['p-check-1'] = { init: function () { $$('.sc-pre').forEach(function (b) { b.classList.remove('on'); }); setScore(10, 0); } };

  /* ---------- 08 what the reviews mention ---------- */
  var cov = $('#cov-heat');
  buildHeat(cov, WG.coverage.rows);
  var COV_LABEL = { mentioned: 'Share of possible tags in which guidelines are mentioned', working: 'Share of mentions that describe the feature as working' };
  function covShow(m, instant) {
    $$('#p-check-2 .seg-tab').forEach(function (b) { var on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    paintHeat(cov, WG.coverage[m], instant, COV_LABEL[m]);
  }
  STEP.cov = function (el, instant) { covShow('working', instant); };
  $$('#p-check-2 .seg-tab').forEach(function (b) {
    if (!b.dataset.step) b.addEventListener('click', function () { covShow(b.dataset.m, rm()); });
  });
  PAGES['p-check-2'] = {
    init: function () { covShow('mentioned', true); $$('#hbars i').forEach(function (i) { i.style.transition = 'none'; i.style.width = '0'; }); void cov.offsetWidth; },
    enter: function (p, instant) {
      if (!instant) covShow('mentioned', false);
      $$('#hbars li').forEach(function (li, k) {
        var i = $('i', li);
        i.style.transition = instant ? 'none' : '';
        i.style.transitionDelay = instant ? '' : (400 + k * 120) + 'ms';
        i.style.width = (+li.dataset.v / 472 * 100) + '%';
      });
    }
  };

  /* ---------- 09 scaling the mapping: a simulated first pass ---------- */
  function lmMark(h, instant, delay) {
    var span = $('.hl[data-h="' + h + '"]'), row = $('#lm-tags li[data-h="' + h + '"]');
    var go = function () {
      span.classList.add('on');
      if (row.classList.contains('lm-unsure')) span.classList.add('unsure');
      row.classList.add('on');
    };
    if (instant) go(); else later(go, delay);
  }
  STEP.llm = function (el, instant) { [1, 2, 3, 4].forEach(function (h, k) { lmMark(h, instant, 200 + k * 700); }); };
  STEP['llm-review'] = function (el, instant) {
    var go = function () {
      $('#lm-tags li[data-h="3"]').classList.add('resolved');
      $('.hl[data-h="3"]').classList.add('done');
      $('#lm-review').classList.add('on');
    };
    // the review only makes sense after the first pass
    var run = $('#p-llm [data-fn="llm"]');
    if (!run.classList.contains('is-done')) { run.classList.add('is-done'); STEP.llm(run, true); }
    if (instant) go(); else later(go, 200);
  };
  PAGES['p-llm'] = {
    init: function () {
      $$('#lm-text .hl').forEach(function (s) { s.classList.remove('on', 'unsure', 'done'); });
      $$('#lm-tags li').forEach(function (li) { li.classList.remove('on', 'resolved'); });
      $('#lm-review').classList.remove('on');
    }
  };

  /* ---------- 10 one record: fields typed in ---------- */
  var recToken = 0;
  function recShow(r, instant) {
    var tok = ++recToken;
    $$('#p-record .seg-tab').forEach(function (b) { var on = b.dataset.r === r; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $$('#p-record .rec').forEach(function (dl) { dl.hidden = dl.dataset.r !== r; });
    var dl = $('#p-record .rec[data-r="' + r + '"]');
    var dds = $$('dd', dl);
    dds.forEach(function (dd) {
      if (dd.dataset.full == null && !dd.classList.contains('rec-st')) dd.dataset.full = dd.textContent;
      dd.classList.remove('typing');
      if (dd.classList.contains('rec-st')) $$('.st', dd).forEach(function (s) { s.style.visibility = instant ? '' : 'hidden'; });
      else dd.textContent = instant ? dd.dataset.full : '';
    });
    if (instant) return;
    var i = 0;
    (function nextField() {
      if (tok !== recToken || i >= dds.length) return;
      var dd = dds[i++];
      if (dd.classList.contains('rec-st')) {
        var chips = $$('.st', dd), k = 0;
        (function chip() { if (tok !== recToken) return; if (k < chips.length) { chips[k++].style.visibility = ''; setTimeout(chip, 140); } else nextField(); })();
        return;
      }
      var text = dd.dataset.full, c = 0;
      dd.classList.add('typing');
      (function type() {
        if (tok !== recToken) return;
        c = Math.min(text.length, c + 2);
        dd.textContent = text.slice(0, c);
        if (c < text.length) setTimeout(type, 14); else { dd.classList.remove('typing'); setTimeout(nextField, 60); }
      })();
    })();
  }
  STEP.rec = function (el, instant) { recShow('b', instant); };
  $$('#p-record .seg-tab').forEach(function (b) {
    if (!b.dataset.step) b.addEventListener('click', function () { recShow('a', rm()); });
  });
  PAGES['p-record'] = {
    init: function () { recShow('a', true); },
    enter: function (p, back) { if (!back) recShow('a', false); },
    leave: function () { recToken++; }
  };

  /* ---------- 12 what a report can claim ---------- */
  STEP.claim = function (el, instant) {
    $('#claims-hint').classList.add('gone');
    if (!instant) el.animate([{ opacity: 0, translate: '0 -24px', scale: '.96' }, { opacity: 1, translate: '0 0', scale: '1' }], { duration: 340, easing: 'steps(4)' });
  };
  PAGES['p-claims'] = { init: function () { $('#claims-hint').classList.remove('gone'); } };

  /* ================================================================== HUD */
  var ms = $('#minishelf'), tip = document.createElement('p');
  tip.className = 'ms-tip'; tip.setAttribute('aria-hidden', 'true');
  function buildMinishelf() {
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ms' + (it.kind === 'label' ? ' lab' : '');
      b.dataset.id = it.id;
      var L = LAYOUT[it.id];
      if (L && !L.tag) b.style.setProperty('--h', Math.round(L.lying ? 24 : L.h / 470 * 32) + 'px');
      b.setAttribute('aria-label', (it.num ? it.num + '. ' : '') + it.title);
      ms.appendChild(b);
    });
    $('#scr-deck').appendChild(tip);
    ms.addEventListener('click', function (e) {
      var b = e.target.closest('.ms'); if (!b) return;
      var idx = seqIndex(b.dataset.id, 0);
      if (idx === 0) toTitle(); else go(idx, idx > pos ? 1 : -1);
    });
    ms.addEventListener('pointerover', function (e) {
      var b = e.target.closest('.ms'); if (!b) return;
      tip.textContent = byId[b.dataset.id].title;
      tip.classList.add('on');
      tip.style.left = Math.max(20, sRect(b).x - 10) + 'px';
    });
    ms.addEventListener('pointerout', function () { tip.classList.remove('on'); });
  }
  function updateHud() {
    var s = seq[pos];
    $$('.ms', ms).forEach(function (b) {
      b.classList.toggle('cur', b.dataset.id === s.item.id);
      b.classList.toggle('seen', !!visited[b.dataset.id]);
    });
    var nb = $('#btn-next'), lbl = $('#next-lbl');
    if (pos >= seq.length - 1) { nb.disabled = true; lbl.textContent = 'Next'; }
    else {
      nb.disabled = false;
      var n = seq[pos + 1];
      lbl.textContent = n.item === s.item ? 'Next' : 'Next: ' + n.item.title;
    }
  }
  $('#btn-next').addEventListener('click', next);
  $('#btn-prev').addEventListener('click', prev);

  /* ================================================================== SETTINGS, FULLSCREEN, BLACKOUT */
  var settings = $('#settings');
  function openSettings() { settings.hidden = false; $('#opt-motion').focus(); }
  function closeSettings() { settings.hidden = true; }
  $('#opt-motion').addEventListener('change', function (e) { prefs.reduceMotion = e.target.checked; savePrefs(); applyPrefs(); });
  function toggleFullscreen() {
    var d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      var el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
    } else (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
  }
  var blackout = $('#blackout');
  blackout.addEventListener('click', function () { blackout.hidden = true; });

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (!a) return;
    var act = a.dataset.act;
    if (act === 'library') toLibrary();
    if (act === 'settings') openSettings();
    if (act === 'settings-close') closeSettings();
  });
  $('#btn-start').addEventListener('click', startGame);

  /* ================================================================== KEYBOARD */
  var order = items.map(function (it) { return it.id; });
  function moveSel(d) {
    var i = selId ? order.indexOf(selId) : (d > 0 ? -1 : order.length);
    i = clamp(i + d, 0, order.length - 1);
    if (popupOpen()) closePopup(true);
    select(order[i]);
    revealCase(order[i]);
    caseEls[order[i]].focus({ preventScroll: true });
  }

  // navigation keys pressed during a transition are retried shortly, rather than lost
  var NAV_KEYS = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', ' ', 'Enter', 'Escape', 'm', 'M', 'Home', 'End', 'Backspace'];
  document.addEventListener('keydown', function (e) { onKey(e.key, e, 0); });
  function onKey(k, e, tries) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var act = document.activeElement;
    if (busy && NAV_KEYS.indexOf(k) >= 0) {
      e.preventDefault();
      if (tries < 24) setTimeout(function () { onKey(k, { preventDefault: function () {} }, tries + 1); }, 150);
      return;
    }
    if (!blackout.hidden) { blackout.hidden = true; e.preventDefault(); return; }
    if (!lb.hidden) { if (k === 'Escape' || k === 'Enter' || k === ' ') { closeLightbox(); e.preventDefault(); } return; }
    if (!settings.hidden) { if (k === 'Escape' || k === 's' || k === 'S') { closeSettings(); e.preventDefault(); } return; }
    // sliders keep their own arrow keys
    if (act && act.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) return;
    if (k === 'f' || k === 'F') { toggleFullscreen(); return; }
    if (k === 'b' || k === 'B') { blackout.hidden = false; return; }
    if (k === 's' || k === 'S') { openSettings(); e.preventDefault(); return; }

    if (screen === 'title') {
      if (k === 'Enter' || k === ' ' || k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); startGame(); }
      return;
    }

    if (screen === 'library') {
      var onButton = act && act.closest && act.closest('#popup button');
      if (k === 'Escape') { if (popupOpen()) closePopup(); else select(null); e.preventDefault(); return; }
      if (k === 'ArrowDown') { e.preventDefault(); moveSel(1); return; }
      if (k === 'ArrowUp') { e.preventDefault(); moveSel(-1); return; }
      if (k === 'Enter') {
        if (onButton) return; // let the focused button handle it
        e.preventDefault();
        if (popupOpen() && popId) openItem(popId, 0);
        else if (selId) openPopup(selId);
        else continueFromLibrary();
        return;
      }
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') {
        e.preventDefault();
        if (popupOpen() && popId) openItem(popId, 0);
        else if (selId && selId !== 'title') openItem(selId, 0);
        else continueFromLibrary();
        return;
      }
      if (k === 'ArrowLeft' || k === 'PageUp') {
        e.preventDefault();
        if (pos > 0) enterDeck(pos, caseEls[seq[pos].item.id]);
        return;
      }
      if (k === 'Home') toTitle();
      return;
    }

    if (screen === 'deck') {
      // a focused button inside the page would also fire on Space or Enter: the deck handles those keys itself
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); if (act && act.blur && act !== document.body) act.blur(); next(); return; }
      if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); prev(); return; }
      if (k === 'Escape') {
        var open = $$('.page.is-current .win-float').filter(function (w) { return !w.hidden; });
        if (open.length) { open.forEach(function (w) { w.hidden = true; }); return; }
        toLibrary(); return;
      }
      if (k === 'm' || k === 'M') { toLibrary(); return; }
      if (k === 'Home') { toTitle(); return; }
      if (k === 'End') go(seq.length - 1, 1);
    }
  }

  /* ================================================================== BOOT */
  window.addEventListener('resize', fit);
  fit();
  applyPrefs();
  buildShelf();
  buildMinishelf();
  buildGames();
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, wait(1500)]).then(intro);

})();
