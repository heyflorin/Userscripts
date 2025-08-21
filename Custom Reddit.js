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

    #main-content > shreddit-feed {
    display: block !important;
    column-count: 2 !important;
    column-gap: 2rem !important;
    column-fill: balance !important;
    -webkit-column-count: 2 !important;
    -webkit-column-gap: 2rem !important;
    -moz-column-count: 2 !important;
    -moz-column-gap: 1rem !important;
    }

    #main-content > shreddit-feed > article {
    break-inside: avoid !important;
    break-inside: avoid-column !important;
    -webkit-column-break-inside: avoid !important;
    page-break-inside: avoid !important;
    display: block !important;
    width: auto !important;
    max-width: 100% !important;
    }

    #main-content > shreddit-feed > hr {
        display: none !important;
    }

    #main-content > shreddit-feed > article {
        padding-top: 0px !important;
        margin-top: 0px !important;
        padding-bottom: 5px !important;
        margin-bottom: 8px !important;
        border-bottom: 1px solid !important;
        border-bottom-color: var(--color-neutral-border-weak) !important;
    }

    [devicetype="mobile"] #left-nav-drawer #left-sidebar {
    /*     max-height: 400px !important; */
        border-radius: 0 0 30px 0 !important;
    }

    #left-sidebar > nav > faceplate-tracker, #left-sidebar > nav > hr:nth-child(4),
    #right-sidebar-container
    {
        display: none !important;
    }

    body > shreddit-app > reddit-header-large > reddit-header-action-items > header > nav > div.pr-lg.flex.gap-xs.items-center.justify-start,
    body > shreddit-app > reddit-header-large > reddit-header-action-items > header > nav > div.pl-lg.gap-xs.flex.items-center.justify-end > div:nth-child(2) > span:nth-child(1),
    body > shreddit-app > reddit-header-large > reddit-header-action-items > header > nav > div.pl-lg.gap-xs.flex.items-center.justify-end > div:nth-child(2) > span:nth-child(2),
    body > shreddit-app > reddit-header-large > reddit-header-action-items > header > nav > div.pl-lg.gap-xs.flex.items-center.justify-end > div:nth-child(2) > span:nth-child(3)
    {
        visibility: hidden;
    }

    #subgrid-container > div.main-container {
        display: block !important;
    }

    body > shreddit-app > reddit-header-large {
        z-index: 97 !important;
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
