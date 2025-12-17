// ==UserScript==
// @name         Hide Element by XPath
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Hides a specific element identified by XPath, even if it loads dynamically.
// @author       You
// @match        https://app.jetkvm.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // CONFIGURATION: Your XPath
  const targetXPath = "//html/body/div/div/div[2]/div";

  /**
   * Attempts to find the element via XPath and hide it.
   */
  function hideTarget() {
    const result = document.evaluate(
      targetXPath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );

    const element = result.singleNodeValue;

    // Only apply style if element exists and is not already hidden
    if (element && element.style.display !== 'none') {
      element.style.display = 'none';
      console.log('Userscript: Element hidden successfully.');
    }
  }

  // 1. INITIAL RUN: Attempt to hide immediately in case it's already there
  hideTarget();

  // 2. OBSERVER: Watch for changes in the page (dynamic loading)
  const observer = new MutationObserver((mutations) => {
    // For performance, we only re-check if nodes were actually added
    let shouldCheck = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldCheck = true;
        break;
      }
    }

    if (shouldCheck) {
      hideTarget();
    }
  });

  // Start observing the document body for added nodes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

})();
