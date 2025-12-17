// ==UserScript==
// @name         JetKVM Mods
// @version      1.0
// @description  Custom tweaks JetKVM web interface
// @author       Florin Catalin Mehedinti
// @run-at       document-start
// @match        https://app.jetkvm.com/*
// @grant        GM.addStyle
// ==/UserScript==

(function () {
  // 1) Hide ASAP to avoid flash
  const HIDE_ID = "us-hide-until-styled";
  const hide = document.createElement("style");
  hide.id = HIDE_ID;
  hide.textContent = "html{visibility:hidden !important;}";
  // Use <html> if <head> not ready yet
  (document.head || document.documentElement).appendChild(hide);

  // 2) GM_addStyle wrapper with fallback
  const addCSS = (css) => {
    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }
    if (typeof GM !== "undefined" && typeof GM.addStyle === "function") {
      GM.addStyle(css);
      return;
    }
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  };

  // 3) Your CSS (inline here; or assemble dynamically)
  const CSS = `

    html, body {
      overscroll-behavior: none !important;
    }

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
      border-radius: 23px  !important;
      max-height: 100%  !important;
      max-width: 100%  !important;
      object-fit: contain  !important;
    }

    .grid {
      min-height: calc(100vh - 90px)  !important;
    }

  `;

  // 4) Run early AND also after DOM is ready (covers both timings)
  // Early pass (document-start)
  addCSS(CSS);

  const reveal = () => {
    // Give the browser a tick to apply styles before reveal
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(HIDE_ID);
        if (el) el.remove();
      });
    });
  };

  // If DOM is already interactive/complete, reveal now; else wait
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      // Optional: add more late CSS here if needed
      // addCSS(moreCSS);
      reveal();
    });
    // Safety: if something delays DOMContentLoaded, still reveal at window load
    window.addEventListener("load", reveal, { once: true });
  } else {
    reveal();
  }

  check();

  const obs = new MutationObserver(check);
  obs.observe(document.head, { childList: true });

  function check() {
    (document.querySelectorAll('meta[name="viewport"]') ||
      [document.head.appendChild(Object.assign(
        document.createElement("meta"),
        { name: "viewport" }
      ))]).forEach(vp => {
        if (!vp.content.includes('user-scalable=no')) vp.content = vp.content ?
          `${vp.content}, user-scalable=no` :
          'user-scalable=no';
      });
  }

})();
