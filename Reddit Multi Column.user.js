// ==UserScript==
// @name         Reddit Multi Column
// @namespace    https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @version      0.3.8
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
    const MIN_WIDTH = 400;
    const COLUMNS = 4;

    const HGAP = 17;
    const VGAP = 12;

    const SETTLE_MS = 180;
    const MAX_HIDE_MS = 1200;
    const FADE_MS = 150;

    let columns = COLUMNS;
    let cleanup = false;

    let parent = null;
    let currentPath = location.pathname;

    const cardIcon = () => document?.querySelector('shreddit-sort-dropdown[header-text="View"]')?.shadowRoot?.querySelector('svg');
    const shouldClean = (icon) => icon === undefined ? false : icon.getAttribute('icon-name') !== "view-card-outline";

    let postMap = new Map();

    const indexOfSmallest = function (a) {
        let lowest = 0;
        for (let i = 1; i < a.length; i++) {
            if (a[i] < (a[lowest] - 1)) lowest = i;
        }
        return lowest;
    };

    // Reddit's <main> and the subgrid wrapper apply horizontal padding that
    // was pushing the feed container ~56px in from the viewport edge. That
    // padding was invisible to our layout math (we measured clientWidth of
    // the feed, not the viewport), so HGAP only added to it — making the
    // effective left/right outer spacing ~68px while the top/bottom stayed
    // at our 12px VGAP. Zeroing those outer paddings lets HGAP be the true
    // visible outer spacing.
    const injectResetStyles = function() {
        if (document.getElementById('rmc-margin-reset')) return;
        const style = document.createElement('style');
        style.id = 'rmc-margin-reset';
        style.textContent = `
            main {
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            div.subgrid-container {
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            shreddit-feed {
                padding: 0 !important;
                margin: 0 !important;
                box-sizing: border-box !important;
                display: block !important;
            }
            shreddit-feed article,
            shreddit-feed shreddit-ad-post,
            shreddit-feed faceplate-partial {
                margin: 0 !important;
                box-sizing: border-box !important;
            }
            custom-feed-header {
                display: block !important;
                margin-left: 25px !important;
                margin-right: 25px !important;
            }
        `;
        document.head.appendChild(style);
    };

    // --- Visibility management ---------------------------------------------
    let settleTimer = null;
    let hideDeadline = 0;
    let hidden = false;

    const hideFeed = function() {
        if (!parent) return;
        hidden = true;
        hideDeadline = performance.now() + MAX_HIDE_MS;
        parent.style.transition = 'none';
        parent.style.opacity = '0';
    };

    const revealFeed = function() {
        if (!parent || !hidden) return;
        hidden = false;
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        parent.style.transition = `opacity ${FADE_MS}ms ease-out`;
        parent.style.opacity = '1';
    };

    const bumpSettle = function() {
        if (!hidden) return;
        if (settleTimer) clearTimeout(settleTimer);
        const remaining = hideDeadline - performance.now();
        if (remaining <= 0) {
            revealFeed();
            return;
        }
        settleTimer = setTimeout(revealFeed, Math.min(SETTLE_MS, remaining));
    };

    // --- Per-article size tracking -----------------------------------------
    const resizeObserver = new ResizeObserver(() => {
        requestLayout();
    });
    const observedArticles = new WeakSet();

    const observeArticleSize = function(article) {
        if (observedArticles.has(article)) return;
        observedArticles.add(article);
        resizeObserver.observe(article);
    };

    // --- Layout ------------------------------------------------------------

    const makeLayout = function(changes = []) {
        if (cleanup) return;
        if (!parent || !parent.isConnected) return;

        if (parent.style.position !== "relative") {
            const main = document.querySelector("main");
            if (main) main.style.maxWidth = "100%";
            const mainContainer = document.querySelector("div.main-container");
            if (mainContainer) {
                mainContainer.className = [...mainContainer.classList].filter(c => !c.includes(":grid-cols-")).join(" ");
            }
            const subgrid = document.querySelector("div.subgrid-container");
            if (subgrid) subgrid.classList.remove("m:w-[1120px]");
            const sidebar = document.getElementById("right-sidebar-container");
            if (sidebar) sidebar.style.display = "none";
            parent.style.position = "relative";
        }

        const containerWidth = parent.clientWidth;

        columns = Math.max(1, Math.floor((containerWidth - HGAP) / (MIN_WIDTH + HGAP)));

        const totalHGapPx = HGAP * (columns + 1);
        const colWidthPx = (containerWidth - totalHGapPx) / columns;

        const nodes = [...parent.querySelectorAll("article, shreddit-ad-post, faceplate-partial").values()];

        for (const article of nodes) {
            const key = article.ariaLabel;
            if (key === null) continue;

            observeArticleSize(article);

            const h = article.offsetHeight;
            if (postMap.has(key)) {
                const post = postMap.get(key);
                if (post.height !== h) post.height = h;
            } else {
                postMap.set(key, { height: h, col: 0, top: 0 });
            }
        }

        let tops = Array(columns).fill(VGAP);
        for (const post of postMap.values()) {
            post.col = indexOfSmallest(tops);
            post.top = tops[post.col];
            tops[post.col] += post.height + VGAP;
        }

        const height = Math.max(...tops);
        if (height > VGAP) {
            parent.style.height = height + "px";
        }

        for (const article of nodes) {
            const key = article.ariaLabel;
            const entry = postMap.get(key) ?? { col: 0, top: tops[0] };
            const leftPx = HGAP + entry.col * (colWidthPx + HGAP);
            // Skip the setAttribute when the resolved layout for this article
            // hasn't moved. setAttribute("style", …) always invalidates style
            // even with an identical value, and re-running over hundreds of
            // articles mid-animation (e.g. Safari Smart Zoom snapping back to
            // 100%) is what causes the cutoff/flash on the way out.
            const layoutKey = cleanup ? '' : `${colWidthPx.toFixed(2)}|${entry.top}|${leftPx.toFixed(2)}`;
            if (article.dataset.rmcKey === layoutKey) continue;
            article.dataset.rmcKey = layoutKey;
            article.setAttribute(
                "style",
                cleanup
                    ? ""
                    : `position:absolute; width:${colWidthPx}px; top:${entry.top}px; left:${leftPx}px; margin:0; padding:0`
            );
        }

        for (const batch of parent.querySelectorAll("faceplate-batch").values()) {
            if (!batch.style.height) {
                batch.style.height = [...batch.childNodes].reduce((h, c) => h + c.clientHeight, 0) + "px";
            }
        }
    };

    // Safari Smart Zoom (double-tap on a Magic Trackpad) is a visual-viewport
    // zoom — visualViewport.scale and window.innerWidth change, but the layout
    // viewport (parent.clientWidth in CSS pixels) does not, so there's nothing
    // for us to lay out differently. The trigger that does reach us is
    // scrollend, which fires several times during the zoom because Safari pans
    // the document while zooming. Running makeLayout mid-gesture is what
    // produces the cutoff/flash on the way back out. Gating on vv.scale skips
    // those scrollend-driven layouts during the gesture; window resize and
    // ⌘+/⌘− leave vv.scale at 1, so they still flow through.
    const vv = window.visualViewport;
    const isVvZoomedIn = () => vv ? Math.abs(vv.scale - 1) > 0.01 : false;

    let layoutScheduled = false;
    function requestLayout() {
        if (isVvZoomedIn()) return;
        bumpSettle();
        if (layoutScheduled) return;
        layoutScheduled = true;
        requestAnimationFrame(() => {
            layoutScheduled = false;
            makeLayout();
        });
    }

    const setLayout = function(changes, observer) {
        const c = shouldClean(cardIcon());
        if (c !== cleanup) {
            cleanup = c;
            requestLayout();
        }
    };

    const pageChange = new MutationObserver(requestLayout);
    const layoutSwitch = new MutationObserver(setLayout);

    window.addEventListener('resize', requestLayout);
    window.addEventListener('scrollend', requestLayout);

    const disconnectPageObservers = function() {
        pageChange.disconnect();
        layoutSwitch.disconnect();
    };

    const findParent = function() {
        const anchor = document.querySelector("article + hr + faceplate-partial");
        return anchor ? anchor.parentNode : null;
    };

    let searchDeadline = 0;
    let searching = false;

    const searchForFeed = function() {
        const found = findParent();
        if (found && found !== parent) {
            parent = found;
            parent.style.position = "";
            parent.style.height = "";
            postMap = new Map();
            resizeObserver.disconnect();
            disconnectPageObservers();

            hideFeed();
            pageChange.observe(parent, { childList: true });

            const icon = cardIcon();
            if (icon) {
                layoutSwitch.observe(icon, { attributes: true });
            }

            requestLayout();
            settleTimer = setTimeout(revealFeed, SETTLE_MS);
            searching = false;
            return;
        }

        if (found && found === parent) {
            postMap = new Map();
            resizeObserver.disconnect();
            parent.style.position = "";
            parent.style.height = "";
            hideFeed();
            requestLayout();
            settleTimer = setTimeout(revealFeed, SETTLE_MS);
            searching = false;
            return;
        }

        if (performance.now() < searchDeadline) {
            requestAnimationFrame(searchForFeed);
        } else {
            searching = false;
        }
    };

    const scheduleFeedSearch = function(budgetMs = 8000) {
        searchDeadline = performance.now() + budgetMs;
        if (!searching) {
            searching = true;
            requestAnimationFrame(searchForFeed);
        }
    };

    const onNavigate = function() {
        const pathChanged = location.pathname !== currentPath;
        currentPath = location.pathname;

        if (pathChanged) {
            parent = null;
            disconnectPageObservers();
        }
        if (!parent || !parent.isConnected) {
            parent = null;
        }
        scheduleFeedSearch();
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

    const appObserver = new MutationObserver(onNavigate);

    const observeApp = function() {
        const app = document.querySelector("shreddit-app");
        if (!app) {
            setTimeout(observeApp, 100);
            return;
        }
        appObserver.observe(app, { attributes: true });
    };

    const domSafetyNet = new MutationObserver(() => {
        if (!parent || !parent.isConnected) {
            scheduleFeedSearch(2000);
        }
    });

    const start = function() {
        injectResetStyles();
        patchHistory();
        observeApp();
        const main = document.querySelector("main") || document.body;
        domSafetyNet.observe(main, { childList: true, subtree: true });
        scheduleFeedSearch();
    };

    if (document.body) {
        start();
    } else {
        window.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();