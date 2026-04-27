/**
 * 編集キャンバス表示の拡大・縮小（見た目のみ。ブロック座標は変わりません）
 */
(function () {
  "use strict";

  var STORAGE_KEY = "nocode_editor_canvas_zoom_pct";
  var MIN = 25;
  var MAX = 200;
  var STEP = 5;

  var currentPct = 100;
  var useCssZoom = null;

  function isPublished() {
    return document.body.classList.contains("nocode-published-mode");
  }

  function readStored() {
    try {
      var v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      if (!isNaN(v) && v >= MIN && v <= MAX) return v;
    } catch (e) {}
    return 100;
  }

  function writeStored(pct) {
    try {
      localStorage.setItem(STORAGE_KEY, String(pct));
    } catch (e) {}
  }

  function detectZoomSupport() {
    if (useCssZoom !== null) return useCssZoom;
    var test = document.createElement("div");
    test.style.cssText = "position:absolute;left:-9999px;top:0;zoom:0.5";
    document.body.appendChild(test);
    try {
      useCssZoom = test.style.zoom === "0.5";
    } catch (e) {
      useCssZoom = false;
    }
    document.body.removeChild(test);
    return useCssZoom;
  }

  function getEls() {
    return {
      scale: document.getElementById("canvas-zoom-scale"),
      viewport: document.getElementById("canvas-zoom-viewport"),
      canvas: document.getElementById("canvas"),
      range: document.getElementById("canvas-zoom-range"),
      pct: document.getElementById("canvas-zoom-pct"),
    };
  }

  function applyZoomTransform(scaleEl, pct) {
    var s = pct / 100;
    var inner = scaleEl.querySelector(".canvas-scroll");
    scaleEl.style.zoom = "";
    scaleEl.style.transform = "scale(" + s + ")";
    scaleEl.style.transformOrigin = "top center";
    if (inner) {
      var iw = inner.offsetWidth;
      var ih = Math.max(inner.offsetHeight, inner.scrollHeight);
      scaleEl.style.width = iw * s + "px";
      scaleEl.style.minHeight = ih * s + "px";
    } else {
      scaleEl.style.width = "";
      scaleEl.style.minHeight = "";
    }
  }

  function applyZoom(pct) {
    var els = getEls();
    if (!els.scale || isPublished()) return;
    pct = Math.round(Math.max(MIN, Math.min(MAX, pct)));
    currentPct = pct;

    if (detectZoomSupport()) {
      try {
        els.scale.style.transform = "";
        els.scale.style.width = "";
        els.scale.style.minHeight = "";
        els.scale.style.transformOrigin = "top center";
        els.scale.style.zoom = pct / 100;
      } catch (e) {
        applyZoomTransform(els.scale, pct);
      }
    } else {
      applyZoomTransform(els.scale, pct);
    }

    if (els.range) els.range.value = String(pct);
    if (els.pct) els.pct.textContent = pct + "%";
    writeStored(pct);

    try {
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent("nocode-canvas-zoom-changed", { detail: { pct: pct } }));
      }
    } catch (e) {}
  }

  function zoomFit() {
    var els = getEls();
    if (!els.viewport || !els.canvas || isPublished()) return;
    var pad = 32;
    var zw = els.viewport.clientWidth - pad;
    var zh = els.viewport.clientHeight - pad;
    var cw = els.canvas.offsetWidth;
    var ch = Math.max(els.canvas.offsetHeight, els.canvas.scrollHeight);
    if (!cw || !ch || !zw || !zh) return;
    var s = Math.min(zw / cw, zh / ch) * 100;
    s = Math.max(MIN, Math.min(MAX, Math.floor(s / STEP) * STEP));
    applyZoom(s);
  }

  function wire() {
    if (isPublished()) return;

    var els = getEls();
    if (!els.scale || !els.range) return;

    applyZoom(readStored());

    if (useCssZoom === false && typeof ResizeObserver !== "undefined") {
      var innerScroll = els.scale.querySelector(".canvas-scroll");
      if (innerScroll) {
        var ro = new ResizeObserver(function () {
          applyZoomTransform(els.scale, currentPct);
        });
        ro.observe(innerScroll);
        ro.observe(els.canvas);
      }
    }

    els.range.min = String(MIN);
    els.range.max = String(MAX);
    els.range.step = String(STEP);

    els.range.addEventListener("input", function () {
      applyZoom(parseInt(els.range.value, 10) || 100);
    });

    var out = document.getElementById("canvas-zoom-out");
    var inn = document.getElementById("canvas-zoom-in");
    var reset = document.getElementById("canvas-zoom-reset");
    var fit = document.getElementById("canvas-zoom-fit");

    if (out) {
      out.addEventListener("click", function () {
        applyZoom(currentPct - STEP);
      });
    }
    if (inn) {
      inn.addEventListener("click", function () {
        applyZoom(currentPct + STEP);
      });
    }
    if (reset) {
      reset.addEventListener("click", function () {
        applyZoom(100);
      });
    }
    if (fit) {
      fit.addEventListener("click", function () {
        requestAnimationFrame(function () {
          zoomFit();
        });
      });
    }
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wire);
    } else {
      wire();
    }
  }

  init();
})();
