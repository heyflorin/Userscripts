// ==UserScript==
// @name         Reddit Multi Column
// @namespace    https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @version      1.0.0
// @description  Multi column layout for reddit redesign (with SPA nav support)
// @author       Can Altıparmak
// @homepageURL  https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @match        https://www.reddit.com/*
// @match        https://new.reddit.com/*
// @grant        none
// @downloadURL https://update.greasyfork.org/scripts/371490/Reddit%20Multi%20Column.user.js
// @updateURL https://update.greasyfork.org/scripts/371490/Reddit%20Multi%20Column.meta.js
// ==/UserScript==
/* jshint esversion: 6 */

(function() {
    'use strict';

    if (!/(^|\.)reddit\.com$/.test(location.hostname)) return;

    // ── Configuration ─────────────────────────────────────────────────────
    const MIN_COL_WIDTH = 400;
    const HGAP = 17;
    const VGAP = 12;

    // ── State ─────────────────────────────────────────────────────────────
    let currentPath = location.pathname;
    let active = false;       // true when multi-column CSS is applied
    let currentCols = 0;      // last column-count we set
    let cleanup = false;      // true → non-card view, disable multi-column

    // ── View-mode detection ───────────────────────────────────────────────
    const cardIcon = () => {
        const selectors = [
            'shreddit-sort-dropdown[header-text="View"]',
            'shreddit-view-nav',
            'shreddit-sort-dropdown',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const root = el.shadowRoot || el;
            const svg = root.querySelector('svg');
            if (svg) return svg;
        }
        return undefined;
    };
    const shouldClean = (icon) =>
        icon === undefined ? false : icon.getAttribute('icon-name') !== "view-card-outline";

    // ── CSS injection ─────────────────────────────────────────────────────
    // The entire multi-column layout is handled by the browser's native CSS
    // column engine.  Zero JS height reads, zero absolute positioning, zero
    // reflow loops.

    const injectStyles = function() {
        if (document.getElementById('rmc-styles')) return;
        const style = document.createElement('style');
        style.id = 'rmc-styles';
        style.textContent = `
            /* ── Widen the content area ───────────────────────────── */
            main {
                max-width: 100% !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            div.subgrid-container {
                max-width: 100% !important;
                width: 100% !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            #right-sidebar-container {
                display: none !important;
            }

            /* ── Feed becomes a CSS-column container ─────────────── */
            shreddit-feed.rmc-active {
                display: block !important;
                padding: ${VGAP}px ${HGAP}px !important;
                margin: 0 !important;
                box-sizing: border-box !important;
                column-gap: ${HGAP}px !important;
            }

            /* faceplate-batch wraps groups of posts; make it
               transparent to the column layout so individual posts
               flow independently across columns. */
            shreddit-feed.rmc-active > faceplate-batch {
                display: contents !important;
            }

            /* Individual posts: avoid breaking mid-post */
            shreddit-feed.rmc-active > article,
            shreddit-feed.rmc-active > shreddit-post,
            shreddit-feed.rmc-active > shreddit-ad-post,
            shreddit-feed.rmc-active > faceplate-batch > article,
            shreddit-feed.rmc-active > faceplate-batch > shreddit-post,
            shreddit-feed.rmc-active > faceplate-batch > shreddit-ad-post {
                break-inside: avoid !important;
                margin-bottom: ${VGAP}px !important;
                margin-top: 0 !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
            }

            /* Lazy-load sentinels span all columns so Reddit's
               IntersectionObserver still fires when the user scrolls
               to the bottom.  column-span:all forces a column break
               before/after, keeping batches above independent. */
            shreddit-feed.rmc-active > faceplate-partial {
                break-inside: avoid !important;
                column-span: all !important;
            }

            /* Custom feed header */
            custom-feed-header {
                display: block !important;
                margin-left: 25px !important;
                margin-right: 25px !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    // ── Width-constraint stripping ────────────────────────────────────────
    const stripWidthConstraints = function(el) {
        if (!el) return;
        const toRemove = [...el.classList].filter(
            c => /(^|:)(w-\[|max-w-\[)/.test(c)
        );
        if (toRemove.length) el.classList.remove(...toRemove);
    };

    // ── Column-count calculation ──────────────────────────────────────────
    // This is the ONLY layout work JS does — one style write per resize.

    const updateColumnCount = function() {
        const feed = document.querySelector('shreddit-feed');
        if (!feed) return;

        if (cleanup) {
            if (active) deactivateFeed(feed);
            return;
        }

        // One-time ancestor adjustments
        if (!active) {
            const mainContainer = document.querySelector('div.main-container');
            if (mainContainer) {
                mainContainer.className = [...mainContainer.classList]
                    .filter(c => !c.includes(':grid-cols-')).join(' ');
            }
            const subgrid = document.querySelector('div.subgrid-container');
            stripWidthConstraints(subgrid);
            feed.classList.add('rmc-active');
            active = true;
        }

        const width = feed.clientWidth || window.innerWidth;
        const cols = Math.max(1, Math.floor((width + HGAP) / (MIN_COL_WIDTH + HGAP)));
        if (cols !== currentCols) {
            currentCols = cols;
            feed.style.columnCount = String(cols);
        }
    };

    const deactivateFeed = function(feed) {
        if (!feed) feed = document.querySelector('shreddit-feed');
        if (feed) {
            feed.classList.remove('rmc-active');
            feed.style.columnCount = '';
        }
        active = false;
        currentCols = 0;
    };

    // ── Resize handling (debounced via rAF) ────────────────────────────────
    let resizeRaf = 0;
    window.addEventListener('resize', () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            updateColumnCount();
        });
    });

    // ── Feed discovery & activation ───────────────────────────────────────
    let feedObserver = null;

    const tryActivate = function() {
        const feed = document.querySelector('shreddit-feed');
        if (!feed) return false;
        injectStyles();
        updateColumnCount();
        return true;
    };

    // Watch for the feed element to appear (SPA navigation, lazy render).
    // Uses a single MutationObserver on document.body — lightweight because
    // it only watches childList (not attributes or subtree characterData).
    const waitForFeed = function() {
        if (tryActivate()) return;
        if (feedObserver) return; // already watching
        feedObserver = new MutationObserver(() => {
            if (tryActivate()) {
                feedObserver.disconnect();
                feedObserver = null;
            }
        });
        feedObserver.observe(document.body, { childList: true, subtree: true });
    };

    // ── View-mode observer ────────────────────────────────────────────────
    const layoutSwitch = new MutationObserver(() => {
        const c = shouldClean(cardIcon());
        if (c !== cleanup) {
            cleanup = c;
            updateColumnCount();
        }
    });

    const observeViewMode = function() {
        const icon = cardIcon();
        if (icon) layoutSwitch.observe(icon, { attributes: true });
    };

    // ── SPA navigation handling ───────────────────────────────────────────
    const onNavigate = function() {
        const pathChanged = location.pathname !== currentPath;
        currentPath = location.pathname;

        if (pathChanged) {
            deactivateFeed();
            layoutSwitch.disconnect();
        }

        waitForFeed();
        observeViewMode();
    };

    const patchHistory = function() {
        const origPush = history.pushState;
        const origReplace = history.replaceState;
        history.pushState = function() {
            const ret = origPush.apply(this, arguments);
            window.dispatchEvent(new Event('reddit-mc:locationchange'));
            return ret;
        };
        history.replaceState = function() {
            const ret = origReplace.apply(this, arguments);
            window.dispatchEvent(new Event('reddit-mc:locationchange'));
            return ret;
        };
        window.addEventListener('popstate', () => {
            window.dispatchEvent(new Event('reddit-mc:locationchange'));
        });
        window.addEventListener('reddit-mc:locationchange', onNavigate);
    };

    // Fallback: detect navigation via shreddit-app attribute changes
    const appObserver = new MutationObserver(() => {
        if (location.pathname !== currentPath) onNavigate();
    });

    const observeApp = function() {
        const app = document.querySelector('shreddit-app');
        if (!app) {
            setTimeout(observeApp, 100);
            return;
        }
        appObserver.observe(app, { attributes: true });
    };

    // ── Entry point ───────────────────────────────────────────────────────
    const start = function() {
        injectStyles();
        patchHistory();
        observeApp();
        observeViewMode();
        waitForFeed();
    };

    if (document.body) {
        start();
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
