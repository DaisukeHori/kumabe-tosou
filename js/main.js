/* =============================================================
   隈部塗装 — KUMABE TOSO / main.js (v2)
   1) 現在ページのナビ強調
   2) スクロールリビール
   3) モバイルナビ
   ============================================================= */
(function () {
  "use strict";

  /* ---------- 1) 現在ページのナビ強調 ---------- */
  var page = document.body.getAttribute("data-page");
  if (page) {
    document.querySelectorAll('.global-nav a[data-nav]').forEach(function (a) {
      if (a.getAttribute("data-nav") === page) a.classList.add("is-current");
    });
  }

  /* ---------- 2) スクロールリビール ---------- */
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var targets = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (prefersReduced || !("IntersectionObserver" in window)) {
    targets.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.06 }
    );
    targets.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 3) モバイルナビ ---------- */
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("globalNav");

  if (toggle && nav) {
    var closeNav = function () {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "メニューを開く");
    };
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    });
    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", closeNav);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
  }
})();

/* =============================================================
   v2.1 — DETAILS（細部の作り込み）
   4) 塗りプログレスバー
   5) カスタムカーソル（マウス環境のみ）
   6) ドローダウンのチルト＋光沢追従
   7) カラーストリップのホイール横変換
   ============================================================= */
(function () {
  "use strict";

  var fine = window.matchMedia("(pointer: fine)").matches;
  var noMotionPref = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

  /* ---------- 4) 塗りプログレスバー ---------- */
  var header = document.querySelector(".site-header");
  if (header) {
    var bar = document.createElement("div");
    bar.className = "paint-progress";
    bar.setAttribute("aria-hidden", "true");
    header.appendChild(bar);

    var ticking = false;
    var updateBar = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = "scaleX(" + ratio + ")";
      ticking = false;
    };
    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(updateBar);
      }
    }, { passive: true });
    updateBar();
  }

  /* ---------- 5) カスタムカーソル ---------- */
  if (fine && noMotionPref) {
    var dot = document.createElement("div");
    dot.className = "cursor-dot";
    dot.setAttribute("aria-hidden", "true");
    var ring = document.createElement("div");
    ring.className = "cursor-ring";
    ring.setAttribute("aria-hidden", "true");
    var label = document.createElement("span");
    label.className = "cursor-label";
    label.textContent = "VIEW";
    ring.appendChild(label);
    document.body.appendChild(dot);
    document.body.appendChild(ring);
    document.body.classList.add("has-cursor", "cursor-hidden");

    var mx = window.innerWidth / 2, my = window.innerHeight / 2;
    var rx = mx, ry = my;
    var visible = false;

    document.addEventListener("mousemove", function (e) {
      mx = e.clientX;
      my = e.clientY;
      if (!visible) {
        visible = true;
        document.body.classList.remove("cursor-hidden");
      }
      dot.style.left = mx + "px";
      dot.style.top = my + "px";
    }, { passive: true });

    document.addEventListener("mouseleave", function () {
      visible = false;
      document.body.classList.add("cursor-hidden");
    });

    var lerp = function (a, b, t) { return a + (b - a) * t; };
    var loop = function () {
      rx = lerp(rx, mx, 0.18);
      ry = lerp(ry, my, 0.18);
      ring.style.left = rx + "px";
      ring.style.top = ry + "px";
      window.requestAnimationFrame(loop);
    };
    window.requestAnimationFrame(loop);

    /* ホバー状態の切り替え（イベント委譲） */
    document.addEventListener("mouseover", function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".drawdown")) {
        ring.classList.add("is-view");
        ring.classList.remove("is-link");
      } else if (t.closest("a, button, input, label, [role='button']")) {
        ring.classList.add("is-link");
        ring.classList.remove("is-view");
      } else {
        ring.classList.remove("is-link", "is-view");
      }
    }, { passive: true });
  }

  /* ---------- 6) ドローダウンのチルト＋光沢追従（colorsページ） ---------- */
  if (fine && noMotionPref && document.body.getAttribute("data-page") === "colors") {
    document.querySelectorAll(".color-visual .drawdown").forEach(function (card) {
      var swatch = card.querySelector(".dd-swatch");
      var rect = null;

      card.addEventListener("mouseenter", function () {
        rect = card.getBoundingClientRect();
      });
      card.addEventListener("mousemove", function (e) {
        if (!rect) rect = card.getBoundingClientRect();
        var px = (e.clientX - rect.left) / rect.width;   /* 0..1 */
        var py = (e.clientY - rect.top) / rect.height;   /* 0..1 */
        var ryDeg = (px - 0.5) * 7;    /* 左右 */
        var rxDeg = (0.5 - py) * 6;    /* 上下 */
        card.style.setProperty("--rx", rxDeg.toFixed(2) + "deg");
        card.style.setProperty("--ry", ryDeg.toFixed(2) + "deg");
        if (swatch) {
          swatch.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
          swatch.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
        }
      }, { passive: true });
      card.addEventListener("mouseleave", function () {
        rect = null;
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
        if (swatch) {
          swatch.style.setProperty("--gx", "30%");
          swatch.style.setProperty("--gy", "22%");
        }
      });
    });
  }

  /* ---------- 7) カラーストリップのホイール横変換 ---------- */
  document.querySelectorAll(".color-strip").forEach(function (strip) {
    strip.addEventListener("wheel", function (e) {
      /* 縦ホイールを横スクロールに変換（ストリップ上のみ） */
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        var atStart = strip.scrollLeft <= 0 && e.deltaY < 0;
        var atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1 && e.deltaY > 0;
        if (!atStart && !atEnd) {
          e.preventDefault();
          strip.scrollLeft += e.deltaY;
        }
      }
    }, { passive: false });
  });
})();
