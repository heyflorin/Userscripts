// ==UserScript==
// @name         JetKVM - Virtual Keys
// @namespace    https://example.com/
// @version      2.1.0
// @description  Draggable ⌨️ button over the largest <video>. Reveals a persistent "Tap to type" input that iPadOS will open keyboard for. Uses capture-phase blockers so app doesn't steal taps.
// @author       Florin
// @match        https://app.jetkvm.com/v/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const VIDEO_SELECTOR = "video";
  const STORAGE_KEY_LEFT_RATIO = "us_kb_btn_left_ratio_v2";

  const css = `
    .us-kb-overlay{
      position:fixed; left:0; top:0; width:10px; height:10px;
      z-index:2147483647; pointer-events:none;
    }
    .us-kb-btn{
      position:absolute; bottom:10px; left:12px;
      width:44px; height:44px; border-radius:999px;
      border:1px solid rgba(255,255,255,0.25);
      background:rgba(0,0,0,0.55); color:#fff;
      font-size:20px; line-height:44px; text-align:center;
      user-select:none; -webkit-user-select:none;
      touch-action:none; pointer-events:auto;
      backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
      box-shadow:0 6px 18px rgba(0,0,0,0.25);
    }
    .us-kb-btn.us-dragging{ opacity:0.9; }

    .us-kb-bar{
      position:absolute; bottom:10px; left:10px; right:10px;
      display:flex; gap:8px; align-items:center;
      pointer-events:auto;
    }
    .us-kb-input{
      flex:1;
      height:40px; padding:0 12px;
      border-radius:12px;
      border:1px solid rgba(255,255,255,0.25);
      background:rgba(0,0,0,0.55);
      color:#fff;
      font:16px/40px -apple-system, BlinkMacSystemFont, "SF Pro Text","Helvetica Neue", Arial, sans-serif;
      outline:none; -webkit-appearance:none;
    }
    .us-kb-input::placeholder{ color:rgba(255,255,255,0.6); }

    .us-kb-close{
      width:44px; height:40px;
      border-radius:12px;
      border:1px solid rgba(255,255,255,0.25);
      background:rgba(0,0,0,0.55); color:#fff;
      font:16px/40px -apple-system, BlinkMacSystemFont, "SF Pro Text","Helvetica Neue", Arial, sans-serif;
      text-align:center;
      user-select:none; -webkit-user-select:none;
      touch-action:manipulation;
    }
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
    let best = null, bestArea = 0;
    for (const v of vids) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = v; }
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
      // prevent scrolling / browser behavior while typing
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("us-remote-keydown", {
        detail: {
          key: e.key, code: e.code,
          ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey
        }
      }));
    });
  }

  // --- Create overlay + button once ---
  const overlay = document.createElement("div");
  overlay.className = "us-kb-overlay";
  document.body.appendChild(overlay);

  const btn = document.createElement("div");
  btn.className = "us-kb-btn";
  btn.textContent = "⌨️";
  btn.title = "Keyboard";
  btn.setAttribute("role", "button");
  overlay.appendChild(btn);

  // Persistent bar (input + close) but toggled
  const bar = document.createElement("div");
  bar.className = "us-kb-bar";
  bar.style.display = "none";

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
  overlay.appendChild(bar);

  dispatchRemoteEvents(input);

  function showBar() { bar.style.display = ""; }
  function hideBar() { bar.style.display = "none"; input.blur(); }

  // --- CAPTURE-PHASE BLOCKERS ---
  // Many remote desktop apps listen on document/window (capture) and steal the event.
  // We intercept taps on our controls *before* the app sees them.
  function stopForOurUI(e) {
    const t = e.target;
    if (t === btn || t === input || t === close || (t instanceof Node && bar.contains(t))) {
      e.stopImmediatePropagation();
      // Don’t preventDefault on the input tap: iPad needs the native tap to focus + open keyboard.
      if (t !== input) e.preventDefault();
    }
  }
  ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click"].forEach(type => {
    document.addEventListener(type, stopForOurUI, true); // capture = true
  });

  // --- Button tap toggles the bar (no auto-focus) ---
  let btnStartX = 0, btnStartLeft = 12, moved = false, pid = null;

  btn.addEventListener("pointerdown", (e) => {
    pid = e.pointerId;
    btn.setPointerCapture(pid);
    btnStartX = e.clientX;
    btnStartLeft = parseFloat(getComputedStyle(btn).left) || 12;
    moved = false;
    btn.classList.add("us-dragging");
  });

  btn.addEventListener("pointermove", (e) => {
    if (pid == null || e.pointerId !== pid) return;

    const dx = e.clientX - btnStartX;
    const ow = overlay.getBoundingClientRect().width;
    const bw = btn.getBoundingClientRect().width;
    const maxLeft = Math.max(8, ow - bw - 8);
    const newLeft = clamp(btnStartLeft + dx, 8, maxLeft);
    btn.style.left = `${newLeft}px`;

    const ratio = maxLeft > 8 ? (newLeft - 8) / (maxLeft - 8) : 0;
    localStorage.setItem(STORAGE_KEY_LEFT_RATIO, String(ratio));

    if (Math.abs(dx) > 6) moved = true;
  });

  btn.addEventListener("pointerup", () => {
    if (pid != null) {
      try { btn.releasePointerCapture(pid); } catch (_) { }
    }
    btn.classList.remove("us-dragging");

    if (!moved) {
      // Toggle bar; user must tap input to open keyboard (reliable on iPadOS)
      bar.style.display === "none" ? showBar() : hideBar();
    }

    pid = null;
    moved = false;
  });

  close.addEventListener("click", hideBar);

  // --- Anchor overlay to video ---
  let currentVideo = null;

  function applySavedBtnPos() {
    const ratioRaw = localStorage.getItem(STORAGE_KEY_LEFT_RATIO);
    const ratio = ratioRaw != null ? Number(ratioRaw) : null;
    if (!Number.isFinite(ratio)) return;

    const ow = overlay.getBoundingClientRect().width;
    const bw = btn.getBoundingClientRect().width;
    const maxLeft = Math.max(8, ow - bw - 8);
    const left = 8 + (maxLeft - 8) * clamp(ratio, 0, 1);
    btn.style.left = `${left}px`;
  }

  function updateOverlay() {
    if (!currentVideo || !document.contains(currentVideo) || !isVisible(currentVideo)) {
      currentVideo = findBestVideo();
      if (!currentVideo) { overlay.style.display = "none"; return; }
      overlay.style.display = "";
    }

    const r = currentVideo.getBoundingClientRect();
    overlay.style.left = `${Math.round(r.left)}px`;
    overlay.style.top = `${Math.round(r.top)}px`;
    overlay.style.width = `${Math.round(r.width)}px`;
    overlay.style.height = `${Math.round(r.height)}px`;

    applySavedBtnPos();
  }

  (function tick() {
    updateOverlay();
    requestAnimationFrame(tick);
  })();

  const mo = new MutationObserver(() => {
    const v = findBestVideo();
    if (v && v !== currentVideo) currentVideo = v;
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
