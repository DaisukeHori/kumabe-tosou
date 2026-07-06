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
