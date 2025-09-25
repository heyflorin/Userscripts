// ==UserScript==
// @name         Custom Reddit
// @version      1.0
// @description  Custom Reddit tweaks for the default UI
// @author       Florin Catalin Mehedinti
// @run-at       document-start
// @match        https://www.reddit.com/*
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

    #left-sidebar > nav > faceplate-tracker, #left-sidebar > nav > hr:nth-child(2) {
      display: none;
    }

    body > shreddit-app > reddit-header-large > reddit-header-action-items > header > nav > div.pe-lg.flex.gap-xs.items-center.justify-start, body > shreddit-app > reddit-header-large > reddit-header-action-items > header > nav > div.ps-lg.gap-xs.flex.items-center.justify-end > div:nth-child(2) > span:nth-child(1) > span {
      visibility: hidden;
    }

    body > shreddit-app > reddit-header-large {
      position: absolute !important;
    }

    #left-sidebar-container, #flex-left-nav-container, #flex-left-nav-container {
      top: 0px !important;
        z-index: 999;
        height: 100%;
    }

    #flex-left-nav-contents, #flex-left-nav-contents reddit-sidebar-nav {
        height: calc(100vw - 100%);
    }

    #right-sidebar-container {
        top: 25px !important;
        height: 100%;
        align-items: top !important;
        border-radius: 15px;
    }

    [pagetype="popular"] #right-sidebar-container, [pagetype="all"] #right-sidebar-container, [pagetype="home"] #right-sidebar-container {
        top: -5px !important;
    }

    [pagetype="post_detail"] #right-sidebar-container {
      display: none;
    }

    [pagetype="community"] #right-sidebar-container {
      padding-top: 25px !important;
        top: 0px !important;
    }

    div.legal-links {
      display: none;
    }

    #right-sidebar-contents > aside {
        padding-bottom: 0px;
    }

    [pagetype="explore"] #subgrid-container > div {
      display: flex;
    }

    [pagetype="explore"] #subgrid-container #main-content {
      min-width: 100%;
    }

    body > shreddit-app > alert-controller {
      top: 0px;
    }

    #subgrid-container {
      width: calc(100%) !important;
    }

    [pagetype="post_detail"] #subgrid-container {
      width: calc(100%) !important;
        margin-left: 35px;
    }

    #subgrid-container .main-container {
        grid-template-columns: minmax(0, 100%) minmax(0, 316px) !important;
    }

    [pagetype="post_detail"] #subgrid-container .main-container {
        grid-template-columns: minmax(0, 100%) minmax(0, 25px) !important;
    }

    #subgrid-container #main-content {
        min-width: 100% !important;
    }

    #left-sidebar > nav > div {
        display: none;
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
})();
