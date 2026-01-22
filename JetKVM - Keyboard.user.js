// ==UserScript==
// @name         JetKVM - Keyboard POC
// @namespace    https://example.com/
// @version      1.2.0
// @description  Adds a draggable keyboard button over <video>. Tap it to reveal a small input field the user can tap to reliably open iPadOS keyboard.
// @author       Florin
// @match        https://app.jetkvm.com/v/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const VIDEO_SELECTOR = "video";
  const STORAGE_KEY_LEFT = "us_kb_btn_left_px_v3";

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
      touch-action: none;
      z-index: 2147483647;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .us-kb-btn.us-dragging { opacity: 0.9; }

    .us-kb-input {
      position: absolute;
      bottom: 10px;
      right: 10px;
      left: 10px; /* spans across bottom; you can narrow if you want */
      height: 40px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.55);
      color: #fff;
      font: 16px/40px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      z-index: 2147483646; /* just under the button */
      outline: none;
      -webkit-appearance: none;
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

  function findBestVideo() {
    const vids = Array.from(document.querySelectorAll(VIDEO_SELECTOR));
    const scored = vids.map(v => {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      const style = getComputedStyle(v);
      const ok =
        r.width > 80 && r.height > 80 && area > 0 &&
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

  function dispatchRemoteEvents(inputEl) {
    // Input for text/IME/paste
    inputEl.addEventListener("beforeinput", (e) => {
      window.dispatchEvent(new CustomEvent("us-remote-beforeinput", {
        detail: { inputType: e.inputType, data: e.data }
      }));
    });

    inputEl.addEventListener("input", () => {
      // If you want raw text chunks, grab inputEl.value here before clearing
      const val = inputEl.value;
      if (val) {
        window.dispatchEvent(new CustomEvent("us-remote-text", { detail: { text: val } }));
      }
      // Clear to keep it from accumulating
      inputEl.value = "";
    });

    // Special keys (enter/backspace/arrows, etc.)
    inputEl.addEventListener("keydown", (e) => {
      // Don’t let space/arrows scroll the page while typing
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("us-remote-keydown", {
        detail: {
          key: e.key, code: e.code,
          ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey
        }
      }));
    });
  }

  function addUI(video) {
    const wrap = wrapVideo(video);
    if (!wrap) return;
    if (wrap.querySelector(".us-kb-btn")) return;

    const btn = document.createElement("div");
    btn.className = "us-kb-btn";
    btn.textContent = "⌨️";
    btn.title = "Keyboard";
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", "Keyboard");

    const saved = localStorage.getItem(STORAGE_KEY_LEFT);
    if (saved != null && Number.isFinite(Number(saved))) btn.style.left = `${Number(saved)}px`;

    wrap.appendChild(btn);

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

        // Hide input when it loses focus (optional)
        input.addEventListener("blur", () => {
          // small delay so taps can land without flicker
          setTimeout(() => {
            if (input && document.activeElement !== input) {
              input.remove();
              input = null;
            }
          }, 150);
        });

        wrap.appendChild(input);
      }

      // Try to focus (may or may not open keyboard), but the reliable part is:
      // the user can tap the input itself.
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (_) { }
    }

    // Drag logic for the button (horizontal only)
    let startX = 0, startLeft = 0, moved = false, pid = null;

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
      const wrapRect = wrap.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const maxLeft = Math.max(8, wrapRect.width - btnRect.width - 8);

      const newLeft = clamp(startLeft + dx, 8, maxLeft);
      btn.style.left = `${newLeft}px`;

      if (Math.abs(dx) > 6) moved = true;
    });

    btn.addEventListener("pointerup", (e) => {
      if (pid != null) {
        try { btn.releasePointerCapture(pid); } catch (_) { }
      }
      btn.classList.remove("us-dragging");

      const leftPx = parseFloat(getComputedStyle(btn).left) || 12;
      localStorage.setItem(STORAGE_KEY_LEFT, String(Math.round(leftPx)));

      // Tap (not drag) => show the input field
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

    // Keep the button clamped on resize/orientation
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
    clampPos();
  }

  function tryInit() {
    const video = findBestVideo();
    if (video) addUI(video);
  }

  tryInit();

  const mo = new MutationObserver(() => {
    clearTimeout(mo._t);
    mo._t = setTimeout(tryInit, 200);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
