// ==UserScript==
// @name         MLB24ALL
// @version      1.7
// @run-at       document-start
// @description  Full-bleed <main>, overlay-friendly, ~5px shorter height
// @match        *://*/*
// @grant        GM.addStyle
// ==/UserScript==

(function() {
    'use strict';

    GM.addStyle(`
        /* Keep only <main> under <app-root> */
        app-root > :not(main) { display: none !important; }

        /* Root: no gaps, no background scroll */
        html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
            scrollbar-width: none; /* Firefox */
            -ms-overflow-style: none; /* IE and Edge */ 
        }
        
        html::-webkit-scrollbar , body::-webkit-scrollbar { /* Chrome, Safari, Opera */
  display: none; }


        /* Pin app-root to viewport edges */
        app-root {
            position: fixed !important;
            inset: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
            overflow: hidden !important;

        }

        /* Full-screen-ish <main> with internal scroll, 5px shorter */
        app-root main {
            position: fixed !important;
            top: 0 !important;
            left: 12px !important;
            max-width: calc(100dvw - 24px) !important;
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
            display: block !important;
            overflow: hidden !important; /* overlay-friendly scroll */
            overflow-x: auto !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior: contain !important;
        }
        
         app-root main header {
            padding-top: 0px;
            margin-top: 0px;
            position: relative !important;
            top: 0 !important;
            left: 0 !important;
            overflow: hidden !important;
            z-index: 2147483646 !important;
        }
        
        app-root main section {
            overflow: hidden !important;
            border-radius: 0 0 10px 10px !important;
        }
        
        app-root main footer {
            border-radius: 10px 10px 0 0 !important;
            position: fixed !important;
            width: 100%;
            max-width: calc(100dvw - 24px) !important;
            bottom: 0 !important;
            overflow: hidden !important;
            right: 12px !important;
            z-index: 2147483646 !important;
        }

        /* Ensure overlays still work */
        .cdk-overlay-container,
        .cdk-global-overlay-wrapper,
        .overlay-container,
        .modal-backdrop,
        .mat-overlay-container {
            z-index: 2147483647 !important;
            pointer-events: auto !important;
        }
    `);
})();