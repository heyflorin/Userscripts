// ==UserScript==
// @name         iPad Safari Zoom/Viewport Lock
// @version      1.0.0
// @description  Prevent web apps from changing viewport scale / zoom behavior on orientation/viewport changes (iPad Safari)
// @match        https://app.jetkvm.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  // -------------------------
  // CONFIG
  // -------------------------
  const DESIRED_VIEWPORT_CONTENT =
    "width=device-width, initial-scale=1, viewport-fit=cover";

  // If the app *keeps* forcing zoom via viewport changes, enabling this can help.
  // Downside: it can restrict pinch zoom.
  const LOCK_MAX_SCALE = true; // set true if needed

  // If the app is using CSS scaling (transform: scale / zoom), try to undo it.
  const STRIP_CSS_SCALE_HACKS = true;

  // Debounce timing for rapid viewport events
  const DEBOUNCE_MS = 80;

  // -------------------------
  // INTERNALS
  // -------------------------
  const desiredContent = LOCK_MAX_SCALE
    ? `${DESIRED_VIEWPORT_CONTENT}, maximum-scale=1, user-scalable=no`
    : DESIRED_VIEWPORT_CONTENT;

  const log = (...args) => {
    // Uncomment if you want logs:
    // console.log("[ViewportLock]", ...args);
  };

  let applyScheduled = false;

  function getViewportMeta() {
    return document.querySelector('meta[name="viewport"]');
  }

  function ensureViewportMeta() {
    let m = getViewportMeta();
    if (!m) {
      m = document.createElement("meta");
      m.name = "viewport";
      // Prefer head, but fall back early
      (document.head || document.documentElement).appendChild(m);
      log("Inserted viewport meta");
    }
    return m;
  }

  function applyViewportLock() {
    const m = ensureViewportMeta();

    const current = (m.getAttribute("content") || "").trim();
    if (current !== desiredContent) {
      m.setAttribute("content", desiredContent);
      log("Re-applied viewport content:", desiredContent);
    }

    if (STRIP_CSS_SCALE_HACKS) stripScaleHacks();
  }

  function scheduleApply() {
    if (applyScheduled) return;
    applyScheduled = true;
    setTimeout(() => {
      applyScheduled = false;
      applyViewportLock();
    }, DEBOUNCE_MS);
  }

  function stripScaleHacks() {
    // Some apps simulate zoom by scaling the page. If you know what element they scale,
    // you can target it more precisely; this is intentionally conservative.
    const html = document.documentElement;
    const body = document.body;

    const candidates = [html, body].filter(Boolean);

    for (const el of candidates) {
      const style = el.style;
      // Remove inline transform scale
      if (style && style.transform && /scale\(/i.test(style.transform)) {
        style.transform = "";
        style.transformOrigin = "";
        log("Removed inline transform scale from", el.tagName);
      }
      // Remove inline zoom (mostly non-iOS, but harmless)
      if (style && style.zoom) {
        style.zoom = "";
        log("Removed inline zoom from", el.tagName);
      }
    }
  }

  // -------------------------
  // HARDENING: prevent the app from changing the viewport meta
  // -------------------------
  function hardenViewportMeta(meta) {
    if (!meta || meta.__viewportLockHardened) return;
    Object.defineProperty(meta, "__viewportLockHardened", { value: true });

    // Intercept setAttribute on THIS meta tag only
    const origSetAttribute = meta.setAttribute.bind(meta);
    meta.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === "content") {
        const v = String(value || "").trim();
        if (v !== desiredContent) {
          log("Blocked viewport content change to:", v);
          return origSetAttribute("content", desiredContent);
        }
      }
      return origSetAttribute(name, value);
    };

    // Also intercept direct property assignment: meta.content = "..."
    try {
      Object.defineProperty(meta, "content", {
        get() {
          return meta.getAttribute("content") || "";
        },
        set(v) {
          const next = String(v || "").trim();
          if (next !== desiredContent) {
            log("Blocked meta.content assignment:", next);
            meta.setAttribute("content", desiredContent);
          } else {
            meta.setAttribute("content", desiredContent);
          }
        },
        configurable: true,
      });
    } catch {
      // Some browsers disallow redefining built-ins; ignore.
    }
  }

  // Observe DOM for viewport meta replacement/removal and any attribute changes
  const domObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // If viewport meta was added/removed/replaced
      if (m.type === "childList") {
        scheduleApply();
      }
      // If viewport meta content was modified
      if (m.type === "attributes") {
        const t = m.target;
        if (
          t &&
          t.tagName === "META" &&
          (t.getAttribute("name") || "").toLowerCase() === "viewport"
        ) {
          hardenViewportMeta(t);
          scheduleApply();
        }
      }
    }
  });

  function start() {
    // Initial apply ASAP
    applyViewportLock();
    hardenViewportMeta(getViewportMeta());

    // Start observing once we have a root
    domObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["content", "name"],
    });

    // Viewport/orientation signals
    window.addEventListener("resize", scheduleApply, { passive: true });
    window.addEventListener("orientationchange", scheduleApply, { passive: true });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", scheduleApply, { passive: true });
      window.visualViewport.addEventListener("scroll", scheduleApply, { passive: true });
    }

    // Some apps wait until DOMContentLoaded to mutate viewport
    document.addEventListener("DOMContentLoaded", scheduleApply, { passive: true });
    window.addEventListener("pageshow", scheduleApply, { passive: true });

    log("Started");
  }

  // document-start safe boot
  start();
})();
