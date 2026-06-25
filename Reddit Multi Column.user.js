// ==UserScript==
// @name         Reddit Multi Column
// @namespace    https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @version      0.5.0
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

    // Selectors for actual post items that should be laid out in columns.
    // IMPORTANT: faceplate-partial is NOT included here — it is Reddit's
    // lazy-load sentinel and must remain in normal document flow so that
    // IntersectionObserver can trigger infinite scroll loading.
    const POST_ITEM_SELECTOR = 'article, shreddit-post, shreddit-ad-post';

    let columns = COLUMNS;
    let cleanup = false;

    let parent = null;
    let currentPath = location.pathname;

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
            shreddit-feed > faceplate-batch > article,
            shreddit-feed > faceplate-batch > shreddit-post,
            shreddit-feed > faceplate-batch > shreddit-ad-post {
                margin: 0 !important;
                box-sizing: border-box !important;
            }
            custom-feed-header {
                display: block !important;
                margin-left: 25px !important;
                margin-right: 25px !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    // --- Per-article size tracking -----------------------------------------
    let inLayout = false;
    let layoutCooldown = 0; // timestamp until which observer-triggered layouts are suppressed
    const LAYOUT_COOLDOWN_MS = 200;

    const resizeObserver = new ResizeObserver(() => {
        if (inLayout) return;
        if (performance.now() < layoutCooldown) return;
        requestLayout();
    });
    const observedArticles = new WeakSet();

    const observeArticleSize = function(article) {
        if (observedArticles.has(article)) return;
        observedArticles.add(article);
        resizeObserver.observe(article);
    };

    // --- Layout ------------------------------------------------------------

    const stripWidthConstraints = function(el) {
        if (!el) return;
        const toRemove = [...el.classList].filter(
            c => /(^|:)(w-\[|max-w-\[)/.test(c)
        );
        if (toRemove.length) el.classList.remove(...toRemove);
    };

    const makeLayout = function() {
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

        // Only select actual post items — NOT faceplate-partial (lazy-load sentinels)
        const nodes = [...parent.querySelectorAll(POST_ITEM_SELECTOR)];

        // Filter to only direct layout items (skip deeply nested elements)
        const layoutNodes = nodes.filter(n => {
            let p = n.parentNode;
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

        // Reset postMap to only contain currently-visible items.
        // This prevents stale entries from removed posts affecting layout.
        const currentKeys = new Set();
        for (const article of layoutNodes) {
            const key = stableKey(article);
            currentKeys.add(key);
            observeArticleSize(article);

            const h = article.offsetHeight;
            if (postMap.has(key)) {
                const post = postMap.get(key);
                if (post.height !== h) post.height = h;
            } else {
                postMap.set(key, { height: h, col: 0, top: 0 });
            }
        }

        // Remove entries that are no longer in the DOM
        for (const key of postMap.keys()) {
            if (!currentKeys.has(key)) postMap.delete(key);
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
            const layoutKey = `${colWidthPx.toFixed(2)}|${entry.top}|${leftPx.toFixed(2)}`;
            if (article.dataset.rmcKey === layoutKey) continue;
            article.dataset.rmcKey = layoutKey;
            article.style.position = 'absolute';
            article.style.width = colWidthPx + 'px';
            article.style.top = entry.top + 'px';
            article.style.left = leftPx + 'px';
            article.style.margin = '0';
        }

        // Ensure faceplate-partial (lazy-load sentinels) and faceplate-batch
        // wrappers are positioned at the bottom of the container so that
        // scrolling triggers Reddit's IntersectionObserver for infinite scroll.
        let bottomOffset = height;
        for (const partial of parent.querySelectorAll(':scope > faceplate-partial, :scope > faceplate-batch')) {
            partial.style.position = 'absolute';
            partial.style.top = bottomOffset + 'px';
            partial.style.left = '0';
            partial.style.width = '100%';
            partial.style.height = 'auto';
            const partialH = partial.offsetHeight || 100;
            bottomOffset += partialH;
        }
        if (bottomOffset > height) {
            parent.style.height = bottomOffset + 'px';
        }

        } finally {
            inLayout = false;
            layoutCooldown = performance.now() + LAYOUT_COOLDOWN_MS;
        }
    };

    const vv = window.visualViewport;
    const isVvZoomedIn = () => vv ? vv.scale > 1.01 : false;

    let layoutScheduled = false;
    let lastLayoutTime = 0;
    const MIN_LAYOUT_INTERVAL = 50; // minimum ms between layouts

    function requestLayout() {
        if (isVvZoomedIn()) return;
        if (layoutScheduled) return;
        layoutScheduled = true;
        requestAnimationFrame(() => {
            layoutScheduled = false;
            const now = performance.now();
            if (now - lastLayoutTime < MIN_LAYOUT_INTERVAL) return;
            lastLayoutTime = now;
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
    const pageChange = new MutationObserver((mutations) => {
        if (inLayout) return;
        if (performance.now() < layoutCooldown) return;

        // Only react to structural changes (new/removed nodes), not our own
        // style or attribute modifications on positioned articles.
        const hasStructuralChange = mutations.some(m => {
            if (m.type === 'childList') return true;
            // Ignore attribute changes on elements we've positioned
            if (m.type === 'attributes' && m.target instanceof Element && m.target.dataset.rmcKey) return false;
            return true;
        });
        if (!hasStructuralChange) return;

        if (pageChangeTimer) clearTimeout(pageChangeTimer);
        pageChangeTimer = setTimeout(() => {
            pageChangeTimer = null;
            requestLayout();
        }, 150);
    });
    const layoutSwitch = new MutationObserver(setLayout);

    window.addEventListener('resize', requestLayout);

    const disconnectPageObservers = function() {
        pageChange.disconnect();
        layoutSwitch.disconnect();
    };

    // --- Feed container discovery ------------------------------------------
    const findParentStrategies = [
        () => document.querySelector('shreddit-feed'),
        () => {
            const anchor = document.querySelector('article + hr + faceplate-partial');
            return anchor ? anchor.parentNode : null;
        },
        () => {
            const first = document.querySelector('main article');
            if (!first) return null;
            let el = first.parentNode;
            while (el && el !== document.body) {
                if (el.querySelectorAll(':scope > article, :scope > shreddit-post').length >= 2) return el;
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

            pageChange.observe(parent, { childList: true, subtree: true, attributes: false });

            const icon = cardIcon();
            if (icon) {
                layoutSwitch.observe(icon, { attributes: true });
            }

            requestLayout();
            searching = false;
            return;
        }

        if (found && found === parent) {
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
