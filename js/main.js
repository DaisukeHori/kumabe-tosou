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

/* =============================================================
   v2.2 — さらなる作り込み
   A) ヒーロー見出しの1文字割り出し
   C) セクションインジケータ（右端固定）
   ============================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- A) ヒーロー見出しの1文字割り出し ---------- */
  var splitTarget = document.querySelector(".hero-title[data-split]");
  if (splitTarget && !reduceMotion) {
    var counter = { i: 0 };

    /* テキストノードを1文字ずつ span.char に変換（要素はそのまま再帰） */
    var walk = function (node) {
      var children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType === Node.TEXT_NODE) {
          var text = child.textContent;
          if (!text) return;
          var frag = document.createDocumentFragment();
          for (var k = 0; k < text.length; k++) {
            var ch = text[k];
            if (ch === " " || ch === "\n" || ch === "\t") {
              frag.appendChild(document.createTextNode(ch));
              continue;
            }
            var span = document.createElement("span");
            span.className = "char";
            span.textContent = ch;
            span.style.setProperty("--ci", counter.i);
            counter.i++;
            frag.appendChild(span);
          }
          node.replaceChild(frag, child);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      });
    };

    /* .line > span の中身だけを対象に分割（.line の overflow:hidden を活かす） */
    splitTarget.querySelectorAll(".line > span").forEach(function (span) {
      walk(span);
    });

    /* 発火 */
    requestAnimationFrame(function () {
      splitTarget.classList.add("is-split");
    });
  }

  /* ---------- C) セクションインジケータ ---------- */
  var secMarks = Array.prototype.slice.call(document.querySelectorAll(".sec-mark"));
  if (secMarks.length >= 2 && "IntersectionObserver" in window) {
    /* ラベル抽出（"SEC. 01" と最後のスパン英名） */
    var items = secMarks.map(function (mark, idx) {
      var spans = mark.querySelectorAll("span:not(.rule)");
      var no = spans[0] ? spans[0].textContent.replace(/[^0-9]/g, "") : String(idx + 1);
      var name = spans[spans.length - 1] ? spans[spans.length - 1].textContent.trim() : "";
      return { mark: mark, no: no || String(idx + 1), name: name };
    });

    var nav = document.createElement("nav");
    nav.className = "sec-indicator";
    nav.setAttribute("aria-hidden", "true");
    items.forEach(function (it, idx) {
      var item = document.createElement("div");
      item.className = "sec-indicator-item";
      item.dataset.index = idx;
      var label = document.createElement("span");
      label.className = "sec-indicator-label";
      label.textContent = it.name || ("SEC " + it.no);
      var dot = document.createElement("span");
      dot.className = "sec-indicator-dot";
      item.appendChild(label);
      item.appendChild(dot);
      nav.appendChild(item);
      it.el = item;
    });
    document.body.appendChild(nav);

    var indicatorItems = nav.querySelectorAll(".sec-indicator-item");
    var currentIdx = -1;
    var setCurrent = function (idx) {
      if (idx === currentIdx) return;
      currentIdx = idx;
      indicatorItems.forEach(function (el, i) {
        el.classList.toggle("is-current", i === idx);
      });
    };

    /* スクロールで一番上に近い（通過した）見出しを現在地に */
    var visibleSet = new Set();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var idx = items.findIndex(function (it) { return it.mark === entry.target; });
        if (entry.isIntersecting) visibleSet.add(idx);
        else visibleSet.delete(idx);
      });
      if (visibleSet.size > 0) {
        var minIdx = Math.min.apply(null, Array.from(visibleSet));
        setCurrent(minIdx);
      }
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });

    items.forEach(function (it) { io.observe(it.mark); });

    /* 表示/非表示: ヒーローを出たら表示、フッター手前で維持 */
    var toggleIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        nav.classList.toggle("is-active", !entry.isIntersecting);
      });
    }, { threshold: 0 });
    var firstSec = document.querySelector(".sec, .page-head");
    var heroEl = document.querySelector(".hero");
    if (heroEl) {
      toggleIo.observe(heroEl);
    } else {
      nav.classList.add("is-active");
    }
  }
})();

/* =============================================================
   v2.4 — 数字のカウントアップ
   .stat-count[data-count] をビュー内で 0 → 目標値へ
   ============================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var counts = Array.prototype.slice.call(document.querySelectorAll(".stat-count[data-count]"));
  if (counts.length === 0) return;

  if (reduceMotion || !("IntersectionObserver" in window)) {
    counts.forEach(function (el) {
      el.textContent = el.getAttribute("data-count");
    });
    return;
  }

  var animate = function (el) {
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    var duration = 1100;
    var start = null;
    var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
    var step = function (ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / duration);
      var val = Math.round(easeOut(p) * target);
      el.textContent = String(val);
      if (p < 1) {
        window.requestAnimationFrame(step);
      } else {
        el.textContent = String(target);
      }
    };
    window.requestAnimationFrame(step);
  };

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        animate(entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  counts.forEach(function (el) {
    el.textContent = "0";
    io.observe(el);
  });
})();
