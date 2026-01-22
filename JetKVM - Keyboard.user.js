// ==UserScript==
// @name         JetKVM UI - Keyboard
// @namespace    https://example.com/
// @version      1.1.0
// @description  Draggable keyboard button overlay on <video>; uses a tiny on-screen textarea to reliably summon iPadOS software keyboard.
// @author       Florin
// @match        https://app.jetkvm.com/v/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const BUTTON_TEXT = "⌨️";
  const BUTTON_TITLE = "Show keyboard";
  const STORAGE_KEY_LEFT = "us_kb_btn_left_px_v2";
  const VIDEO_SELECTOR = "video";

  const css = `
    .us-kb-wrap { position: relative !important; display: inline-block !important; width: 100% !important; max-width: 100% !important; }
    .us-kb-btn {
      position: absolute;
      bottom: 10px;
      left: 12px;
      width: 44px; height: 44px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.55);
      color: #fff;
      font-size: 20px;
      line-height: 44px;
      text-align: center;
      user-select: none; -webkit-user-select: none;
      touch-action: none; /* allow drag without page scroll */
      z-index: 2147483647;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .us-kb-btn.us-dragging { opacity: 0.9; }
    /* IMPORTANT: keep textarea ON-SCREEN (tiny + barely visible) so iPadOS will actually open the keyboard */
    textarea.us-kb-sink {
      position: fixed !important;
      left: 8px !important;
      bottom: 8px !important;
      width: 1px !important;
      height: 1px !important;
      opacity: 0.01 !important;     /* not 0 */
      z-index: 2147483647 !important;
      border: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      background: transparent !important;
      color: transparent !important;
      caret-color: transparent !important;
      -webkit-appearance: none !important;
    }
  `;

  if (typeof GM_addStyle === "function") GM_addStyle(css);
  else {
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function findBestVideo() {
    const vids = Array.from(document.querySelectorAll(VIDEO_SELECTOR));
    const scored = vids.map(v => {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      const style = getComputedStyle(v);
      const ok = r.width > 80 && r.height > 80 && area > 0 &&
        style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      return { v, area, ok };
    }).filter(x => x.ok);

    scored.sort((a, b) => b.area - a.area);
    return scored[0]?.v || null;
  }

  function wrapVideo(video) {
    if (video.closest(".us-kb-wrap")) return video.closest(".us-kb-wrap");
    const parent = video.parentElement;
    if (!parent) return null;

    const wrap = document.createElement("div");
    wrap.className = "us-kb-wrap";
    parent.insertBefore(wrap, video);
    wrap.appendChild(video);
    return wrap;
  }

  function ensureSink() {
    let ta = document.querySelector("textarea.us-kb-sink");
    if (ta) return ta;

    ta = document.createElement("textarea");
    ta.className = "us-kb-sink";
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("spellcheck", "false");
    document.body.appendChild(ta);

    // Keep it empty so you don't get weird selection bubbles
    ta.addEventListener("input", () => { ta.value = ""; });

    // (Optional) dispatch events your app can listen to
    ta.addEventListener("keydown", (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("us-remote-keydown", {
        detail: {
          key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey
        }
      }));
    });

    ta.addEventListener("beforeinput", (e) => {
      window.dispatchEvent(new CustomEvent("us-remote-beforeinput", {
        detail: {
          inputType: e.inputType, data: e.data
        }
      }));
    });

    return ta;
  }

  function summonKeyboard() {
    const ta = ensureSink();

    // Safari/iPadOS is picky. This sequence tends to work better.
    ta.value = " "; // make it "real"
    ta.focus({ preventScroll: true });
    try { ta.setSelectionRange(1, 1); } catch (_) { }
    // Clear shortly after; leaving a space can cause selection UI sometimes.
    setTimeout(() => { ta.value = ""; }, 50);
  }

  function addButton(video) {
    const wrap = wrapVideo(video);
    if (!wrap) return;
    if (wrap.querySelector(".us-kb-btn")) return;

    const btn = document.createElement("div");
    btn.className = "us-kb-btn";
    btn.textContent = BUTTON_TEXT;
    btn.title = BUTTON_TITLE;
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", BUTTON_TITLE);

    // restore position
    const saved = localStorage.getItem(STORAGE_KEY_LEFT);
    if (saved != null && Number.isFinite(Number(saved))) btn.style.left = `${Number(saved)}px`;

    wrap.appendChild(btn);

    // Drag state
    let startX = 0;
    let startLeft = 0;
    let moved = false;
    let activePointerId = null;

    btn.addEventListener("pointerdown", (e) => {
      activePointerId = e.pointerId;
      btn.setPointerCapture(activePointerId);

      startX = e.clientX;
      startLeft = parseFloat(getComputedStyle(btn).left) || 12;
      moved = false;

      btn.classList.add("us-dragging");
      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener("pointermove", (e) => {
      if (activePointerId == null || e.pointerId !== activePointerId) return;

      const dx = e.clientX - startX;
      const wrapRect = wrap.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const maxLeft = Math.max(8, wrapRect.width - btnRect.width - 8);

      const newLeft = clamp(startLeft + dx, 8, maxLeft);
      btn.style.left = `${newLeft}px`;

      if (Math.abs(dx) > 6) moved = true;
    });

    btn.addEventListener("pointerup", (e) => {
      if (activePointerId != null) {
        try { btn.releasePointerCapture(activePointerId); } catch (_) { }
      }
      btn.classList.remove("us-dragging");

      const leftPx = parseFloat(getComputedStyle(btn).left) || 12;
      localStorage.setItem(STORAGE_KEY_LEFT, String(Math.round(leftPx)));

      // Treat as TAP if not dragged: summon keyboard here (better than pointerdown)
      if (!moved) {
        // Must happen right on the user gesture. pointerup is still a trusted gesture.
        summonKeyboard();
      }

      activePointerId = null;
      moved = false;

      e.preventDefault();
      e.stopPropagation();
    });

    btn.addEventListener("pointercancel", () => {
      activePointerId = null;
      moved = false;
      btn.classList.remove("us-dragging");
    });

    // Clamp on resize/orientation
    const clampPos = () => {
      const wrapRect = wrap.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const maxLeft = Math.max(8, wrapRect.width - btnRect.width - 8);
      const leftPx = parseFloat(getComputedStyle(btn).left) || 12;
      const clamped = clamp(leftPx, 8, maxLeft);
      btn.style.left = `${clamped}px`;
      localStorage.setItem(STORAGE_KEY_LEFT, String(Math.round(clamped)));
    };
    window.addEventListener("resize", clampPos, { passive: true });
    window.addEventListener("orientationchange", clampPos, { passive: true });

    ensureSink();
    clampPos();
  }

  function tryInit() {
    const video = findBestVideo();
    if (video) addButton(video);
  }

  tryInit();

  const mo = new MutationObserver(() => {
    clearTimeout(mo._t);
    mo._t = setTimeout(tryInit, 200);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
