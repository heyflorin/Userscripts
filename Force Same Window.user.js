// ==UserScript==
// @name         GLKVM Same Tab
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Redirects new-window navigations to current tab
// @match        *://www.glkvm.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

// Inject directly into the PAGE context (not the userscript sandbox)
const s = document.createElement('script');
s.textContent = `(function() {

    // 1. Override window.open
    window.open = function(url) {
        if (url) {
            console.log('[GLKVM] window.open intercepted:', url);
            location.href = url;
        }
        return window;
    };

    // 2. Override HTMLAnchorElement click — catch programmatic <a target="_blank"> clicks
    const origClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function() {
        if (this.tagName === 'A' && this.href && this.target && this.target !== '_self') {
            console.log('[GLKVM] anchor click intercepted:', this.href);
            location.href = this.href;
            return;
        }
        return origClick.call(this);
    };

    // 3. Intercept dispatchEvent with synthetic click events on anchors
    const origDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function(event) {
        if (event.type === 'click' && this.tagName === 'A' && this.href && this.target && this.target !== '_self') {
            console.log('[GLKVM] dispatchEvent click intercepted:', this.href);
            location.href = this.href;
            return true;
        }
        return origDispatch.call(this, event);
    };

    console.log('[GLKVM Same Tab] Injected into page context');

})()`;
document.documentElement.prepend(s);