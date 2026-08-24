// ==UserScript==
// @name         Reddit Multi Column
// @namespace    https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @version      0.3.29
// @description  Multi column layout for reddit redesign (with SPA nav support)
// @author       Can Altıparmak
// @homepageURL  https://gist.github.com/c6p/463892bb243f611f2a3cfa4268c6435e
// @match        https://www.reddit.com/*
// @match        https://new.reddit.com/*
// @grant        none
// @run-at       document-start
// @downloadURL https://update.greasyfork.org/scripts/371490/Reddit%20Multi%20Column.user.js
// @updateURL https://update.greasyfork.org/scripts/371490/Reddit%20Multi%20Column.meta.js
// ==/UserScript==
/* jshint esversion: 6 */

// --- 0.3.29 ------------------------------------------------------------------
// Reddit redesigned its page grid and the script silently stood down on every
// page, on every screen size — "not working" with no error. Two independent
// breaks, found by running the script against the live hydrated site:
//
// 1. THE TOO-NARROW CHECK MEASURED THE WRONG WIDTH. Reddit's main-container
//    now caps the content column at 756px (grid-cols-[minmax(0,756px)_...]),
//    so the feed's NATIVE clientWidth is ~732px even on a 1600px-wide screen.
//    isTooNarrow() measured that native width, computed a single column, and
//    permanently stood down — but the whole point of applyChrome is to widen
//    <main> to 100% before the grid lays out, so the decision must be based
//    on the width the feed WOULD have after the chrome rewrite. isTooNarrow
//    now measures the engaged feed when the grid is up, and otherwise the
//    main-container (which spans content + right sidebar — exactly the space
//    applyChrome unlocks), falling back to window.innerWidth. On phones /
//    portrait tablets the container is genuinely narrow, so the mobile
//    stand-down behavior is unchanged.
//
// 2. REDDIT RENAMED ITS VIEW-SWITCHER ICONS. The card/compact detector
//    compared the View dropdown's icon-name against "view-card-outline";
//    the icon set was renamed and card view is now "card" (selected state
//    "card-fill", compact is "classic"). The old comparison read card view
//    as "not card" — one attribute flicker on that icon and cleanup mode
//    stood the grid down for good. The check now accepts any icon-name
//    containing "card", old names and new.
// -----------------------------------------------------------------------------

// --- 0.3.28 ------------------------------------------------------------------
// Fixes the persistent gap that appeared between the top of the viewport and
// Reddit's header on iPad after scrolling all the way back up (or overscrolling
// to refresh). The header is position:fixed top-0, so no amount of ordinary
// scrolling can open space above it — the gap is iOS Safari's rubber-band
// snap-back being ABANDONED: during a top overscroll window.scrollY goes
// negative and even fixed elements ride along; if the document's layout
// changes while the snap-back animation is in flight, WebKit can drop the
// animation and leave the page permanently settled at a negative offset
// (everything, header included, shifted down) until the next scroll.
//
// Scrolling back to the top is exactly when this script produces such layout
// changes: images near the top finish decoding as they scroll into view,
// ResizeObserver refreshes card heights, and makeLayout rewrites card
// positions and the masonry container height — a document-height change in
// the middle of the bounce.
//
// Two defenses:
//   1. PREVENT: requestLayout/makeLayout never write to the DOM while the
//      page is over-scrolled past the top (scrollY < 0, checked again at
//      rAF time); the deferred layout retries every 150ms until the bounce
//      is over.
//   2. HEAL: if the offset is left SETTLED negative — no finger down, no
//      scroll events for 400ms — the snap-back evidently died (whether we
//      or Reddit's own late DOM work killed it), so it's forced manually
//      with a 1px scroll jiggle (scrollTo(0,1) then scrollTo(0,0); the
//      plain scrollTo(0,0) alone doesn't always re-clamp the viewport).
// -----------------------------------------------------------------------------

// --- 0.3.27 ------------------------------------------------------------------
// The stacked flash on tapping a post SURVIVED 0.3.26 on iPad. Root cause,
// reproduced in a mock-shreddit harness: every fix since 0.3.23 assumed the
// only way Reddit starts an SPA navigation is by calling history.pushState on
// the history INSTANCE — the one call our patch intercepts synchronously. It
// isn't. Two mechanisms bypass it completely:
//
//   - History.prototype.pushState.call(history, ...) — dispatching through
//     the prototype never reads the instance property, so an instance-level
//     wrapper is invisible to it (some routers do this deliberately to dodge
//     monkey-patches);
//   - the Navigation API (navigation.navigate(); Safari 18.4+, so current
//     iPadOS) — no pushState call happens at all.
//
// Either way the URL changes with no event reaching us. The next incidental
// layout trigger (any feed DOM mutation) runs makeLayout, which reads
// location.pathname LIVE, sees /comments/, and stands the grid down — with no
// veil up and no suppression armed, un-gridding the still-visible feed into
// the stacked flash. The late <shreddit-app> attribute fallback then finally
// runs onNavigate, hundreds of ms after the paint. In the harness this showed
// as ~280ms of visible stacked feed for the prototype-call and Navigation-API
// routes and zero for plain pushState — matching "works in theory, still
// flashes on the iPad".
//
// Fixes, layered so no navigation mechanism is left uncovered:
//
// 1. PATCH History.prototype (not the instance), so prototype-dispatched
//    pushState/replaceState are caught too.
// 2. LISTEN TO THE NAVIGATION API where present: 'navigate' fires
//    synchronously at navigation start (before the URL commits) and raises
//    the veil + remembers the gridded feed; 'currententrychange' fires right
//    after the URL updates and drives onNavigate, whatever initiated the
//    navigation.
// 3. VEIL ON THE TAP ITSELF: a document-level capture-phase click listener
//    raises the veil for any same-origin, path-changing link activation —
//    ahead of Reddit's router, whatever it does. (Modified clicks, new-tab
//    targets and downloads are skipped; a navigation that never happens is
//    mopped up by the veil's safety timeout.)
// 4. STALE-PATH GUARD, the structural backstop: requestLayout/makeLayout now
//    route through onNavigate whenever location.pathname no longer matches
//    the path we last processed, instead of laying out (and standing down)
//    against a navigation we never heard about. Even a mechanism none of the
//    hooks above cover can no longer reach standDown before onNavigate runs.
// 5. LINGERING-FEED BACKSTOP: standing down a feed we were actively gridding
//    because the path is now a post-detail page can only mean the previous
//    feed is lingering through a swap — suppress and hide it uncondition-
//    ally rather than trusting the priorFeed identity check alone.
// 6. STARTUP CRASH FIX: at true document-start document.documentElement can
//    still be null (it is in Chromium userscript engines; WebKit guarantees
//    it). injectResetStyles/showVeil then threw and the WHOLE script silently
//    died for the page. Bootstrap now waits for <html> to exist.
// -----------------------------------------------------------------------------

// --- 0.3.26 ------------------------------------------------------------------
// Closes the two remaining "old layout paints before the grid" windows on
// iPad (and any slow device):
//
// 1. FRESH LOADS WERE NEVER COVERED. The 0.3.25 veil only went up on SPA
//    navigations (onNavigate); on a refresh / first load nothing hid the
//    feed — and the script didn't even run until document-end — so the
//    native stacked layout was always visible until the grid engaged. The
//    script now runs at document-start (@run-at) and raises the veil (CSS
//    rule + <html> class) synchronously before Reddit paints anything,
//    width-gated exactly like the navigation veil. The history patch and the
//    feed search also start immediately instead of waiting for the DOM to be
//    ready, so the grid engages at the earliest possible frame; only the
//    safety-net observer still waits for <body>.
//
// 2. THE VEIL COULD EXPIRE BEFORE REDDIT RENDERED. The veil's only lifetime
//    was the fixed MAX_HIDE_MS (1.2s) safety timeout, but on iPad Reddit
//    routinely takes longer than that to render a feed (cold hydration, or
//    the SPA swap on back-navigation). The veil then lifted while the feed
//    search was still running, and the freshly-rendered stacked feed painted
//    until the grid caught up — the "resets to the original layout before
//    reapplying" flash. The search loop now re-arms the veil timer on every
//    frame while it is actively hunting — and only if the veil is still up,
//    so an expired or deliberately-lifted veil is never re-applied — which
//    makes the safety timeout count from the END of the search rather than
//    its start. If the search exhausts its budget without finding a feed,
//    the veil is lifted explicitly, so a feed-less page can never sit
//    veiled.
// -----------------------------------------------------------------------------

// --- 0.3.25 ------------------------------------------------------------------
// Reworks the iOS / iPadOS stacked-flash fix. (Reverts the abandoned 0.3.24,
// which marked each gridded feed with a durable flag and suppressed on that:
// the flag was never cleared, so when Reddit REUSED a feed DOM node for a later
// page the script kept the reused node hidden — blanking content and leaving
// only the left rail. And it still flashed, because it only ever hid the
// PREVIOUS feed, never a freshly-rendered one.)
//
// New approach — a declarative "navigation veil" instead of per-node bookkeeping:
//
// 1. THE VEIL. A class (rmc-veil) is added to <html> SYNCHRONOUSLY the instant a
//    wide-screen SPA navigation begins (in onNavigate, which runs from the
//    patched pushState/replaceState/popstate). While it's set, a single CSS rule
//    hides EVERY <shreddit-feed> (opacity only — IntersectionObserver lazy
//    loading still runs). That covers both the lingering previous feed AND any
//    feed Reddit renders fresh on the new page (the back-navigation flash that
//    per-node hiding could never catch, since the node doesn't exist yet). It's
//    lifted on the first real reveal, and unconditionally after MAX_HIDE_MS, so a
//    feed can never get stuck invisible. Gated on viewport width, so phones /
//    portrait tablets — where we stay fully native — are never veiled.
//
// 2. PRIOR-FEED MEMORY ACROSS A push→replace PAIR. Reddit opens a post with a
//    pushState immediately followed by a replaceState to the canonical permalink
//    — two path changes in one task. The first nulls `parent`; the old code then
//    overwrote priorFeed with null on the second, so it forgot which feed it was
//    gridding and revealed it un-gridded. priorFeed is now only refreshed when a
//    feed is actually held, so it survives the pair and the post-detail feed
//    stays correctly suppressed (hidden) past the veil.
//
// No durable per-node state, no extra chrome rewriting (so the left rail is left
// alone), and the veil is width-gated so native mode is untouched.
// -----------------------------------------------------------------------------

// --- 0.3.23 ------------------------------------------------------------------
// Fixes a brief flash on iOS / iPadOS where the multi-column feed collapses to
// a single stacked column for a moment when you tap a post, before the post
// page renders.
//
// Cause: tapping a post is an SPA navigation to a /comments/ post-detail page.
// Reddit's content swap is slow on iOS/iPadOS, so the previous (gridded) feed
// lingers in the DOM. Our re-search found that lingering feed, saw the new path
// was a post detail (a "mixed" feed), and stood the grid down — which un-grids
// the still-visible feed into a stacked column right before it's replaced. On
// desktop the swap is fast enough that the un-gridded frame never shows.
//
// Fix: recognise that lingering previous feed (the node we were gridding,
// re-found while the path is now a /comments/ detail page) and keep it HIDDEN
// instead of revealing it while it's stood down. There's no feed to display on
// a post-detail page anyway — the post and comments render elsewhere — so the
// node simply stays invisible until Reddit removes it (or it's re-gridded and
// revealed on back-navigation). No stacked frame ever paints.
// -----------------------------------------------------------------------------

// --- 0.3.22 ------------------------------------------------------------------
// Fixes the broken left nav on iOS / iPadOS (Home, Popular, News, Explore and
// custom feeds never loading). Two causes, both addressed:
//
// 1. THE SAFARI `contain` HACK IS BACK OUT. 0.3.21 reintroduced
//    `contain: layout paint !important` on the feed cards/partials as a paint
//    optimization. That exact rule was removed once before specifically to fix
//    mobile (commit "Fixed for mobile"), because on iOS Safari `contain` breaks
//    IntersectionObserver-driven lazy content and causes whole regions to fail
//    to paint — which is what stops Reddit's lazily-loaded left-nav sections and
//    custom feeds from ever rendering. It's purely a desktop paint tweak, so it
//    is dropped again rather than reworked.
//
// 2. STAND DOWN BELOW 2 COLUMNS (phones / portrait tablets). The grid only ever
//    fits a single column on a narrow screen, so it adds no value there, yet it
//    still rewrote Reddit's responsive chrome (widening <main>, stripping the
//    grid container, hiding the sidebar) and fought the mobile nav drawer. The
//    script now leaves Reddit completely native whenever fewer than MIN_COLUMNS
//    columns fit, and re-engages (restoring chrome) when a wide layout returns,
//    e.g. rotating an iPad to landscape.
// -----------------------------------------------------------------------------

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

    // Below this many columns the masonry adds nothing (a single column is just
    // Reddit's native feed) while still rewriting the page chrome and fighting
    // Reddit's responsive layout. On phones and portrait tablets the feed is
    // only ever wide enough for one column, so we stand fully down there and let
    // Reddit render natively — that's what keeps the mobile left-nav drawer and
    // its lazily-loaded sections working.
    const MIN_COLUMNS = 2;

    const SETTLE_MS = 180;
    const MAX_HIDE_MS = 1200;
    const FADE_MS = 150;

    let columns = 0;
    let cleanup = false;

    let parent = null;
    let currentPath = location.pathname;

    // The feed we were gridding right before the most recent navigation. If
    // Reddit hasn't torn it down by the time we re-search (slow SPA swaps on
    // iOS/iPadOS), we'll re-find this exact node on the new — post-detail —
    // page; recognising it lets us keep it hidden instead of un-gridding it
    // into a visible stacked flash. See the 0.3.23 note above.
    let priorFeed = null;
    // True while we're deliberately keeping a stood-down feed hidden (the
    // lingering-feed-on-post-detail case). Guards revealFeed so a stray
    // settle/scroll can't flash it back in before Reddit removes it.
    let suppressed = false;

    let postMap = new Map();
    let rmcKeyCounter = 0;
    let lastColWidth = 0;

    const cardIcon = () => document?.querySelector('shreddit-sort-dropdown[header-text="View"]')?.shadowRoot?.querySelector('svg');
    // Card view means masonry stays on; anything else (compact/classic) means
    // clean up. Reddit renamed these icons ("view-card-outline" became "card",
    // selected state "card-fill", compact became "classic"), so match any
    // card-flavored name, old or new, instead of one exact string.
    const shouldClean = (icon) => icon == null ? false : !/card/.test(icon.getAttribute('icon-name') || "");

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
                /* NOTE: do NOT add a 'contain: layout paint' rule here. It looks
                   like a harmless per-card paint optimization, but on iOS /
                   iPadOS Safari it breaks IntersectionObserver-driven lazy
                   loading and leaves whole regions unpainted — which is what
                   stopped the left nav (Home/Popular/…) and custom feeds from
                   loading. */
            }
            html.rmc-grid custom-feed-header {
                display: block !important;
                margin-left: 25px !important;
                margin-right: 25px !important;
            }
            /* The navigation veil. While html carries rmc-veil (added
               synchronously the instant a wide-screen SPA navigation begins,
               removed on reveal or after MAX_HIDE_MS), EVERY feed is invisible —
               the previous one lingering through Reddit's slow iOS/iPadOS swap as
               well as any freshly-rendered one (e.g. on back-navigation). That
               closes the window in which an un-gridded / native-stacked feed
               could paint before the grid is (re)applied. It is opacity only, so
               IntersectionObserver lazy-loading still runs; !important so it wins
               over the inline opacity the grid manages. NOT scoped to rmc-grid:
               the destination feed isn't gridded yet when we navigate to it. */
            html.rmc-veil shreddit-feed {
                opacity: 0 !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    // --- Visibility management ---------------------------------------------
    let settleTimer = null;
    let hideDeadline = 0;
    let hidden = false;

    // The navigation veil (see the CSS rule and onNavigate). A class on <html>
    // that hides every feed during a navigation, applied synchronously at the
    // navigation event so no un-gridded / native-stacked frame can paint while
    // the async re-search and re-grid catch up. A hard safety timeout guarantees
    // it is always lifted, so a feed can never get stuck invisible.
    let veilTimer = null;
    const showVeil = function() {
        document.documentElement.classList.add('rmc-veil');
        if (veilTimer) clearTimeout(veilTimer);
        veilTimer = setTimeout(hideVeil, MAX_HIDE_MS);
    };
    const hideVeil = function() {
        if (veilTimer) { clearTimeout(veilTimer); veilTimer = null; }
        document.documentElement.classList.remove('rmc-veil');
    };

    const hideFeed = function() {
        if (!parent) return;
        hidden = true;
        hideDeadline = performance.now() + MAX_HIDE_MS;
        parent.style.transition = 'none';
        parent.style.opacity = '0';
    };

    const revealFeed = function() {
        // While a feed is suppressed (lingering on a post-detail page) it must
        // stay hidden until it's removed or re-engaged — never revealed by a
        // settle timer or scroll-driven relayout.
        if (suppressed) return;
        if (!parent || !hidden) return;
        hidden = false;
        // Revealing a real feed ends the navigation: lift the veil so the feed
        // we just gridded (or a genuine native mixed feed) becomes visible. A
        // suppressed post-detail feed never reaches here, so it stays hidden by
        // its own inline opacity:0 after the veil's safety timeout lifts.
        hideVeil();
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
    // How many columns the current feed width would yield. Kept identical to the
    // math in makeLayout so the "too narrow → stand down" decision matches what
    // would actually be rendered.
    const columnCountFor = function(containerWidth) {
        return Math.max(1, Math.floor((containerWidth - GAP) / (MIN_WIDTH + GAP)));
    };

    // The width the grid would actually get. Once engaged, that's the feed
    // itself (applyChrome has already widened <main> to 100%). Before engaging
    // it must NOT be the feed's native clientWidth: Reddit's main-container
    // caps the content column at ~756px, so the native feed measures a single
    // column wide on ANY screen and the script would never engage. Measure the
    // main-container instead — it spans content plus right sidebar, which is
    // exactly the space applyChrome unlocks — with the viewport as fallback.
    const gridWidth = function() {
        if (document.documentElement.classList.contains('rmc-grid') && parent) {
            return parent.clientWidth;
        }
        const container = document.querySelector("div.main-container");
        if (container) return container.clientWidth;
        return window.innerWidth;
    };

    // True on phones / portrait tablets, where only a single column fits. There
    // the grid is pointless and its chrome changes interfere with Reddit's
    // mobile layout, so we leave the page native.
    const isTooNarrow = function() {
        if (!parent) return false;
        return columnCountFor(gridWidth()) < MIN_COLUMNS;
    };

    // A post-detail page (the page you land on after tapping a post). There is
    // no pure-post feed to display here — the post body and comment tree render
    // outside the feed node — so any feed we still hold on such a page is the
    // previous feed lingering through Reddit's SPA swap.
    const isPostDetail = () => /\/comments\//.test(location.pathname);

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
        // The path changed under us without a navigation signal (see the
        // stale-path guard in requestLayout — this is its rAF-time recheck,
        // since a navigation can commit between scheduling and this frame).
        // Never lay out — least of all stand down — against a navigation
        // onNavigate hasn't processed.
        if (location.pathname !== currentPath) { onNavigate(); return; }
        // rAF-time recheck of the overscroll gate in requestLayout: the rubber
        // band can start between scheduling and this frame, and writing layout
        // mid-bounce is what strands iOS at a negative scroll offset.
        if (overscrolledTop()) { scheduleOverscrollRetry(); return; }
        if (!parent || !parent.isConnected) return;
        if (cleanup || isMixedFeed() || isTooNarrow()) {
            // Standing down a feed we were actively gridding (non-empty
            // postMap) because the path is now a post-detail page can only
            // mean it's the previous feed lingering through the SPA swap —
            // there is no post feed to show on a post-detail page. Arm
            // suppression unconditionally, whether or not engageFeed's
            // priorFeed identity check already did: painting it stacked is
            // never right.
            if (!cleanup && postMap.size > 0 && isPostDetail()) suppressed = true;
            standDown();
            // If this is the previous feed still lingering on a post-detail
            // page, keep it hidden through the swap rather than letting the
            // stood-down (stacked) feed paint. standDown() reset opacity to
            // visible, so re-hide in the same frame — no paint happens between.
            if (suppressed) hideFeed();
            return;
        }

        applyChrome();
        // We're actually gridding now, so any prior suppression is over.
        suppressed = false;
        if (parent.style.position !== "relative") parent.style.position = "relative";

        const containerWidth = parent.clientWidth;
        const newColumns = columnCountFor(containerWidth);
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

    // --- iOS top-overscroll (rubber band) handling ---------------------------
    // Reddit's header is position:fixed top-0. On iOS, over-scrolling past the
    // top (a momentum fling to the top, or pull-to-refresh) rubber-bands the
    // whole viewport — window.scrollY goes NEGATIVE and even fixed elements
    // ride along. WebKit's snap-back animation is fragile: if the document's
    // layout changes while it is in flight, Safari can abandon it, leaving the
    // page permanently settled at a negative offset — a persistent gap between
    // the viewport top and the header (and everything else shifted down) until
    // the user scrolls again. Scrolling back to the top is exactly when our
    // late work lands: images near the top finish decoding, ResizeObserver
    // updates card heights, and makeLayout rewrites card positions and the
    // masonry container height — a document-height change mid-bounce. Two
    // defenses:
    //   1. Never perform layout writes while over-scrolled: requestLayout and
    //      makeLayout defer (with a retry) until the bounce is done.
    //   2. Self-heal: if the page is left settled at a negative offset with no
    //      finger down and no scroll activity, force the snap-back Safari
    //      abandoned with a 1px scroll jiggle (a plain scrollTo(0,0) doesn't
    //      always re-clamp the visual viewport).
    const overscrolledTop = () => window.scrollY < 0 || (vv ? vv.pageTop < 0 : false);

    let touchActive = false;
    let overscrollRetry = null;
    const scheduleOverscrollRetry = function() {
        if (overscrollRetry) return;
        overscrollRetry = setTimeout(() => {
            overscrollRetry = null;
            requestLayout();
        }, 150);
    };

    let healTimer = null;
    const scheduleOverscrollHeal = function() {
        if (healTimer) clearTimeout(healTimer);
        // Re-armed by every scroll event while negative, so this only fires
        // once the offset has been SETTLED negative for a while — i.e. the
        // snap-back is not merely still animating, it's dead.
        healTimer = setTimeout(() => {
            healTimer = null;
            if (touchActive || !overscrolledTop()) return;
            window.scrollTo(0, 1);
            requestAnimationFrame(() => window.scrollTo(0, 0));
        }, 400);
    };
    window.addEventListener('touchstart', () => { touchActive = true; }, { passive: true });
    window.addEventListener('touchend', () => { touchActive = false; scheduleOverscrollHeal(); }, { passive: true });
    window.addEventListener('touchcancel', () => { touchActive = false; scheduleOverscrollHeal(); }, { passive: true });
    window.addEventListener('scroll', () => { if (overscrolledTop()) scheduleOverscrollHeal(); }, { passive: true });

    let layoutScheduled = false;
    function requestLayout() {
        // Stale-path guard: the URL changed but no navigation signal reached
        // us (a router mechanism none of our hooks cover). Whatever DOM churn
        // triggered this layout IS our navigation notification — route it to
        // onNavigate, which veils and re-searches, instead of letting
        // makeLayout stand the visible grid down against the new path.
        if (location.pathname !== currentPath) { onNavigate(); return; }
        if (isVvZoomedIn()) return;
        // Mid rubber band: no DOM writes now (see above) — retry shortly.
        if (overscrolledTop()) { scheduleOverscrollRetry(); return; }
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
        // Stand down for the same reasons makeLayout does: a mixed feed (grid
        // would overlap comments) or a screen too narrow for the grid to help
        // (phones / portrait tablets — leaving Reddit native keeps the mobile
        // nav working). In both cases keep the feed visible instead of hiding
        // and laying it out.
        const standdown = isMixedFeed() || isTooNarrow();
        if (standdown) {
            standDown();
            // The previous gridded feed, re-found while we're now on a
            // post-detail page, is lingering through Reddit's SPA swap (slow on
            // iOS/iPadOS). Revealing it would un-grid it into a stacked flash
            // before the post renders. Keep it hidden instead — there's no feed
            // to show on a post-detail page; it'll be removed, or re-gridded and
            // revealed on back-navigation. Any other stood-down feed (a genuine
            // profile/search mixed feed, or a too-narrow phone layout) is real
            // content and must be shown.
            if (found === priorFeed && isPostDetail()) {
                // Lingering previous feed on a post-detail page: hold it hidden
                // (inline opacity:0) and lift the veil so the rest of the page
                // paints. It stays hidden until Reddit removes it or it's
                // re-gridded and revealed on back-navigation.
                suppressed = true;
                hideFeed();
                hideVeil();
            } else {
                // Genuine native content for this page (profile / search mixed
                // feed, or a too-narrow layout): show it now and lift the veil.
                // revealFeed on its own won't lift the veil here — the feed was
                // never hidden via hideFeed so `hidden` is false and revealFeed
                // early-returns — so lift it explicitly, otherwise the feed stays
                // invisible behind the veil until its safety timeout.
                suppressed = false;
                revealFeed();
                hideVeil();
            }
        } else {
            suppressed = false;
            hideFeed();
        }
        requestLayout();
        if (!standdown) settleTimer = setTimeout(revealFeed, SETTLE_MS);
    };

    const searchForFeed = function() {
        const found = findParent();
        if (found) {
            engageFeed(found, found !== parent);
            searching = false;
            return;
        }

        if (performance.now() < searchDeadline) {
            // Keep the veil up while we're still actively hunting for the
            // feed. Its fixed safety timeout alone is too short for slow iPad
            // loads/swaps — Reddit can take several seconds to render the
            // feed, and if the veil expired first the native stacked feed
            // would paint until the grid engages. Re-arming only while the
            // class is still present means a veil that already expired (or
            // was deliberately lifted) is never re-applied.
            if (document.documentElement.classList.contains('rmc-veil')) showVeil();
            requestAnimationFrame(searchForFeed);
        } else {
            searching = false;
            // Search exhausted without a feed to grid: never leave the page
            // veiled (a feed-less page has nothing for engageFeed to reveal).
            hideVeil();
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
            // Drop the veil the instant navigation begins, on any screen wide
            // enough that the grid would engage. This hides BOTH the previous
            // feed lingering through Reddit's slow iOS/iPadOS swap and any
            // freshly-rendered feed (back-navigation), so neither can paint
            // un-gridded/stacked before we (re)apply the grid. Gated on viewport
            // width so phones / portrait tablets — where we stay native — never
            // get a feed hidden out from under them. Uses window.innerWidth, not
            // the current feed's width, because on a post-detail page the content
            // column is narrow and would wrongly read as "too narrow".
            if (columnCountFor(window.innerWidth) >= MIN_COLUMNS) showVeil();
            // Remember the feed we were gridding so engageFeed can recognise it
            // lingering on the new page and keep it hidden. Only refresh this
            // when we actually hold a feed: Reddit opens a post with a pushState
            // immediately followed by a replaceState to the canonical permalink
            // (two path changes in one task). The first nulls `parent`; if we
            // overwrote priorFeed with null on the second we'd forget the feed
            // and reveal it un-gridded. Keep the previous one in that case.
            if (parent && parent.isConnected) priorFeed = parent;
            parent = null;
            disconnectPageObservers();
        }
        if (!parent || !parent.isConnected) {
            parent = null;
        }
        scheduleFeedSearch();
    };

    const announceNavigation = function() {
        window.dispatchEvent(new Event('reddit-mc:locationchange'));
    };

    // Raise the veil for an imminent same-origin path change and remember the
    // feed we're gridding — BEFORE anything about the current page is torn
    // down. Shared by every early navigation signal (the tap itself, the
    // Navigation API's navigate event). Duplicates the start of onNavigate's
    // path-changed branch on purpose: these signals fire before the URL
    // commits, when onNavigate would still see the old path and do nothing.
    // Idempotent, so firing from several hooks for one navigation is fine.
    const prepareForNavigation = function(destPathname) {
        if (destPathname === location.pathname) return;
        if (columnCountFor(window.innerWidth) >= MIN_COLUMNS) showVeil();
        if (parent && parent.isConnected) priorFeed = parent;
    };

    // The tap itself is the earliest navigation signal there is — it precedes
    // whatever mechanism Reddit's router uses (pushState, prototype dispatch,
    // Navigation API, anything). Veil on any same-origin link activation whose
    // path differs from the current one. Modified clicks / non-primary
    // buttons / new-tab targets / downloads stay in this tab's layout, so
    // they're skipped; if a veiled click never turns into a navigation, the
    // veil's safety timeout clears it.
    const onLinkActivation = function(e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const path = e.composedPath ? e.composedPath() : [];
        for (const el of path) {
            if (!el || el.tagName !== 'A') continue;
            if (!el.href || typeof el.pathname !== 'string') return;
            if ((el.target && el.target !== '_self') || el.hasAttribute('download')) return;
            if (el.origin !== location.origin) return;
            prepareForNavigation(el.pathname);
            return;
        }
    };

    const patchHistory = function() {
        // Patch the PROTOTYPE, not the history instance. Reddit's router can
        // dispatch History.prototype.pushState.call(history, ...) — which
        // never reads the instance property, so an instance-level wrapper
        // (what every version up to 0.3.26 installed) sees nothing. The
        // prototype wrapper catches both plain history.pushState(...) calls
        // (property lookup falls through to the prototype) and explicit
        // prototype dispatch.
        const proto = window.History && History.prototype;
        if (proto && proto.pushState) {
            const origPush = proto.pushState;
            const origReplace = proto.replaceState;
            proto.pushState = function() {
                const ret = origPush.apply(this, arguments);
                announceNavigation();
                return ret;
            };
            proto.replaceState = function() {
                const ret = origReplace.apply(this, arguments);
                announceNavigation();
                return ret;
            };
        }
        window.addEventListener('popstate', announceNavigation);

        // The Navigation API (Safari 18.4+, so current iPadOS; Chrome). A
        // router driving its SPA through navigation.navigate() never calls
        // pushState at all. 'navigate' fires synchronously at navigation
        // start — before the URL even commits — the earliest programmatic
        // veil point; 'currententrychange' fires right after the URL updates,
        // for every same-document navigation however it was initiated (it
        // also double-fires alongside the pushState wrappers, which is
        // harmless: onNavigate no-ops when the path hasn't changed).
        if (window.navigation && typeof window.navigation.addEventListener === 'function') {
            window.navigation.addEventListener('navigate', (e) => {
                try {
                    const dest = new URL(e.destination.url);
                    if (dest.origin === location.origin) prepareForNavigation(dest.pathname);
                } catch (err) { /* opaque or unparsable destination — not a page of ours */ }
            });
            window.navigation.addEventListener('currententrychange', announceNavigation);
        }

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

    // --- Bootstrap -----------------------------------------------------------
    // The script runs at document-start (see @run-at) so the veil can beat
    // Reddit's FIRST paint. Nothing used to hide the feed on a fresh load /
    // refresh — the veil only covered SPA navigations — so the native stacked
    // layout was always visible until the grid engaged (very noticeable on
    // iPad, where hydration is slow). Everything here is safe before <body>
    // exists: the style element attaches to <head> or <html>, the veil class
    // goes on <html>, patched history sticks before Reddit's own code captures
    // it, observeApp retries until <shreddit-app> appears, and the feed search
    // polls on animation frames (which also keep re-arming the veil, see
    // searchForFeed). Only the safety-net observer needs a node to watch, so
    // it alone waits for the DOM.
    const attachSafetyNet = function() {
        const main = document.querySelector("main") || document.body;
        domSafetyNet.observe(main, { childList: true, subtree: true });
    };

    const boot = function() {
        injectResetStyles();
        if (columnCountFor(window.innerWidth) >= MIN_COLUMNS) showVeil();
        patchHistory();
        document.addEventListener('click', onLinkActivation, true);
        observeApp();
        scheduleFeedSearch();
        if (document.body) attachSafetyNet();
        else document.addEventListener('DOMContentLoaded', attachSafetyNet, { once: true });
    };

    // At true document-start document.documentElement can still be null (it
    // is in Chromium userscript engines; WebKit guarantees <html> exists).
    // injectResetStyles/showVeil would then throw on it — killing the ENTIRE
    // script for the page — so when the root element isn't there yet, wait
    // for it.
    if (document.documentElement) {
        boot();
    } else {
        new MutationObserver(function(_, observer) {
            if (!document.documentElement) return;
            observer.disconnect();
            boot();
        }).observe(document, { childList: true });
    }
})();