// ==UserScript==
// @name         JetKVM UI Modifications - Hide various elements by XPath
// @namespace    http://tampermonkey.net/
// @version      1.2
// @downloadURL  https://raw.githubusercontent.com/heyflorin/Userscripts/refs/heads/main/JetKVM%20-%20Hide%20Elements.user.js
// @description  Hides elements identified by XPath, including dynamically loaded nodes and other customizations.
// @match        https://app.jetkvm.com/v/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  // Add/remove XPaths here.
  const XPATHS = [
    "//html/body/div/div/div[2]/div",
    "//html/body/div/div/div[2]/div[2]/div/div",
    "//html/body/div/div/div[2]/div[2]/div/div[3]/div",
  ];

  const log = (...args) => console.log("[HideXPath]", ...args);

  function firstByXPath(xpath, root = document) {
    try {
      return document.evaluate(
        xpath,
        root,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
    } catch (e) {
      log("Bad XPath:", xpath, e);
      return null;
    }
  }

  function hideByXPaths(xpaths) {
    let hiddenCount = 0;

    for (const xpath of xpaths) {
      const el = firstByXPath(xpath);
      if (!el) continue;

      // Avoid redoing work if we already hid it.
      if (el.dataset.usHiddenByXpath === "1") continue;

      el.style.setProperty("display", "none", "important");
      el.dataset.usHiddenByXpath = "1";
      hiddenCount++;
    }

    if (hiddenCount) log(`Hidden ${hiddenCount} element(s).`);
  }

  // Initial pass
  hideByXPaths(XPATHS);

  // Watch for dynamically added content; throttle to one pass per animation frame.
  let scheduled = false;
  const observer = new MutationObserver((mutations) => {
    if (scheduled) return;

    // Only react if something was added (cheap filter).
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          hideByXPaths(XPATHS);
        });
        break;
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
