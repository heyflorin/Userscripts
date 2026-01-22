// ==UserScript==
// @name         iPad Video Keyboard Toggle (Draggable)
// @namespace    https://example.com/
// @version      1.0.0
// @description  Adds a draggable keyboard button overlay inside the bottom of a <video> to summon iPadOS software keyboard via hidden textarea focus.
// @author       Florin
// @match        https://app.jetkvm.com/v/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  /**********************************************************************
   * Config
   **********************************************************************/
  const BUTTON_TEXT = "⌨️";
  const BUTTON_TITLE = "Show keyboard";
  const STORAGE_KEY_LEFT = "us_kb_btn_left_px_v1";
  const STORAGE_KEY_VIDEO = "us_kb_btn_video_sig_v1"; // per-page fallback

  // If your app has multiple videos, this targets the "best" one.
  // You can tighten this by setting VIDEO_SELECTOR to something specific.
  const VIDEO_SELECTOR = "video";

  /**********************************************************************
   * Styles
   **********************************************************************/
  const css = `
    .us-kb-wrap {
      position: relative !important;
      display: inline-block !important;
      width: 100% !important;
      height: auto !important;
      max-width: 100% !important;
    }
    .us-kb-btn {
      position: absolute;
      bottom: 10px;
      left: 12px; /* will be overridden by saved position */
      width: 44px;
      height: 44px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.55);
      color: #fff;
      font-size: 20px;
      line-height: 44px;
      text-align: center;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none; /* we manage drag */
      z-index: 2147483647;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .us-kb-btn:active {
      transform: scale(0.98);
    }
    .us-kb-btn.us-dragging {
      cursor: grabbing;
      opacity: 0.9;
    }
    .us-kb-toast {
      position: absolute;
      bottom: 62px;
      left: 12px;
      padding: 6px 10px;
      border-radius: 10px;
      background: rgba(0,0,0,0.70);
      color: #fff;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      z-index: 2147483647;
      pointer-events: none;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 160ms ease, transform 160ms ease;
      white-space: nowrap;
    }
    .us-kb-toast.us-show {
      opacity: 1;
      transform: translateY(0);
    }
    /* Hidden textarea used as an input pipe */
    textarea.us-kb-hidden {
      position: fixed !important;
      left: -9999px !important;
      top: 0 !important;
      width: 1px !important;
      height: 1px !important;
      opacity: 0 !important;
      z-index: -1 !important;
      caret-color: transparent !important;
      pointer-events: none !important;
    }
  `;

  if (typeof GM_addStyle === "function") {
    GM_addStyle(css);
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  /**********************************************************************
   * Helpers
   **********************************************************************/
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  // Pick the biggest visible video on the page (common for remote desktop canvases)
  function findBestVideo() {
    const vids = Array.from(document.querySelectorAll(VIDEO_SELECTOR));
    const visible = vids
      .map(v => {
        const r = v.getBoundingClientRect();
        const area = Math.max(0, r.width) * Math.max(0, r.height);
        const visibleEnough = r.width > 80 && r.height > 80 && area > 0;
        const style = getComputedStyle(v);
        const notHidden = style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        return { v, r, area, ok: visibleEnough && notHidden };
      })
      .filter(x => x.ok);

    visible.sort((a, b) => b.area - a.area);
    return visible[0]?.v || null;
  }

  function signatureForVideo(video) {
    // A cheap-ish signature so saved position doesn't wildly apply to a different embed
    const r = video.getBoundingClientRect();
    return `${location.host}|${Math.round(r.width)}x${Math.round(r.height)}`;
  }

  function getSavedLeft(video) {
    // Prefer per-video signature, fallback to per-page saved
    const sig = signatureForVideo(video);
    const savedSig = localStorage.getItem(STORAGE_KEY_VIDEO);
    const savedLeft = localStorage.getItem(STORAGE_KEY_LEFT);

    if (savedSig === sig && savedLeft != null) {
      const n = Number(savedLeft);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function setSavedLeft(video, leftPx) {
    const sig = signatureForVideo(video);
    localStorage.setItem(STORAGE_KEY_VIDEO, sig);
    localStorage.setItem(STORAGE_KEY_LEFT, String(Math.round(leftPx)));
  }

  function ensureHiddenTextarea() {
    let ta = document.querySelector("textarea.us-kb-hidden");
    if (ta) return ta;

    ta = document.createElement("textarea");
    ta.className = "us-kb-hidden";
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("spellcheck", "false");
    document.body.appendChild(ta);

    // Clear text after input so it stays "neutral"
    ta.addEventListener("input", () => {
      ta.value = "";
    });

    // Optional: expose events for your app to hook into
    // You can listen for these custom events in your app if you want.
    ta.addEventListener("keydown", (e) => {
      // Prevent iPad scrolling on space/arrows, etc.
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("us-remote-keydown", {
        detail: {
          key: e.key, code: e.code,
          ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey
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

  function focusKeyboard(ta) {
    // Must be triggered from a user gesture for iPadOS to reliably open keyboard
    try {
      ta.focus({ preventScroll: true });
      // Some iOS versions benefit from a tiny selection set
      ta.setSelectionRange(0, 0);
    } catch (_) {
      // ignore
    }
  }

  /**********************************************************************
   * UI Injection
   **********************************************************************/
  function wrapVideo(video) {
    // If already wrapped, skip
    if (video.closest(".us-kb-wrap")) return video.closest(".us-kb-wrap");

    const wrap = document.createElement("div");
    wrap.className = "us-kb-wrap";

    // Preserve sizing behavior by copying computed display constraints where reasonable
    // (We keep it light to avoid breaking app layouts.)
    const parent = video.parentElement;
    if (!parent) return null;

    parent.insertBefore(wrap, video);
    wrap.appendChild(video);

    // If the video uses absolute positioning, ensure wrapper doesn't collapse
    // Many apps set the video to width/height 100%; wrapper will naturally size to it.
    return wrap;
  }

  function addButton(video) {
    const wrap = wrapVideo(video);
    if (!wrap) return;

    if (wrap.querySelector(".us-kb-btn")) return; // already added

    const ta = ensureHiddenTextarea();

    const btn = document.createElement("div");
    btn.className = "us-kb-btn";
    btn.textContent = BUTTON_TEXT;
    btn.title = BUTTON_TITLE;
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-label", BUTTON_TITLE);

    const toast = document.createElement("div");
    toast.className = "us-kb-toast";
    toast.textContent = "Drag left/right • Tap to type";

    wrap.appendChild(btn);
    wrap.appendChild(toast);

    // Restore saved X position if present
    const savedLeft = getSavedLeft(video);
    if (savedLeft != null) btn.style.left = `${savedLeft}px`;

    const showToast = () => {
      toast.style.left = btn.style.left || "12px";
      toast.classList.add("us-show");
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => toast.classList.remove("us-show"), 1200);
    };

    // Tap to focus textarea => keyboard
    // Use pointerdown (not click) to keep it within the gesture event
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // If a drag is happening, don't treat as summon
      if (btn.dataset.dragging === "1") return;

      focusKeyboard(ta);
      showToast();
    });

    // Horizontal drag
    let startX = 0;
    let startLeft = 0;
    let moved = false;

    const onMove = (e) => {
      if (!btn.hasPointerCapture(e.pointerId)) return;

      const dx = e.clientX - startX;
      const wrapRect = wrap.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const maxLeft = wrapRect.width - btnRect.width - 8; // right padding
      const newLeft = clamp(startLeft + dx, 8, maxLeft);

      btn.style.left = `${newLeft}px`;
      toast.style.left = `${newLeft}px`;

      if (Math.abs(dx) > 6) moved = true;
    };

    const onUp = (e) => {
      if (btn.hasPointerCapture(e.pointerId)) {
        btn.releasePointerCapture(e.pointerId);
      }
      btn.classList.remove("us-dragging");

      // Mark as dragging to suppress the pointerdown summon if user moved
      btn.dataset.dragging = moved ? "1" : "0";

      // Persist position if moved
      if (moved) {
        const leftPx = parseFloat(btn.style.left || "12");
        setSavedLeft(video, leftPx);
      }

      // Reset after a beat so a tap right after drag works
      setTimeout(() => { btn.dataset.dragging = "0"; }, 80);
    };

    btn.addEventListener("pointerdown", (e) => {
      // Start drag tracking, but don't steal the tap unless user moves
      startX = e.clientX;
      startLeft = parseFloat(getComputedStyle(btn).left) || 12;
      moved = false;
      btn.classList.add("us-dragging");
      btn.setPointerCapture(e.pointerId);
    });

    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerup", onUp);
    btn.addEventListener("pointercancel", onUp);

    // Keep position clamped on resize/orientation changes
    const onResize = () => {
      const wrapRect = wrap.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const maxLeft = Math.max(8, wrapRect.width - btnRect.width - 8);
      const leftPx = parseFloat(getComputedStyle(btn).left) || 12;
      const clamped = clamp(leftPx, 8, maxLeft);
      btn.style.left = `${clamped}px`;
      toast.style.left = `${clamped}px`;
      setSavedLeft(video, clamped);
    };

    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });

    // Optional: If the user taps the video itself, you may also want keyboard.
    // Uncomment if you want that behavior.
    // wrap.addEventListener("pointerdown", () => focusKeyboard(ta), { passive: true });

    showToast();
  }

  /**********************************************************************
   * Boot + observe (apps often replace the <video>)
   **********************************************************************/
  function tryInit() {
    const video = findBestVideo();
    if (video) addButton(video);
  }

  tryInit();

  const mo = new MutationObserver(() => {
    // Debounce-ish
    clearTimeout(mo._t);
    mo._t = setTimeout(tryInit, 200);
  });

  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
