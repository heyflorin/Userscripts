// ==UserScript==
// @name         JetKVM - Fullscreen + CSS + Viewport Lock
// @version      2.0
// @downloadURL  https://raw.githubusercontent.com/heyflorin/Userscripts/refs/heads/main/JetKVM%20-%20Full%20Screen.user.js
// @description  Adds CMD+SHIFT+F fake-fullscreen (no Safari fullscreen X), applies UI CSS tweaks, and locks viewport scaling.
// @author       Florin Catalin Mehedinti
// @run-at       document-start
// @match        https://app.jetkvm.com/v/*/devices/*
// @grant        GM.addStyle
// ==/UserScript==

(() => {
  "use strict";

  /*****************
   * CONFIG
   *****************/
  const KEYBIND = { meta: true, shift: true, key: "f" }; // CMD + SHIFT + F
  const VIDEO_SELECTOR = "video"; // change if JetKVM has multiple and you want a specific one

  /*****************
   * HELPERS
   *****************/
  const log = (...a) => console.log("[JetKVM Mods]", ...a);

  const addCSS = (css) => {
    if (typeof GM?.addStyle === "function") return GM.addStyle(css);
    const s = document.createElement("style");
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };

  const HIDE_ID = "us-hide-until-styled";
  const hideStyle = document.createElement("style");
  hideStyle.id = HIDE_ID;
  hideStyle.textContent = "html{visibility:hidden !important;}";
  (document.head || document.documentElement).appendChild(hideStyle);

  const reveal = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(HIDE_ID)?.remove();
    }));
  };

  /*****************
   * CSS TWEAKS + FAKE FULLSCREEN CSS
   *****************/
  addCSS(`
    /* Your existing tweaks */
    html, body { overscroll-behavior: none !important; }

    html {
      overflow: hidden !important;
      height: 100% !important;
      position: fixed !important;
    }

    body {
      overflow: auto !important;
      height: 100% !important;
      position: relative !important;
    }

    video {
      margin-top: 2px !important;
      border-radius: 23px !important;
      max-height: 100% !important;
      max-width: 100% !important;
      object-fit: contain !important;
    }

    .grid { min-height: calc(100vh - 90px) !important; }

    /* Fake fullscreen (no Safari fullscreen overlay / big X) */
    .us-fakefs-wrap.us-fakefs-on{
      position:fixed !important;
      inset:0 !important;
      width:100vw !important;
      height:100vh !important;
      z-index:2147483647 !important;
      background:#000 !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      padding:0 !important;
      margin:0 !important;
    }

    .us-fakefs-wrap.us-fakefs-on video{
      width:100% !important;
      height:100% !important;
      max-width:100% !important;
      max-height:100% !important;
      object-fit:contain !important;
      border-radius:0 !important;
      margin:0 !important;
    }

    body.us-fakefs-lock{
      overflow:hidden !important;
      position:fixed !important;
      width:100% !important;
      touch-action:none !important;
    }
  `);

  /*****************
   * VIEWPORT LOCK (prevents pinch zoom)
   *****************/
  function ensureViewportLocked() {
    const head = document.head || document.documentElement;
    let vp = head.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement("meta");
      vp.name = "viewport";
      head.appendChild(vp);
    }
    const content = vp.getAttribute("content") || "";
    if (!/user-scalable\s*=\s*no/i.test(content)) {
      vp.setAttribute("content", content ? `${content}, user-scalable=no` : "user-scalable=no");
    }
  }

  ensureViewportLocked();
  new MutationObserver(ensureViewportLocked).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  /*****************
   * FAKE FULLSCREEN TOGGLE
   *****************/
  function getTargetVideo() {
    // Prefer a playing/visible one if there are multiple
    const vids = [...document.querySelectorAll(VIDEO_SELECTOR)];
    if (!vids.length) return null;

    // try: visible first
    const visible = vids.find(v => {
      const r = v.getBoundingClientRect();
      return r.width > 50 && r.height > 50;
    });
    return visible || vids[0];
  }

  function ensureWrapped(video) {
    if (!video) return null;
    const p = video.parentElement;
    if (p && p.classList.contains("us-fakefs-wrap")) return p;

    const wrapper = document.createElement("div");
    wrapper.className = "us-fakefs-wrap";

    video.parentNode.insertBefore(wrapper, video);
    wrapper.appendChild(video);
    return wrapper;
  }

  function setFakeFullscreen(on) {
    const video = getTargetVideo();
    if (!video) return log("No <video> found to fullscreen.");

    // keep inline (prevents iOS video fullscreen behavior)
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("disablepictureinpicture", "");
    video.setAttribute("controlslist", "nofullscreen");

    const wrapper = ensureWrapped(video);
    wrapper.classList.toggle("us-fakefs-on", on);
    document.body.classList.toggle("us-fakefs-lock", on);

    log(on ? "Fake fullscreen ON" : "Fake fullscreen OFF");
  }

  function toggleFakeFullscreen() {
    const video = getTargetVideo();
    if (!video) return log("No <video> found to fullscreen.");
    const wrapper = ensureWrapped(video);
    setFakeFullscreen(!wrapper.classList.contains("us-fakefs-on"));
  }

  // Exit fake fullscreen if the user navigates or the tab loses visibility
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setFakeFullscreen(false);
  });

  /*****************
   * KEYBIND: CMD + SHIFT + F
   *****************/
  function isKeybind(e) {
    // Use e.key normalized to lowercase for letters
    return (
      e.metaKey === KEYBIND.meta &&
      e.shiftKey === KEYBIND.shift &&
      (e.key || "").toLowerCase() === KEYBIND.key
    );
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (!isKeybind(e)) return;

      // Don’t steal it when typing in inputs
      const t = e.target;
      const typing =
        t &&
        (t.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
      if (typing) return;

      e.preventDefault();
      e.stopPropagation();
      toggleFakeFullscreen();
    },
    true // capture: beat the app’s handlers
  );

  /*****************
   * REVEAL
   *****************/
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reveal, { once: true });
    window.addEventListener("load", reveal, { once: true });
  } else {
    reveal();
  }
})();
