// ==UserScript==
// @name         Reddit Multi Column
// @namespace    https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @version      0.3.21
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

// --- 0.3.21 ------------------------------------------------------------------
// Don't apply the grid on mixed feeds. Profile overview / comments / saved /
// upvoted / etc., post-detail pages, and search interleave comments with posts;
// the grid only positions the posts, so the comments (left in flow) ended up
// painted under the posts. Those feeds are now detected (by URL, plus a comment
// element backstop) and the script stands down, rendering Reddit natively. The
// page chrome we change for the grid (the <main> width cap and right sidebar)
// is now snapshotted and restored when standing down, so a profile isn't left
// stretched and sidebar-less. Card detection also tightened to require a real
// <shreddit-post> so a stray comment container can't be mistaken for a post.
// -----------------------------------------------------------------------------

// --- 0.3.20 ------------------------------------------------------------------
// Fixes columns shifting up while scrolling as new posts load. Two causes:
//   - Post keys weren't stable. Reddit adds/changes aria-label during
//     hydration, and getPostKey checked aria-label first, so a post could
//     silently change key on a later pass. Now posts are keyed by the stable
//     <shreddit-post> permalink/id, and the resolved key is cached on the
//     element so it can never flip for that element's lifetime.
//   - The every-pass prune dropped any entry missing that pass, so a post
//     Reddit briefly unmounted (or virtualized off-screen) lost its reserved
//     slot and its column collapsed upward. Pruning now happens only on
//     navigation (feed reset), not during scroll.
// -----------------------------------------------------------------------------

// --- 0.3.19 ------------------------------------------------------------------
// Four fixes on top of 0.3.18's robust keying:
//
// 1. LOADER NO LONGER BECOMES A CARD. 0.3.18 keyed every node (including the
//    faceplate-partial lazy-loader), so the pulsating loader got its own
//    masonry slot. Now only real posts (an <article> wrapping a <shreddit-post>,
//    plus <shreddit-ad-post>) go into the grid; loader/skeleton partials are
//    parked just below the grid where they still trigger loading on scroll but
//    are out of the card flow. Skeleton placeholders (which lack a
//    <shreddit-post>) are ignored entirely.
//
// 2. SYMMETRIC GAPS / NO DEAD SPACE UNDER CARDS. The advance used
//    article.offsetHeight, which includes the trailing separator/margin Reddit
//    renders after the post body — dead space below every card. We now measure
//    from the article's top to the bottom of the actual <shreddit-post>, which
//    trims that. HGAP/VGAP are collapsed into a single GAP so horizontal and
//    vertical spacing match (change GAP below to taste).
//
// 3. SNAPPIER. makeLayout no longer reads offsetHeight for every card on every
//    pass — heights are cached and only NEW cards are measured; a ResizeObserver
//    updates the few cards that actually change (1px threshold so hover borders
//    don't trigger a reflow). And the big one: the app-level observer used to
//    re-run the entire feed search (with an opacity flash + full relayout) on
//    EVERY attribute change on <shreddit-app>, which Reddit fires constantly
//    while browsing. onNavigate is now a no-op unless the path actually changes.
//
// 4. NO RE-ORDERING ON SCROLL. Column assignment is sticky: once a card lands in
//    a column it stays there. Only new cards get assigned (to the shortest
//    column), and a full reflow happens only when the column COUNT changes
//    (i.e. on resize). Scrolling/appending no longer shuffles existing cards.
// -----------------------------------------------------------------------------

(function() {
    'use strict';

    if (!/(^|\.)reddit\.com$/.test(location.hostname)) return;

    const MIN_WIDTH = 400;

    // Single symmetric gap, used for both the space between cards and the outer
    // margin on every side. (Was HGAP 17 / VGAP 12 — asymmetric.)
    const GAP = 16;

    const SETTLE_MS = 180;
    const MAX_HIDE_MS = 1200;
    const FADE_MS = 150;

    let columns = 0;
    let cleanup = false;

    let parent = null;
    let currentPath = location.pathname;

    let postMap = new Map();
    let rmcKeyCounter = 0;
    let lastColWidth = 0;

    const cardIcon = () => document?.querySelector('shreddit-sort-dropdown[header-text="View"]')?.shadowRoot?.querySelector('svg');
    const shouldClean = (icon) => icon === undefined ? false : icon.getAttribute('icon-name') !== "view-card-outline";

    // Per-post identity. This MUST be stable for an element's entire lifetime —
    // if a post's key changes between layouts, its column entry is dropped and
    // re-created, which collapses the gap in its old column (the "shift up").
    // Two defenses:
    //   1. Prefer the <shreddit-post> permalink/id — Reddit's actual stable post
    //      identity — over aria-label, which it adds/changes during hydration.
    //   2. Cache the resolved key on the element, so even if every attribute
    //      later churns, the same element always reports the same key. A genuine
    //      new element (e.g. a re-rendered post) has no cache and is re-keyed by
    //      its permalink, so it reclaims its original slot instead of jumping.
    const getPostKey = function(node, post) {
        if (node.__rmcK) return node.__rmcK;
        let key;
        post = post || (node.querySelector && node.querySelector('shreddit-post'));
        const permalink = post && post.getAttribute && post.getAttribute('permalink');
        if (permalink) key = 'p:' + permalink;
        else if (post && post.id) key = 'i:' + post.id;
        else {
            const label = node.getAttribute && node.getAttribute('aria-label');
            if (label) key = 'l:' + label;
            else if (node.id) key = 'e:' + node.id;
            else key = 'r:' + (++rmcKeyCounter);
        }
        node.__rmcK = key;
        return key;
    };

    // Card height for the masonry. For real posts, measure from the article's
    // top down to the bottom of the <shreddit-post> body — this excludes the
    // trailing separator/margin Reddit puts after the post (the "gap under each
    // card"). Falls back to offsetHeight for ads and anything without a post.
    const measureCard = function(node) {
        const inner = (node.tagName === 'ARTICLE' && node.querySelector)
            ? node.querySelector('shreddit-post')
            : null;
        if (inner) {
            const top = node.getBoundingClientRect().top;
            const bottom = inner.getBoundingClientRect().bottom;
            const h = Math.round(bottom - top);
            if (h > 0) return h;
        }
        return node.offsetHeight;
    };

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
    // the feed, not the viewport), so the gap only added to it. Zeroing those
    // outer paddings lets GAP be the true visible outer spacing. We also hide
    // any inter-post <hr> separators, which otherwise pile up at the top-left
    // once the posts are taken out of flow.
    //
    // Everything here is scoped under html.rmc-grid, a class we add only while
    // the grid is engaged (see applyChrome / standDown). That way a mixed feed
    // we've stood down on — a profile, comments, search — renders with Reddit's
    // native separators and spacing intact instead of our zeroed-out version.
    const injectResetStyles = function() {
        if (document.getElementById('rmc-margin-reset')) return;
        const style = document.createElement('style');
        style.id = 'rmc-margin-reset';
        style.textContent = `
            html.rmc-grid main {
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            html.rmc-grid div.subgrid-container {
                padding-left: 0 !important;
                padding-right: 0 !important;
            }
            html.rmc-grid shreddit-feed {
                padding: 0 !important;
                margin: 0 !important;
                box-sizing: border-box !important;
                display: block !important;
            }
            html.rmc-grid shreddit-feed hr {
                display: none !important;
            }
            html.rmc-grid shreddit-feed article,
            html.rmc-grid shreddit-feed shreddit-ad-post,
            html.rmc-grid shreddit-feed faceplate-partial {
                margin: 0 !important;
                box-sizing: border-box !important;
                /* Tell Safari each card is an isolated paint surface. Helps
                   it re-rasterize only the tiles that actually changed after
                   a visual zoom (Smart Zoom) instead of repainting the whole
                   tall feed region. */
                contain: layout paint !important;
            }
            html.rmc-grid custom-feed-header {
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

    // --- Per-card size tracking --------------------------------------------
    // Only NEW cards get measured in makeLayout; this observer keeps the cached
    // height fresh for the few cards that change after the fact (images
    // decoding, embeds expanding) without re-measuring the whole feed. The 1px
    // threshold ignores hover-driven micro-changes so hovering never reflows.
    let observedCards = new WeakSet();
    const resizeObserver = new ResizeObserver((entries) => {
        let changed = false;
        for (const e of entries) {
            const node = e.target;
            if (!node.isConnected) continue;
            const entry = postMap.get(getPostKey(node));
            if (!entry) continue;
            const h = measureCard(node);
            if (Math.abs(entry.height - h) > 1) {
                entry.height = h;
                changed = true;
            }
        }
        if (changed) requestLayout();
    });

    const observeCard = function(node) {
        if (observedCards.has(node)) return;
        observedCards.add(node);
        resizeObserver.observe(node);
    };

    const resetObserver = function() {
        resizeObserver.disconnect();
        observedCards = new WeakSet();
    };

    // --- Layout ------------------------------------------------------------

    // The grid is only correct for pure-post feeds. Profile overview / comments
    // / saved / upvoted / etc., post-detail pages, and search all interleave
    // comments (and other content) with posts; if we absolutely-position only
    // the posts there, the comments stay in flow and the two overlap. On those
    // feeds we stand down and let Reddit render natively.
    const isMixedFeed = function() {
        const path = location.pathname;
        if (/\/comments\//.test(path)) return true;        // post detail / profile comments
        if (/^\/search(\/|$|\?)/.test(path)) return true;  // search blends result types
        // Profile tabs: only the posts/submitted tab and custom feeds (/m/) are
        // pure posts; overview, comments, saved, upvoted, downvoted, hidden and
        // gilded all mix posts with comments.
        if (/^\/(user|u)\/[^/]+/.test(path) &&
            !/\/(submitted|posts)\/?$/.test(path) &&
            !/\/m\//.test(path)) return true;
        // Backstop for anything the URL rules miss: an actual comment element
        // present in the feed.
        if (parent && parent.querySelector('shreddit-comment, shreddit-profile-comment')) return true;
        return false;
    };

    // We widen Reddit's <main>, drop its two-column grid, and hide the right
    // sidebar to give the grid room. Snapshot exactly what we change so it can
    // be put back when the grid stands down (mixed feed / compact view) or when
    // the page chrome is swapped on navigation — otherwise the profile is left
    // stretched with no sidebar.
    let chromeState = null;
    const restoreChrome = function() {
        if (!chromeState) return;
        const s = chromeState;
        if (s.main) s.main.style.maxWidth = s.mainMaxWidth || "";
        if (s.container && s.containerClass != null) s.container.className = s.containerClass;
        if (s.subgrid && s.subgridHadWidth) s.subgrid.classList.add("m:w-[1120px]");
        if (s.sidebar) s.sidebar.style.display = s.sidebarDisplay || "";
        chromeState = null;
    };
    const applyChrome = function() {
        document.documentElement.classList.add('rmc-grid');
        const main = document.querySelector("main");
        // Already applied to the current chrome — nothing to do (no re-apply, so
        // no sidebar flicker when navigating between post feeds).
        if (chromeState && chromeState.main === main) return;
        // First run, or SPA replaced the chrome: revert the old snapshot (a
        // no-op on detached nodes) and take a fresh one.
        restoreChrome();
        const container = document.querySelector("div.main-container");
        const subgrid = document.querySelector("div.subgrid-container");
        const sidebar = document.getElementById("right-sidebar-container");
        chromeState = {
            main, mainMaxWidth: main ? main.style.maxWidth : "",
            container, containerClass: container ? container.className : null,
            subgrid, subgridHadWidth: subgrid ? subgrid.classList.contains("m:w-[1120px]") : false,
            sidebar, sidebarDisplay: sidebar ? sidebar.style.display : "",
        };
        if (main) main.style.maxWidth = "100%";
        if (container) container.className = [...container.classList].filter(c => !c.includes(":grid-cols-")).join(" ");
        if (subgrid) subgrid.classList.remove("m:w-[1120px]");
        if (sidebar) sidebar.style.display = "none";
    };

    // Strip our inline layout (compact view, mixed feed, or teardown) and make
    // sure the feed is left fully visible and unstyled.
    const clearLayout = function() {
        if (!parent) return;
        for (const node of parent.querySelectorAll('[data-rmc-key]')) {
            node.removeAttribute('style');
            delete node.dataset.rmcKey;
        }
        parent.style.position = "";
        parent.style.height = "";
        parent.style.opacity = "";
        parent.style.transition = "";
    };

    // Fully disengage: drop the grid CSS, put back the page chrome, and clear
    // our inline layout. Leaves the page exactly as Reddit would render it.
    const standDown = function() {
        document.documentElement.classList.remove('rmc-grid');
        restoreChrome();
        clearLayout();
    };

    const makeLayout = function() {
        if (!parent || !parent.isConnected) return;
        if (cleanup || isMixedFeed()) {
            standDown();
            return;
        }

        applyChrome();
        if (parent.style.position !== "relative") parent.style.position = "relative";

        const containerWidth = parent.clientWidth;
        const newColumns = Math.max(1, Math.floor((containerWidth - GAP) / (MIN_WIDTH + GAP)));
        const colWidthPx = (containerWidth - GAP * (newColumns + 1)) / newColumns;

        const columnsChanged = newColumns !== columns;
        const widthChanged = Math.abs(colWidthPx - lastColWidth) > 0.5;
        columns = newColumns;
        lastColWidth = colWidthPx;

        // One pass to classify the children. Real posts and ads are cards;
        // faceplate-partials are loaders (handled separately); skeleton
        // <article>s without a <shreddit-post> are neither and get ignored.
        const items = [];
        for (const node of parent.querySelectorAll("article, shreddit-ad-post, faceplate-partial")) {
            const tag = node.tagName;
            const isPartial = tag === 'FACEPLATE-PARTIAL';
            const isAd = tag === 'SHREDDIT-AD-POST';
            const post = (!isPartial && node.querySelector) ? node.querySelector('shreddit-post') : null;
            const isCard = isAd || (tag === 'ARTICLE' && !!post);
            items.push({ node, isPartial, isCard, key: isCard ? getPostKey(node, post) : null });
        }

        // Seed new cards / refresh measurements. On scroll, only brand-new cards
        // are measured; existing heights come from cache. On resize (width
        // change) every card is re-measured since its rendered height changes.
        // We deliberately do NOT prune entries for posts missing this pass: a
        // post that's momentarily absent (mid re-render) or unmounted by Reddit's
        // virtualization must keep its reserved slot, otherwise the cards below
        // it in that column collapse upward — the shift you saw. With stable
        // cached keys a re-rendered post reclaims its existing entry, so the map
        // tracks the feed without churn, and it resets on navigation
        // (searchForFeed), which bounds it per feed.
        const remeasure = columnsChanged || widthChanged;
        for (const it of items) {
            if (!it.isCard) continue;
            observeCard(it.node);
            const existing = postMap.get(it.key);
            if (!existing) {
                postMap.set(it.key, { height: measureCard(it.node), col: -1, top: 0 });
            } else if (remeasure) {
                existing.height = measureCard(it.node);
            }
        }

        // Sticky columns: only (re)assign a column to a card that doesn't have a
        // valid one. A column-count change invalidates all of them (true reflow,
        // resize only); otherwise existing cards keep their column so scrolling
        // and appends never shuffle them between columns.
        if (columnsChanged) {
            for (const p of postMap.values()) p.col = -1;
        }
        const tops = Array(columns).fill(GAP);
        for (const p of postMap.values()) {
            if (p.col < 0 || p.col >= columns) p.col = indexOfSmallest(tops);
            p.top = tops[p.col];
            tops[p.col] += p.height + GAP;
        }
        const gridHeight = tops.length ? Math.max(...tops) : GAP;

        // Position the cards. The layoutKey memo skips setAttribute when a card
        // hasn't moved — so a layout where nothing changed writes nothing, which
        // is what keeps scroll cheap and flash-free.
        for (const it of items) {
            if (!it.isCard) continue;
            const p = postMap.get(it.key);
            if (!p) continue;
            const leftPx = GAP + p.col * (colWidthPx + GAP);
            const layoutKey = `${colWidthPx.toFixed(2)}|${p.top}|${leftPx.toFixed(2)}`;
            if (it.node.dataset.rmcKey === layoutKey) continue;
            it.node.dataset.rmcKey = layoutKey;
            it.node.setAttribute(
                "style",
                `position:absolute; width:${colWidthPx}px; top:${p.top}px; left:${leftPx}px; margin:0; padding:0`
            );
        }

        // Park loaders below the grid, out of the card flow. A partial that has
        // already loaded real posts is left static so those posts anchor to the
        // feed; a pure loader/skeleton is pinned just under the last card, where
        // scrolling to the bottom still reaches it to trigger the next page.
        let bottom = gridHeight;
        for (const it of items) {
            if (!it.isPartial) continue;
            const node = it.node;
            if (node.querySelector('shreddit-post')) {
                if (node.dataset.rmcKey !== 'wrap') {
                    node.dataset.rmcKey = 'wrap';
                    node.removeAttribute('style');
                }
                continue;
            }
            const lh = node.offsetHeight || 0;
            const lkey = `loader|${bottom}|${colWidthPx.toFixed(2)}`;
            if (node.dataset.rmcKey !== lkey) {
                node.dataset.rmcKey = lkey;
                node.setAttribute(
                    "style",
                    `position:absolute; top:${bottom}px; left:${GAP}px; width:${colWidthPx}px; margin:0; padding:0`
                );
            }
            if (lh) bottom += lh + GAP;
        }

        if (bottom > GAP) parent.style.height = bottom + "px";

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
    // Only bail on zoom-IN (Safari Smart Zoom). Don't gate on zoom-out, since
    // some Safari configs report initial scale below 1 and we'd never lay out.
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

    const pageChange = new MutationObserver(requestLayout);
    const layoutSwitch = new MutationObserver(setLayout);

    window.addEventListener('resize', requestLayout);
    window.addEventListener('scrollend', requestLayout);

    const disconnectPageObservers = function() {
        pageChange.disconnect();
        layoutSwitch.disconnect();
    };

    // Anchor on the post's actual parent. The old selector
    // ("article + hr + faceplate-partial") assumed a specific separator/loader
    // sibling chain around posts; when Reddit changes those siblings the anchor
    // vanishes. Finding any post inside the feed and using its parentElement is
    // resilient to that, and querySelectorAll on the returned container still
    // collects posts even if they're nested a level deeper.
    const findParent = function() {
        const article = document.querySelector("shreddit-feed article")
                     || document.querySelector("article");
        return article ? article.parentElement : null;
    };

    let searchDeadline = 0;
    let searching = false;

    // Attach to a feed. For a mixed feed we never hide or position it — just
    // keep it visible and let makeLayout leave it native; for a pure-post feed
    // we hide, lay out, then reveal once settled.
    const engageFeed = function(found, isNew) {
        parent = found;
        parent.style.position = "";
        parent.style.height = "";
        postMap = new Map();
        columns = 0;
        lastColWidth = 0;
        resetObserver();
        if (isNew) {
            disconnectPageObservers();
            pageChange.observe(parent, { childList: true });
            const icon = cardIcon();
            if (icon) layoutSwitch.observe(icon, { attributes: true });
        }
        const mixed = isMixedFeed();
        if (mixed) {
            standDown();
            revealFeed();
        } else {
            hideFeed();
        }
        requestLayout();
        if (!mixed) settleTimer = setTimeout(revealFeed, SETTLE_MS);
    };

    const searchForFeed = function() {
        const found = findParent();
        if (found) {
            engageFeed(found, found !== parent);
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

    // Only react to genuine navigation. Reddit fires attribute changes on
    // <shreddit-app> constantly while browsing; without this guard each one
    // re-ran the whole feed search (opacity flash + full relayout), which is a
    // big part of why the page felt slow. When the path hasn't changed and the
    // feed is still attached, do nothing.
    const onNavigate = function() {
        const pathChanged = location.pathname !== currentPath;
        if (!pathChanged && parent && parent.isConnected) return;

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
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();