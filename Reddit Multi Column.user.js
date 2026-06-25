// ==UserScript==
// @name         Reddit Multi Column
// @namespace    https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @version      0.4.0
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

    const MIN_WIDTH = 400;
    const COLUMNS = 4;

    const HGAP = 17;
    const VGAP = 12;

    const SETTLE_MS = 180;
    const MAX_HIDE_MS = 1200;
    const FADE_MS = 150;

    // Selectors used to locate feed items inside the feed container. Kept in
    // one place so they're easy to update when Reddit changes its DOM.
    const FEED_ITEM_SELECTOR = 'article, shreddit-post, shreddit-ad-post, faceplate-partial';

    let columns = COLUMNS;
    let cleanup = false;

    let parent = null;
    let currentPath = location.pathname;

    const cardIcon = () => {
        // Try multiple selectors – Reddit has changed the view-switcher element
        // name/attributes over time.
        const selectors = [
            'shreddit-sort-dropdown[header-text="View"]',
            'shreddit-view-nav',
            'shreddit-sort-dropdown',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            // If the component uses Shadow DOM, look inside it.
            const root = el.shadowRoot || el;
            const svg = root.querySelector('svg');
            if (svg) return svg;
        }
        return undefined;
    };
    const shouldClean = (icon) => icon === undefined ? false : icon.getAttribute('icon-name') !== "view-card-outline";

    let postMap = new Map();
    let nextSyntheticId = 0;

    const indexOfSmallest = function (a) {
        let lowest = 0;
        for (let i = 1; i < a.length; i++) {
            if (a[i] < (a[lowest] - 1)) lowest = i;
        }
        return lowest;
    };

    // --- Stable key for each feed item ------------------------------------
    // Reddit may or may not provide an aria-label, data-testid, or id on
    // articles. We try several attributes and fall back to a synthetic id
    // stamped on the element so that every item always gets a layout key.
    const stableKey = function(el) {
        if (el.dataset.rmcId) return el.dataset.rmcId;
        const candidate =
            el.getAttribute('aria-label') ||
            el.getAttribute('id') ||
            el.getAttribute('data-testid') ||
            el.getAttribute('data-fullname') ||
            el.getAttribute('data-post-id') ||
            el.querySelector('[data-post-id]')?.getAttribute('data-post-id') ||
            el.querySelector('a[href*="/comments/"]')?.getAttribute('href');
        if (candidate) {
            el.dataset.rmcId = candidate;
            return candidate;
        }
        const synth = `rmc-synth-${nextSyntheticId++}`;
        el.dataset.rmcId = synth;
        return synth;
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
            shreddit-feed > article,
            shreddit-feed > shreddit-post,
            shreddit-feed > shreddit-ad-post,
            shreddit-feed > faceplate-partial,
            shreddit-feed > faceplate-batch > article,
            shreddit-feed > faceplate-batch > shreddit-post,
            shreddit-feed > faceplate-batch > shreddit-ad-post,
            shreddit-feed > faceplate-batch > faceplate-partial {
                margin: 0 !important;
                box-sizing: border-box !important;
                contain: layout paint !important;
            }
            custom-feed-header {
                display: block !important;
                margin-left: 25px !important;
                margin-right: 25px !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
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
    let inLayout = false;
    const resizeObserver = new ResizeObserver(() => {
        // Avoid feedback loop: makeLayout repositions articles which triggers
        // ResizeObserver which calls requestLayout again, causing a blink.
        if (inLayout) return;
        requestLayout();
    });
    const observedArticles = new WeakSet();

    const observeArticleSize = function(article) {
        if (observedArticles.has(article)) return;
        observedArticles.add(article);
        resizeObserver.observe(article);
    };

    // --- Layout ------------------------------------------------------------

    // Strip width-constraining utility classes that Reddit may apply to any
    // ancestor of the feed. Instead of targeting one exact class name, we
    // remove anything that looks like a Tailwind fixed/max-width utility
    // (e.g. "m:w-[1120px]", "lg:max-w-[960px]"), which is more resilient to
    // Reddit changing the breakpoint values.
    const stripWidthConstraints = function(el) {
        if (!el) return;
        const toRemove = [...el.classList].filter(
            c => /(^|:)(w-\[|max-w-\[)/.test(c)
        );
        if (toRemove.length) el.classList.remove(...toRemove);
    };

    const makeLayout = function(changes = []) {
        if (cleanup) return;
        if (!parent || !parent.isConnected) return;

        inLayout = true;
        try {
        if (parent.style.position !== "relative") {
            const main = document.querySelector("main");
            if (main) main.style.maxWidth = "100%";
            const mainContainer = document.querySelector("div.main-container");
            if (mainContainer) {
                mainContainer.className = [...mainContainer.classList].filter(c => !c.includes(":grid-cols-")).join(" ");
            }
            const subgrid = document.querySelector("div.subgrid-container");
            stripWidthConstraints(subgrid);
            if (subgrid) {
                subgrid.style.maxWidth = "100%";
                subgrid.style.width = "100%";
            }
            const sidebar = document.getElementById("right-sidebar-container");
            if (sidebar) sidebar.style.display = "none";
            parent.style.position = "relative";
        }

        const containerWidth = parent.clientWidth;

        columns = Math.max(1, Math.floor((containerWidth - HGAP) / (MIN_WIDTH + HGAP)));

        const totalHGapPx = HGAP * (columns + 1);
        const colWidthPx = (containerWidth - totalHGapPx) / columns;

        const nodes = [...parent.querySelectorAll(FEED_ITEM_SELECTOR)];

        // Filter to only direct layout items (skip deeply nested elements
        // that happen to match the selector inside a shadow DOM etc.)
        const layoutNodes = nodes.filter(n => {
            let p = n.parentNode;
            // Accept items whose parent is the feed container or a
            // faceplate-batch directly inside it.
            while (p && p !== parent) {
                const tag = p.tagName ? p.tagName.toLowerCase() : '';
                if (tag === 'faceplate-batch') {
                    p = p.parentNode;
                    continue;
                }
                break;
            }
            return p === parent;
        });

        for (const article of layoutNodes) {
            const key = stableKey(article);

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

        for (const article of layoutNodes) {
            const key = stableKey(article);
            const entry = postMap.get(key) ?? { col: 0, top: tops[0] };
            const leftPx = HGAP + entry.col * (colWidthPx + HGAP);
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

        for (const batch of parent.querySelectorAll("faceplate-batch")) {
            if (!batch.style.height) {
                batch.style.height = [...batch.childNodes].reduce((h, c) => h + (c.clientHeight || 0), 0) + "px";
            }
        }
        } finally {
            inLayout = false;
        }
    };

    // Safari Smart Zoom (double-tap on a Magic Trackpad) is a visual-viewport
    // zoom — visualViewport.scale and window.innerWidth change, but the layout
    // viewport (parent.clientWidth in CSS pixels) does not, so there's nothing
    // for us to lay out differently.
    const vv = window.visualViewport;
    const isVvZoomedIn = () => vv ? vv.scale > 1.01 : false;

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

    let pageChangeTimer = null;
    const pageChange = new MutationObserver(() => {
        // Debounce: Reddit's feed generates many rapid childList mutations
        // (e.g. batch loading). Coalesce them into a single layout pass.
        if (pageChangeTimer) clearTimeout(pageChangeTimer);
        pageChangeTimer = setTimeout(() => {
            pageChangeTimer = null;
            requestLayout();
        }, 100);
    });
    const layoutSwitch = new MutationObserver(setLayout);

    window.addEventListener('resize', requestLayout);

    const disconnectPageObservers = function() {
        pageChange.disconnect();
        layoutSwitch.disconnect();
    };

    // --- Feed container discovery ------------------------------------------
    // Use a ranked list of strategies so that when Reddit changes its DOM we
    // still find the feed.  Each strategy returns the container element or
    // null.  The first non-null result wins.
    const findParentStrategies = [
        // Strategy 1: <shreddit-feed> custom element (current Reddit 2025+).
        () => document.querySelector('shreddit-feed'),

        // Strategy 2: legacy selector – an <article> followed by <hr> then
        // <faceplate-partial> (pre-2025 Reddit).  Return its parentNode.
        () => {
            const anchor = document.querySelector('article + hr + faceplate-partial');
            return anchor ? anchor.parentNode : null;
        },

        // Strategy 3: any container that holds multiple <article> children
        // (generic heuristic).  Walk up from the first article's parent and
        // pick the first ancestor that holds ≥2 articles.
        () => {
            const first = document.querySelector('main article');
            if (!first) return null;
            let el = first.parentNode;
            while (el && el !== document.body) {
                if (el.querySelectorAll(':scope > article, :scope > shreddit-post').length >= 2) return el;
                // Also check one level deeper (faceplate-batch wrappers).
                if (el.querySelectorAll('article, shreddit-post').length >= 2) return el;
                el = el.parentNode;
            }
            return null;
        },
    ];

    const findParent = function() {
        for (const strategy of findParentStrategies) {
            try {
                const result = strategy();
                if (result) return result;
            } catch (_) { /* strategy failed, try next */ }
        }
        return null;
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
            nextSyntheticId = 0;
            resizeObserver.disconnect();
            disconnectPageObservers();

            hideFeed();
            pageChange.observe(parent, { childList: true, subtree: true });

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
            // Parent hasn't changed – just ensure layout is up to date
            // without the destructive hide/reveal cycle that causes blinking.
            requestLayout();
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

    const appObserver = new MutationObserver(() => {
        // Only trigger navigation handling when the URL actually changed.
        if (location.pathname !== currentPath) {
            onNavigate();
        }
    });

    const observeApp = function() {
        const app = document.querySelector("shreddit-app");
        if (!app) {
            setTimeout(observeApp, 100);
            return;
        }
        appObserver.observe(app, { attributes: true });
    };

    let safetyNetTimer = null;
    const domSafetyNet = new MutationObserver(() => {
        if (!parent || !parent.isConnected) {
            // Debounce: avoid firing repeatedly for rapid DOM changes.
            if (safetyNetTimer) return;
            safetyNetTimer = setTimeout(() => {
                safetyNetTimer = null;
                if (!parent || !parent.isConnected) {
                    scheduleFeedSearch(2000);
                }
            }, 500);
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
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
