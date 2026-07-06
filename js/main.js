/* =============================================================
   隈部塗装 — KUMABE TOSO / main.js
   1) Before/After しずくスライダー
   2) スクロールリビール
   3) ヘッダーのスクロール状態
   4) モバイルナビ
   ============================================================= */
(function () {
  "use strict";

  /* ---------- 1) Before/After スライダー ---------- */
  var piece = document.getElementById("piece");
  var range = document.getElementById("pieceRange");

  if (piece && range) {
    var updateSplit = function () {
      piece.style.setProperty("--split", range.value + "%");
    };
    range.addEventListener("input", updateSplit);
    updateSplit();
  }

  /* ---------- 2) スクロールリビール ---------- */
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var revealTargets = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (prefersReduced || !("IntersectionObserver" in window)) {
    revealTargets.forEach(function (el) { el.classList.add("is-visible"); });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
    );
    revealTargets.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- 3) ヘッダーのスクロール状態 ---------- */
  var header = document.getElementById("siteHeader");
  var onScroll = function () {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- 4) モバイルナビ ---------- */
  var toggle = document.getElementById("navToggle");
  var nav = document.getElementById("globalNav");

  if (toggle && nav) {
    var closeNav = function () {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "メニューを開く");
    };
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "メニューを閉じる" : "メニューを開く");
    });
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
  }
})();
