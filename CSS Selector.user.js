// ==UserScript==
// @name         CSS Selector Picker (v1.22.0)
// @namespace    https://greasyfork.org/
// @version      1.22.0
// @description  A CSS selector picker for web pages, allowing you to select elements and generate useful CSS selectors on both Desktop and Mobile.
// @match        *://*/*
// @run-at       document-end
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM.addStyle
// ==/UserScript==

(() => {
  "use strict";

  // ---------- utils ----------
  const addStyle = (css) => {
    try {
      if (typeof GM_addStyle === "function") return GM_addStyle(css);
    } catch (_) {}
    try {
      if (typeof GM !== "undefined" && typeof GM.addStyle === "function")
        return GM.addStyle(css);
    } catch (_) {}
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  };
  async function copyText(text) {
    if (typeof text !== "string") text = String(text ?? "");
    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(text, "text");
        return true;
      }
    } catch (_) {}
    if (
      navigator.clipboard &&
      window.isSecureContext &&
      navigator.clipboard.writeText
    ) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      Object.assign(ta.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
        zIndex: 2147483647,
      });
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) return true;
    } catch (_) {}
    try {
      const div = document.createElement("div");
      div.contentEditable = "true";
      div.innerText = text;
      Object.assign(div.style, {
        position: "fixed",
        top: "0",
        left: "0",
        opacity: "0",
        zIndex: 2147483647,
      });
      document.body.appendChild(div);
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("copy");
      sel.removeAllRanges();
      div.remove();
      if (ok) return true;
    } catch (_) {}
    return false;
  }
  const esc =
    CSS && CSS.escape
      ? (s) => CSS.escape(s)
      : (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
  const PILL_MAX_CHARS = 100;
  const trim = (s, n = PILL_MAX_CHARS) =>
    s.length <= n ? s : s.slice(0, n - 1) + "…";
  const looksUniqueToken = (v) => {
    if (!v) return false;
    const s = String(v);
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    )
      return true;
    if (/\d{3,}/.test(s)) return true;
    if (/[a-f0-9]{6,}/i.test(s) && /\d/.test(s)) return true;
    if (/[A-Za-z]/.test(s) && /\d/.test(s) && s.length >= 8) return true;
    if (s.length >= 16 && /^[A-Za-z0-9_-]+$/.test(s)) return true;
    return false;
  };

  // ---------- finder (CSS selector generator) ----------
    // License: MIT
    // Author: Anton Medvedev <anton@medv.io>
    // Source: https://github.com/antonmedv/finder
    const acceptedAttrNames = new Set(['role', 'name', 'aria-label', 'rel', 'href']);
    /** Check if attribute name and value are word-like. */
    function attr(name, value) {
        let nameIsOk = acceptedAttrNames.has(name);
        nameIsOk ||= name.startsWith('data-') && wordLike(name);
        let valueIsOk = wordLike(value) && value.length < 100;
        valueIsOk ||= value.startsWith('#') && wordLike(value.slice(1));
        return nameIsOk && valueIsOk;
    }
    /** Check if id name is word-like. */
    function idName(name) {
        return wordLike(name);
    }
    /** Check if class name is word-like. */
    function className(name) {
        return wordLike(name);
    }
    /** Check if tag name is word-like. */
    function tagName(name) {
        return true;
    }
    /** Finds unique CSS selectors for the given element. */
    function finder(input, options) {
        if (input.nodeType !== Node.ELEMENT_NODE) {
            throw new Error(`Can't generate CSS selector for non-element node type.`);
        }
        if (input.tagName.toLowerCase() === 'html') {
            return 'html';
        }
        const defaults = {
            root: document.body,
            idName: idName,
            className: className,
            tagName: tagName,
            attr: attr,
            timeoutMs: 1000,
            seedMinLength: 3,
            optimizedMinLength: 2,
            maxNumberOfPathChecks: Infinity,
        };
        const startTime = new Date();
        const config = { ...defaults, ...options };
        const rootDocument = findRootDocument(config.root, defaults);
        let foundPath;
        let count = 0;
        for (const candidate of search(input, config, rootDocument)) {
            const elapsedTimeMs = new Date().getTime() - startTime.getTime();
            if (elapsedTimeMs > config.timeoutMs ||
                count >= config.maxNumberOfPathChecks) {
                const fPath = fallback(input, rootDocument);
                if (!fPath) {
                    throw new Error(`Timeout: Can't find a unique selector after ${config.timeoutMs}ms`);
                }
                return selector(fPath);
            }
            count++;
            if (unique(candidate, rootDocument)) {
                foundPath = candidate;
                break;
            }
        }
        if (!foundPath) {
            throw new Error(`Selector was not found.`);
        }
        const optimized = [
            ...optimize(foundPath, input, config, rootDocument, startTime),
        ];
        optimized.sort(byPenalty);
        if (optimized.length > 0) {
            return selector(optimized[0]);
        }
        return selector(foundPath);
    }
    function* search(input, config, rootDocument) {
        const stack = [];
        let paths = [];
        let current = input;
        let i = 0;
        while (current && current !== rootDocument) {
            const level = tie(current, config);
            for (const node of level) {
                node.level = i;
            }
            stack.push(level);
            current = current.parentElement;
            i++;
            paths.push(...combinations(stack));
            if (i >= config.seedMinLength) {
                paths.sort(byPenalty);
                for (const candidate of paths) {
                    yield candidate;
                }
                paths = [];
            }
        }
        paths.sort(byPenalty);
        for (const candidate of paths) {
            yield candidate;
        }
    }
    function wordLike(name) {
        if (/^[a-z\-]{3,}$/i.test(name)) {
            const words = name.split(/-|[A-Z]/);
            for (const word of words) {
                if (word.length <= 2) {
                    return false;
                }
                if (/[^aeiou]{4,}/i.test(word)) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    function tie(element, config) {
        const level = [];
        const elementId = element.getAttribute('id');
        if (elementId && config.idName(elementId)) {
            level.push({
                name: '#' + CSS.escape(elementId),
                penalty: 0,
            });
        }
        for (let i = 0; i < element.classList.length; i++) {
            const name = element.classList[i];
            if (config.className(name)) {
                level.push({
                    name: '.' + CSS.escape(name),
                    penalty: 1,
                });
            }
        }
        for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i];
            if (config.attr(attr.name, attr.value)) {
                level.push({
                    name: `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`,
                    penalty: 2,
                });
            }
        }
        const tagName = element.tagName.toLowerCase();
        if (config.tagName(tagName)) {
            level.push({
                name: tagName,
                penalty: 5,
            });
            const index = indexOf(element, tagName);
            if (index !== undefined) {
                level.push({
                    name: nthOfType(tagName, index),
                    penalty: 10,
                });
            }
        }
        const nth = indexOf(element);
        if (nth !== undefined) {
            level.push({
                name: nthChild(tagName, nth),
                penalty: 50,
            });
        }
        return level;
    }
    function selector(path) {
        let node = path[0];
        let query = node.name;
        for (let i = 1; i < path.length; i++) {
            const level = path[i].level || 0;
            if (node.level === level - 1) {
                query = `${path[i].name} > ${query}`;
            }
            else {
                query = `${path[i].name} ${query}`;
            }
            node = path[i];
        }
        return query;
    }
    function penalty(path) {
        return path.map((node) => node.penalty).reduce((acc, i) => acc + i, 0);
    }
    function byPenalty(a, b) {
        return penalty(a) - penalty(b);
    }
    function indexOf(input, tagName) {
        const parent = input.parentNode;
        if (!parent) {
            return undefined;
        }
        let child = parent.firstChild;
        if (!child) {
            return undefined;
        }
        let i = 0;
        while (child) {
            if (child.nodeType === Node.ELEMENT_NODE &&
                (tagName === undefined ||
                    child.tagName.toLowerCase() === tagName)) {
                i++;
            }
            if (child === input) {
                break;
            }
            child = child.nextSibling;
        }
        return i;
    }
    function fallback(input, rootDocument) {
        let i = 0;
        let current = input;
        const path = [];
        while (current && current !== rootDocument) {
            const tagName = current.tagName.toLowerCase();
            const index = indexOf(current, tagName);
            if (index === undefined) {
                return;
            }
            path.push({
                name: nthOfType(tagName, index),
                penalty: NaN,
                level: i,
            });
            current = current.parentElement;
            i++;
        }
        if (unique(path, rootDocument)) {
            return path;
        }
    }
    function nthChild(tagName, index) {
        if (tagName === 'html') {
            return 'html';
        }
        return `${tagName}:nth-child(${index})`;
    }
    function nthOfType(tagName, index) {
        if (tagName === 'html') {
            return 'html';
        }
        return `${tagName}:nth-of-type(${index})`;
    }
    function* combinations(stack, path = []) {
        if (stack.length > 0) {
            for (let node of stack[0]) {
                yield* combinations(stack.slice(1, stack.length), path.concat(node));
            }
        }
        else {
            yield path;
        }
    }
    function findRootDocument(rootNode, defaults) {
        if (rootNode.nodeType === Node.DOCUMENT_NODE) {
            return rootNode;
        }
        if (rootNode === defaults.root) {
            return rootNode.ownerDocument;
        }
        return rootNode;
    }
    function unique(path, rootDocument) {
        const css = selector(path);
        switch (rootDocument.querySelectorAll(css).length) {
            case 0:
                throw new Error(`Can't select any node with this selector: ${css}`);
            case 1:
                return true;
            default:
                return false;
        }
    }
    function* optimize(path, input, config, rootDocument, startTime) {
        if (path.length > 2 && path.length > config.optimizedMinLength) {
            for (let i = 1; i < path.length - 1; i++) {
                const elapsedTimeMs = new Date().getTime() - startTime.getTime();
                if (elapsedTimeMs > config.timeoutMs) {
                    return;
                }
                const newPath = [...path];
                newPath.splice(i, 1);
                if (unique(newPath, rootDocument) &&
                    rootDocument.querySelector(selector(newPath)) === input) {
                    yield newPath;
                    yield* optimize(newPath, input, config, rootDocument, startTime);
                }
            }
        }
    }

  // ---------- styles ----------
  addStyle(`
    /* Scoped root for picker variables */
    #css-selector-picker-root{
      --pill-h: 46px;
      --pill-pad-x: 16px;
      --font: -apple-system, BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      --font-size: 15px;
      --blue-bg:#1a73e8; --blue-bd:#1259b0;
      --orange-bg:#ff8c00; --orange-bd:#cc7000;
      --text-light:#fff;
      --btn-bg:#2f2f2f; --btn-bd:#1c1c1c; --btn-fg:#fff;

      --grabber-size: 56px;
      --grabber-bg:#2f2f2f;
      --grabber-active:#444;
      --grabber-bd:#111;
      --grabber-fg:#fff;
    }

    #css-selector-picker-root .selector-pill{
      height:var(--pill-h)!important; padding:0 var(--pill-pad-x)!important;
      font-family:var(--font)!important; font-size:var(--font-size)!important; line-height:1!important;
      box-sizing:border-box!important; display:inline-flex!important; align-items:center!important; justify-content:flex-start!important;
      -webkit-tap-highlight-color:transparent; user-select:none; white-space:nowrap; cursor:pointer;
      border-radius:999px!important; font-weight:800; max-width:min(64vw,520px); min-width:0; overflow:hidden; text-overflow:ellipsis; text-align:left;
      box-shadow:0 3px 10px rgba(0,0,0,.10); outline:none; -webkit-user-select:none;
      pointer-events:auto;
      position:relative !important;
    }
    #css-selector-picker-root .selector-pill.generic{  background:var(--orange-bg) !important; border:2px solid var(--orange-bd) !important; color:var(--text-light) !important; }
    #css-selector-picker-root .selector-pill.specific{ background:var(--blue-bg) !important;   border:2px solid var(--blue-bd) !important;   color:var(--text-light) !important; }

    #css-selector-picker-root .picker-results{
      position:fixed!important; right:16px; bottom:20px; z-index:2147483648;
      display:none; flex-direction:column; gap:12px;
      pointer-events:none;
    }
    #css-selector-picker-root .picker-row{ display:flex; gap:8px; align-items:center; justify-content:flex-end; }

    #css-selector-picker-root .action-group{ display:flex; gap:6px; pointer-events:none; }
    #css-selector-picker-root .action-btn{
      height:var(--pill-h)!important; width:var(--pill-h)!important;
      min-width:var(--pill-h)!important; min-height:var(--pill-h)!important;
      display:inline-flex; align-items:center; justify-content:center;
      border-radius:999px!important; font-family:var(--font); font-size:18px; font-weight:700; cursor:pointer; user-select:none;
      background:var(--btn-bg); color:var(--btn-fg); border:2px solid var(--btn-bd);
      box-shadow:0 3px 10px rgba(0,0,0,.10);
      pointer-events:auto;
    }
    #css-selector-picker-root .action-btn.generic{ border-color:var(--orange-bd); }
    #css-selector-picker-root .action-btn.specific{ border-color:var(--blue-bd); }
    #css-selector-picker-root .action-btn.generic.active{ background:var(--orange-bg)!important; border-color:var(--orange-bd)!important; }
    #css-selector-picker-root .action-btn.specific.active{ background:var(--blue-bg)!important; border-color:var(--blue-bd)!important; }
    #css-selector-picker-root .picker-results:not(.locked) .action-btn[data-action="css"]{ display:none!important; }

    #css-selector-picker-root .picker-hover-box{
      position:fixed; z-index:2147483646; pointer-events:none;
      border:1px dotted rgba(26,115,232,.95) !important; background:rgba(26,115,232,.20);
      border-radius:3px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);
      transition:transform .06s ease,width .06s ease,height .06s ease,left .06s ease,top .06s ease;
    }
    #css-selector-picker-root .picker-matches-layer{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none;}
    #css-selector-picker-root .picker-match-box{
      position:fixed; pointer-events:none; border:1px dotted rgba(255,140,0,.95) !important;
      background:rgba(255,140,0,.22); border-radius:3px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);
    }
    #css-selector-picker-root .picker-hover-box.locked{ border-style:solid !important; }
    #css-selector-picker-root .picker-match-box.locked{ border-style:solid !important; }

    #css-selector-picker-root .picker-grabber{
      position:fixed; left:12px; bottom:20px; z-index:2147483649;
      width:var(--grabber-size); height:var(--grabber-size);
      display:flex; align-items:center; justify-content:center;
      border-radius:50%; background:var(--grabber-bg); color:var(--grabber-fg); border:2px solid var(--grabber-bd);
      box-shadow:0 6px 18px rgba(0,0,0,.25);
      font-family:var(--font); font-size:calc(var(--grabber-size)*0.5); font-weight:900; cursor:pointer; user-select:none;
      -webkit-tap-highlight-color:transparent;
      pointer-events:auto;
    }
    #css-selector-picker-root .picker-grabber.active{ background:var(--grabber-active); }

    #css-selector-picker-root .selector-pill .pill-text{ display:block; overflow:hidden; text-overflow:ellipsis; word-break:break-all; white-space:nowrap;}
    #css-selector-picker-root .selector-pill .pill-lock{
      display:none; align-items:center; justify-content:center;
      position:absolute; right:0px; top:0px;
      width:50px; height:100%; padding:0; margin:0; border-radius:0 10px 10px 0;
      font-size:20px; font-weight: bold; line-height:1; cursor:pointer; user-select:none;
      pointer-events:auto;
    }
    #css-selector-picker-root .selector-pill.generic .pill-lock{ border-color:var(--orange-bd); }
    #css-selector-picker-root .selector-pill.specific .pill-lock{ border-color:var(--blue-bd); }
    #css-selector-picker-root .picker-results.locked .pill-lock{ display:flex; }

    #css-selector-picker-root .picker-css-overlay{
      position:fixed; z-index:2147483650; max-width:min(72vw, 640px);
      background:#101114; color:#f5f7fb; border:1px solid rgba(255,255,255,.15);
      border-radius:10px; box-shadow:0 14px 40px rgba(0,0,0,.45);
      font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      pointer-events:auto; display:none;
      max-height:60vh;
      overflow:scroll;
    }
    #css-selector-picker-root .picker-css-overlay .css-ov-header{
      display:flex !important; align-items:center !important; justify-content:space-between !important;
      gap:8px !important; padding:10px 14px !important; background:rgba(255,255,255,.04) !important;
      border-bottom:1px solid rgba(255,255,255,.08) !important;
      font-family:var(--font) !important; font-weight:700 !important; font-size:13px !important;
    }
    #css-selector-picker-root .picker-css-overlay .css-ov-title{ opacity:.85 !important; }
    #css-selector-picker-root .picker-css-overlay .css-ov-copy{
      appearance:none !important; -webkit-appearance:none !important; border:none !important; outline:none !important;
      background:#2b2f38 !important; color:#fff !important; border:1px solid #1d2129 !important;;
      padding:6px 9px !important; border-radius:8px !important; cursor:pointer !important; font-weight:700 !important; font-size:12px !important;
    }
    #css-selector-picker-root .picker-css-overlay .css-ov-copy:active{ transform:translateY(1px) !important; }
    #css-selector-picker-root .picker-css-overlay pre{ margin:0 !important; padding:8px 16px !important; background: inherit !important; border: none !important; color: inherit !important;}
    #css-selector-picker-root .picker-css-overlay code{ font-size: 10px !important; max-width: 340px !important; white-space: nowrap; text-overflow: ellipsis; display:block !important; border: none !important; white-space:pre !important; padding:8px !important; overflow-y:auto !important; overflow-x: hidden !important; word-break:break-word !important; background:inherit !important;}
  `);

  // Create isolated root container so styles don't leak.
  const pickerRoot = document.createElement('div');
  pickerRoot.id = 'css-selector-picker-root';
  pickerRoot.setAttribute('data-picker-ui','1'); // keep existing detection
  document.documentElement.appendChild(pickerRoot);

  // ---------- UI ----------
  const results = document.createElement("div");
  results.className = "picker-results";
  results.setAttribute("data-picker-ui", "1");
  results.innerHTML = `
    <div class="picker-row" data-kind="generic" data-picker-ui="1">
      <div class="selector-pill generic" data-role="label" data-picker-ui="1">
        <span class="pill-text" data-role="label-text" data-picker-ui="1"></span>
      </div>
      <div class="action-group" data-picker-ui="1">
        <div class="action-btn generic" data-action="parent" title="Parent ▲" data-picker-ui="1">▲</div>
        <div class="action-btn generic" data-action="child"  title="Child ▼"  data-picker-ui="1">▼</div>
        <div class="action-btn generic" data-action="css"    title="Computed Styles" data-picker-ui="1">ⓘ</div>
        <div class="action-btn generic" data-action="hide"   title="Hide ✕"   data-picker-ui="1">✕</div>
      </div>
    </div>
    <div class="picker-row" data-kind="specific" data-picker-ui="1">
      <div class="selector-pill specific" data-role="label" data-picker-ui="1">
        <span class="pill-text" data-role="label-text" data-picker-ui="1"></span>
      </div>
      <div class="action-group" data-picker-ui="1">
        <div class="action-btn specific" data-action="prev" title="Prev ◀" data-picker-ui="1">◀</div>
        <div class="action-btn specific" data-action="next" title="Next ▶" data-picker-ui="1">▶</div>
        <div class="action-btn specific" data-action="css"  title="Computed Styles" data-picker-ui="1">ⓘ</div>
        <div class="action-btn specific" data-action="hide" title="Hide ✕" data-picker-ui="1">✕</div>
      </div>
    </div>
  `;
  pickerRoot.appendChild(results);

  const hoverBox = document.createElement("div");
  hoverBox.className = "picker-hover-box";
  hoverBox.setAttribute("data-picker-ui", "1");
  hoverBox.style.display = "none";
  pickerRoot.appendChild(hoverBox);

  const matchesLayer = document.createElement("div");
  matchesLayer.className = "picker-matches-layer";
  matchesLayer.setAttribute("data-picker-ui", "1");
  pickerRoot.appendChild(matchesLayer);

  // Grabber
  const grabber = document.createElement("div");
  grabber.className = "picker-grabber";
  grabber.setAttribute("data-picker-ui", "1");
  grabber.setAttribute("title", "Start/Stop Picker");
  grabber.textContent = "⊹";
  pickerRoot.appendChild(grabber);

  // Computed CSS overlay
  const cssOverlay = document.createElement("div");
  cssOverlay.className = "picker-css-overlay";
  cssOverlay.setAttribute("data-picker-ui", "1");
  cssOverlay.innerHTML = `
    <div class="css-ov-header" data-picker-ui="1">
      <div class="css-ov-title" data-picker-ui="1">Computed Styles</div>
      <button class="css-ov-copy" data-picker-ui="1" title="Copy CSS">Copy</button>
    </div>
    <pre data-picker-ui="1"><code class="css-ov-code" data-picker-ui="1"></code></pre>
  `;
  pickerRoot.appendChild(cssOverlay);

  // Hide rules style
  const hideStyle = document.createElement("style");
  hideStyle.setAttribute("data-picker-ui", "1");
  document.head.appendChild(hideStyle);
  const hiddenRules = new Set();
  const addHideRule = (sel) => {
    if (!sel || hiddenRules.has(sel)) return;
    hiddenRules.add(sel);
    hideStyle.appendChild(
      document.createTextNode(`${sel}{display:none !important;}\n`)
    );
  };

  // ---------- state ----------
  let pickMode = false;
  let locked = false;
  let lockedTarget = null;

  // Keep overlay open when user explicitly taps/clicks the lock
  let overlayPinned = false;
  let lastOverlayKind = null; // 'generic' | 'specific'

  let activeTouchCount = 0;

  let hoveredTarget = null;
  let selectorGeneric = "";
  let selectorSpecific = "";

  // hover RAF
  let rafScheduledHover = false,
    pendingXY = null;

  // pinch-zoom suppression (picker ON)
  let zoomSuppressOn = false;

  // tap detection
  let pdX = 0,
    pdY = 0,
    pdTime = 0;
  const TAP_MS = 300,
    TAP_DIST = 10;

  const uiContains = (node) => !!(node && node.closest('[data-picker-ui="1"]'));

  // ---------- performance helpers ----------
  
  // Cache for expensive computations
  const selectorCache = new WeakMap();
  const semanticCache = new WeakMap();
  const selectorTestCache = new Map(); // Cache for selector test results
  const boundingRectCache = new WeakMap(); // Cache for getBoundingClientRect
  
  // Performance throttle for cache cleaning
  let cacheCleanupTimer = null;
  const scheduleCleanup = () => {
    if (cacheCleanupTimer) return;
    cacheCleanupTimer = setTimeout(() => {
      // Clean selector test cache if it gets too large
      if (selectorTestCache.size > 500) {
        selectorTestCache.clear();
      }
      cacheCleanupTimer = null;
    }, 30000); // Clean every 30 seconds
  };
  
  // Optimized helper functions with caching
  const getSemanticClasses = (() => {
    const cache = new WeakMap();
    return (element) => {
      if (!element || !element.classList) return [];
      if (cache.has(element)) return cache.get(element);
      
      const result = [];
      for (const cls of element.classList) {
        if (!looksUniqueToken(cls) && /^[a-z][a-z-]*$/i.test(cls)) {
          result.push(cls);
        }
      }
      cache.set(element, result);
      return result;
    };
  })();
  
  const getSameTagSiblings = (() => {
    const cache = new WeakMap();
    return (element) => {
      const parent = element.parentElement;
      if (!parent) return [];
      
      const cacheKey = `${parent.tagName}-${element.tagName}`;
      if (cache.has(parent)) {
        const cached = cache.get(parent);
        if (cached.key === cacheKey) return cached.siblings;
      }
      
      const siblings = [];
      for (const child of parent.children) {
        if (child.tagName === element.tagName) {
          siblings.push(child);
        }
      }
      
      cache.set(parent, { key: cacheKey, siblings });
      return siblings;
    };
  })();
  
  const getCachedBoundingRect = (element) => {
    if (boundingRectCache.has(element)) {
      return boundingRectCache.get(element);
    }
    const rect = element.getBoundingClientRect();
    boundingRectCache.set(element, rect);
    // Clear cache after a short time since rects can change
    setTimeout(() => boundingRectCache.delete(element), 1000);
    return rect;
  };
  
  const testSelector = (selector, expectedElement = null, minMatches = 1, maxMatches = 200) => {
    // Create cache key
    const cacheKey = `${selector}|${minMatches}|${maxMatches}`;
    
    // Check cache first
    if (selectorTestCache.has(cacheKey)) {
      const cached = selectorTestCache.get(cacheKey);
      if (expectedElement) {
        // Need to verify the expected element is still in the matches
        return {
          ...cached,
          valid: cached.valid && cached.matches && cached.matches.includes(expectedElement)
        };
      }
      return cached;
    }
    
    try {
      const matches = document.querySelectorAll(selector);
      const count = matches.length;
      const matchesArray = count <= 50 ? Array.from(matches) : null; // Only cache small arrays
      
      const result = {
        valid: count >= minMatches && count <= maxMatches,
        count,
        matches: matchesArray
      };
      
      if (expectedElement && matchesArray) {
        result.valid = result.valid && matchesArray.includes(expectedElement);
      }
      
      // Cache the result
      selectorTestCache.set(cacheKey, result);
      scheduleCleanup();
      
      return result;
    } catch(_) {
      const result = { valid: false, count: 0 };
      selectorTestCache.set(cacheKey, result);
      return result;
    }
  };

  // ---------- selector builders ----------

  function buildGeneric(el) {
    if (!(el instanceof Element)) return "*";
    
    // Check cache first
    if (selectorCache.has(el)) {
      return selectorCache.get(el).generic;
    }
    
    try {
      const MAX_MATCHES_TARGET = 200;
      const MIN_MATCHES_TARGET = 2;
      
      // Get cached semantic signature
      let signature = semanticCache.get(el);
      if (!signature) {
        signature = getSemanticSignature(el);
        semanticCache.set(el, signature);
      }
      
      const tag = el.tagName.toLowerCase();
      const isOverlyBroad = ['div', 'span', 'p', 'a', 'li', 'td', 'th', 'tr', 'img', 'input', 'button'].includes(tag);
      
      // Quick path for unique elements with good attributes
      if (signature.classes.length > 0) {
        for (let i = 0; i < Math.min(signature.classes.length, 2); i++) {
          const selector = `${tag}.${CSS.escape(signature.classes[i])}`;
          const result = testSelector(selector, el, MIN_MATCHES_TARGET, MAX_MATCHES_TARGET);
          if (result.valid) {
            selectorCache.set(el, { generic: selector });
            return selector;
          }
        }
      }
      
      // Try semantic container approach only if needed
      const containerInfo = findSemanticContainer(el);
      if (containerInfo) {
        const { container, commonClasses, commonDataAttrs } = containerInfo;
        const containerSelector = getMinimalContainerSelector(container);
        
        let targetSelector = tag;
        if (commonClasses.length > 0) {
          targetSelector += '.' + commonClasses.slice(0, 2).map(c => CSS.escape(c)).join('.');
        }
        if (commonDataAttrs.length > 0) {
          targetSelector += commonDataAttrs.slice(0, 1).map(attr => 
            `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`
          ).join('');
        }
        
        const fullSelector = containerSelector ? `${containerSelector} ${targetSelector}` : targetSelector;
        const result = testSelector(fullSelector, el, MIN_MATCHES_TARGET, MAX_MATCHES_TARGET);
        
        if (result.valid) {
          selectorCache.set(el, { generic: fullSelector });
          return fullSelector;
        }
        
        // Try simpler version
        if (containerSelector && targetSelector !== tag) {
          const simpleResult = testSelector(targetSelector, el, MIN_MATCHES_TARGET, MAX_MATCHES_TARGET);
          if (simpleResult.valid) {
            selectorCache.set(el, { generic: targetSelector });
            return targetSelector;
          }
        }
      }
      
      // Fallback logic - only if tag isn't too broad
      const tagResult = testSelector(tag, null, MIN_MATCHES_TARGET, MAX_MATCHES_TARGET);
      if (tagResult.valid && !isOverlyBroad) {
        selectorCache.set(el, { generic: tag });
        return tag;
      }
      
      // Last resort - build constrained selector
      const constrainedSelector = buildConstrainedGenericSelector(el);
      selectorCache.set(el, { generic: constrainedSelector });
      return constrainedSelector;
      
    } catch (err) {
      // Ultimate fallback
      try {
        const finderResult = finder(el).replace(/:nth-[^(]+\([^)]+\)/g, "");
        selectorCache.set(el, { generic: finderResult });
        return finderResult;
      } catch (_) { 
        const fallback = el.tagName.toLowerCase();
        selectorCache.set(el, { generic: fallback });
        return fallback;
      }
    }
  }
  
  // Helper: analyze semantic patterns in attributes and content  
  const getSemanticSignature = (() => {
    const contentPatternCache = new Map();
    
    return (node) => {
      if (semanticCache.has(node)) {
        return semanticCache.get(node);
      }
      
      const signature = {
        classes: getSemanticClasses(node),
        dataAttrs: [],
        roles: [],
        contentPattern: null
      };
      
      // Collect semantic data attributes and roles (optimized loop)
      const attrs = node.attributes;
      for (let i = 0; i < attrs.length; i++) {
        const attr = attrs[i];
        if (attr.name.startsWith('data-') && !looksUniqueToken(attr.value)) {
          signature.dataAttrs.push({name: attr.name, value: attr.value});
        } else if (attr.name === 'role' || attr.name === 'aria-label') {
          signature.roles.push({name: attr.name, value: attr.value});
        }
        // Limit collection to prevent excessive data
        if (signature.dataAttrs.length >= 3) break;
      }
      
      // Analyze content patterns for text-heavy elements (with caching)
      const text = node.textContent?.trim();
      if (text && text.length > 0 && text.length < 100) {
        if (contentPatternCache.has(text)) {
          signature.contentPattern = contentPatternCache.get(text);
        } else {
          let pattern = null;
          if (/^\$[\d,]+\.?\d*$/.test(text)) pattern = 'price';
          else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) pattern = 'date';
          else if (/^\d+$/.test(text)) pattern = 'number';
          else if (/^[A-Z][a-z]+ \d+$/.test(text)) pattern = 'month-day';
          
          signature.contentPattern = pattern;
          // Cache pattern result
          if (contentPatternCache.size < 200) {
            contentPatternCache.set(text, pattern);
          }
        }
      }
      
      semanticCache.set(node, signature);
      return signature;
    };
  })();
  
  // Helper: find the best semantic container for similar elements (optimized)
  const findSemanticContainer = (() => {
    const containerCache = new WeakMap();
    
    return (element) => {
      if (containerCache.has(element)) {
        return containerCache.get(element);
      }
      
      let current = element.parentElement;
      const candidates = [];
      let depth = 0;
      const MAX_DEPTH = 3; // Reduced from unlimited traversal
      
      while (current && current !== document.documentElement && depth < MAX_DEPTH) {
        const sameTagSiblings = getSameTagSiblings(element);
        
        if (sameTagSiblings.length >= 2) {
          const maxSiblingsToAnalyze = Math.min(sameTagSiblings.length, 8); // Reduced from 10
          const signatures = [];
          
          // Optimized signature collection
          for (let i = 0; i < maxSiblingsToAnalyze; i++) {
            signatures.push(getSemanticSignature(sameTagSiblings[i]));
          }
          
          const commonClasses = findCommonClasses(signatures);
          const commonDataAttrs = findCommonDataAttrs(signatures);
          const hasContentPattern = signatures.some(s => s.contentPattern);
          
          const score = calculateContainerScore(current, sameTagSiblings.length, commonClasses, commonDataAttrs, hasContentPattern);
          candidates.push({
            container: current,
            siblings: sameTagSiblings,
            commonClasses,
            commonDataAttrs,
            score
          });
        }
        current = current.parentElement;
        depth++;
      }
      
      // Return the best container (highest score)
      const result = candidates.length > 0 ? candidates.reduce((a, b) => a.score > b.score ? a : b) : null;
      containerCache.set(element, result);
      return result;
    };
  })();
  
  // Optimized common classes/attributes detection
  function findCommonClasses(signatures) {
    if (signatures.length < 2) return [];
    
    const classCounts = new Map();
    const threshold = Math.max(2, Math.ceil(signatures.length * 0.6));
    
    // Optimized counting
    for (const sig of signatures) {
      const seen = new Set(); // Avoid counting same class multiple times per signature
      for (const cls of sig.classes) {
        if (!seen.has(cls)) {
          seen.add(cls);
          classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
        }
      }
    }
    
    const result = [];
    for (const [cls, count] of classCounts) {
      if (count >= threshold && result.length < 2) { // Early termination
        result.push(cls);
      }
    }
    return result;
  }
  
  function findCommonDataAttrs(signatures) {
    if (signatures.length < 2) return [];
    
    const attrCounts = new Map();
    const threshold = Math.max(2, Math.ceil(signatures.length * 0.8));
    
    // Optimized counting
    for (const sig of signatures) {
      const seen = new Set();
      for (const attr of sig.dataAttrs) {
        const key = `${attr.name}=${attr.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          attrCounts.set(key, (attrCounts.get(key) || 0) + 1);
        }
      }
    }
    
    // Return only the first match to avoid over-processing
    for (const [key, count] of attrCounts) {
      if (count >= threshold) {
        const [name, value] = key.split('=');
        return [{name, value}];
      }
    }
    return [];
  }
  
  function calculateContainerScore(container, siblingCount, commonClasses, commonDataAttrs, hasContentPattern) {
    let score = Math.min(siblingCount * 10, 100);
    
    score += commonClasses.length * 15;
    score += commonDataAttrs.length * 20;
    if (hasContentPattern) score += 25;
    
    const tag = container.tagName.toLowerCase();
    if (['ul', 'ol', 'nav', 'section', 'main', 'article'].includes(tag)) score += 30;
    else if (['div'].includes(tag)) score += 5;
    
    return score;
  }
  
  // Simplified constrained selector builder
  function buildConstrainedGenericSelector(element) {
    const tag = element.tagName.toLowerCase();
    let signature = semanticCache.get(element);
    if (!signature) {
      signature = getSemanticSignature(element);
      semanticCache.set(element, signature);
    }
    
    // Try element's own semantic classes (simplified)
    if (signature.classes.length > 0) {
      const classSelector = `${tag}.${CSS.escape(signature.classes[0])}`;
      const result = testSelector(classSelector, element, 2, 200);
      if (result.valid) return classSelector;
    }
    
    // Try semantic data attributes
    if (signature.dataAttrs.length > 0) {
      const attr = signature.dataAttrs[0];
      const attrSelector = `${tag}[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
      const result = testSelector(attrSelector, element, 2, 200);
      if (result.valid) return attrSelector;
    }
    
    // Try parent context
    const parent = element.parentElement;
    if (parent && signature.classes.length > 0) {
      const parentSelector = getMinimalContainerSelector(parent);
      if (parentSelector) {
        const contextSelector = `${parentSelector} ${tag}.${CSS.escape(signature.classes[0])}`;
        const result = testSelector(contextSelector, element, 2, 200);
        if (result.valid) return contextSelector;
      }
    }
    
    // Last resort
    try {
      return finder(element);
    } catch(_) {
      return tag;
    }
  }
  
  function getMinimalContainerSelector(container) {
    const tag = container.tagName.toLowerCase();
    
    // Try ID first (if semantic)
    const id = container.getAttribute('id');
    if (id && !looksUniqueToken(id) && /^[a-z][a-z0-9-]*$/i.test(id)) {
      return `#${CSS.escape(id)}`;
    }
    
    // Try semantic classes
    const semanticClasses = [];
    for (const cls of container.classList) {
      if (!looksUniqueToken(cls) && /^[a-z][a-z-]*$/i.test(cls)) {
        semanticClasses.push(cls);
      }
    }
    
    if (semanticClasses.length > 0) {
      return `${tag}.${CSS.escape(semanticClasses[0])}`;
    }
    
    // Try semantic data attributes
    for (const attr of container.attributes) {
      if (attr.name.startsWith('data-') && !looksUniqueToken(attr.value) && attr.value.length < 20) {
        return `${tag}[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
      }
    }
    
    // For semantic HTML5 tags, tag alone might be sufficient
    if (['nav', 'main', 'article', 'section', 'header', 'footer', 'aside'].includes(tag)) {
      return tag;
    }
    
    return ''; // No good container selector found
  }

  function buildSpecific(el) {
    if (!(el instanceof Element)) return "*";
    
    // Check cache first
    if (selectorCache.has(el)) {
      return selectorCache.get(el).specific;
    }
    
    try {
      const tag = el.tagName.toLowerCase();
      
      // Priority 1: Unique ID (if not generated/random)
      const id = el.getAttribute('id');
      if (id && !looksUniqueToken(id)) {
        const idSelector = `#${CSS.escape(id)}`;
        selectorCache.set(el, { specific: idSelector });
        return idSelector;
      }
      
      // Priority 2: Unique data attributes
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') && !looksUniqueToken(attr.value)) {
          const selector = `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
          const result = testSelector(selector, null, 1, 1);
          if (result.valid) {
            selectorCache.set(el, { specific: selector });
            return selector;
          }
        }
      }
      
      // Priority 3: Unique combination of stable classes
      const stableClasses = getSemanticClasses(el);
      
      if (stableClasses.length > 0) {
        for (let i = 1; i <= Math.min(stableClasses.length, 2); i++) { // Reduced limit
          const classCombo = stableClasses.slice(0, i).map(c => `.${CSS.escape(c)}`).join('');
          const selector = `${tag}${classCombo}`;
          const result = testSelector(selector, null, 1, 1);
          if (result.valid) {
            selectorCache.set(el, { specific: selector });
            return selector;
          } else if (result.count > 1 && result.count <= 5) { // Reduced threshold
            // Add parent context to make it unique
            const parent = el.parentElement;
            if (parent) {
              const parentSelector = getMinimalContainerSelector(parent);
              if (parentSelector) {
                const contextSelector = `${parentSelector} ${selector}`;
                const contextResult = testSelector(contextSelector, null, 1, 1);
                if (contextResult.valid) {
                  selectorCache.set(el, { specific: contextSelector });
                  return contextSelector;
                }
              }
            }
          }
        }
      }
      
      // Priority 4: Use finder library with optimization
      let finderResult = finder(el);
      
      // Try to simplify finder result by removing unnecessary nth-child selectors
      const simplified = finderResult.replace(/:nth-child\(\d+\)(?=\s|$)/g, '');
      if (simplified !== finderResult) {
        const result = testSelector(simplified, null, 1, 1);
        if (result.valid) {
          selectorCache.set(el, { specific: simplified });
          return simplified;
        }
      }
      
      selectorCache.set(el, { specific: finderResult });
      return finderResult;
      
    } catch (err) {
      // Final fallback to finder
      try {
        const fallback = finder(el);
        selectorCache.set(el, { specific: fallback });
        return fallback;
      } catch (_) {
        // Ultimate fallback
        const tag = el.tagName.toLowerCase();
        const parent = el.parentElement;
        if (parent) {
          const siblings = getSameTagSiblings(el);
          const index = siblings.indexOf(el) + 1;
          const fallback = `${tag}:nth-of-type(${index})`;
          selectorCache.set(el, { specific: fallback });
          return fallback;
        }
        selectorCache.set(el, { specific: tag });
        return tag;
      }
    }
  }

  // ---------- overlays ----------
  const isPickerNode = (n) =>
    !!(n && n.closest && n.closest('[data-picker-ui="1"]'));
  function clearMatches() {
    while (matchesLayer.firstChild)
      matchesLayer.removeChild(matchesLayer.firstChild);
  }
  function boxForRect(rect, cls = "picker-match-box") {
    const d = document.createElement("div");
    d.className = cls;
    d.setAttribute("data-picker-ui", "1");
    d.style.left = rect.left + "px";
    d.style.top = rect.top + "px";
    d.style.width = rect.width + "px";
    d.style.height = rect.height + "px";
    return d;
  }
  // Optimized DOM queries with batching
  function drawHighlightsFor(el, sel) {
    clearMatches();
    
    let matches = [];
    try {
      const matchQuery = document.querySelectorAll(sel);
      // Convert NodeList to Array only for processing
      matches = matchQuery.length <= 1200 ? Array.from(matchQuery) : Array.from(matchQuery).slice(0, 1200);
    } catch (_) {
      // Invalid selector, show just the target element
      const r0 = getCachedBoundingRect(el);
      if (r0.width && r0.height) {
        hoverBox.style.cssText = `display:block;left:${r0.left}px;top:${r0.top}px;width:${r0.width}px;height:${r0.height}px`;
        hoverBox.classList.toggle("locked", !!locked);
      } else {
        hoverBox.style.display = "none";
      }
      return;
    }
    
    const fragment = document.createDocumentFragment();
    const boxElements = []; // Batch style applications
    
    for (const m of matches) {
      if (!(m instanceof Element) || m === el || isPickerNode(m)) continue;
      
      const r = getCachedBoundingRect(m);
      if (!r.width || !r.height) continue;
      
      const box = document.createElement("div");
      box.className = locked ? "picker-match-box locked" : "picker-match-box";
      box.setAttribute("data-picker-ui", "1");
      
      // Batch style setting
      boxElements.push({
        element: box,
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height
      });
      
      fragment.appendChild(box);
    }
    
    // Apply styles in batch
    for (const {element, left, top, width, height} of boxElements) {
      element.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    }
    
    matchesLayer.appendChild(fragment);
    
    // Update hover box
    const r0 = getCachedBoundingRect(el);
    if (!r0.width || !r0.height) {
      hoverBox.style.display = "none";
    } else {
      hoverBox.style.cssText = `display:block;left:${r0.left}px;top:${r0.top}px;width:${r0.width}px;height:${r0.height}px`;
      hoverBox.classList.toggle("locked", !!locked);
    }
  }

  // ---------- selection & UI updates ----------
  const currentTarget = () => (locked ? lockedTarget : hoveredTarget);
  function computeSelectorsFor(el) {
    // Check if we have cached results
    const cached = selectorCache.get(el);
    if (cached && cached.generic && cached.specific) {
      selectorGeneric = cached.generic;
      selectorSpecific = cached.specific;
    } else {
      selectorGeneric = buildGeneric(el);
      selectorSpecific = buildSpecific(el);
      
      // Update cache with both selectors
      selectorCache.set(el, { 
        generic: selectorGeneric, 
        specific: selectorSpecific 
      });
    }
    
    // Ensure generic and specific selectors are different
    ensureSelectorDiversity(el);
    
    // Update cache with final selectors
    selectorCache.set(el, { 
      generic: selectorGeneric, 
      specific: selectorSpecific 
    });
  }
  
  function ensureSelectorDiversity(el) {
    // Quick exit if selectors are already different
    if (selectorGeneric !== selectorSpecific) return;
    
    // Strategy 1: Make generic selector broader by removing constraints
    let broaderGeneric = makeSelectorBroader(selectorGeneric);
    
    if (broaderGeneric && broaderGeneric !== selectorGeneric) {
      const result = testSelector(broaderGeneric, el, 2, 200);
      if (result.valid) {
        selectorGeneric = broaderGeneric;
        return;
      }
    }
    
    // Strategy 2: Make specific selector more specific
    let moreSpecific = makeSelectorMoreSpecific(selectorSpecific, el);
    
    if (moreSpecific && moreSpecific !== selectorSpecific) {
      const result = testSelector(moreSpecific, null, 1, 1);
      if (result.valid && result.matches && result.matches[0] === el) {
        selectorSpecific = moreSpecific;
        return;
      }
    }
    
    // Strategy 3: Generate alternative generic selector (simplified)
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    
    if (parent) {
      const parentTag = parent.tagName.toLowerCase();
      const parentChildSelector = `${parentTag} ${tag}`;
      const result = testSelector(parentChildSelector, el, 2, 200);
      if (result.valid) {
        selectorGeneric = parentChildSelector;
        return;
      }
    }
    
    // Strategy 4: Use tag-based generic as last resort (if not too broad)
    const broadTags = ['div', 'span', 'p', 'a', 'li', 'td', 'th', 'tr', 'img', 'input', 'button'];
    
    if (!broadTags.includes(tag)) {
      const tagResult = testSelector(tag, null, 2, 200);
      if (tagResult.valid) {
        selectorGeneric = tag;
      }
    }
  }
  
  function makeSelectorBroader(selector) {
    // Remove the last part of a descendant selector
    if (selector.includes(' ')) {
      const parts = selector.split(' ');
      if (parts.length > 1) {
        return parts.slice(1).join(' ');
      }
    }
    
    // Remove classes from the selector
    if (selector.includes('.')) {
      const withoutLastClass = selector.replace(/\.[^.\s\[]+$/, '');
      if (withoutLastClass && withoutLastClass !== selector) {
        return withoutLastClass;
      }
      
      const tagOnly = selector.replace(/\.[^.\s\[]+/g, '').replace(/\[[^\]]+\]/g, '');
      if (tagOnly && tagOnly !== selector) {
        return tagOnly;
      }
    }
    
    // Remove attribute selectors
    if (selector.includes('[')) {
      const withoutAttrs = selector.replace(/\[[^\]]+\]/g, '');
      if (withoutAttrs && withoutAttrs !== selector) {
        return withoutAttrs;
      }
    }
    
    return null;
  }
  
  function makeSelectorMoreSpecific(selector, el) {
    // Add an ID if element has one and it's not already in the selector
    const id = el.getAttribute('id');
    if (id && !selector.includes('#') && !looksUniqueToken(id)) {
      return `#${CSS.escape(id)}`;
    }
    
    // Add more classes if available
    const classes = getSemanticClasses(el).filter(cls => !selector.includes(`.${cls}`));
    
    if (classes.length > 0) {
      return selector + `.${CSS.escape(classes[0])}`;
    }
    
    // Add data attributes
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && !looksUniqueToken(attr.value)) {
        const attrSelector = `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
        if (!selector.includes(attrSelector)) {
          return selector + attrSelector;
        }
      }
    }
    
    // Add positional specificity as last resort
    const parent = el.parentElement;
    if (parent && !selector.includes(':nth-')) {
      const siblings = getSameTagSiblings(el);
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        return `${selector}:nth-of-type(${index})`;
      }
    }
    
    return null;
  }
  
  // Cache DOM queries for UI elements
  const uiElements = {
    get genericText() {
      if (!this._genericText) {
        this._genericText = results.querySelector(
          '.picker-row[data-kind="generic"] [data-role="label"] .pill-text'
        );
      }
      return this._genericText;
    },
    get specificText() {
      if (!this._specificText) {
        this._specificText = results.querySelector(
          '.picker-row[data-kind="specific"] [data-role="label"] .pill-text'
        );
      }
      return this._specificText;
    }
  };
  
  function updateResultsUI(targetEl) {
    if (!targetEl) {
      results.style.display = "none";
      results.classList.remove("locked");
      return;
    }
    
    uiElements.genericText.textContent = trim(selectorGeneric, PILL_MAX_CHARS);
    uiElements.specificText.textContent = trim(selectorSpecific, PILL_MAX_CHARS);
    results.style.display = "flex";
    results.classList.toggle("locked", !!locked);
  }
  function updateVisuals() {
    const tgt = currentTarget();
    if (!pickMode || !tgt) {
      results.style.display = pickMode ? "flex" : "none";
      hoverBox.style.display = "none";
      clearMatches();
      hideCssOverlay();
      return;
    }
    drawHighlightsFor(tgt, selectorGeneric);
    updateResultsUI(tgt);
  }
  function setLockedTarget(el) {
    if (!(el instanceof Element) || isPickerNode(el)) return false;
    locked = true;
    lockedTarget = el;
    computeSelectorsFor(el);
    updateVisuals();
    return true;
  }

  // ---------- elementFromPoint ignoring UI ----------
  function elementFromPointIgnoreUI(x, y) {
    const old = results.style.pointerEvents;
    results.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    results.style.pointerEvents = old;
    return el;
  }

  // ---------- pointer & touch (drag-to-hover) ----------
  function queueFromXY(x, y) {
    if (!pickMode || locked) return;
    pendingXY = { x, y };
    if (!rafScheduledHover) {
      rafScheduledHover = true;
      requestAnimationFrame(() => {
        rafScheduledHover = false;
        const p = pendingXY;
        pendingXY = null;
        if (!p || !pickMode || locked) return;
        
        let target = elementFromPointIgnoreUI(p.x, p.y);
        if (!(target instanceof Element)) return;
        if (isPickerNode(target)) return;
        
        target = snapCandidate(target, p.x, p.y);
        
        if (!(target instanceof Element)) {
          // Clear state efficiently
          hoveredTarget = null;
          selectorGeneric = "";
          selectorSpecific = "";
          results.style.display = "none";
          hoverBox.style.display = "none";
          hoverBox.classList.remove("locked");
          clearMatches();
          return;
        }
        
        // Only update if target changed to avoid redundant work
        if (hoveredTarget !== target) {
          hoveredTarget = target;
          computeSelectorsFor(target);
          updateVisuals();
        }
      });
    }
  }

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!pickMode) return;
      pdX = e.clientX;
      pdY = e.clientY;
      pdTime = performance.now();
      if (!uiContains(e.target)) queueFromXY(e.clientX, e.clientY);
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!pickMode) return;
      if (!locked) queueFromXY(e.clientX, e.clientY);
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    "pointerup",
    (e) => {
      if (!pickMode) return;
      if (uiContains(e.target)) return;
      const dt = performance.now() - pdTime;
      const d = Math.hypot(e.clientX - pdX || 0, e.clientY - pdY || 0);
      if (dt <= TAP_MS && d <= TAP_DIST) {
        if (!locked) {
          if (hoveredTarget instanceof Element) {
            locked = true;
            lockedTarget = hoveredTarget;
          }
        } else {
          locked = false;
          lockedTarget = null;
          hoverBox.classList.remove("locked");
          // Unlocking should also clear any pinned overlay
          overlayPinned = false;
          lastOverlayKind = null;
          clearAllCssButtonActive();
          // Now we can safely hide
          cssOverlay.style.display = "none";
        }
        updateVisuals();
      }
    },
    { capture: true, passive: true }
  );

  // Touch feed -> drag-to-hover + prevent scroll during drag (unlocked)
  document.addEventListener(
    "touchstart",
    (e) => {
      activeTouchCount = e.touches.length;
      // Note: Touch coordinates are handled in touchmove for active dragging
    },
    { capture: true }
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pickMode) return;
      if (e.touches.length === 1 && !locked) {
        const t = e.touches[0];
        if (t) {
          queueFromXY(t.clientX, t.clientY);
        }
        const el = elementFromPointIgnoreUI(t.clientX, t.clientY);
        if (!isPickerNode(el)) e.preventDefault(); // prevent scroll while precision-dragging
      }
      activeTouchCount = e.touches.length;
    },
    { capture: true, passive: false }
  );
  document.addEventListener(
    "touchend",
    (e) => {
      activeTouchCount = e.touches.length;
    },
    { capture: true }
  );
  document.addEventListener(
    "touchcancel",
    () => {
      activeTouchCount = 0;
    },
    { capture: true }
  );

  // ---------- disable page actions while picker ON ----------
  const cancelPageAction = (e) => {
    if (!pickMode) return;
    if (uiContains(e.target)) return; // allow UI
    e.preventDefault();
    e.stopPropagation();
  };
  for (const type of [
    "click",
    "mousedown",
    "mouseup",
    "pointerup",
    "dblclick",
    "submit",
  ]) {
    document.addEventListener(type, cancelPageAction, true);
  }

  // ---------- traversal / hide actions ----------
  function validElement(el) {
    return el && el instanceof Element && !isPickerNode(el);
  }
  function firstValidChild(el) {
    let c = el && el.firstElementChild;
    while (c && isPickerNode(c)) c = c.nextElementSibling;
    return c;
  }
  function prevValidSibling(el) {
    let p = el && el.previousElementSibling;
    while (p && isPickerNode(p)) p = p.previousElementSibling;
    return p;
  }
  function nextValidSibling(el) {
    let n = el && el.nextElementSibling;
    while (n && isPickerNode(n)) n = n.nextElementSibling;
    return n;
  }

  function traverse(kind, action) {
    let base = currentTarget();
    if (!base) return;
    if (!locked) {
      if (!setLockedTarget(base)) return;
      base = lockedTarget;
    }

    let target = null;
    if (kind === "specific") {
      // siblings
      if (action === "prev") target = prevValidSibling(base);
      else if (action === "next") target = nextValidSibling(base);
    } else {
      // generic: parents / children
      if (action === "parent")
        target = validElement(base.parentElement) ? base.parentElement : null;
      else if (action === "child") target = firstValidChild(base);
    }

    const labelText = results.querySelector(
      `.picker-row[data-kind="${kind}"] [data-role="label"] .pill-text`
    );
    if (validElement(target)) {
      setLockedTarget(target);
    } else {
      const msg =
        action === "parent"
          ? "No parent"
          : action === "child"
          ? "No child"
          : action === "prev"
          ? "No prev sibling"
          : "No next sibling";
      const restore = kind === "generic" ? selectorGeneric : selectorSpecific;
      if (labelText) {
        const r = restore;
        labelText.textContent = msg;
        setTimeout(() => {
          labelText.textContent = trim(r, PILL_MAX_CHARS);
        }, 900);
      }
    }
  }

  // copy on pill click (mouse + touch + pen)
  const copyFromPill = async (pillEl) => {
    const row = pillEl.closest(".picker-row");
    const labelText = pillEl.querySelector(".pill-text");
    const kind = row?.getAttribute("data-kind");
    const full = kind === "generic" ? selectorGeneric : selectorSpecific;
    await copyText(full);
    const restore = full;
    labelText.textContent = "Copied";
    setTimeout(() => {
      labelText.textContent = trim(restore, PILL_MAX_CHARS);
    }, 900);
  };
  results.addEventListener("click", (e) => {
    if (e.target.closest(".pill-lock") || e.target.closest(".action-btn"))
      return; // ignore lock/action clicks
    const pillEl = e.target.closest(".selector-pill");
    if (!pillEl) return;
    e.preventDefault();
    e.stopPropagation();
    copyFromPill(pillEl);
  });
  results.addEventListener("pointerup", (e) => {
    if (e.target.closest(".pill-lock") || e.target.closest(".action-btn"))
      return; // ignore lock/action taps
    const pillEl = e.target.closest(".selector-pill");
    if (!pillEl) return;
    e.preventDefault();
    e.stopPropagation();
    copyFromPill(pillEl);
  });

  // action buttons (traverse / hide)
  results.addEventListener("click", (e) => {
    const btn = e.target.closest(".action-btn");
    if (!btn) return;
    const row = btn.closest(".picker-row");
    const kind = row?.getAttribute("data-kind");
    const action = btn.getAttribute("data-action");
    if (action === "css") return; // let CSS overlay handler handle this click
    e.preventDefault();
    e.stopPropagation();
    if (action === "hide") {
      const tgt = currentTarget();
      if (!tgt) return;
      const sel =
        kind === "specific"
          ? selectorSpecific || buildSpecific(tgt)
          : selectorGeneric || buildGeneric(tgt);
      addHideRule(sel);
      const labelText = row.querySelector(".pill-text");
      if (labelText) {
        const r = sel;
        labelText.textContent = "Hidden";
        setTimeout(() => {
          labelText.textContent = trim(r, PILL_MAX_CHARS);
        }, 900);
      }
      return;
    }
    traverse(kind, action);
  });

  // ---------- Computed CSS utilities ----------
  const CSS_PROP_WHITELIST = [
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "z-index",
    "box-sizing",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-radius",
    "outline-width",
    "outline-style",
    "outline-color",
    "background-color",
    "background-image",
    "background-repeat",
    "background-position",
    "background-size",
    "background-attachment",
    "background-clip",
    "background-origin",
    "color",
    "opacity",
    "visibility",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-variant",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-align",
    "text-transform",
    "text-decoration-line",
    "text-decoration-color",
    "text-decoration-style",
    "text-decoration-thickness",
    "white-space",
    "vertical-align",
    "overflow",
    "overflow-x",
    "overflow-y",
    "pointer-events",
    "cursor",
    "box-shadow",
    "transform",
    "transform-origin",
    "transform-style",
    "perspective",
    "perspective-origin",
    "backface-visibility",
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
    "filter",
    "mix-blend-mode",
    "isolation",
    "flex",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "flex-direction",
    "flex-wrap",
    "align-items",
    "align-self",
    "align-content",
    "justify-content",
    "justify-items",
    "justify-self",
    "gap",
    "row-gap",
    "column-gap",
    "grid-template-columns",
    "grid-template-rows",
    "grid-template-areas",
    "grid-auto-columns",
    "grid-auto-rows",
    "grid-auto-flow",
    "place-items",
    "place-content",
    "place-self",
    "contain",
    "content",
    "will-change",
  ];
  const TRIVIAL_BY_VALUE = new Set([
    "",
    "none",
    "normal",
    "auto",
    "0",
    "0px",
    "0s",
    "0ms",
    "rgba(0, 0, 0, 0)",
  ]);
  function isTrivial(prop, val) {
    const v = String(val).trim();
    if (TRIVIAL_BY_VALUE.has(v)) {
      // allow certain zeros to show if they matter
      if (
        v === "0px" &&
        /margin|padding|border-.*-width|outline-width/.test(prop)
      )
        return false;
      if (v === "0" && /(opacity)/.test(prop)) return false;
      return true;
    }
    if (prop.startsWith("-")) return true; // vendor
    if (
      prop.includes("transition") &&
      (v === "all 0s ease 0s" || v === "0s ease 0s")
    )
      return true;
    if (/^border-.*-style$/.test(prop) && v === "none") return true;
    if (/^border-.*-width$/.test(prop) && (v === "0px" || v === "0"))
      return true;
    if (/^outline-/.test(prop) && (v === "none" || v === "0px")) return true;
    if (
      (prop === "box-shadow" ||
        prop === "text-decoration-line" ||
        prop === "background-image" ||
        prop === "filter" ||
        prop === "transform") &&
      v === "none"
    )
      return true;
    return false;
  }
  function buildComputedCSSText(sel, el) {
    try {
      const cs = getComputedStyle(el);
      const lines = [];
      for (const prop of CSS_PROP_WHITELIST) {
        const val = cs.getPropertyValue(prop);
        if (!isTrivial(prop, val)) lines.push(`  ${prop}: ${val};`);
      }
      // If nothing made it through, fall back to a minimal useful subset
      if (!lines.length) {
        const fallback = [
          "display",
          "position",
          "width",
          "height",
          "margin-top",
          "margin-right",
          "margin-bottom",
          "margin-left",
          "padding-top",
          "padding-right",
          "padding-bottom",
          "padding-left",
          "color",
          "background-color",
          "font-size",
          "font-weight",
          "line-height",
        ];
        for (const p of fallback) {
          const v = cs.getPropertyValue(p);
          if (v && !TRIVIAL_BY_VALUE.has(v)) lines.push(`  ${p}: ${v};`);
        }
      }
      return `${sel} {\n${lines.join("\n")}\n}`;
    } catch (_) {
      return `${sel} {\n  /* unable to compute styles */\n}`;
    }
  }

  let cssOverlayHideTimer = null;
  function positionCssOverlayNear(rect) {
    cssOverlay.style.display = "block";
    cssOverlay.style.visibility = "hidden";
    // initial paint to measure
    const pad = 8;
    const wantBelow = window.innerHeight - rect.bottom >= 160; // enough space below
    const topCand = wantBelow
      ? rect.bottom + 8
      : Math.max(8, rect.top - cssOverlay.offsetHeight - 8);
    let left = Math.min(
      Math.max(8, rect.right - cssOverlay.offsetWidth),
      Math.max(8, window.innerWidth - cssOverlay.offsetWidth - 8)
    );
    if (!isFinite(left))
      left = Math.max(8, Math.min(rect.left, window.innerWidth - 320));
    cssOverlay.style.left = `${Math.round(left)}px`;
    cssOverlay.style.top = `${Math.round(topCand)}px`;
    cssOverlay.style.visibility = "visible";
  }
  function showCssOverlayFor(kind) {
    if (!locked || !lockedTarget) return;
    // Cancel any pending hide
    if (cssOverlayHideTimer) {
      clearTimeout(cssOverlayHideTimer);
      cssOverlayHideTimer = null;
    }
    const sel = kind === "generic" ? selectorGeneric : selectorSpecific;
    const cssCode = buildComputedCSSText(sel, lockedTarget);
    const codeEl = cssOverlay.querySelector(".css-ov-code");
    codeEl.textContent = cssCode;
    const cssBtn = results.querySelector(
      `.picker-row[data-kind="${kind}"] .action-btn[data-action="css"]`
    );
    if (cssBtn) {
      const r = cssBtn.getBoundingClientRect();
      positionCssOverlayNear(r);
    }
  }
  function hideCssOverlay() {
    // Don't auto-hide if the user pinned it open
    if (overlayPinned) return;
    cssOverlay.style.display = "none";
  }

  // Button helpers for active state
  function getCssBtn(kind) {
    return results.querySelector(
      `.picker-row[data-kind="${kind}"] .action-btn[data-action="css"]`
    );
  }
  function setCssButtonActive(kind, on) {
    const b = getCssBtn(kind);
    if (b) b.classList.toggle("active", !!on);
  }
  function clearAllCssButtonActive() {
    setCssButtonActive("generic", false);
    setCssButtonActive("specific", false);
  }

  // copy in overlay
  cssOverlay.addEventListener("click", (e) => {
    const btn = e.target.closest(".css-ov-copy");
    if (!btn) return;
    const code = cssOverlay.querySelector(".css-ov-code")?.textContent || "";
    e.preventDefault();
    e.stopPropagation();
    copyText(code).then(() => {
      const prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = prev;
      }, 900);
    });
  });
  cssOverlay.addEventListener("pointerleave", () => {
    // If pinned, keep it open
    if (overlayPinned) return;
    cssOverlayHideTimer = setTimeout(hideCssOverlay, 120);
  });
  cssOverlay.addEventListener("pointerenter", () => {
    if (cssOverlayHideTimer) {
      clearTimeout(cssOverlayHideTimer);
      cssOverlayHideTimer = null;
    }
  });

  // CSS button interactions (hover/tap) - optimized event handling
  results.addEventListener("pointerover", (e) => {
    const cssBtn = e.target.closest('.action-btn[data-action="css"]');
    if (!cssBtn || !locked || overlayPinned) return;
    
    const row = cssBtn.closest(".picker-row");
    const kind = row?.getAttribute("data-kind");
    if (!kind) return;
    
    if (cssOverlayHideTimer) {
      clearTimeout(cssOverlayHideTimer);
      cssOverlayHideTimer = null;
    }
    showCssOverlayFor(kind);
  });
  
  results.addEventListener("pointerout", (e) => {
    const cssBtn = e.target.closest('.action-btn[data-action="css"]');
    if (!cssBtn || overlayPinned) return;
    
    if (cssOverlayHideTimer) clearTimeout(cssOverlayHideTimer);
    cssOverlayHideTimer = setTimeout(hideCssOverlay, 160);
  });
  results.addEventListener("click", (e) => {
    const cssBtn = e.target.closest('.action-btn[data-action="css"]');
    if (!cssBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const row = cssBtn.closest(".picker-row");
    const kind = row?.getAttribute("data-kind");
    if (!kind) return;
    if (!locked) return;

    // Toggle pinning. Clicking the other button swaps content while staying pinned.
    if (!overlayPinned) {
      overlayPinned = true;
      lastOverlayKind = kind;
      if (cssOverlayHideTimer) {
        clearTimeout(cssOverlayHideTimer);
        cssOverlayHideTimer = null;
      }
      clearAllCssButtonActive();
      setCssButtonActive(kind, true);
      showCssOverlayFor(kind);
    } else {
      if (lastOverlayKind === kind) {
        overlayPinned = false;
        lastOverlayKind = null;
        clearAllCssButtonActive();
        // Allow hiding now that it's unpinned
        hideCssOverlay();
      } else {
        lastOverlayKind = kind;
        if (cssOverlayHideTimer) {
          clearTimeout(cssOverlayHideTimer);
          cssOverlayHideTimer = null;
        }
        clearAllCssButtonActive();
        setCssButtonActive(kind, true);
        showCssOverlayFor(kind);
      }
    }
  });

  // Ensure first tap opens overlay on touch/pen (without requiring a second tap)
  results.addEventListener("pointerup", (e) => {
    const cssBtn = e.target.closest('.action-btn[data-action="css"]');
    if (!cssBtn) return;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    e.preventDefault();
    e.stopPropagation();
    const row = cssBtn.closest(".picker-row");
    const kind = row?.getAttribute("data-kind");
    if (!kind || !locked) return;

    if (!overlayPinned) {
      overlayPinned = true;
      lastOverlayKind = kind;
      if (cssOverlayHideTimer) {
        clearTimeout(cssOverlayHideTimer);
        cssOverlayHideTimer = null;
      }
      clearAllCssButtonActive();
      setCssButtonActive(kind, true);
      showCssOverlayFor(kind);
    } else {
      if (lastOverlayKind === kind) {
        overlayPinned = false;
        lastOverlayKind = null;
        clearAllCssButtonActive();
        hideCssOverlay();
      } else {
        lastOverlayKind = kind;
        if (cssOverlayHideTimer) {
          clearTimeout(cssOverlayHideTimer);
          cssOverlayHideTimer = null;
        }
        clearAllCssButtonActive();
        setCssButtonActive(kind, true);
        showCssOverlayFor(kind);
      }
    }
  });

  // ---------- snapping logic (optimized) ----------
  const SNAP_EDGE_PX = 12,
    SIMILAR_SIDE_PX = 16,
    SIMILAR_AREA_RATIO = 1.35;
    
  const rectLike = (a, b) => {
    const aw = a.width,
      ah = a.height,
      bw = b.width,
      bh = b.height;
    if (!aw || !ah || !bw || !bh) return false;
    
    const similarSides =
      Math.abs(a.left - b.left) <= SIMILAR_SIDE_PX &&
      Math.abs(a.top - b.top) <= SIMILAR_SIDE_PX &&
      Math.abs(a.right - b.right) <= SIMILAR_SIDE_PX &&
      Math.abs(a.bottom - b.bottom) <= SIMILAR_SIDE_PX;
    
    if (similarSides) return true;
    
    const arA = aw * ah,
      arB = bw * bh,
      ratio = arA > arB ? arA / arB : arB / arA;
    return ratio <= SIMILAR_AREA_RATIO;
  };
  
  const distToRectEdge = (r, x, y) =>
    Math.min(
      Math.abs(x - r.left),
      Math.abs(r.right - x),
      Math.abs(y - r.top),
      Math.abs(r.bottom - y)
    );
    
  const pointInRect = (r, x, y) =>
    x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    
  function nearestBoundaryChild(el, x, y, parentRect) {
    const maxChildren = Math.min(el.children.length, 30); // Reduced from 50
    let best = null,
      bestEdge = Infinity;
      
    for (let i = 0; i < maxChildren; i++) {
      const c = el.children[i];
      if (!(c instanceof Element)) continue;
      
      const cr = getCachedBoundingRect(c);
      if (!cr.width || !cr.height) continue;
      if (!pointInRect(cr, x, y)) continue;
      
      const elRect = getCachedBoundingRect(el);
      if (
        !(
          rectLike(cr, elRect) ||
          (parentRect && rectLike(cr, parentRect))
        )
      )
        continue;
        
      const d = distToRectEdge(cr, x, y);
      if (d <= SNAP_EDGE_PX && d < bestEdge) {
        best = c;
        bestEdge = d;
      }
    }
    return best;
  }
  
  function snapCandidate(el, x, y) {
    if (!(el instanceof Element)) return el;
    
    const r = getCachedBoundingRect(el);
    const p = el.parentElement;
    let parentPick = null,
      dParent = Infinity;
      
    if (p && p instanceof Element) {
      const pr = getCachedBoundingRect(p);
      const dEdge = distToRectEdge(r, x, y);
      if (dEdge <= SNAP_EDGE_PX && rectLike(pr, r)) {
        parentPick = p;
        dParent = Math.min(
          Math.abs(x - pr.left),
          Math.abs(pr.right - x),
          Math.abs(y - pr.top),
          Math.abs(pr.bottom - y)
        );
      }
    }
    
    const childPick = nearestBoundaryChild(
      el,
      x,
      y,
      p ? getCachedBoundingRect(p) : null
    );
    
    if (parentPick && childPick) {
      const cr = getCachedBoundingRect(childPick);
      const dChild = distToRectEdge(cr, x, y);
      return dParent <= dChild ? parentPick : childPick;
    }
    return parentPick || childPick || el;
  }

  // ---------- block pinch-zoom while picker ON ----------
  const preventZoomGesture = (e) => {
    if (pickMode) {
      e.preventDefault();
    }
  };
  const preventCtrlWheel = (e) => {
    if (pickMode && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
    }
  };
  function enableZoomSuppression() {
    if (zoomSuppressOn) return;
    document.addEventListener("gesturestart", preventZoomGesture, {
      passive: false,
      capture: true,
    });
    document.addEventListener("gesturechange", preventZoomGesture, {
      passive: false,
      capture: true,
    });
    document.addEventListener("gestureend", preventZoomGesture, {
      passive: false,
      capture: true,
    });
    document.addEventListener("wheel", preventCtrlWheel, {
      passive: false,
      capture: true,
    });
    document.addEventListener("dblclick", preventZoomGesture, {
      passive: false,
      capture: true,
    });
    zoomSuppressOn = true;
  }
  function disableZoomSuppression() {
    if (!zoomSuppressOn) return;
    document.removeEventListener("gesturestart", preventZoomGesture, {
      capture: true,
    });
    document.removeEventListener("gesturechange", preventZoomGesture, {
      capture: true,
    });
    document.removeEventListener("gestureend", preventZoomGesture, {
      capture: true,
    });
    document.removeEventListener("wheel", preventCtrlWheel, { capture: true });
    document.removeEventListener("dblclick", preventZoomGesture, {
      capture: true,
    });
    zoomSuppressOn = false;
  }

  // ---------- scroll sync (hide while scrolling, redraw on settle) ----------
  let scrolling = false,
    scrollTimer = null;
    
  const onAnyScroll = () => {
    if (!pickMode) return;
    if (!scrolling) {
      scrolling = true;
      hoverBox.style.display = "none";
      clearMatches();
      hideCssOverlay();
      // Clear bounding rect cache on scroll since positions change
      boundingRectCache.clear && boundingRectCache.clear();
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;
      if (pickMode) {
        // Clear cache again before redraw
        boundingRectCache.clear && boundingRectCache.clear();
        updateVisuals();
      }
    }, 140);
  };
  
  // Use optimized scroll listener
  const scrollOptions = { capture: true, passive: true };
  window.addEventListener("scroll", onAnyScroll, scrollOptions);
  document.addEventListener("scroll", onAnyScroll, scrollOptions);

  // Redraw on resize (debounce not strictly necessary)
  window.addEventListener(
    "resize",
    () => {
      if (pickMode && currentTarget()) updateVisuals();
    },
    { capture: true, passive: true }
  );

  // ---------- mode toggles (grabber + hotkey) ----------
  function applyZoomPolicy() {
    if (pickMode) enableZoomSuppression();
    else disableZoomSuppression();
  }

  function setPickMode(on) {
    pickMode = !!on;
    grabber.classList.toggle("active", pickMode);
    locked = false;
    lockedTarget = null;
    hoveredTarget = null;
    selectorGeneric = "";
    selectorSpecific = "";
    results.style.display = "none";
    results.classList.remove("locked");
    hoverBox.style.display = "none";
    clearMatches();
    
    // Reset any pinned overlay when leaving/entering mode
    overlayPinned = false;
    lastOverlayKind = null;
    clearAllCssButtonActive();
    hideCssOverlay();
    
    // Clear caches when toggling modes to prevent stale data
    if (!pickMode) {
      boundingRectCache.clear && boundingRectCache.clear();
      selectorTestCache.clear();
    }
    
    applyZoomPolicy();
  }

  // Tap the grabber to toggle
  grabber.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPickMode(!pickMode);
    },
    { passive: false }
  );

  // Hotkey
  document.addEventListener(
    "keydown",
    (e) => {
      const ae = document.activeElement;
      const typing =
        ae &&
        (ae.tagName === "INPUT" ||
          ae.tagName === "TEXTAREA" ||
          ae.isContentEditable);
      if (typing) return;
      if (e.metaKey && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        e.stopPropagation();
        setPickMode(!pickMode);
      }
    },
    true
  );
})();
