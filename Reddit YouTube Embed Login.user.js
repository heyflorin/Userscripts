// ==UserScript==
// @name         Reddit YouTube Embed Login
// @namespace    https://github.com/heyflorin/Userscripts
// @version      1.0.0
// @description  Keeps YouTube videos embedded on Reddit signed in to your YouTube (Premium) account, so they play without ads.
// @match        https://www.reddit.com/*
// @match        https://old.reddit.com/*
// @match        https://new.reddit.com/*
// @match        https://sh.reddit.com/*
// @match        https://*.redditmedia.com/*
// @match        https://cdn.embedly.com/widgets/media.html*
// @match        https://www.youtube.com/embed/*
// @match        https://www.youtube-nocookie.com/embed/*
// @grant        none
// @run-at       document-start
// ==/UserScript==
/* jshint esversion: 11 */

// WHY EMBEDS PLAY SIGNED OUT
// ---------------------------------------------------------------------------
// A YouTube player embedded on reddit.com is a *third-party* iframe. Whether it
// knows who you are depends only on whether your youtube.com login cookies are
// sent to it, and three things stop that:
//
//   1. Browser third-party cookie blocking (Safari/iOS always, Firefox Total
//      Cookie Protection, Chrome when 3P cookies are blocked). The embed gets an
//      empty cookie jar, so it plays logged out — with ads, even on Premium.
//   2. Reddit sometimes routes the video through youtube-nocookie.com or an
//      Embedly wrapper. youtube-nocookie never uses your login at all.
//   3. Sandboxed / `credentialless` iframes, which drop cookies or forbid the
//      frame from asking for them.
//
// WHAT THIS SCRIPT DOES
// ---------------------------------------------------------------------------
// It runs in two places, because no script on reddit.com can read or hand over
// youtube.com cookies — only the YouTube frame itself can ask the browser for
// them:
//
//  • On Reddit (and old Reddit's redditmedia / Embedly frames): rewrites every
//    YouTube embed to a plain https://www.youtube.com/embed/… player — drops
//    youtube-nocookie and Embedly, removes `credentialless`, and widens any
//    sandbox so the player may use its cookies. Covers iframes in shadow DOM,
//    shreddit-embed's `html` attribute and `srcdoc` frames.
//
//  • Inside the YouTube embed (only when it's embedded on Reddit): if the
//    player loaded signed out, it uses the browser's Storage Access API
//    (document.requestStorageAccess) — the standard, browser-sanctioned way for
//    an embed to use its first-party login. Your first tap on the player asks
//    the browser for access (Safari may show a one-time "Allow youtube.com to
//    use cookies and website data while browsing reddit.com?" prompt), then the
//    player reloads signed in and starts playing. Once granted, later embeds are
//    signed in with no prompt (Chrome/Firefox automatically; Safari after the
//    first tap on each player, without a prompt).
//
// REQUIREMENTS
// ---------------------------------------------------------------------------
//  • Be signed in to YouTube in this same browser, and have opened youtube.com
//    as a normal tab recently (Safari only grants storage access to sites you've
//    used first-party within the last 30 days). On iOS, signing in through the
//    YouTube app does not count — sign in at youtube.com in Safari.
//  • The userscript manager must inject into iframes (Tampermonkey,
//    Violentmonkey and the iOS "Userscripts" app all do by default — don't add
//    @noframes).
//
// If access can't be granted (prompt declined, browser too old), the player
// still works signed out and shows an "Open on YouTube" link instead.

(function () {
  'use strict';

  const TAG = '[RYTL]';
  // URL param on embeds we touched: 1 = rewritten by the Reddit side,
  // h = reloaded without autoplay (waiting for the tap), 2 = reloaded with access.
  const MARK = 'rytl';
  const REDDIT_HOST_RE = /(^|\.)(reddit\.com|redditmedia\.com|redd\.it)$/i;
  const YT_HOST_RE = /(^|\.)youtube\.com$/i;
  const YT_NOCOOKIE_RE = /(^|\.)youtube-nocookie\.com$/i;
  const EMBEDLY_RE = /(^|\.)embedly\.com$/i;
  const ID_RE = /^[\w-]{11}$/;

  const log = (...a) => console.debug(TAG, ...a);
  const host = location.hostname.toLowerCase();

  // ---------------------------------------------------------------------------
  // Shared: turn any YouTube-ish embed/watch URL into a canonical player URL.
  // Returns { url, changed } or null if the URL isn't a YouTube video at all.
  // ---------------------------------------------------------------------------
  function parseTime(t) {
    if (!t) return null;
    if (/^\d+$/.test(t)) return t;
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    if (!m || !(m[1] || m[2] || m[3])) return null;
    return String((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
  }

  function buildEmbed(id, from) {
    const u = new URL('https://www.youtube.com/embed/' + id);
    const start = parseTime(from.searchParams.get('start') || from.searchParams.get('t'));
    if (start) u.searchParams.set('start', start);
    const list = from.searchParams.get('list');
    if (list) u.searchParams.set('list', list);
    return u;
  }

  function toYouTubeEmbed(raw, depth = 0) {
    if (!raw || depth > 2) return null;
    let u;
    try { u = new URL(raw, location.href); } catch (_) { return null; }
    const h = u.hostname.toLowerCase();

    // Embedly wrapper: …/widgets/media.html?src=<youtube embed>&url=<watch url>
    if (EMBEDLY_RE.test(h)) {
      for (const k of ['src', 'url']) {
        const r = toYouTubeEmbed(u.searchParams.get(k), depth + 1);
        if (r) {
          const out = new URL(r.url);
          out.searchParams.set(MARK, '1');
          return { url: out.href, changed: true };
        }
      }
      return null;
    }

    let out = null;
    if (YT_HOST_RE.test(h) || YT_NOCOOKIE_RE.test(h)) {
      const p = u.pathname;
      if (p.startsWith('/embed/')) {
        if (h === 'www.youtube.com' && u.protocol === 'https:') return { url: u.href, changed: false };
        out = new URL(u.href);
        out.protocol = 'https:';
        out.hostname = 'www.youtube.com';
      } else if (p === '/watch' && ID_RE.test(u.searchParams.get('v') || '')) {
        out = buildEmbed(u.searchParams.get('v'), u);
      } else {
        const m = /^\/(?:shorts|live|v)\/([\w-]{11})/.exec(p);
        if (m) out = buildEmbed(m[1], u);
      }
    } else if (h === 'youtu.be') {
      const id = u.pathname.slice(1, 12);
      if (ID_RE.test(id)) out = buildEmbed(id, u);
    }
    if (!out) return null;
    out.searchParams.set(MARK, '1');
    return { url: out.href, changed: true };
  }

  // ===========================================================================
  // PART 1 — Reddit pages (and redditmedia frames): fix the embed iframes.
  // ===========================================================================
  const SANDBOX_NEEDS = [
    'allow-scripts',
    'allow-same-origin', // without it the player has an opaque origin and no cookies
    'allow-popups',
    'allow-popups-to-escape-sandbox',
    'allow-presentation',
    'allow-storage-access-by-user-activation',
  ];

  // Mutates an <iframe> (live or inside a parsed template). Returns true if
  // anything changed.
  function fixIframe(el, live) {
    const src = el.getAttribute('src');
    const r = src ? toYouTubeEmbed(src) : null;

    if (!r) {
      // Not a YouTube frame itself — but a srcdoc frame may contain one.
      const doc = el.getAttribute('srcdoc');
      if (doc && /youtube|embedly/i.test(doc)) {
        const fixed = fixMarkup(doc);
        if (fixed !== doc) { el.setAttribute('srcdoc', fixed); return true; }
      }
      return false;
    }

    let changed = r.changed;
    if (el.hasAttribute('credentialless')) {
      el.removeAttribute('credentialless');
      changed = true;
    }
    if (el.hasAttribute('sandbox')) {
      const sb = el.sandbox;
      for (const t of SANDBOX_NEEDS) {
        if (!sb.contains(t)) {
          try { sb.add(t); changed = true; } catch (_) { /* unknown token in this browser */ }
        }
      }
    }
    if (!changed) return false;

    // Setting src (even to the same value) re-navigates the frame, which is what
    // makes new sandbox / credentialless settings take effect.
    if (live) log('fixing embed', src, '→', r.url);
    el.setAttribute('src', r.url);
    return true;
  }

  function fixMarkup(html) {
    if (!/youtube|embedly/i.test(html)) return html;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    let changed = false;
    for (const f of tpl.content.querySelectorAll('iframe')) {
      if (fixIframe(f, false)) changed = true;
    }
    return changed ? tpl.innerHTML : html;
  }

  // shreddit-embed (and similar) carry the oEmbed markup in an `html`
  // attribute and render it later — fix it before it renders.
  function fixHtmlAttr(el) {
    const html = el.getAttribute('html');
    if (!html) return;
    const fixed = fixMarkup(html);
    if (fixed !== html) {
      log('fixing embed markup on', el.localName);
      el.setAttribute('html', fixed);
    }
  }

  const observedRoots = new WeakSet();
  const observer = new MutationObserver(onMutations);
  const OBSERVE_OPTS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcdoc', 'html', 'sandbox', 'credentialless'],
  };

  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, OBSERVE_OPTS);
    scanTree(root);
  }

  function handleElement(el) {
    if (el.localName === 'iframe') fixIframe(el, true);
    else if (el.hasAttribute('html')) fixHtmlAttr(el);
    if (el.shadowRoot) observeRoot(el.shadowRoot);
  }

  function scanTree(root) {
    if (root.nodeType === 1) handleElement(root);
    root.querySelectorAll('iframe, [html]').forEach(handleElement);
    // Shadow roots (shreddit-embed, shreddit-post, …) — only custom elements have them.
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot && el.localName.includes('-')) observeRoot(el.shadowRoot);
    });
  }

  function onMutations(muts) {
    for (const m of muts) {
      if (m.type === 'attributes') {
        handleElement(m.target);
      } else {
        for (const n of m.addedNodes) if (n.nodeType === 1) scanTree(n);
      }
    }
  }

  function startRedditSide() {
    observeRoot(document);
    // Shadow roots attached after an element was inserted don't produce a
    // mutation we can see, so sweep for new ones periodically.
    setInterval(() => {
      if (!document.hidden && document.documentElement) scanTree(document.documentElement);
    }, 2500);
  }

  // ===========================================================================
  // PART 2 — Embedly frame (old Reddit): jump straight to the YouTube player.
  // ===========================================================================
  function startEmbedlySide() {
    if (window.self === window.top) return;
    const r = toYouTubeEmbed(location.href);
    if (r) {
      log('unwrapping Embedly →', r.url);
      location.replace(r.url);
    }
  }

  // ===========================================================================
  // PART 3 — Inside the YouTube embed: get access to the first-party login.
  // ===========================================================================
  function isFramed() {
    try { return window.self !== window.top; } catch (_) { return true; }
  }

  function embeddedOnReddit(params) {
    const ok = (s) => {
      try { return REDDIT_HOST_RE.test(new URL(s).hostname); } catch (_) { return false; }
    };
    if (params.has(MARK)) return true;
    const ao = location.ancestorOrigins;
    if (ao && ao.length) return Array.from(ao).some(ok);
    if (document.referrer && ok(document.referrer)) return true;
    return ok(params.get('origin') || '') || ok(params.get('widget_referrer') || '');
  }

  async function hasAccess() {
    if (typeof document.hasStorageAccess !== 'function') return null; // unsupported
    try { return await document.hasStorageAccess(); } catch (_) { return false; }
  }

  // Chrome/Edge remember the grant per site pair and let later frames take it
  // without a tap. Safari throws on this permission name — that's fine.
  async function permissionAlreadyGranted() {
    try {
      const st = await navigator.permissions.query({ name: 'storage-access' });
      return st.state === 'granted';
    } catch (_) {
      return false;
    }
  }

  function loggedInState() {
    for (const s of document.scripts) {
      const m = /"LOGGED_IN"\s*:\s*(true|false)/.exec(s.textContent);
      if (m) return m[1] === 'true';
    }
    return null; // unknown
  }

  function reloadWith(changes) {
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    location.replace(u.href);
  }

  function videoId() {
    const m = /^\/embed\/([\w-]{11})/.exec(location.pathname);
    return m ? m[1] : null;
  }

  // Small in-player notice.
  let toastEl = null;
  function toast(text, { link = false, ms = 0 } = {}) {
    const mount = () => {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = [
          'position:fixed', 'top:8px', 'left:50%', 'transform:translateX(-50%)',
          'z-index:2147483647', 'max-width:90%', 'padding:6px 12px',
          'border-radius:16px', 'background:rgba(0,0,0,.8)', 'color:#fff',
          'font:500 13px/1.4 Roboto,Arial,sans-serif', 'text-align:center',
          'box-shadow:0 2px 8px rgba(0,0,0,.4)', 'pointer-events:auto',
        ].join(';');
        (document.body || document.documentElement).appendChild(toastEl);
      }
      toastEl.textContent = text;
      const id = videoId();
      if (link && id) {
        const a = document.createElement('a');
        a.href = 'https://www.youtube.com/watch?v=' + id;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = ' Open on YouTube ↗';
        a.style.cssText = 'color:#3ea6ff;text-decoration:none;font-weight:700';
        toastEl.appendChild(a);
      }
      toastEl.style.display = '';
      if (ms) setTimeout(() => { if (toastEl) toastEl.style.display = 'none'; }, ms);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  function startYouTubeSide() {
    if (!isFramed()) return;
    const params = new URLSearchParams(location.search);
    if (!embeddedOnReddit(params)) return;

    // youtube-nocookie never uses your login — swap to the normal player.
    if (YT_NOCOOKIE_RE.test(host)) {
      const u = new URL(location.href);
      u.hostname = 'www.youtube.com';
      u.searchParams.set(MARK, '1');
      log('leaving youtube-nocookie');
      location.replace(u.href);
      return;
    }

    const reloaded = params.get(MARK) === '2';

    // 'idle' until we know whether we need the tap; 'armed' = the next tap asks
    // for storage access; 'pending' = waiting on the browser; 'off' = hands off.
    let state = 'idle';

    // Swallow the gesture's other events while armed so YouTube doesn't start
    // playing (signed out, with an ad) underneath the access request.
    const swallow = (e) => {
      if ((state === 'armed' || state === 'pending') && e.isTrusted) e.stopImmediatePropagation();
    };
    for (const t of ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend']) {
      window.addEventListener(t, swallow, true);
    }
    window.addEventListener('click', async (e) => {
      if (!e.isTrusted || (state !== 'armed' && state !== 'pending')) return;
      if (toastEl && toastEl.contains(e.target)) return; // let the fallback link work
      e.preventDefault();
      e.stopImmediatePropagation();
      if (state === 'pending') return;
      state = 'pending';
      toast('Connecting your YouTube account…');
      try {
        await document.requestStorageAccess(); // must run inside the tap
        log('storage access granted — reloading signed in');
        reloadWith({ [MARK]: '2', autoplay: '1' });
      } catch (err) {
        log('storage access denied', err);
        state = 'off';
        toast('Couldn’t use your YouTube login here.', { link: true, ms: 8000 });
      }
    }, true);

    (async () => {
      let has = await hasAccess();

      if (has === false && await permissionAlreadyGranted()) {
        try {
          await document.requestStorageAccess();
          has = true;
          if (!reloaded) {
            // The page was requested without cookies; fetch it again with them.
            log('storage access already granted — reloading signed in');
            reloadWith({ [MARK]: '2' });
            return;
          }
        } catch (_) { /* fall through to the tap flow */ }
      }

      // Reddit's player facade loads the embed with autoplay=1 after you click
      // on Reddit. Without access that would start a signed-out ad before you
      // could tap the player, so load it paused and let the tap do the rest.
      if (has === false && params.get('autoplay') === '1' && !reloaded) {
        log('no storage access yet — holding autoplay for the tap');
        reloadWith({ autoplay: null, [MARK]: 'h' });
        return;
      }

      const ready = () => {
        const li = loggedInState();
        log('logged in:', li, '| storage access:', has);
        if (li === true) { state = 'off'; return; }

        if (has === true) {
          // Cookies were available when the player loaded, so a signed-out
          // player here means you're not signed in to YouTube in this browser.
          state = 'off';
          return;
        }
        if (has === null) {
          // No Storage Access API in this browser.
          state = 'off';
          if (li === false) toast('YouTube login isn’t available in embeds in this browser.', { link: true, ms: 6000 });
          return;
        }
        state = 'armed';
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
      else ready();
    })();
  }

  // ---------------------------------------------------------------------------
  if (YT_HOST_RE.test(host) || YT_NOCOOKIE_RE.test(host)) startYouTubeSide();
  else if (EMBEDLY_RE.test(host)) startEmbedlySide();
  else if (REDDIT_HOST_RE.test(host)) startRedditSide();
})();
