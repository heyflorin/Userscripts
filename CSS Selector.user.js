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
  document.documentElement.appendChild(results);
  // Replace direct appends to document root with scoped root
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
  let lastTouchX = 0,
    lastTouchY = 0;

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

  // ---------- selector builders ----------

  function buildGeneric(el) {
    if (!(el instanceof Element)) return "*";
    
    try {
      const MAX_MATCHES_TARGET = 200;     // acceptable upper bound of generic breadth
      const MIN_MATCHES_TARGET = 2;       // we want at least a couple similar nodes
      const OPTIMAL_MATCHES_TARGET = 20;  // sweet spot for generic selectors
      
      // Helper: analyze semantic patterns in attributes and content
      function getSemanticSignature(node) {
        const signature = {
          classes: [],
          dataAttrs: [],
          roles: [],
          contentPattern: null
        };
        
        // Collect semantic classes (avoid generated/unique ones)
        for (const cls of node.classList) {
          if (!looksUniqueToken(cls) && /^[a-z][a-z-]*[a-z]$/i.test(cls)) {
            signature.classes.push(cls);
          }
        }
        
        // Collect semantic data attributes
        for (const attr of node.attributes) {
          if (attr.name.startsWith('data-') && !looksUniqueToken(attr.value)) {
            signature.dataAttrs.push({name: attr.name, value: attr.value});
          }
          if (attr.name === 'role' || attr.name === 'aria-label') {
            signature.roles.push({name: attr.name, value: attr.value});
          }
        }
        
        // Analyze content patterns for text-heavy elements
        const text = node.textContent?.trim();
        if (text && text.length > 0 && text.length < 100) {
          // Look for patterns like prices, dates, numbers, etc.
          if (/^\$[\d,]+\.?\d*$/.test(text)) signature.contentPattern = 'price';
          else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) signature.contentPattern = 'date';
          else if (/^\d+$/.test(text)) signature.contentPattern = 'number';
          else if (/^[A-Z][a-z]+ \d+$/.test(text)) signature.contentPattern = 'month-day';
        }
        
        return signature;
      }
      
      // Helper: find the best semantic container for similar elements
      function findSemanticContainer(element) {
        let current = element.parentElement;
        const candidates = [];
        
        while (current && current !== document.documentElement) {
          const children = Array.from(current.children);
          const sameTagSiblings = children.filter(c => c.tagName === element.tagName);
          
          if (sameTagSiblings.length >= 2) {
            // Analyze semantic similarity among siblings
            const signatures = sameTagSiblings.map(getSemanticSignature);
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
        }
        
        // Return the best container (highest score)
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0] || null;
      }
      
      function findCommonClasses(signatures) {
        if (signatures.length < 2) return [];
        const classCounts = new Map();
        signatures.forEach(sig => {
          sig.classes.forEach(cls => {
            classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
          });
        });
        
        const threshold = Math.max(2, Math.ceil(signatures.length * 0.6)); // 60% threshold
        return Array.from(classCounts.entries())
          .filter(([cls, count]) => count >= threshold)
          .map(([cls]) => cls)
          .slice(0, 3); // Limit to top 3
      }
      
      function findCommonDataAttrs(signatures) {
        if (signatures.length < 2) return [];
        const attrCounts = new Map();
        signatures.forEach(sig => {
          sig.dataAttrs.forEach(attr => {
            const key = `${attr.name}=${attr.value}`;
            attrCounts.set(key, (attrCounts.get(key) || 0) + 1);
          });
        });
        
        const threshold = Math.max(2, Math.ceil(signatures.length * 0.8)); // 80% threshold for data attrs
        return Array.from(attrCounts.entries())
          .filter(([key, count]) => count >= threshold)
          .map(([key]) => {
            const [name, value] = key.split('=');
            return {name, value};
          })
          .slice(0, 2); // Limit to top 2
      }
      
      function calculateContainerScore(container, siblingCount, commonClasses, commonDataAttrs, hasContentPattern) {
        let score = 0;
        
        // Base score from sibling count (more siblings = better for generic selection)
        score += Math.min(siblingCount * 10, 100);
        
        // Bonus for semantic indicators
        score += commonClasses.length * 15;
        score += commonDataAttrs.length * 20;
        if (hasContentPattern) score += 25;
        
        // Bonus for semantic container tags
        const tag = container.tagName.toLowerCase();
        if (['ul', 'ol', 'nav', 'section', 'main', 'article'].includes(tag)) score += 30;
        if (['div'].includes(tag)) score += 5; // slight preference for divs over generic containers
        
        // Penalty for deeply nested structures (prefer higher-level containers)
        let depth = 0;
        let current = container;
        while (current && current !== document.body) {
          depth++;
          current = current.parentElement;
        }
        score -= Math.max(0, depth - 3) * 5;
        
        return score;
      }
      
      // Helper function to detect overly broad/common tags
      function isOverlyBroadTag(tag) {
        const broadTags = ['div', 'span', 'p', 'a', 'li', 'td', 'th', 'tr', 'img', 'input', 'button'];
        return broadTags.includes(tag);
      }
      
      // Helper function to build a more constrained generic selector when tag-only is too broad
      function buildConstrainedGenericSelector(element) {
        const tag = element.tagName.toLowerCase();
        const signature = getSemanticSignature(element);
        
        // Strategy 1: Try element's own semantic classes
        if (signature.classes.length > 0) {
          for (let i = 0; i < Math.min(signature.classes.length, 2); i++) {
            const classSelector = `${tag}.${CSS.escape(signature.classes[i])}`;
            try {
              const matches = document.querySelectorAll(classSelector);
              if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                return classSelector;
              }
            } catch(_) {}
          }
          
          // Try multiple classes combined
          if (signature.classes.length > 1) {
            const multiClassSelector = `${tag}.${signature.classes.slice(0, 2).map(c => CSS.escape(c)).join('.')}`;
            try {
              const matches = document.querySelectorAll(multiClassSelector);
              if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                return multiClassSelector;
              }
            } catch(_) {}
          }
        }
        
        // Strategy 2: Try element's semantic data attributes
        if (signature.dataAttrs.length > 0) {
          for (const attr of signature.dataAttrs) {
            const attrSelector = `${tag}[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
            try {
              const matches = document.querySelectorAll(attrSelector);
              if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                return attrSelector;
              }
            } catch(_) {}
          }
        }
        
        // Strategy 3: Try role or aria attributes
        if (signature.roles.length > 0) {
          for (const role of signature.roles) {
            const roleSelector = `${tag}[${CSS.escape(role.name)}="${CSS.escape(role.value)}"]`;
            try {
              const matches = document.querySelectorAll(roleSelector);
              if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                return roleSelector;
              }
            } catch(_) {}
          }
        }
        
        // Strategy 4: Try parent context with current element's first class
        if (signature.classes.length > 0) {
          const parent = element.parentElement;
          if (parent) {
            const parentSelector = getMinimalContainerSelector(parent);
            if (parentSelector) {
              const contextSelector = `${parentSelector} ${tag}.${CSS.escape(signature.classes[0])}`;
              try {
                const matches = document.querySelectorAll(contextSelector);
                if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                  return contextSelector;
                }
              } catch(_) {}
            }
          }
        }
        
        // Strategy 5: Try positional selectors within parent (but avoid nth-child if possible)
        const parent = element.parentElement;
        if (parent) {
          const parentSelector = getMinimalContainerSelector(parent);
          if (parentSelector) {
            // Try first/last child if applicable
            const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
            if (siblings.length > 1) {
              const elementIndex = siblings.indexOf(element);
              if (elementIndex === 0) {
                const firstChildSelector = `${parentSelector} ${tag}:first-child`;
                try {
                  const matches = document.querySelectorAll(firstChildSelector);
                  if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                    return firstChildSelector;
                  }
                } catch(_) {}
              } else if (elementIndex === siblings.length - 1) {
                const lastChildSelector = `${parentSelector} ${tag}:last-child`;
                try {
                  const matches = document.querySelectorAll(lastChildSelector);
                  if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                    return lastChildSelector;
                  }
                } catch(_) {}
              }
            }
          }
        }
        
        // Strategy 6: Use content pattern matching for similar content
        if (signature.contentPattern) {
          // Find elements with similar content patterns
          const allElements = document.querySelectorAll(tag);
          const similarElements = Array.from(allElements).filter(el => {
            const elSignature = getSemanticSignature(el);
            return elSignature.contentPattern === signature.contentPattern;
          });
          
          if (similarElements.length >= MIN_MATCHES_TARGET && similarElements.length <= MAX_MATCHES_TARGET) {
            // Try to find a common parent or pattern
            const commonParents = new Map();
            similarElements.forEach(el => {
              let parent = el.parentElement;
              while (parent && parent !== document.body) {
                const parentSignature = getSemanticSignature(parent);
                if (parentSignature.classes.length > 0) {
                  const key = `${parent.tagName.toLowerCase()}.${parentSignature.classes[0]}`;
                  commonParents.set(key, (commonParents.get(key) || 0) + 1);
                  break;
                }
                parent = parent.parentElement;
              }
            });
            
            // Find the most common parent pattern
            for (const [parentPattern, count] of commonParents.entries()) {
              if (count >= Math.ceil(similarElements.length * 0.7)) {
                const contentBasedSelector = `${parentPattern} ${tag}`;
                try {
                  const matches = document.querySelectorAll(contentBasedSelector);
                  if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
                    return contentBasedSelector;
                  }
                } catch(_) {}
              }
            }
          }
        }
        
        // Last resort: Use finder but remove positional selectors to make it more generic
        try {
          let finderResult = finder(element);
          // Remove nth-child and nth-of-type to make it more generic
          const genericified = finderResult.replace(/:nth-(child|of-type)\(\d+\)/g, '');
          const matches = document.querySelectorAll(genericified);
          if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
            return genericified;
          }
        } catch(_) {}
        
        // Absolute last resort: return the specific selector as it's better than an overly broad one
        try {
          return finder(element);
        } catch(_) {
          return tag; // Even if it's broad, we need to return something
        }
      }
      
      // Main algorithm: build generic selector
      const containerInfo = findSemanticContainer(el);
      
      if (!containerInfo) {
        // Fallback: no good container found, use simple tag-based approach
        const tag = el.tagName.toLowerCase();
        const ownSignature = getSemanticSignature(el);
        
        let selector = tag;
        if (ownSignature.classes.length > 0) {
          selector += '.' + ownSignature.classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
        }
        
        // Test this simple selector
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length >= MIN_MATCHES_TARGET && matches.length <= MAX_MATCHES_TARGET) {
            return selector;
          }
        } catch(_) {}
        
        // Check if tag-only would be too broad
        const tagOnlyMatches = document.querySelectorAll(tag).length;
        if (tagOnlyMatches > MAX_MATCHES_TARGET || isOverlyBroadTag(tag)) {
          return buildConstrainedGenericSelector(el);
        }
        
        // Ultimate fallback
        return tag;
      }
      
      // Build selector using container context
      const { container, commonClasses, commonDataAttrs } = containerInfo;
      const targetTag = el.tagName.toLowerCase();
      
      // Start with container selector
      let containerSelector = getMinimalContainerSelector(container);
      
      // Build target element selector
      let targetSelector = targetTag;
      if (commonClasses.length > 0) {
        targetSelector += '.' + commonClasses.map(c => CSS.escape(c)).join('.');
      }
      if (commonDataAttrs.length > 0) {
        targetSelector += commonDataAttrs.map(attr => 
          `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`
        ).join('');
      }
      
      // Combine with appropriate combinator
      const fullSelector = containerSelector ? `${containerSelector} ${targetSelector}` : targetSelector;
      
      // Test and validate
      try {
        const matches = document.querySelectorAll(fullSelector);
        const count = matches.length;
        
        if (count >= MIN_MATCHES_TARGET && count <= MAX_MATCHES_TARGET && Array.from(matches).includes(el)) {
          return fullSelector;
        }
        
        // If too specific, try without container
        if (count < MIN_MATCHES_TARGET) {
          const matches2 = document.querySelectorAll(targetSelector);
          if (matches2.length >= MIN_MATCHES_TARGET && matches2.length <= MAX_MATCHES_TARGET) {
            return targetSelector;
          }
        }
        
        // If still too specific, try just tag + first common class
        if (commonClasses.length > 0) {
          const simpleSelector = `${targetTag}.${CSS.escape(commonClasses[0])}`;
          const matches3 = document.querySelectorAll(simpleSelector);
          if (matches3.length >= MIN_MATCHES_TARGET && matches3.length <= MAX_MATCHES_TARGET) {
            return simpleSelector;
          }
        }
        
      } catch(_) {}
      
      // Before falling back to tag-only, check if it's too broad
      const tagOnlyMatches = document.querySelectorAll(targetTag).length;
      if (tagOnlyMatches > MAX_MATCHES_TARGET || isOverlyBroadTag(targetTag)) {
        // Try to build a more specific selector using element's own attributes
        return buildConstrainedGenericSelector(el);
      }
      
      // Fallback to tag-only if it's reasonable
      return targetTag;
      
    } catch (err) {
      // Ultimate fallback
      try {
        let sel = finder(el);
        return sel.replace(/:nth-[^(]+\([^)]+\)/g, "");
      } catch (_) { 
        return el.tagName.toLowerCase(); 
      }
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
    
    try {
      // Try to build a specific selector using stable attributes
      const tag = el.tagName.toLowerCase();
      
      // Priority 1: Unique ID (if not generated/random)
      const id = el.getAttribute('id');
      if (id && !looksUniqueToken(id)) {
        return `#${CSS.escape(id)}`;
      }
      
      // Priority 2: Unique data attributes
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') && !looksUniqueToken(attr.value)) {
          const selector = `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`;
          try {
            if (document.querySelectorAll(selector).length === 1) {
              return selector;
            }
          } catch(_) {}
        }
      }
      
      // Priority 3: Unique combination of stable classes
      const stableClasses = Array.from(el.classList).filter(cls => 
        !looksUniqueToken(cls) && /^[a-z][a-z-]*$/i.test(cls)
      );
      
      if (stableClasses.length > 0) {
        for (let i = 1; i <= Math.min(stableClasses.length, 3); i++) {
          const classCombo = stableClasses.slice(0, i).map(c => `.${CSS.escape(c)}`).join('');
          const selector = `${tag}${classCombo}`;
          try {
            const matches = document.querySelectorAll(selector);
            if (matches.length === 1) {
              return selector;
            } else if (matches.length > 1 && matches.length <= 10) {
              // Add parent context to make it unique
              const parent = el.parentElement;
              if (parent) {
                const parentSelector = getMinimalContainerSelector(parent);
                if (parentSelector) {
                  const contextSelector = `${parentSelector} ${selector}`;
                  try {
                    if (document.querySelectorAll(contextSelector).length === 1) {
                      return contextSelector;
                    }
                  } catch(_) {}
                }
              }
            }
          } catch(_) {}
        }
      }
      
      // Priority 4: Use finder library with optimization
      let finderResult = finder(el);
      
      // Try to simplify finder result by removing unnecessary nth-child selectors
      const simplified = finderResult.replace(/:nth-child\(\d+\)(?=\s|$)/g, '');
      if (simplified !== finderResult) {
        try {
          const matches = document.querySelectorAll(simplified);
          if (matches.length === 1) {
            return simplified;
          }
        } catch(_) {}
      }
      
      return finderResult;
      
    } catch (err) {
      // Final fallback to finder
      try {
        return finder(el);
      } catch (_) {
        // Ultimate fallback - this should rarely happen
        const tag = el.tagName.toLowerCase();
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
          const index = siblings.indexOf(el) + 1;
          return `${tag}:nth-of-type(${index})`;
        }
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
  function drawHighlightsFor(el, sel) {
    clearMatches();
    let matches = [];
    try {
      matches = Array.from(document.querySelectorAll(sel));
    } catch (_) {}
    const LIMIT = 1200;
    let count = 0;
    for (const m of matches) {
      if (count >= LIMIT) break;
      if (!(m instanceof Element)) continue;
      if (m === el) continue;
      if (isPickerNode(m)) continue;
      const r = m.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const box = boxForRect(r, "picker-match-box");
      if (locked) box.classList.add("locked");
      matchesLayer.appendChild(box);
      count++;
    }
    const r0 = el.getBoundingClientRect();
    if (!r0.width || !r0.height) {
      hoverBox.style.display = "none";
    } else {
      hoverBox.style.display = "block";
      hoverBox.style.left = r0.left + "px";
      hoverBox.style.top = r0.top + "px";
      hoverBox.style.width = r0.width + "px";
      hoverBox.style.height = r0.height + "px";
      hoverBox.classList.toggle("locked", !!locked);
    }
  }

  // ---------- selection & UI updates ----------
  const currentTarget = () => (locked ? lockedTarget : hoveredTarget);
  function computeSelectorsFor(el) {
    selectorGeneric = buildGeneric(el);
    selectorSpecific = buildSpecific(el);
    
    // Ensure generic and specific selectors are different
    ensureSelectorDiversity(el);
  }
  
  function ensureSelectorDiversity(el) {
    // If selectors are identical, we need to make them serve different purposes
    if (selectorGeneric === selectorSpecific) {
      // Strategy 1: Make generic selector broader by removing constraints
      let broaderGeneric = makeSelectorBroader(selectorGeneric, el);
      
      if (broaderGeneric && broaderGeneric !== selectorGeneric) {
        const matches = document.querySelectorAll(broaderGeneric);
        if (matches.length >= 2 && matches.length <= 200 && Array.from(matches).includes(el)) {
          selectorGeneric = broaderGeneric;
          return;
        }
      }
      
      // Strategy 2: Make specific selector more specific
      let moreSpecific = makeSelectorMoreSpecific(selectorSpecific, el);
      
      if (moreSpecific && moreSpecific !== selectorSpecific) {
        const matches = document.querySelectorAll(moreSpecific);
        if (matches.length === 1 && matches[0] === el) {
          selectorSpecific = moreSpecific;
          return;
        }
      }
      
      // Strategy 3: Generate alternative generic selector using different approach
      let alternativeGeneric = generateAlternativeGeneric(el);
      
      if (alternativeGeneric && alternativeGeneric !== selectorSpecific) {
        const matches = document.querySelectorAll(alternativeGeneric);
        if (matches.length >= 2 && matches.length <= 200 && Array.from(matches).includes(el)) {
          selectorGeneric = alternativeGeneric;
          return;
        }
      }
      
      // Strategy 4: If all else fails, use tag-based generic (if not too broad)
      const tag = el.tagName.toLowerCase();
      const tagMatches = document.querySelectorAll(tag).length;
      const broadTags = ['div', 'span', 'p', 'a', 'li', 'td', 'th', 'tr', 'img', 'input', 'button'];
      
      if (tagMatches >= 2 && tagMatches <= 200 && !broadTags.includes(tag)) {
        selectorGeneric = tag;
      }
    }
  }
  
  function makeSelectorBroader(selector, el) {
    // Remove the last part of a descendant selector
    if (selector.includes(' ')) {
      const parts = selector.split(' ');
      if (parts.length > 1) {
        return parts.slice(1).join(' '); // Remove first part (container)
      }
    }
    
    // Remove classes from the selector
    if (selector.includes('.')) {
      const withoutLastClass = selector.replace(/\.[^.\s\[]+$/, '');
      if (withoutLastClass && withoutLastClass !== selector) {
        return withoutLastClass;
      }
      
      // Remove all classes, keep just the tag
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
    
    // Remove pseudo-selectors
    if (selector.includes(':')) {
      const withoutPseudo = selector.replace(/:[\w-]+(\([^)]*\))?/g, '');
      if (withoutPseudo && withoutPseudo !== selector) {
        return withoutPseudo;
      }
    }
    
    return null;
  }
  
  function makeSelectorMoreSpecific(selector, el) {
    const tag = el.tagName.toLowerCase();
    
    // Add an ID if element has one and it's not already in the selector
    const id = el.getAttribute('id');
    if (id && !selector.includes('#') && !looksUniqueToken(id)) {
      return `#${CSS.escape(id)}`;
    }
    
    // Add more classes if available
    const classes = Array.from(el.classList).filter(cls => 
      !looksUniqueToken(cls) && !selector.includes(`.${cls}`)
    );
    
    if (classes.length > 0) {
      const additionalClass = `.${CSS.escape(classes[0])}`;
      if (!selector.includes(additionalClass)) {
        return selector + additionalClass;
      }
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
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        return `${selector}:nth-of-type(${index})`;
      }
    }
    
    return null;
  }
  
  function generateAlternativeGeneric(el) {
    const tag = el.tagName.toLowerCase();
    
    // Strategy 1: Use parent context with tag
    const parent = el.parentElement;
    if (parent) {
      // Try parent tag + current element tag
      const parentTag = parent.tagName.toLowerCase();
      const parentChildSelector = `${parentTag} ${tag}`;
      const matches = document.querySelectorAll(parentChildSelector);
      if (matches.length >= 2 && matches.length <= 200 && Array.from(matches).includes(el)) {
        return parentChildSelector;
      }
      
      // Try parent with class + current element tag
      const parentClasses = Array.from(parent.classList).filter(cls => !looksUniqueToken(cls));
      if (parentClasses.length > 0) {
        const parentClassSelector = `${parentTag}.${CSS.escape(parentClasses[0])} ${tag}`;
        const matches2 = document.querySelectorAll(parentClassSelector);
        if (matches2.length >= 2 && matches2.length <= 200 && Array.from(matches2).includes(el)) {
          return parentClassSelector;
        }
      }
    }
    
    // Strategy 2: Use element's role or aria attributes
    const role = el.getAttribute('role');
    if (role && !looksUniqueToken(role)) {
      const roleSelector = `[role="${CSS.escape(role)}"]`;
      const matches = document.querySelectorAll(roleSelector);
      if (matches.length >= 2 && matches.length <= 200 && Array.from(matches).includes(el)) {
        return roleSelector;
      }
    }
    
    // Strategy 3: Use element's position in context
    if (parent) {
      const tagSiblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const elementIndex = tagSiblings.indexOf(el);
      
      if (tagSiblings.length > 1) {
        if (elementIndex === 0) {
          const firstChildSelector = `${tag}:first-of-type`;
          const matches = document.querySelectorAll(firstChildSelector);
          if (matches.length >= 2 && matches.length <= 200 && Array.from(matches).includes(el)) {
            return firstChildSelector;
          }
        } else if (elementIndex === tagSiblings.length - 1) {
          const lastChildSelector = `${tag}:last-of-type`;
          const matches = document.querySelectorAll(lastChildSelector);
          if (matches.length >= 2 && matches.length <= 200 && Array.from(matches).includes(el)) {
            return lastChildSelector;
          }
        }
      }
    }
    
    // Strategy 4: Use common attribute patterns
    for (const attr of el.attributes) {
      if (attr.name === 'type' || attr.name === 'href' || attr.name === 'src') {
        // For common attributes, try to generalize the value
        let generalizedValue = generalizeAttributeValue(attr.value);
        if (generalizedValue) {
          const generalSelector = `${tag}[${CSS.escape(attr.name)}*="${CSS.escape(generalizedValue)}"]`;
          const matches = document.querySelectorAll(generalSelector);
          if (matches.length >= 2 && matches.length <= 200 && Array.from(matches).includes(el)) {
            return generalSelector;
          }
        }
      }
    }
    
    return null;
  }
  
  function generalizeAttributeValue(value) {
    // Extract common patterns from attribute values
    if (!value) return null;
    
    // For URLs, extract domain or path patterns
    if (value.startsWith('http')) {
      try {
        const url = new URL(value);
        if (url.pathname.length > 1) {
          // Extract first path segment
          const pathParts = url.pathname.split('/').filter(p => p);
          if (pathParts.length > 0) {
            return pathParts[0];
          }
        }
        return url.hostname;
      } catch(_) {}
    }
    
    // For class-like values, extract common prefixes
    if (value.includes('-') || value.includes('_')) {
      const parts = value.split(/[-_]/);
      if (parts.length > 1 && parts[0].length > 2) {
        return parts[0];
      }
    }
    
    // For file extensions
    if (value.includes('.')) {
      const parts = value.split('.');
      if (parts.length > 1) {
        const ext = parts[parts.length - 1];
        if (ext.length <= 4) {
          return `.${ext}`;
        }
      }
    }
    
    return null;
  }
  function updateResultsUI(targetEl) {
    const gText = results.querySelector(
      '.picker-row[data-kind="generic"] [data-role="label"] .pill-text'
    );
    const sText = results.querySelector(
      '.picker-row[data-kind="specific"] [data-role="label"] .pill-text'
    );
    if (!targetEl) {
      results.style.display = "none";
      results.classList.remove("locked");
      return;
    }
    gText.textContent = trim(selectorGeneric, PILL_MAX_CHARS);
    sText.textContent = trim(selectorSpecific, PILL_MAX_CHARS);
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
          hoveredTarget = null;
          selectorGeneric = "";
          selectorSpecific = "";
          results.style.display = "none";
          hoverBox.style.display = "none";
          hoverBox.classList.remove("locked");
          clearMatches();
          return;
        }
        hoveredTarget = target;
        computeSelectorsFor(target);
        updateVisuals();
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
      if (!pickMode) return;
      const t = e.touches[0];
      if (t) {
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;
      }
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

  // CSS button interactions (hover/tap)
  results.addEventListener("pointerover", (e) => {
    const cssBtn = e.target.closest('.action-btn[data-action="css"]');
    if (!cssBtn) return;
    const row = cssBtn.closest(".picker-row");
    const kind = row?.getAttribute("data-kind");
    if (!kind) return;
    if (!locked) return;
    // If user pinned overlay, don't override content/visibility on hover
    if (overlayPinned) return;
    if (cssOverlayHideTimer) {
      clearTimeout(cssOverlayHideTimer);
      cssOverlayHideTimer = null;
    }
    showCssOverlayFor(kind);
  });
  results.addEventListener("pointerout", (e) => {
    const cssBtn = e.target.closest('.action-btn[data-action="css"]');
    if (!cssBtn) return;
    // If pinned, keep it open
    if (overlayPinned) return;
    if (cssOverlayHideTimer) {
      clearTimeout(cssOverlayHideTimer);
    }
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

  // ---------- snapping logic ----------
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
    const arA = aw * ah,
      arB = bw * bh,
      ratio = arA > arB ? arA / arB : arB / arA;
    return similarSides || ratio <= SIMILAR_AREA_RATIO;
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
    const n = Math.min(el.children.length, 50);
    let best = null,
      bestEdge = Infinity;
    for (let i = 0; i < n; i++) {
      const c = el.children[i];
      if (!(c instanceof Element)) continue;
      const cr = c.getBoundingClientRect();
      if (!cr.width || !cr.height) continue;
      if (!pointInRect(cr, x, y)) continue;
      if (
        !(
          rectLike(cr, el.getBoundingClientRect()) ||
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
    const r = el.getBoundingClientRect(),
      p = el.parentElement;
    let parentPick = null,
      dParent = Infinity;
    if (p && p instanceof Element) {
      const pr = p.getBoundingClientRect();
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
      p ? p.getBoundingClientRect() : null
    );
    if (parentPick && childPick) {
      const cr = childPick.getBoundingClientRect();
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
      // keep pills visible so you can still act; hide them too if you prefer:
      // results.style.display = 'none';
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;
      if (pickMode) updateVisuals();
    }, 140);
  };
  // capture = true to run before site handlers; passive = true to avoid blocking
  window.addEventListener("scroll", onAnyScroll, {
    capture: true,
    passive: true,
  });
  document.addEventListener("scroll", onAnyScroll, {
    capture: true,
    passive: true,
  });

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
