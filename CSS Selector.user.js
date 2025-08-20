// ==UserScript==
// @name         CSS Selector Picker (v1.21.3)
// @namespace    https://greasyfork.org/
// @version      1.21.2
// @description  Circular grabber (⊹). Blocks pinch-zoom while picker ON (touch + trackpad). Disables page actions while ON. Mouse/touch copy. Drag-to-hover. During scroll, overlays hide and redraw after settle. Specific: ◀/▶ siblings, ✕ hide this. Generic: ▲ parent / ▼ child, ✕ hide all. ⌘⇧C toggles.
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

  // ---------- styles ----------
  addStyle(`
    :root{
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
    [data-picker-ui="1"]{ }

    .selector-pill{
      height:var(--pill-h)!important; padding:0 var(--pill-pad-x)!important;
      font-family:var(--font)!important; font-size:var(--font-size)!important; line-height:1!important;
      box-sizing:border-box!important; display:inline-flex!important; align-items:center!important; justify-content:flex-start!important;
      -webkit-tap-highlight-color:transparent; user-select:none; white-space:nowrap; cursor:pointer;
      border-radius:999px!important; font-weight:800; max-width:min(64vw,520px); min-width:0; overflow:hidden; text-overflow:ellipsis; text-align:left;
      box-shadow:0 3px 10px rgba(0,0,0,.10); outline:none; -webkit-user-select:none;
      pointer-events:auto;
    }
    .selector-pill.generic{  background:var(--orange-bg); border:2px solid var(--orange-bd); color:var(--text-light); }
    .selector-pill.specific{ background:var(--blue-bg);   border:2px solid var(--blue-bd);   color:var(--text-light); }

    .picker-results{
      position:fixed!important; right:16px; bottom:20px; z-index:2147483648;
      display:none; flex-direction:column; gap:12px;
      pointer-events:none; /* container doesn't block page; children opt-in */
    }
    .picker-row{ display:flex; gap:8px; align-items:center; justify-content:flex-end; }

    .action-group{ display:flex; gap:6px; pointer-events:none; }
    .action-btn{
      height:var(--pill-h)!important; width:var(--pill-h)!important;
      min-width:var(--pill-h)!important; min-height:var(--pill-h)!important;
      display:inline-flex; align-items:center; justify-content:center;
      border-radius:999px!important; font-family:var(--font); font-size:18px; font-weight:700; cursor:pointer; user-select:none;
      background:var(--btn-bg); color:var(--btn-fg); border:2px solid var(--btn-bd);
      box-shadow:0 3px 10px rgba(0,0,0,.10);
      pointer-events:auto;
    }
    .action-btn.generic{ border-color:var(--orange-bd); }
    .action-btn.specific{ border-color:var(--blue-bd); }

    /* Overlays (never block) */
    .picker-hover-box{
      position:fixed; z-index:2147483646; pointer-events:none;
      border:2px dotted rgba(26,115,232,.95); background:rgba(26,115,232,.20);
      border-radius:3px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);
      transition:transform .06s ease,width .06s ease,height .06s ease,left .06s ease,top .06s ease;
    }
    .picker-hover-box.locked{ border-style:solid; }
    .picker-matches-layer{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483645;pointer-events:none;}
    .picker-match-box{
      position:fixed; pointer-events:none; border:2px dotted rgba(255,140,0,.95);
      background:rgba(255,140,0,.22); border-radius:3px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);
    }
    .picker-match-box.locked{ border-style:solid; }

    /* Circular grabber (bottom-left) */
    .picker-grabber{
      position:fixed; left:12px; bottom:20px; z-index:2147483649;
      width:var(--grabber-size); height:var(--grabber-size);
      display:flex; align-items:center; justify-content:center;
      border-radius:50%; background:var(--grabber-bg); color:var(--grabber-fg); border:2px solid var(--grabber-bd);
      box-shadow:0 6px 18px rgba(0,0,0,.25);
      font-family:var(--font); font-size:calc(var(--grabber-size)*0.5); font-weight:900; cursor:pointer; user-select:none;
      -webkit-tap-highlight-color:transparent;
      pointer-events:auto;
    }
    .picker-grabber.active{ background:var(--grabber-active); }

    /* Left swipe zone (only when picker OFF) */
    .picker-swipe-zone{
      position:fixed; left:0; bottom:0; width:28vw; height:28vh; z-index:2147483643;
      background:transparent; pointer-events:auto;
    }
    .picker-swipe-zone.disabled{ pointer-events:none; }
  `);

  // ---------- UI ----------
  const results = document.createElement("div");
  results.className = "picker-results";
  results.setAttribute("data-picker-ui", "1");
  results.innerHTML = `
    <div class="picker-row" data-kind="generic" data-picker-ui="1">
      <div class="selector-pill generic" data-role="label" data-picker-ui="1"></div>
      <div class="action-group" data-picker-ui="1">
        <div class="action-btn generic" data-action="parent" title="Parent ▲" data-picker-ui="1">▲</div>
        <div class="action-btn generic" data-action="child"  title="Child ▼"  data-picker-ui="1">▼</div>
        <div class="action-btn generic" data-action="hide"   title="Hide ✕"   data-picker-ui="1">✕</div>
      </div>
    </div>
    <div class="picker-row" data-kind="specific" data-picker-ui="1">
      <div class="selector-pill specific" data-role="label" data-picker-ui="1"></div>
      <div class="action-group" data-picker-ui="1">
        <div class="action-btn specific" data-action="prev" title="Prev ◀" data-picker-ui="1">◀</div>
        <div class="action-btn specific" data-action="next" title="Next ▶" data-picker-ui="1">▶</div>
        <div class="action-btn specific" data-action="hide" title="Hide ✕" data-picker-ui="1">✕</div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(results);

  const hoverBox = document.createElement("div");
  hoverBox.className = "picker-hover-box";
  hoverBox.setAttribute("data-picker-ui", "1");
  hoverBox.style.display = "none";
  document.documentElement.appendChild(hoverBox);

  const matchesLayer = document.createElement("div");
  matchesLayer.className = "picker-matches-layer";
  matchesLayer.setAttribute("data-picker-ui", "1");
  document.documentElement.appendChild(matchesLayer);

  // Grabber + swipe zone
  const grabber = document.createElement("div");
  grabber.className = "picker-grabber";
  grabber.setAttribute("data-picker-ui", "1");
  grabber.setAttribute("title", "Start/Stop Picker");
  grabber.textContent = "⊹";
  document.documentElement.appendChild(grabber);

  const swipeZone = document.createElement("div");
  swipeZone.className = "picker-swipe-zone";
  swipeZone.setAttribute("data-picker-ui", "1");
  document.documentElement.appendChild(swipeZone);

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
  const avoidUtility =
    /^(col|row|grid|container|wrap|clearfix|hidden|show|sr-only|visually-hidden|flex|items-|justify-|text-|mt-|mb-|ml-|mr-|p-|m-|w-|h-)/;

  function stableAttrNoId(el) {
    const attrs = [
      "data-testid",
      "data-test",
      "data-qa",
      "aria-label",
      "role",
      "name",
    ];
    for (const an of attrs) {
      const v = el.getAttribute && el.getAttribute(an);
      if (!v) continue;
      if (looksUniqueToken(v)) continue;
      return `[${an}="${String(v).replace(/"/g, '\\"')}"]`;
    }
    return "";
  }
  function stableClasses(el, max = 3) {
    const cl = Array.from(el.classList || []).filter(
      (c) => !avoidUtility.test(c) && !looksUniqueToken(c)
    );
    if (!cl.length) return [];
    const withCounts = cl
      .map((name) => ({
        name,
        count: document.getElementsByClassName(name).length || 0,
        len: name.length,
      }))
      .sort((a, b) => b.count - a.count || b.len - a.len);
    return withCounts.slice(0, max).map((x) => x.name);
  }
  function bestClassGeneric(el) {
    const classes = Array.from(el.classList || []);
    if (!classes.length) return null;
    const scored = classes
      .map((name) => ({
        name,
        count: document.getElementsByClassName(name).length || 0,
        len: name.length,
      }))
      .sort((a, b) => a.count - b.count || b.len - a.len);
    for (const s of scored) {
      if (s.count <= 1) continue;
      if (avoidUtility.test(s.name)) continue;
      if (looksUniqueToken(s.name)) continue;
      return s;
    }
    for (const s of scored) {
      if (avoidUtility.test(s.name)) continue;
      if (looksUniqueToken(s.name)) continue;
      return s;
    }
    return null;
  }

  const attrSelectorGeneric = (el) => stableAttrNoId(el) || "";
  function buildGeneric(el) {
    if (!(el instanceof Element)) return "*";
    const bc = bestClassGeneric(el);
    const childSel = bc
      ? `.${esc(bc.name)}`
      : attrSelectorGeneric(el) || el.tagName.toLowerCase();
    const p = el.parentElement;
    if (!p || !(p instanceof Element)) return childSel;
    const pab = bestClassGeneric(p);
    const paa = attrSelectorGeneric(p);
    const parentSel = pab
      ? `.${esc(pab.name)}`
      : paa || p.tagName.toLowerCase();
    return `${parentSel} > ${childSel}`;
  }

  function anchorNoId(el) {
    const tag = el.tagName.toLowerCase();
    const cls = stableClasses(el, 3);
    const attr = stableAttrNoId(el);
    if (cls.length)
      return `${tag}${cls.map((c) => "." + esc(c)).join("")}${attr}`;
    if (attr) return `${tag}${attr}`;
    return tag;
  }
  const nthOfTypeIndex = (el) => {
    const p = el.parentElement;
    if (!p) return 1;
    const sib = [...p.children].filter((n) => n.tagName === el.tagName);
    return Math.max(1, sib.indexOf(el) + 1);
  };
  const nthChildIndex = (el) => {
    const p = el.parentElement;
    if (!p) return 1;
    const all = [...p.children];
    return Math.max(1, all.indexOf(el) + 1);
  };
  function buildSpecific(el) {
    if (!(el instanceof Element)) return "*";
    const MAX_ANC = 6;
    const ancEls = [];
    let cur = el.parentElement;
    while (cur && ancEls.length < MAX_ANC) {
      ancEls.unshift(cur);
      cur = cur.parentElement;
    }
    const ancAnchors = ancEls.map((a) => anchorNoId(a));
    const ancSuffix = ancEls.map((_) => "");
    const selfAnchorBase = anchorNoId(el);
    const prefixString = () =>
      ancAnchors.map((a, i) => a + ancSuffix[i]).join(" > ");
    const candidateWithSelf = (ixKind = "type") => {
      const selfNth =
        ixKind === "type"
          ? `:nth-of-type(${nthOfTypeIndex(el)})`
          : `:nth-child(${nthChildIndex(el)})`;
      const self = selfAnchorBase + selfNth;
      const pref = prefixString();
      return pref ? `${pref} > ${self}` : self;
    };
    let candidate = candidateWithSelf("type");
    let list = [];
    try {
      list = Array.from(document.querySelectorAll(candidate));
    } catch (_) {}
    if (list.length !== 1) {
      candidate = candidateWithSelf("child");
      try {
        list = Array.from(document.querySelectorAll(candidate));
      } catch (_) {}
    }
    if (list.length !== 1 && ancEls.length) {
      for (let i = ancEls.length - 1; i >= 0 && list.length !== 1; i--) {
        const aEl = ancEls[i];
        ancSuffix[i] = `:nth-of-type(${nthOfTypeIndex(aEl)})`;
        candidate = candidateWithSelf("type");
        try {
          list = Array.from(document.querySelectorAll(candidate));
        } catch (_) {}
        if (list.length === 1) break;
        ancSuffix[i] = `:nth-child(${nthChildIndex(aEl)})`;
        candidate = candidateWithSelf("type");
        try {
          list = Array.from(document.querySelectorAll(candidate));
        } catch (_) {}
      }
    }
    while (list.length !== 1 && cur && cur instanceof Element) {
      ancEls.unshift(cur);
      ancAnchors.unshift(anchorNoId(cur));
      ancSuffix.unshift(`:nth-of-type(${nthOfTypeIndex(cur)})`);
      candidate = candidateWithSelf("type");
      try {
        list = Array.from(document.querySelectorAll(candidate));
      } catch (_) {}
      cur = cur.parentElement;
      if (ancEls.length > 12) break;
    }
    return candidate;
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
  }
  function updateResultsUI(targetEl) {
    const gEl = results.querySelector(
      '.picker-row[data-kind="generic"]  [data-role="label"]'
    );
    const sEl = results.querySelector(
      '.picker-row[data-kind="specific"] [data-role="label"]'
    );
    if (!targetEl) {
      results.style.display = "none";
      return;
    }
    gEl.textContent = trim(selectorGeneric, PILL_MAX_CHARS);
    sEl.textContent = trim(selectorSpecific, PILL_MAX_CHARS);
    results.style.display = "flex";
  }
  function updateVisuals() {
    const tgt = currentTarget();
    if (!pickMode || !tgt) {
      results.style.display = pickMode ? "flex" : "none";
      hoverBox.style.display = "none";
      clearMatches();
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

    const pill = results.querySelector(
      `.picker-row[data-kind="${kind}"] [data-role="label"]`
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
      if (pill) {
        const r = restore;
        pill.textContent = msg;
        setTimeout(() => {
          pill.textContent = trim(r, PILL_MAX_CHARS);
        }, 900);
      }
    }
  }

  // copy on pill click (mouse + touch + pen)
  const copyFromPill = async (pillEl) => {
    const row = pillEl.closest(".picker-row");
    const kind = row?.getAttribute("data-kind");
    const full = kind === "generic" ? selectorGeneric : selectorSpecific;
    await copyText(full);
    const restore = full;
    pillEl.textContent = "Copied";
    setTimeout(() => {
      pillEl.textContent = trim(restore, PILL_MAX_CHARS);
    }, 900);
  };
  results.addEventListener("click", (e) => {
    const pillEl = e.target.closest(".selector-pill");
    if (!pillEl) return;
    e.preventDefault();
    e.stopPropagation();
    copyFromPill(pillEl);
  });
  results.addEventListener("pointerup", (e) => {
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
    e.preventDefault();
    e.stopPropagation();
    const row = btn.closest(".picker-row");
    const kind = row?.getAttribute("data-kind");
    const action = btn.getAttribute("data-action");
    if (action === "hide") {
      const tgt = currentTarget();
      if (!tgt) return;
      const sel =
        kind === "specific"
          ? selectorSpecific || buildSpecific(tgt)
          : selectorGeneric || buildGeneric(tgt);
      addHideRule(sel);
      const pill = row.querySelector(".selector-pill");
      if (pill) {
        const r = sel;
        pill.textContent = "Hidden";
        setTimeout(() => {
          pill.textContent = trim(r, PILL_MAX_CHARS);
        }, 900);
      }
      return;
    }
    traverse(kind, action);
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

  // ---------- mode toggles (grabber + swipe zone + hotkey) ----------
  function applyZoomPolicy() {
    if (pickMode) enableZoomSuppression();
    else disableZoomSuppression();
  }

  function setPickMode(on) {
    pickMode = !!on;
    grabber.classList.toggle("active", pickMode);
    swipeZone.classList.toggle("disabled", pickMode);
    locked = false;
    lockedTarget = null;
    hoveredTarget = null;
    selectorGeneric = "";
    selectorSpecific = "";
    results.style.display = "none";
    hoverBox.style.display = "none";
    clearMatches();
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

  // Swipe logic (open when picker off; close when on)
  function installSwipeOpenClose(el) {
    let sx = 0,
      sy = 0,
      down = false;
    const THRESH = 28;
    el.addEventListener(
      "pointerdown",
      (e) => {
        if (el.classList.contains("disabled")) return;
        sx = e.clientX;
        sy = e.clientY;
        down = true;
      },
      { passive: true }
    );
    el.addEventListener(
      "pointermove",
      (e) => {
        if (!down || el.classList.contains("disabled")) return;
        const dx = e.clientX - sx || 0,
          dy = e.clientY - sy || 0;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= THRESH) {
          if (!pickMode && dx > 0) setPickMode(true);
          if (pickMode && dx < 0) setPickMode(false);
          down = false;
        }
      },
      { passive: true }
    );
    el.addEventListener(
      "pointerup",
      () => {
        down = false;
      },
      { passive: true }
    );
    el.addEventListener(
      "pointercancel",
      () => {
        down = false;
      },
      { passive: true }
    );
  }
  installSwipeOpenClose(grabber);
  installSwipeOpenClose(swipeZone);

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
