// ==UserScript==
// @name         JetKVM - CSS Mods
// @version      1.1
// @downloadURL  https://github.com/heyflorin/Userscripts/blob/main/JetKVM%20-%20UI%20Mods.user.js
// @description  Custom tweaks JetKVM web interface
// @author       Florin Catalin Mehedinti
// @run-at       document-start
// @match        https://app.jetkvm.com/v/*/devices/*
// @grant        GM.addStyle
// ==/UserScript==

(() => {
  "use strict";

  // Hide ASAP to avoid a flash of unstyled layout
  const HIDE_ID = "us-hide-until-styled";
  const hideStyle = document.createElement("style");
  hideStyle.id = HIDE_ID;
  hideStyle.textContent = "html{visibility:hidden !important;}";
  (document.head || document.documentElement).appendChild(hideStyle);

  // Minimal style injection (GM.addStyle if available; otherwise <style>)
  const addCSS = (css) => {
    if (typeof GM?.addStyle === "function") return GM.addStyle(css);
    const s = document.createElement("style");
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  };

  addCSS(`
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
      border-radius: 20px !important;
      max-height: 100% !important;
      object-fit: contain !important;
    }

	.grid { min-height: calc(100vh - 90px) !important; }
  `);

  // Ensure viewport disallows pinch zoom (if JetKVM adds/changes it later)
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

  // Reveal once styles have had a chance to apply
  const reveal = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(HIDE_ID)?.remove();
    }));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reveal, { once: true });
    window.addEventListener("load", reveal, { once: true });
  } else {
    reveal();
  }
})();
