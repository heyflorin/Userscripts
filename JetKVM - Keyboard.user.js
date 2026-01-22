// ==UserScript==
// @name         JetKVM - Keyboard
// @namespace    https://example.com/
// @version      3.1.0
// @description  Viewport HUD keyboard toggle for iPad. Fixes input tap by avoiding pointer-events:none on ancestors and blocking app capture handlers without preventDefault.
// @author       Florin
// @match        https://app.jetkvm.com/v/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const STORE_X = "us_kb_hud_x_v2";

  const css = `
    .us-kb-hud {
      position: fixed;
      left: 0; right: 0;
      bottom: env(safe-area-inset-bottom, 0px);
      height: 64px;
      z-index: 2147483647;
      pointer-events: auto; /* IMPORTANT: allow hit-testing in iOS */
    }
    .us-kb-hud-inner {
      position: absolute;
      left: 0; right: 0;
      bottom: 10px;
      height: 44px;
      pointer-events: none; /* background passes through */
    }

    .us-kb-btn {
      position: absolute;
      left: 12px; bottom: 0;
      width: 44px; height: 44px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.55);
      color: #fff;
      font-size: 20px;
      line-height: 44px;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      pointer-events: auto; /* clickable */
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .us-kb-btn.us-dragging { opacity: 0.9; }

    .us-kb-bar {
      position: absolute;
      left: 10px; right: 10px; bottom: 0;
      height: 44px;
      display: none;
      gap: 8px;
      align-items: center;
      pointer-events: auto; /* clickable */
    }
    .us-kb-input {
      flex: 1;
      height: 44px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.55);
      color: #fff;
      font: 16px/44px -apple-system, BlinkMacSystemFont, "SF Pro Text","Helvetica Neue", Arial, sans-serif;
      outline: none;
      -webkit-appearance: none;
      pointer-events: auto;
    }
    .us-kb-input::placeholder { color: rgba(255,255,255,0.6); }

    .us-kb-close {
      width: 44px; height: 44px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.55);
      color: #fff;
      font: 16px/44px -apple-system, BlinkMacSystemFont, "SF Pro Text","Helvetica Neue", Arial, sans-serif;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
      touch-action: manipulation;
      pointer-events: auto;
    }
  `;

  if (typeof GM_addStyle === "function") GM_addStyle(css);
  else {
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  // Root HUD
  const hud = document.createElement("div");
  hud.className = "us-kb-hud";
  document.body.appendChild(hud);

  const inner = document.createElement("div");
  inner.className = "us-kb-hud-inner";
  hud.appendChild(inner);

  // Button
  const btn = document.createElement("div");
  btn.className = "us-kb-btn";
  btn.textContent = "⌨️";
  btn.title = "Keyboard";
  btn.setAttribute("role", "button");
  inner.appendChild(btn);

  // Bar
  const bar = document.createElement("div");
  bar.className = "us-kb-bar";

  const input = document.createElement("input");
  input.className = "us-kb-input";
  input.type = "text";
  input.placeholder = "Tap here to type…";
  input.autocapitalize = "off";
  input.autocomplete = "off";
  input.autocorrect = "off";
  input.spellcheck = false;

  const close = document.createElement("div");
  close.className = "us-kb-close";
  close.textContent = "✕";
  close.setAttribute("role", "button");

  bar.appendChild(input);
  bar.appendChild(close);
  inner.appendChild(bar);

  // Critical: stop the remote-desktop app’s global event handlers from cancelling focus.
  // Use CAPTURE, stop propagation, BUT DO NOT preventDefault (we want native focus).
  const stopAppCapture = (e) => {
    e.stopImmediatePropagation();
    // no preventDefault here
  };
  ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "mouseup"].forEach((t) => {
    input.addEventListener(t, stopAppCapture, true);
    close.addEventListener(t, stopAppCapture, true);
  });

  // Optional hooks for your app
  input.addEventListener("beforeinput", (e) => {
    window.dispatchEvent(new CustomEvent("us-remote-beforeinput", {
      detail: { inputType: e.inputType, data: e.data }
    }));
  });

  input.addEventListener("input", () => {
    const val = input.value;
    if (val) window.dispatchEvent(new CustomEvent("us-remote-text", { detail: { text: val } }));
    input.value = "";
  });

  input.addEventListener("keydown", (e) => {
    // Don’t let arrows/space scroll the page while typing
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("us-remote-keydown", {
      detail: {
        key: e.key, code: e.code,
        ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey
      }
    }));
  });

  function showBar() { bar.style.display = "flex"; }
  function hideBar() { bar.style.display = "none"; input.blur(); }
  function toggleBar() { (bar.style.display === "none" || !bar.style.display) ? showBar() : hideBar(); }

  close.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); hideBar(); });

  // Restore saved X
  function applySavedX() {
    const saved = Number(localStorage.getItem(STORE_X));
    if (!Number.isFinite(saved)) return;
    const vw = window.innerWidth;
    const bw = btn.getBoundingClientRect().width || 44;
    const maxLeft = Math.max(8, vw - bw - 8);
    btn.style.left = `${clamp(saved, 8, maxLeft)}px`;
  }
  applySavedX();

  // Drag / tap logic
  let startX = 0, startLeft = 12, moved = false, pid = null;

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    pid = e.pointerId;
    btn.setPointerCapture(pid);

    startX = e.clientX;
    startLeft = parseFloat(getComputedStyle(btn).left) || 12;
    moved = false;
    btn.classList.add("us-dragging");
  });

  btn.addEventListener("pointermove", (e) => {
    if (pid == null || e.pointerId !== pid) return;
    e.preventDefault();
    e.stopPropagation();

    const dx = e.clientX - startX;
    const vw = window.innerWidth;
    const bw = btn.getBoundingClientRect().width || 44;
    const maxLeft = Math.max(8, vw - bw - 8);

    const newLeft = clamp(startLeft + dx, 8, maxLeft);
    btn.style.left = `${newLeft}px`;
    localStorage.setItem(STORE_X, String(Math.round(newLeft)));

    if (Math.abs(dx) > 6) moved = true;
  });

  btn.addEventListener("pointerup", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (pid != null) {
      try { btn.releasePointerCapture(pid); } catch (_) { }
    }
    btn.classList.remove("us-dragging");

    if (!moved) toggleBar();

    pid = null;
    moved = false;
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleBar();
  });

  window.addEventListener("resize", applySavedX, { passive: true });
})();
