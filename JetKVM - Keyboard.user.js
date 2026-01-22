// ==UserScript==
// @name         JetKVM - Keyboard
// @namespace    https://example.com/
// @version      2.0.0
// @description  Adds a draggable keyboard button anchored over the bottom of the largest <video>. Uses a body-level overlay so it won't get covered by app layers.
// @author       Florin
// @match        https://app.jetkvm.com/v/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const VIDEO_SELECTOR = "video";
  const STORAGE_KEY_LEFT_RATIO = "us_kb_btn_left_ratio_v1"; // store 0..1 for responsive layouts

  const css = `
    .us-kb-overlay {
      position: fixed;
      left: 0; top: 0;
      width: 10px; height: 10px;
      z-index: 2147483647;
      pointer-events: none; /* children opt-in */
    }
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
      touch-action: none;
      pointer-events: auto;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .us-kb-btn.us-dragging { opacity: 0.9; }

    .us-kb-input {
      position: absolute;
      bottom: 10px;
      left: 10px;
      right: 10px;
      height: 40px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.55);
      color: #fff;
      font: 16px/40px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      outline: none;
      -webkit-appearance: none;
      pointer-events: auto;
    }
    .us-kb-input::placeholder { color: rgba(255,255,255,0.6); }
  `;

  if (typeof GM_addStyle === "function") GM_addStyle(css);
  else {
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    return true;
  }

  function findBestVideo() {
    const vids = Array.from(document.querySelectorAll(VIDEO_SELECTOR)).filter(isVisible);
    let best = null;
    let bestArea = 0;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best;
  }

  function dispatchRemoteEvents(inputEl) {
    inputEl.addEventListener("beforeinput", (e) => {
      window.dispatchEvent(new CustomEvent("us-remote-beforeinput", {
        detail: { inputType: e.inputType, data: e.data }
      }));
    });

    inputEl.addEventListener("input", () => {
      const val = inputEl.value;
      if (val) window.dispatchEvent(new CustomEvent("us-remote-text", { detail: { text: val } }));
      inputEl.value = "";
    });

    inputEl.addEventListener("keydown", (e) => {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("us-remote-keydown", {
        detail: {
          key: e.key, code: e.code,
          ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey
        }
      }));
    });
  }

  // Create a single overlay anchored to whichever video is "best" right now.
  const overlay = document.createElement("div");
  overlay.className = "us-kb-overlay";
  document.body.appendChild(overlay);

  const btn = document.createElement("div");
  btn.className = "us-kb-btn";
  btn.textContent = "⌨️";
  btn.title = "Keyboard";
  btn.setAttribute("role", "button");
  btn.setAttribute("aria-label", "Keyboard");
  overlay.appendChild(btn);

  let input = null;
  function showInput() {
    if (!input) {
      input = document.createElement("input");
      input.className = "us-kb-input";
      input.type = "text";
      input.placeholder = "Tap here to type…";
      input.autocapitalize = "off";
      input.autocomplete = "off";
      input.autocorrect = "off";
      input.spellcheck = false;

      dispatchRemoteEvents(input);

      input.addEventListener("blur", () => {
        setTimeout(() => {
          if (input && document.activeElement !== input) {
            input.remove();
            input = null;
          }
        }, 150);
      });

      overlay.appendChild(input);
    }

    // Try focus; even if focus doesn't pop keyboard, the user tap on input will.
    input.focus({ preventScroll: true });
    try { input.setSelectionRange(0, 0); } catch (_) { }
  }

  // Drag the button horizontally within overlay width
  let startX = 0, startLeft = 12, moved = false, pid = null;

  btn.addEventListener("pointerdown", (e) => {
    pid = e.pointerId;
    btn.setPointerCapture(pid);
    startX = e.clientX;
    startLeft = parseFloat(getComputedStyle(btn).left) || 12;
    moved = false;
    btn.classList.add("us-dragging");
    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener("pointermove", (e) => {
    if (pid == null || e.pointerId !== pid) return;

    const dx = e.clientX - startX;
    const ow = overlay.getBoundingClientRect().width;
    const bw = btn.getBoundingClientRect().width;
    const maxLeft = Math.max(8, ow - bw - 8);

    const newLeft = clamp(startLeft + dx, 8, maxLeft);
    btn.style.left = `${newLeft}px`;

    // store as ratio so it survives resizes
    const ratio = maxLeft > 0 ? (newLeft - 8) / (maxLeft - 8) : 0;
    localStorage.setItem(STORAGE_KEY_LEFT_RATIO, String(ratio));

    if (Math.abs(dx) > 6) moved = true;
  });

  btn.addEventListener("pointerup", (e) => {
    if (pid != null) {
      try { btn.releasePointerCapture(pid); } catch (_) { }
    }
    btn.classList.remove("us-dragging");

    if (!moved) showInput();

    pid = null;
    moved = false;

    e.preventDefault();
    e.stopPropagation();
  });

  btn.addEventListener("pointercancel", () => {
    pid = null;
    moved = false;
    btn.classList.remove("us-dragging");
  });

  // Position overlay to match the current best video’s rect
  let currentVideo = null;

  function applySavedButtonPos() {
    const ratioRaw = localStorage.getItem(STORAGE_KEY_LEFT_RATIO);
    const ratio = ratioRaw != null ? Number(ratioRaw) : null;
    if (!Number.isFinite(ratio)) return;

    const ow = overlay.getBoundingClientRect().width;
    const bw = btn.getBoundingClientRect().width;
    const maxLeft = Math.max(8, ow - bw - 8);
    const left = 8 + (maxLeft - 8) * clamp(ratio, 0, 1);
    btn.style.left = `${left}px`;
  }

  function anchorToVideo(v) {
    currentVideo = v;
    // update immediately
    updateOverlay();
    // apply saved button position after overlay size updates
    setTimeout(applySavedButtonPos, 0);
  }

  function updateOverlay() {
    if (!currentVideo || !document.contains(currentVideo) || !isVisible(currentVideo)) {
      const v = findBestVideo();
      if (!v) {
        overlay.style.display = "none";
        return;
      }
      overlay.style.display = "";
      anchorToVideo(v);
      return;
    }

    overlay.style.display = "";

    const r = currentVideo.getBoundingClientRect();
    // Align overlay exactly over the video box
    overlay.style.left = `${Math.round(r.left)}px`;
    overlay.style.top = `${Math.round(r.top)}px`;
    overlay.style.width = `${Math.round(r.width)}px`;
    overlay.style.height = `${Math.round(r.height)}px`;

    // Clamp button after resize
    applySavedButtonPos();

    // Make sure input stays above everything
    // (it’s in overlay with huge z-index, so it should)
  }

  // Keep it glued during scroll/layout changes
  function tick() {
    updateOverlay();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Also react to DOM changes (video replacement, etc.)
  const mo = new MutationObserver(() => {
    const v = findBestVideo();
    if (v && v !== currentVideo) anchorToVideo(v);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

})();
