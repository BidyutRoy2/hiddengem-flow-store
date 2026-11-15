// ==UserScript==
// @name        Universal DOM Diagnostic v2.0 — TM Only
// @namespace   hiddengem-flow-store
// @version     2.0.0
// @description Read-only UI scanner for websites — 30+ diagnostic rules, score, Baseline Diff, hidden-iframe crawler, performance + console capture, overlay, custom rules. Tampermonkey only: no Playwright, no GitHub Actions, no server, no network calls. Baseline and settings stay local.
// @match       *://*/*
// @grant       none
// ==/UserScript==

(() => {
  'use strict';

  /* ============================================================
     SECTION 0 — Constants, state, storage (GM with fallback)
     ============================================================ */
  const APP_ID = 'universal-dom-diagnostic-v20';
  const OVERLAY_ID = 'udd-overlay-v20';
  const CRAWL_FRAME_ID = 'udd-crawl-frame-v20';
  const MAX_DOM_NODES = 20000;
  const MAX_CONTROLS = 500;
  const MAX_ISSUES_SHOWN = 100;

  if (document.getElementById(APP_ID)) return;

  const ROLES = new Set([
    'button', 'link', 'tab', 'tablist', 'slider', 'spinbutton',
    'textbox', 'searchbox', 'combobox', 'listbox', 'option',
    'checkbox', 'radio', 'switch', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'treeitem', 'gridcell', 'scrollbar',
    'progressbar', 'heading', 'main', 'navigation', 'banner',
    'contentinfo', 'complementary', 'form', 'search', 'dialog',
    'alert', 'alertdialog'
  ]);
  const VALID_ROLES = new Set([
    'button', 'link', 'tab', 'tablist', 'tabpanel', 'slider',
    'spinbutton', 'textbox', 'searchbox', 'combobox', 'listbox',
    'option', 'checkbox', 'radio', 'switch', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'treeitem', 'grid',
    'gridcell', 'row', 'rowheader', 'columnheader', 'scrollbar',
    'progressbar', 'heading', 'main', 'navigation', 'banner',
    'contentinfo', 'complementary', 'form', 'search', 'dialog',
    'alert', 'alertdialog', 'img', 'figure', 'list', 'listitem',
    'table', 'cell', 'separator', 'toolbar', 'tooltip', 'status',
    'log', 'region', 'article', 'group', 'presentation', 'none'
  ]);

  const DEFAULT_SETTINGS = {
    autoScan: true,
    rescanHours: 24,
    minScore: 80,
    maxCritical: 0,
    crawlMaxPages: 10,
    optInSafeMetadata: false
  };

  const state = {
    report: null,
    reportText: '',
    scanning: false,
    issues: [],
    controls: [],
    headings: [],
    forms: [],
    score: 100,
    grade: 'A',
    diff: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    customRules: [],
    perf: null, // filled by Section 1
    crawl: {
      running: false, paused: false, stopped: false,
      queue: [], index: 0, results: [], skipped: 0, done: 0
    },
    overlayMode: null, // 'tab' | 'issues' | 'headings' | null
    iframeNotes: []
  };

  // Panel element refs — declared early (let, not const) so functions
  // defined before the panel exists can reference them safely.
  let panel = null;
  let styleEl = null;
  let overlayLayer = null;
  let statusEl = null;
  let outputEl = null;
  let diffBoxEl = null;
  let gateBoxEl = null;
  let copyButton = null;
  let downloadButton = null;
  let downloadHtmlButton = null;
  let saveButton = null;

  function gmHas(name) {
    try { return typeof window[name] === 'function'; } catch (_) { return false; }
  }
  function storeGet(key, def) {
    try {
      if (gmHas('GM_getValue')) {
        const v = GM_getValue('udd-v2:' + key, undefined);
        return v === undefined ? def : v;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem('udd-v2:' + key);
      return raw === null ? def : JSON.parse(raw);
    } catch (_) { return def; }
  }
  function storeSet(key, value) {
    try {
      if (gmHas('GM_setValue')) { GM_setValue('udd-v2:' + key, value); return true; }
    } catch (_) {}
    try { localStorage.setItem('udd-v2:' + key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function storeDelete(key) {
    try { if (gmHas('GM_deleteValue')) GM_deleteValue('udd-v2:' + key); } catch (_) {}
    try { localStorage.removeItem('udd-v2:' + key); } catch (_) {}
  }
  function baselineKey() {
    return 'baseline:' + location.origin + location.pathname;
  }
  function loadSettings() {
    const saved = storeGet('settings', null);
    if (saved && typeof saved === 'object') {
      state.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    }
  }
  function saveSettings() {
    storeSet('settings', state.settings);
  }
  function loadCustomRules() {
    const saved = storeGet('customRules', []);
    state.customRules = Array.isArray(saved) ? saved.filter(isValidCustomRuleShape) : [];
  }
  loadSettings();
  loadCustomRules();

  /* ============================================================
     SECTION 1 — Performance + console capture (document-start)
     Runs before the page loads, so early errors are not missed.
     Nothing here makes network calls. Values are measured only.
     ============================================================ */
  const perfData = {
    lcp: null, cls: 0, clsEntries: 0, inp: null, fcp: null, ttfb: null,
    consoleErrors: [], pageErrors: [], failedResources: [],
    startedAt: Date.now()
  };
  state.perf = perfData;

  function perfNow() { return Math.round(performance.now()); }

  try {
    if (typeof PerformanceObserver === 'function') {
      const lcpObs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) perfData.lcp = Math.round(e.startTime);
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
      const clsObs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) { perfData.cls += e.value; perfData.clsEntries++; }
        }
      });
      clsObs.observe({ type: 'layout-shift', buffered: true });
      const inpObs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          const d = Math.round(e.duration);
          if (perfData.inp === null || d > perfData.inp) perfData.inp = d;
        }
      });
      inpObs.observe({ type: 'event', buffered: true, durationThreshold: 16 });
      const paintObs = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          if (e.name === 'first-contentful-paint') perfData.fcp = Math.round(e.startTime);
        }
      });
      paintObs.observe({ type: 'paint', buffered: true });
    }
  } catch (_) { /* PerformanceObserver unavailable — values stay null */ }

  try {
    const nav = performance.getEntriesByType &&
      performance.getEntriesByType('navigation')[0];
    if (nav && nav.responseStart) perfData.ttfb = Math.round(nav.responseStart);
  } catch (_) {}

  // Console + page errors — wrap, do not replace behaviour.
  try {
    const origError = console.error.bind(console);
    console.error = function () {
      try {
        const msg = Array.prototype.map.call(arguments, a => {
          try { return typeof a === 'string' ? a : JSON.stringify(a); }
          catch (_) { return String(a); }
        }).join(' ').slice(0, 300);
        if (perfData.consoleErrors.length < 20) {
          perfData.consoleErrors.push({ atMs: perfNow(), message: msg });
        }
      } catch (_) {}
      origError.apply(console, arguments);
    };
  } catch (_) {}
  window.addEventListener('error', e => {
    if (perfData.pageErrors.length < 20) {
      perfData.pageErrors.push({
        atMs: perfNow(),
        message: String(e.message || 'error').slice(0, 300),
        source: String(e.filename || '').slice(0, 200)
      });
    }
  });
  window.addEventListener('unhandledrejection', e => {
    if (perfData.pageErrors.length < 20) {
      let msg = 'unhandled rejection';
      try { msg = String(e.reason && e.reason.message ? e.reason.message : e.reason).slice(0, 300); }
      catch (_) {}
      perfData.pageErrors.push({ atMs: perfNow(), message: msg, source: '' });
    }
  });

  function collectFailedResources() {
    const out = [];
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const e of entries) {
        // transferSize 0 can mean cached OR failed — label honestly in report.
        if (e.transferSize === 0 && e.decodedBodySize === 0 && e.duration > 0) {
          out.push({ url: safeURL(e.name), initiatorType: e.initiatorType || '' });
          if (out.length >= 20) break;
        }
      }
    } catch (_) {}
    perfData.failedResources = out;
    return out;
  }
  function perfVerdict(name, value, good, poor) {
    if (value === null || value === undefined) return 'not measured';
    return value <= good ? 'good' : (value <= poor ? 'needs improvement' : 'poor');
  }
  function perfSummary() {
    collectFailedResources();
    return {
      lcpMs: perfData.lcp,
      lcpVerdict: perfVerdict('lcp', perfData.lcp, 2500, 4000),
      cls: perfData.cls === 0 ? 0 : Math.round(perfData.cls * 1000) / 1000,
      clsVerdict: perfVerdict('cls', perfData.cls, 0.1, 0.25),
      inpMs: perfData.inp,
      inpVerdict: perfVerdict('inp', perfData.inp, 200, 500),
      fcpMs: perfData.fcp,
      ttfbMs: perfData.ttfb,
      consoleErrors: perfData.consoleErrors.slice(),
      pageErrors: perfData.pageErrors.slice(),
      suspectedFailedResources: perfData.failedResources.slice(),
      note: 'LCP/CLS/INP thresholds are Google Core Web Vitals (LCP 2.5s, CLS 0.1, INP 200ms). ' +
        'Values are measured in this browser session only. Suspected failed resources have ' +
        'transferSize 0, which can mean cached or failed — verify in DevTools Network.'
    };
  }

  /* ============================================================
     SECTION 2 — Small helpers
     ============================================================ */
  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
  function escHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeURL(raw) {
    try {
      const u = new URL(raw, location.href);
      if (!['http:', 'https:'].includes(u.protocol)) return '[non-http URL omitted]';
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch (_) { return ''; }
  }
  function getClass(el) {
    if (typeof el.className === 'string') return el.className.slice(0, 220);
    if (el.className && el.className.baseVal) return el.className.baseVal.slice(0, 220);
    return '';
  }
  function getById(el, id) {
    try {
      const root = el.getRootNode();
      if (root && root.getElementById) return root.getElementById(id);
    } catch (_) {}
    try { return (el.ownerDocument || document).getElementById(id); }
    catch (_) { return null; }
  }
  function isExcluded(el) {
    if (!el || !(el instanceof Element)) return true;
    if (el.id === APP_ID || el.id === OVERLAY_ID || el.id === CRAWL_FRAME_ID) return true;
    if (panel && (el === panel || panel.contains(el))) return true;
    if (overlayLayer && (el === overlayLayer || overlayLayer.contains(el))) return true;
    return false;
  }
  function visible(el) {
    if (!(el instanceof Element)) return false;
    if (isExcluded(el)) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    let s, r;
    try { s = getComputedStyle(el); r = el.getBoundingClientRect(); }
    catch (_) { return false; }
    return s.display !== 'none' &&
      s.visibility !== 'hidden' &&
      Number(s.opacity) !== 0 &&
      r.width > 0 && r.height > 0 &&
      el.getClientRects().length > 0;
  }
  function getRect(el) {
    try {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height)
      };
    } catch (_) { return { x: 0, y: 0, width: 0, height: 0 }; }
  }

  /* ============================================================
     SECTION 3 — Accessible name (aria-labelledby BEFORE aria-label)
     ============================================================ */
  function associatedLabel(el) {
    const labels = el.labels ? Array.from(el.labels) : [];
    let result = labels
      .map(x => normalize(x.innerText || x.textContent))
      .filter(Boolean).join(' | ');
    if (result) return result.slice(0, 120);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      result = labelledBy.split(/\s+/)
        .map(id => getById(el, id)).filter(Boolean)
        .map(x => normalize(x.innerText || x.textContent))
        .filter(Boolean).join(' | ');
      if (result) return result.slice(0, 120);
    }
    const label = el.closest ? el.closest('label') : null;
    if (label) return normalize(label.innerText || label.textContent).slice(0, 120);
    return '';
  }
  function accessibleName(el) {
    // Correct AccName order: aria-labelledby first, then aria-label.
    const labelledBy = el.getAttribute('aria-labelledby');
    const candidates = [
      labelledBy ? associatedLabel(el) : '',
      el.getAttribute('aria-label'),
      associatedLabel(el),
      el.getAttribute('title'),
      el.getAttribute('placeholder'),
      ['A', 'BUTTON', 'SUMMARY'].includes(el.tagName)
        ? (el.innerText || el.textContent) : '',
      el.getAttribute('alt'),
      el.getAttribute('name')
    ];
    for (const item of candidates) {
      const value = normalize(item);
      if (value) return value.slice(0, 120);
    }
    return '';
  }

  /* ============================================================
     SECTION 4 — Locator: CSS selector + XPath
     ============================================================ */
  function getSelector(el) {
    const tag = (el.tagName || 'div').toLowerCase();
    const doc = el.ownerDocument || document;
    if (el.id) {
      try {
        if (doc.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
          return tag + '#' + el.id;
        }
      } catch (_) {}
    }
    const cls = getClass(el).split(/\s+/).filter(Boolean)[0];
    if (cls) {
      try {
        if (doc.querySelectorAll(tag + '.' + CSS.escape(cls)).length === 1) {
          return tag + '.' + cls;
        }
      } catch (_) {}
      return tag + '.' + cls;
    }
    const name = accessibleName(el);
    if (name) return tag + '[name="' + name.slice(0, 40).replace(/"/g, '') + '"]';
    // nth-of-type fallback inside parent
    try {
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children)
          .filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
          return tag + ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')';
        }
      }
    } catch (_) {}
    return tag;
  }
  function getXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '//*[@id="' + el.id + '"]';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 8) {
      let idx = 1;
      let sib = cur.previousSibling;
      while (sib) {
        if (sib.nodeType === 1 && sib.tagName === cur.tagName) idx++;
        sib = sib.previousSibling;
      }
      parts.unshift(cur.tagName.toLowerCase() + '[' + idx + ']');
      cur = cur.parentElement;
    }
    return '/' + parts.join('/');
  }

  /* ============================================================
     SECTION 5 — Collector (Shadow DOM + same-origin iframes)
     ============================================================ */
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    return ['button', 'input', 'select', 'textarea', 'a', 'summary'].includes(tag) ||
      ROLES.has(role) ||
      el.isContentEditable ||
      (el.hasAttribute('tabindex') && Number(el.getAttribute('tabindex')) >= 0);
  }

  function collectNodes(rootDoc) {
    const notes = [];
    const seenRoots = new Set();
    const seenDocs = new Set();
    const result = [];
    const queue = [rootDoc];
    if (rootDoc) seenDocs.add(rootDoc);
    while (queue.length && result.length < MAX_DOM_NODES) {
      const root = queue.shift();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll('*')); }
      catch (_) { continue; }
      for (const el of nodes) {
        if (result.length >= MAX_DOM_NODES) break;
        if (isExcluded(el)) continue;
        result.push(el);
        if (el.shadowRoot) queue.push(el.shadowRoot);
        if (el.tagName === 'IFRAME') {
          if (el.id === CRAWL_FRAME_ID) continue; // never scan the crawler's own frame
          try {
            const d = el.contentDocument;
            if (d && !seenDocs.has(d)) { seenDocs.add(d); queue.push(d); }
            else if (!d) {
              notes.push({ type: 'iframe-unloaded', src: safeURL(el.src || ''), title: el.getAttribute('title') || '' });
            }
          } catch (_) {
            notes.push({ type: 'iframe-cross-origin', src: safeURL(el.src || ''), title: el.getAttribute('title') || '' });
          }
        }
      }
    }
    return { nodes: result, notes };
  }

  function describeControl(el, index) {
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.getAttribute('type') || 'text') : '';
    const item = {
      index,
      tag: el.tagName,
      selector: getSelector(el),
      xpath: getXPath(el),
      text: ['BUTTON', 'A', 'SUMMARY'].includes(el.tagName)
        ? normalize(el.innerText || el.textContent).slice(0, 120) : '',
      accessibleName: accessibleName(el),
      role: el.getAttribute('role') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || '',
      type,
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      id: el.id || '',
      className: getClass(el),
      disabled: 'disabled' in el ? Boolean(el.disabled)
        : el.getAttribute('aria-disabled') === 'true',
      required: 'required' in el ? Boolean(el.required)
        : el.getAttribute('aria-required') === 'true',
      pressed: el.getAttribute('aria-pressed'),
      expanded: el.getAttribute('aria-expanded'),
      selected: el.getAttribute('aria-selected'),
      checked: 'checked' in el ? Boolean(el.checked) : undefined,
      ariaValueNow: el.getAttribute('aria-valuenow'),
      ariaValueMin: el.getAttribute('aria-valuemin'),
      ariaValueMax: el.getAttribute('aria-valuemax'),
      rect: getRect(el)
    };
    if (tag === 'a') item.href = safeURL(el.href);
    if (tag === 'select') {
      item.multiple = Boolean(el.multiple);
      item.optionCount = el.options ? el.options.length : 0;
    }
    if (tag === 'textarea') item.rows = el.rows;
    if (el.isContentEditable) item.contentEditable = true;
    // Opt-in safe metadata only — length bucket, never the value.
    if (state.settings.optInSafeMetadata && (tag === 'input' || tag === 'textarea')) {
      let len = 0;
      try { len = String(el.value || '').length; } catch (_) { len = 0; }
      item.safeMeta = {
        inputType: type || '',
        hasMaxLength: el.hasAttribute('maxlength'),
        valueLengthBucket: len === 0 ? '0' : (len <= 10 ? '1-10' : '11+'),
        hasPlaceholder: el.hasAttribute('placeholder')
      };
    }
    return item;
  }

  function collectHeadings(nodes) {
    return nodes
      .filter(el => /^H[1-6]$/.test(el.tagName) && visible(el))
      .slice(0, 60)
      .map(el => ({
        level: Number(el.tagName.slice(1)),
        text: normalize(el.innerText || el.textContent).slice(0, 180),
        selector: getSelector(el),
        rect: getRect(el)
      }))
      .filter(x => x.text);
  }

  function collectForms(nodes) {
    return nodes
      .filter(el => el.tagName === 'FORM' && visible(el))
      .slice(0, 80)
      .map((form, index) => {
        let fieldEls = [];
        try {
          fieldEls = Array.from(form.querySelectorAll(
            'input,select,textarea,[role="textbox"],[role="combobox"]'
          ));
          // Shadow-DOM fields inside the form (querySelectorAll misses them)
          const shadowFields = [];
          for (const el of nodes) {
            if (el.shadowRoot && form.contains(el)) {
              try {
                shadowFields.push.apply(shadowFields,
                  Array.from(el.shadowRoot.querySelectorAll('input,select,textarea')));
              } catch (_) {}
            }
          }
          fieldEls = fieldEls.concat(shadowFields);
        } catch (_) {}
        const fields = fieldEls.filter(visible).slice(0, 100).map(field => ({
          tag: field.tagName,
          type: field.tagName === 'INPUT' ? field.type || 'text' : '',
          label: accessibleName(field),
          name: field.getAttribute('name') || '',
          placeholder: field.getAttribute('placeholder') || '',
          required: 'required' in field ? Boolean(field.required)
            : field.getAttribute('aria-required') === 'true',
          disabled: 'disabled' in field ? Boolean(field.disabled)
            : field.getAttribute('aria-disabled') === 'true'
        }));
        return {
          index: index + 1, id: form.id || '', className: getClass(form),
          selector: getSelector(form), fieldCount: fields.length, fields
        };
      });
  }

  /* ============================================================
     SECTION 6 — Diagnostic engine (30+ built-in rules)
     Each issue: {id, rule, severity, message, fix, selector, name}
     id = rule::selector::name — stable fingerprint for Baseline Diff.
     ============================================================ */
  function parseRGB(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map(x => parseFloat(x));
    if (parts.length < 3 || parts.some(isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  function luminance(c) {
    const f = v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrastRatio(c1, c2) {
    if (!c1 || !c2) return null;
    const l1 = luminance(c1), l2 = luminance(c2);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function effectiveBackground(el) {
    let cur = el;
    while (cur && cur instanceof Element) {
      try {
        const bg = parseRGB(getComputedStyle(cur).backgroundColor);
        if (bg && bg.a > 0) return bg;
      } catch (_) {}
      cur = cur.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function detectIssues(interactiveEls, controls, nodes, headings, forms, rootDoc) {
    const issues = [];
    const seenIssueIds = new Set();
    function push(rule, severity, message, fix, elOrControl) {
      let selector = '', name = '';
      if (elOrControl) {
        if (elOrControl instanceof Element) {
          selector = getSelector(elOrControl);
          name = accessibleName(elOrControl) ||
            normalize(elOrControl.innerText || elOrControl.textContent).slice(0, 60);
        } else {
          selector = elOrControl.selector || '';
          name = elOrControl.accessibleName || elOrControl.text || '';
        }
      }
      const id = rule + '::' + selector + '::' + normalize(name).slice(0, 60);
      if (seenIssueIds.has(id)) return;
      seenIssueIds.add(id);
      issues.push({ id, rule, severity, message, fix, selector, name: normalize(name).slice(0, 120) });
    }
    const doc = rootDoc || document;
    const byTag = tag => nodes.filter(el => el.tagName === tag);

    // 1. unlabeled-control (critical)
    for (let i = 0; i < interactiveEls.length; i++) {
      const el = interactiveEls[i], c = controls[i];
      if (!c) continue;
      const needsName = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(c.tag);
      if (needsName && !c.accessibleName && !c.text) {
        push('unlabeled-control', 'critical',
          c.tag + ' has no accessible name — a screen reader announces it as blank.',
          'Add an aria-label, a <label>, or visible text.', el);
      }
    }
    // 2. empty-button (critical)
    for (const el of interactiveEls) {
      if (el.tagName === 'BUTTON' && !accessibleName(el) &&
          !normalize(el.innerText || el.textContent)) {
        push('empty-button', 'critical', 'Button has no text or label — its purpose is unknown.',
          'Add visible text or an aria-label.', el);
      }
    }
    // 3. empty-link (critical)
    for (const el of interactiveEls) {
      if (el.tagName === 'A' && el.hasAttribute('href') && !accessibleName(el) &&
          !normalize(el.innerText || el.textContent)) {
        push('empty-link', 'critical', 'Link has no text or label — its destination is unknown.',
          'Add link text or an aria-label.', el);
      }
    }
    // 4. missing-alt (warning)
    for (const el of byTag('IMG')) {
      if (visible(el) && !el.hasAttribute('alt')) {
        push('missing-alt', 'warning', 'Image has no alt attribute.',
          'Add meaningful alt text, or alt="" if the image is decorative.', el);
      }
    }
    // 5. decorative-alt-misuse (warning) — alt text that is just a filename
    for (const el of byTag('IMG')) {
      const alt = el.getAttribute('alt') || '';
      if (alt && /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(alt.trim())) {
        push('decorative-alt-misuse', 'warning',
          'Alt text looks like a filename ("' + alt.slice(0, 40) + '") instead of a description.',
          'Write what the image shows, or use alt="" if decorative.', el);
      }
    }
    // 6. duplicate-id (warning)
    const idCounts = {};
    for (const el of nodes) if (el.id) idCounts[el.id] = (idCounts[el.id] || 0) + 1;
    for (const id of Object.keys(idCounts)) {
      if (idCounts[id] > 1) {
        push('duplicate-id', 'warning', 'id="' + id + '" is used ' + idCounts[id] + ' times.',
          'Use each id only once per page.', null);
      }
    }
    // 7. heading-skip (warning)
    let prevLevel = 0;
    for (const h of headings) {
      if (prevLevel && h.level > prevLevel + 1) {
        push('heading-skip', 'warning',
          'Heading jumps from H' + prevLevel + ' to H' + h.level + '.',
          'Increase heading levels by one at a time (H1 → H2 → H3).', null);
      }
      prevLevel = h.level;
    }
    // 8. heading-missing-h1 (warning)
    if (!headings.some(h => h.level === 1)) {
      push('heading-missing-h1', 'warning', 'Page has no visible H1 heading.',
        'Add one H1 that describes the page.', null);
    }
    // 9. multiple-h1 (warning)
    const h1Count = headings.filter(h => h.level === 1).length;
    if (h1Count > 1) {
      push('multiple-h1', 'warning', 'Page has ' + h1Count + ' visible H1 headings.',
        'Keep a single H1 per page; use H2/H3 for other sections.', null);
    }
    // 10. no-landmarks (info)
    const landmarkTags = ['HEADER', 'NAV', 'MAIN', 'FOOTER', 'ASIDE'];
    const hasLandmark = nodes.some(el =>
      landmarkTags.includes(el.tagName) ||
      ['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'search', 'form']
        .includes((el.getAttribute('role') || '').toLowerCase()));
    if (!hasLandmark) {
      push('no-landmarks', 'info', 'Page has no landmarks (header, nav, main, footer).',
        'Use <header>, <nav>, <main> and <footer>, or equivalent ARIA roles.', null);
    }
    // 11. missing-lang (warning)
    try {
      const lang = (doc.documentElement && doc.documentElement.lang) || '';
      if (!lang.trim()) {
        push('missing-lang', 'warning', 'The <html> element has no lang attribute.',
          'Add lang="en" (or the page language) to <html>.', null);
      }
    } catch (_) {}
    // 12. missing-title (warning)
    try {
      if (!normalize(doc.title)) {
        push('missing-title', 'warning', 'Page has no <title> (or it is empty).',
          'Add a descriptive <title>.', null);
      }
    } catch (_) {}
    // 13. missing-skip-link (info)
    const hasSkip = nodes.some(el =>
      el.tagName === 'A' && (el.getAttribute('href') || '').startsWith('#') &&
      /skip/i.test(normalize(el.innerText || el.textContent)));
    if (!hasSkip) {
      push('missing-skip-link', 'info', 'No skip link to main content was found.',
        'Add a "Skip to main content" link as the first link on the page.', null);
    }
    // 14. invalid-aria-role (warning)
    for (const el of nodes) {
      const role = (el.getAttribute('role') || '').toLowerCase().trim();
      if (role && !VALID_ROLES.has(role)) {
        push('invalid-aria-role', 'warning', 'role="' + role + '" is not a valid ARIA role.',
          'Remove it or use a valid role from the ARIA specification.', el);
      }
    }
    // 15. aria-hidden-focusable (critical)
    for (const el of interactiveEls) {
      let cur = el, hidden = false;
      while (cur && cur instanceof Element) {
        if (cur.getAttribute('aria-hidden') === 'true') { hidden = true; break; }
        cur = cur.parentElement;
      }
      if (hidden) {
        push('aria-hidden-focusable', 'critical',
          'Focusable element is inside aria-hidden="true" — keyboard users can reach it but screen readers cannot see it.',
          'Remove aria-hidden from the ancestor, or remove the element from the tab order.', el);
      }
    }
    // 16. tabindex-positive (warning)
    for (const el of interactiveEls) {
      const ti = el.getAttribute('tabindex');
      if (ti !== null && Number(ti) > 0) {
        push('tabindex-positive', 'warning', 'tabindex="' + ti + '" disrupts the natural tab order.',
          'Use tabindex="0" or restructure the DOM order instead.', el);
      }
    }
    // 17. small-touch-target (warning) — under 24x24 CSS px
    for (const el of interactiveEls) {
      const r = getRect(el);
      if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)) {
        push('small-touch-target', 'warning',
          'Interactive element is ' + r.width + 'x' + r.height + 'px — smaller than the 24px minimum target size.',
          'Make the target at least 24x24px.', el);
      }
    }
    // 18. low-contrast-placeholder (warning, only where computable)
    for (const el of interactiveEls) {
      if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) continue;
      if (!el.hasAttribute('placeholder')) continue;
      try {
        const ph = getComputedStyle(el, '::placeholder');
        const fg = parseRGB(ph.color);
        const bg = effectiveBackground(el);
        const ratio = contrastRatio(fg, bg);
        if (ratio !== null && ratio < 4.5) {
          push('low-contrast-placeholder', 'warning',
            'Placeholder text contrast is ' + ratio.toFixed(2) + ':1 — below the 4.5:1 WCAG AA level.',
            'Darken the placeholder colour so it meets 4.5:1.', el);
        }
      } catch (_) { /* placeholder pseudo-style not readable — skip, do not invent */ }
    }
    // 19. form-field-no-label (critical)
    for (const el of byTag('INPUT').concat(byTag('SELECT'), byTag('TEXTAREA'))) {
      if (!visible(el)) continue;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      if (!accessibleName(el)) {
        push('form-field-no-label', 'critical',
          el.tagName + ' field has no label or accessible name.',
          'Associate a <label>, aria-label, or aria-labelledby.', el);
      }
    }
    // 20. form-no-autocomplete (info)
    // Only flag when the form has autofill-relevant fields but no field
    // in it carries an autocomplete attribute.
    for (const form of forms) {
      if (form.fieldCount === 0) continue;
      const relevant = form.fields.some(f =>
        ['email', 'password', 'text', 'tel'].includes((f.type || '').toLowerCase()) ||
        /email|name|tel|password/i.test(f.name || ''));
      if (!relevant) continue;
      let anyAuto = false;
      try {
        const formEl = nodes.find(el => el.tagName === 'FORM' && getSelector(el) === form.selector);
        if (formEl) {
          anyAuto = Array.from(formEl.querySelectorAll('input,select,textarea'))
            .some(f => f.hasAttribute('autocomplete'));
        }
      } catch (_) {}
      if (!anyAuto) {
        push('form-no-autocomplete', 'info',
          'Form has ' + form.fieldCount + ' fields but no autocomplete attributes.',
          'Add autocomplete="email", "name", "current-password", etc. where it applies.', null);
      }
    }
    // 21. missing-iframe-title (warning)
    for (const el of byTag('IFRAME')) {
      if (el.id === CRAWL_FRAME_ID) continue;
      if (visible(el) && !normalize(el.getAttribute('title'))) {
        push('missing-iframe-title', 'warning', 'Visible iframe has no title attribute.',
          'Add title="..." describing the embedded content.', el);
      }
    }
    // 22. video-no-captions (warning)
    for (const el of byTag('VIDEO')) {
      if (!visible(el)) continue;
      let hasCaptions = false;
      try {
        hasCaptions = Array.from(el.querySelectorAll('track'))
          .some(t => (t.getAttribute('kind') || '') === 'captions');
      } catch (_) {}
      if (!hasCaptions) {
        push('video-no-captions', 'warning', 'Video has no captions track.',
          'Add <track kind="captions" src="...">.', el);
      }
    }
    // 23. link-same-text-different-href (warning)
    const linkGroups = {};
    for (const c of controls) {
      if (c.tag !== 'A' || !c.text || !c.href) continue;
      const key = c.text.toLowerCase();
      linkGroups[key] = linkGroups[key] || new Set();
      linkGroups[key].add(c.href);
    }
    for (const key of Object.keys(linkGroups)) {
      if (linkGroups[key].size > 1) {
        push('link-same-text-different-href', 'warning',
          'Link text "' + key.slice(0, 40) + '" points to ' + linkGroups[key].size + ' different destinations.',
          'Make link text describe each destination, or keep one destination per text.', null);
      }
    }
    // 24. button-no-type-in-form (warning)
    for (const el of byTag('BUTTON')) {
      if (!visible(el)) continue;
      if (el.closest && el.closest('form') && !el.hasAttribute('type')) {
        push('button-no-type-in-form', 'warning',
          'Button inside a form has no type attribute — it defaults to type="submit".',
          'Add type="button" or type="submit" explicitly.', el);
      }
    }
    // 25. duplicate-accessible-name (warning)
    const nameGroups = {};
    for (const c of controls) {
      if (!c.accessibleName) continue;
      const key = c.tag + '::' + c.accessibleName.toLowerCase();
      nameGroups[key] = (nameGroups[key] || 0) + 1;
    }
    for (const key of Object.keys(nameGroups)) {
      if (nameGroups[key] > 1) {
        push('duplicate-accessible-name', 'warning',
          'Accessible name "' + key.split('::')[1].slice(0, 40) + '" is used ' +
          nameGroups[key] + ' times on ' + key.split('::')[0] + ' elements.',
          'Make names distinct, or group the controls with a fieldset/legend.', null);
      }
    }
    // 26. aria-valuenow-missing (warning)
    for (const el of nodes) {
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (['slider', 'spinbutton', 'progressbar'].includes(role) &&
          !el.hasAttribute('aria-valuenow')) {
        push('aria-valuenow-missing', 'warning',
          'role="' + role + '" has no aria-valuenow.',
          'Add aria-valuenow (with aria-valuemin / aria-valuemax).', el);
      }
    }
    // 27. required-no-indicator (info)
    for (const el of byTag('INPUT').concat(byTag('SELECT'), byTag('TEXTAREA'))) {
      if (!visible(el)) continue;
      const req = 'required' in el ? Boolean(el.required)
        : el.getAttribute('aria-required') === 'true';
      if (!req) continue;
      const labelText = accessibleName(el);
      if (labelText && !/\*|required/i.test(labelText)) {
        push('required-no-indicator', 'info',
          'Required field "' + labelText.slice(0, 40) + '" has no visible required indicator.',
          'Mark it with * or the word "required" in the label.', el);
      }
    }
    // 28. image-link-no-name (critical)
    for (const el of byTag('A')) {
      if (!visible(el) || !el.hasAttribute('href')) continue;
      const imgs = el.querySelectorAll ? el.querySelectorAll('img') : [];
      const hasText = normalize(el.innerText || el.textContent).length > 0;
      if (imgs.length > 0 && !hasText && !accessibleName(el)) {
        let imgAlt = '';
        try { imgAlt = imgs[0].getAttribute('alt') || ''; } catch (_) {}
        if (!imgAlt) {
          push('image-link-no-name', 'critical',
            'Link contains only an image with no alt text or label.',
            'Give the image alt text, or the link an aria-label.', el);
        }
      }
    }
    // 29. empty-heading (warning)
    for (const el of nodes) {
      if (/^H[1-6]$/.test(el.tagName) && visible(el) &&
          !normalize(el.innerText || el.textContent)) {
        push('empty-heading', 'warning', el.tagName + ' heading is empty.',
          'Add heading text, or remove the empty heading.', el);
      }
    }
    // 30. table-no-th (warning)
    for (const el of byTag('TABLE')) {
      if (!visible(el)) continue;
      let hasTh = false;
      try { hasTh = el.querySelectorAll('th').length > 0; } catch (_) {}
      if (!hasTh) {
        push('table-no-th', 'warning', 'Table has no <th> header cells.',
          'Use <th> (with scope) for header cells.', el);
      }
    }
    // 31. select-no-label (warning — distinct from form-field-no-label: select-specific)
    for (const el of byTag('SELECT')) {
      if (visible(el) && !accessibleName(el)) {
        push('select-no-label', 'warning', 'Select dropdown has no label.',
          'Associate a <label> or aria-label.', el);
      }
    }
    return issues;
  }

  /* ============================================================
     SECTION 7 — Custom Rule Engine (predefined predicates only)
     NO eval, NO Function constructor. Unknown predicates rejected.
     Predicate = the condition that TRIGGERS an issue when true:
       missingAttribute — element lacks `attribute`
       hasAttribute    — element has `attribute`
       textEmpty       — element has no visible text
       countGreaterThan — matched elements count > `value`
     ============================================================ */
  const CUSTOM_PREDICATES = ['missingAttribute', 'hasAttribute', 'textEmpty', 'countGreaterThan'];
  function isValidCustomRuleShape(r) {
    if (!r || typeof r !== 'object') return false;
    if (typeof r.id !== 'string' || !r.id.trim()) return false;
    if (typeof r.selector !== 'string' || !r.selector.trim()) return false;
    if (typeof r.message !== 'string' || !r.message.trim()) return false;
    const test = r.test;
    const pred = typeof test === 'string' ? test : (test && test.predicate);
    if (!CUSTOM_PREDICATES.includes(pred)) return false;
    if (!['critical', 'warning', 'info'].includes(r.severity || 'warning')) return false;
    return true;
  }
  function validateCustomRule(r) {
    if (!isValidCustomRuleShape(r)) {
      return 'Invalid rule: need id, selector, message, a valid severity, and test.predicate ' +
        'one of ' + CUSTOM_PREDICATES.join(', ') + '. No eval or code is allowed.';
    }
    if (String(r.id).startsWith('udd-builtin-')) return 'Rule id must not start with udd-builtin-.';
    return null;
  }
  function runCustomRules(nodes, issues) {
    if (!state.customRules.length) return issues;
    const seen = new Set(issues.map(i => i.id));
    function push(rule, severity, message, fix, el) {
      const selector = el ? getSelector(el) : '';
      const name = el ? (accessibleName(el) || normalize(el.innerText || el.textContent).slice(0, 60)) : '';
      const id = 'custom:' + rule.id + '::' + selector + '::' + normalize(name).slice(0, 60);
      if (seen.has(id)) return;
      seen.add(id);
      issues.push({
        id, rule: 'custom:' + rule.id, severity,
        message, fix: fix || '', selector, name: normalize(name).slice(0, 120),
        custom: true
      });
    }
    for (const rule of state.customRules) {
      if (rule.enabled === false) continue;
      const test = typeof rule.test === 'string'
        ? { predicate: rule.test, attribute: rule.attribute, value: rule.value }
        : rule.test;
      let matched = [];
      try {
        matched = nodes.filter(el => {
          try { return el.matches && el.matches(rule.selector); } catch (_) { return false; }
        });
      } catch (_) { continue; }
      if (test.predicate === 'countGreaterThan') {
        const limit = Number(test.value || 0);
        if (matched.length > limit) {
          push(rule, rule.severity || 'warning',
            rule.message + ' (' + matched.length + ' matches, limit ' + limit + '.)',
            rule.fix || '', matched[0] || null);
        }
        continue;
      }
      for (const el of matched) {
        let hit = false;
        if (test.predicate === 'missingAttribute') hit = !el.hasAttribute(test.attribute || '');
        else if (test.predicate === 'hasAttribute') hit = el.hasAttribute(test.attribute || '');
        else if (test.predicate === 'textEmpty') hit = !normalize(el.innerText || el.textContent);
        if (hit) push(rule, rule.severity || 'warning', rule.message, rule.fix || '', el);
      }
    }
    return issues;
  }

  /* ============================================================
     SECTION 8 — Score, grade, Baseline Diff, gate
     ============================================================ */
  function computeScore(issues) {
    let score = 100;
    for (const i of issues) {
      if (i.severity === 'critical') score -= 10;
      else if (i.severity === 'warning') score -= 5;
      else score -= 1;
    }
    return Math.max(0, score);
  }
  function gradeFor(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }
  function loadBaseline() {
    try {
      const raw = storeGet(baselineKey(), null);
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) { return null; }
  }
  function compareBaseline(baseline, currentIssues, currentScore) {
    const baseIssues = Array.isArray(baseline.issues) ? baseline.issues : [];
    const baseById = new Map(baseIssues.map(i => [i.id, i]));
    const curById = new Map(currentIssues.map(i => [i.id, i]));
    const added = currentIssues.filter(i => !baseById.has(i.id));
    const fixed = baseIssues.filter(i => !curById.has(i.id));
    const unchanged = currentIssues.filter(i => baseById.has(i.id));
    return {
      baselineAt: baseline.capturedAt || '',
      baselineScore: typeof baseline.score === 'number' ? baseline.score : null,
      currentScore,
      scoreDelta: (typeof baseline.score === 'number') ? currentScore - baseline.score : null,
      added, fixed, unchanged,
      addedCount: added.length, fixedCount: fixed.length, unchangedCount: unchanged.length
    };
  }
  function saveBaseline() {
    if (!state.report) { setStatus('Run SCAN UI first, then SAVE BASELINE.'); return; }
    const baseline = {
      version: '2.0.0', url: location.origin + location.pathname,
      capturedAt: new Date().toISOString(), score: state.score, issues: state.issues
    };
    if (storeSet(baselineKey(), JSON.stringify(baseline))) {
      state.diff = null;
      renderDiff(null);
      setStatus('Baseline saved: ' + state.issues.length + ' issues, score ' +
        state.score + '/100. Change the page and SCAN again to see the diff.');
    } else {
      setStatus('Baseline could not be saved (storage unavailable).');
    }
  }
  function clearBaseline() {
    storeDelete(baselineKey());
    state.diff = null;
    renderDiff(null);
    setStatus('Baseline cleared.');
  }
  function exportBaseline() {
    const b = loadBaseline();
    if (!b) { setStatus('No baseline to export — SAVE BASELINE first.'); return; }
    downloadFile('udd-baseline-' + fileSlug() + '.json',
      JSON.stringify(b, null, 2), 'application/json');
    setStatus('Baseline JSON downloaded.');
  }
  function importBaselineFromText(text) {
    try {
      const b = JSON.parse(text);
      if (!b || !Array.isArray(b.issues) || typeof b.score !== 'number') {
        setStatus('Import failed: file is not a UDD baseline (needs issues array + score).');
        return;
      }
      storeSet(baselineKey(), JSON.stringify(b));
      state.diff = null;
      renderDiff(null);
      setStatus('Baseline imported: ' + b.issues.length + ' issues, score ' + b.score + '. SCAN to compare.');
    } catch (e) {
      setStatus('Import failed: ' + e.message);
    }
  }
  function gateResult() {
    const critical = state.issues.filter(i => i.severity === 'critical').length;
    const breached = state.score < state.settings.minScore || critical > state.settings.maxCritical;
    return {
      pass: !breached, critical,
      message: breached
        ? 'REGRESSION GATE FAILED — score ' + state.score + ' (min ' + state.settings.minScore +
          '), critical ' + critical + ' (max ' + state.settings.maxCritical + '). ' +
          'This is an in-browser gate only; it does not block any pull request or deployment.'
        : 'GATE PASSED — score ' + state.score + ' (min ' + state.settings.minScore +
          '), critical ' + critical + ' (max ' + state.settings.maxCritical + ').'
    };
  }
  function notifyGate(gate) {
    if (gate.pass) return;
    try {
      if (gmHas('GM_notification')) {
        GM_notification({
          title: 'UDD: Regression gate failed',
          text: 'Score ' + state.score + ', ' + gate.critical + ' critical issues on ' + location.pathname,
          timeout: 6000
        });
      }
    } catch (_) {}
  }

  /* ============================================================
     SECTION 9 — Analyse one document (main page or crawl iframe)
     ============================================================ */
  function analyzeDocument(rootDoc, urlLabel) {
    const collected = collectNodes(rootDoc);
    const nodes = collected.nodes;
    const interactiveEls = [];
    const seen = new Set();
    for (const el of nodes) {
      if (interactiveEls.length >= MAX_CONTROLS) break;
      if (!visible(el) || !isInteractive(el)) continue;
      if (seen.has(el)) continue;
      seen.add(el);
      interactiveEls.push(el);
    }
    const controls = interactiveEls.map((el, i) => describeControl(el, i + 1));
    const headings = collectHeadings(nodes);
    const forms = collectForms(nodes);
    let issues = detectIssues(interactiveEls, controls, nodes, headings, forms, rootDoc);
    issues = runCustomRules(nodes, issues);
    const score = computeScore(issues);
    return {
      url: urlLabel || (rootDoc === document
        ? location.origin + location.pathname : ''),
      controls, headings, forms, issues, score, grade: gradeFor(score),
      scannedElements: nodes.length,
      iframeNotes: collected.notes,
      controlsTruncated: interactiveEls.length >= MAX_CONTROLS,
      domScanTruncated: nodes.length >= MAX_DOM_NODES
    };
  }

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }
  function fileSlug() {
    return location.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase() +
      '-' + new Date().toISOString().slice(0, 10);
  }
  function downloadFile(filename, content, mime) {
    try {
      if (gmHas('GM_download')) {
        GM_download({ url: URL.createObjectURL(new Blob([content], { type: mime })), name: filename });
        return;
      }
    } catch (_) {}
    try {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setStatus('Download failed: ' + e.message);
    }
  }

  /* ============================================================
     SECTION 10 — Scan (main page), renderers, gate banner, diff
     ============================================================ */
  function scanUI() {
    if (state.scanning) return;
    state.scanning = true;
    try {
      setStatus('Scanning website UI...');
      const result = analyzeDocument(document);
      state.controls = result.controls;
      state.headings = result.headings;
      state.forms = result.forms;
      state.issues = result.issues;
      state.score = result.score;
      state.grade = result.grade;
      state.iframeNotes = result.iframeNotes;

      const baseline = loadBaseline();
      state.diff = baseline ? compareBaseline(baseline, result.issues, result.score) : null;
      renderDiff(state.diff);
      const gate = gateResult();
      renderGate(gate);
      notifyGate(gate);
      try { storeSet('lastScan:' + location.origin + location.pathname, Date.now()); } catch (_) {}

      const perf = perfSummary();
      const report = {
        reportType: 'Universal DOM Diagnostic',
        version: '2.0.0',
        capturedAt: new Date().toISOString(),
        page: {
          url: location.origin + location.pathname,
          title: document.title || '',
          viewport: {
            width: window.innerWidth, height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY)
          },
          document: {
            readyState: document.readyState,
            language: document.documentElement.lang || '',
            scannedElements: result.scannedElements
          }
        },
        summary: {
          visibleInteractiveControls: result.controls.length,
          headings: result.headings.length,
          visibleForms: result.forms.length,
          issues: result.issues.length,
          critical: result.issues.filter(i => i.severity === 'critical').length,
          warning: result.issues.filter(i => i.severity === 'warning').length,
          info: result.issues.filter(i => i.severity === 'info').length,
          score: result.score,
          grade: result.grade,
          gate: gate.pass ? 'PASS' : 'FAIL',
          controlsTruncated: result.controlsTruncated,
          domScanTruncated: result.domScanTruncated,
          iframeNotes: result.iframeNotes
        },
        performance: perf,
        baselineDiff: state.diff,
        issues: result.issues,
        headings: result.headings,
        forms: result.forms,
        controls: result.controls,
        crawl: state.crawl.results.length ? {
          pages: state.crawl.results.length,
          done: state.crawl.done, skipped: state.crawl.skipped,
          results: state.crawl.results
        } : null,
        settingsUsed: {
          minScore: state.settings.minScore,
          maxCritical: state.settings.maxCritical,
          optInSafeMetadata: state.settings.optInSafeMetadata
        },
        privacy: {
          inputValuesCollected: false,
          passwordValuesCollected: false,
          cookiesCollected: false,
          localStorageCollected: false,
          sessionStorageCollected: false,
          networkRequestsCollected: false,
          urlQueryAndHashIncluded: false,
          baselineStoredLocallyOnly: true,
          optInSafeMetadata: state.settings.optInSafeMetadata
        }
      };
      state.report = report;
      state.reportText = JSON.stringify(report, null, 2);
      if (outputEl) {
        outputEl.value = state.reportText.slice(0, 14000) +
          (state.reportText.length > 14000 ? '\n[Preview truncated. Copy the complete report.]' : '');
      }
      if (copyButton) copyButton.disabled = false;
      if (downloadButton) downloadButton.disabled = false;
      if (downloadHtmlButton) downloadHtmlButton.disabled = false;
      if (saveButton) saveButton.disabled = false;
      renderIssuesList();
      renderControlsList();
      renderPerfTab();
      if (state.overlayMode) renderOverlay();
      const diffNote = state.diff
        ? ' Diff: +' + state.diff.addedCount + ' new, -' + state.diff.fixedCount + ' fixed.'
        : ' No baseline yet — SAVE BASELINE to enable diff.';
      setStatus('Scan complete: ' + result.controls.length + ' controls, ' +
        result.issues.length + ' issues, score ' + result.score + '/100 (' + result.grade + ').' + diffNote);
    } catch (error) {
      setStatus('Scan failed: ' + error.message);
      console.error(error);
    } finally {
      state.scanning = false;
    }
  }

  function renderDiff(diff) {
    if (!diffBoxEl) return;
    if (!diff) {
      const b = loadBaseline();
      diffBoxEl.innerHTML = '<b>Baseline:</b> ' + (b
        ? 'saved (' + String(b.capturedAt || '').slice(0, 19).replace('T', ' ') + ') — SCAN to auto-compare.'
        : 'none yet. SCAN, then SAVE BASELINE.');
      return;
    }
    const delta = diff.scoreDelta === null ? 'n/a'
      : (diff.scoreDelta > 0 ? '+' + diff.scoreDelta : String(diff.scoreDelta));
    const deltaClass = diff.scoreDelta === null ? '' : (diff.scoreDelta < 0 ? 'bad' : (diff.scoreDelta > 0 ? 'good' : ''));
    let html = '<div class="diff-sum">Score: <b>' + escHtml(String(diff.baselineScore)) + ' → ' +
      diff.currentScore + ' (<span class="' + deltaClass + '">' + delta + '</span>)</b> &nbsp;|&nbsp; ' +
      '<span class="bad">+' + diff.addedCount + ' new</span> &nbsp; ' +
      '<span class="good">−' + diff.fixedCount + ' fixed</span> &nbsp; ' +
      diff.unchangedCount + ' unchanged</div>';
    if (diff.added.length) {
      html += '<div class="diff-head bad">NEW ISSUES (+' + diff.addedCount + ')</div>';
      html += diff.added.slice(0, 10).map(i =>
        '<div class="diff-item">[' + escHtml(i.severity.toUpperCase()) + '] ' + escHtml(i.rule) +
        ' — ' + escHtml(i.message) + ' <code>' + escHtml(i.selector) + '</code></div>').join('');
    }
    if (diff.fixed.length) {
      html += '<div class="diff-head good">FIXED (−' + diff.fixedCount + ')</div>';
      html += diff.fixed.slice(0, 10).map(i =>
        '<div class="diff-item">[' + escHtml(i.severity.toUpperCase()) + '] ' + escHtml(i.rule) +
        ' — ' + escHtml(i.message) + ' <code>' + escHtml(i.selector) + '</code></div>').join('');
    }
    if (!diff.added.length && !diff.fixed.length) {
      html += '<div class="diff-item good">No change — matches the baseline.</div>';
    }
    diffBoxEl.innerHTML = html;
  }

  function renderGate(gate) {
    if (!gateBoxEl) return;
    gateBoxEl.className = 'gate ' + (gate.pass ? 'gate-pass' : 'gate-fail');
    gateBoxEl.textContent = gate.message;
  }

  function issueFilter() {
    const sevEl = panel ? panel.querySelector('#udd-issue-sev') : null;
    const qEl = panel ? panel.querySelector('#udd-issue-q') : null;
    return {
      sev: sevEl ? sevEl.value : 'all',
      q: qEl ? qEl.value.trim().toLowerCase() : ''
    };
  }
  function renderIssuesList() {
    const list = panel ? panel.querySelector('#udd-issues-list') : null;
    if (!list) return;
    const f = issueFilter();
    const filtered = state.issues.filter(i => {
      if (f.sev !== 'all' && i.severity !== f.sev) return false;
      if (f.q && (i.rule + ' ' + i.message + ' ' + i.selector + ' ' + i.name)
          .toLowerCase().indexOf(f.q) === -1) return false;
      return true;
    });
    if (!state.issues.length) {
      list.innerHTML = '<div class="muted">No scan yet, or no issues found. Run SCAN UI.</div>';
      return;
    }
    list.innerHTML = '<div class="muted">Showing ' + Math.min(filtered.length, MAX_ISSUES_SHOWN) +
      ' of ' + filtered.length + ' matching (' + state.issues.length + ' total).</div>' +
      filtered.slice(0, MAX_ISSUES_SHOWN).map(i =>
        '<div class="issue sev-' + escHtml(i.severity) + '">' +
        '<b>[' + escHtml(i.severity.toUpperCase()) + ']</b> ' + escHtml(i.rule) +
        '<br>' + escHtml(i.message) +
        '<br><span class="muted">Fix: ' + escHtml(i.fix || '') + '</span>' +
        (i.selector ? '<br><code>' + escHtml(i.selector) + '</code>' : '') +
        '</div>').join('');
  }
  function renderControlsList() {
    const list = panel ? panel.querySelector('#udd-controls-list') : null;
    if (!list) return;
    if (!state.controls.length) {
      list.innerHTML = '<div class="muted">No scan yet. Run SCAN UI.</div>';
      return;
    }
    list.innerHTML = '<div class="muted">' + state.controls.length + ' visible interactive controls.</div>' +
      state.controls.slice(0, MAX_ISSUES_SHOWN).map(c =>
        '<div class="issue"><b>#' + c.index + ' ' + escHtml(c.tag) + '</b> ' +
        escHtml(c.accessibleName || c.text || '(no name)') +
        '<br><code>' + escHtml(c.selector) + '</code>' +
        (c.href ? '<br><span class="muted">' + escHtml(c.href) + '</span>' : '') +
        '</div>').join('');
  }
  function renderPerfTab() {
    const box = panel ? panel.querySelector('#udd-perf-box') : null;
    if (!box) return;
    const p = perfSummary();
    function row(label, value, verdict) {
      return '<tr><td>' + escHtml(label) + '</td><td>' + escHtml(String(value === null ? 'not measured' : value)) +
        '</td><td>' + escHtml(verdict || '') + '</td></tr>';
    }
    box.innerHTML = '<table class="mini"><tr><th>Metric</th><th>Value</th><th>Verdict</th></tr>' +
      row('LCP', p.lcpMs === null ? null : p.lcpMs + ' ms', p.lcpVerdict) +
      row('CLS', p.cls, p.clsVerdict) +
      row('INP (max event)', p.inpMs === null ? null : p.inpMs + ' ms', p.inpVerdict) +
      row('FCP', p.fcpMs === null ? null : p.fcpMs + ' ms', '') +
      row('TTFB', p.ttfbMs === null ? null : p.ttfbMs + ' ms', '') +
      '</table>' +
      '<div class="muted">' + escHtml(p.note) + '</div>' +
      '<div class="diff-head">Console errors (' + p.consoleErrors.length + ')</div>' +
      (p.consoleErrors.length ? p.consoleErrors.map(e => '<div class="diff-item">' + escHtml(e.message) + '</div>').join('') : '<div class="muted">None captured.</div>') +
      '<div class="diff-head">Page errors (' + p.pageErrors.length + ')</div>' +
      (p.pageErrors.length ? p.pageErrors.map(e => '<div class="diff-item">' + escHtml(e.message) + '</div>').join('') : '<div class="muted">None captured.</div>') +
      '<div class="diff-head">Suspected failed resources (' + p.suspectedFailedResources.length + ')</div>' +
      (p.suspectedFailedResources.length ? p.suspectedFailedResources.map(e => '<div class="diff-item">' + escHtml(e.url) + '</div>').join('') : '<div class="muted">None detected.</div>');
  }

  /* ============================================================
     SECTION 11 — Overlay mode (Tab Order / Issues / Headings)
     Markers live in one container only; page DOM is not altered.
     ============================================================ */
  function ensureOverlayLayer() {
    if (overlayLayer) return overlayLayer;
    overlayLayer = document.createElement('div');
    overlayLayer.id = OVERLAY_ID;
    overlayLayer.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(overlayLayer);
    return overlayLayer;
  }
  function clearOverlay() {
    if (overlayLayer) overlayLayer.innerHTML = '';
  }
  function overlayMarker(x, y, w, h, label, cls, issue) {
    const layer = ensureOverlayLayer();
    const d = document.createElement('div');
    d.className = 'udd-marker ' + cls;
    d.style.left = Math.max(0, x) + 'px';
    d.style.top = Math.max(0, y) + 'px';
    d.style.minWidth = Math.max(18, Math.min(w, 120)) + 'px';
    d.textContent = label;
    d.title = issue ? (issue.rule + ': ' + issue.message) : label;
    if (issue) {
      d.addEventListener('click', ev => {
        ev.stopPropagation();
        showTab('issues');
        const q = panel ? panel.querySelector('#udd-issue-q') : null;
        if (q) { q.value = issue.rule; renderIssuesList(); }
        if (statusEl) statusEl.textContent = issue.rule + ': ' + issue.message;
      });
    }
    layer.appendChild(d);
    return d;
  }
  function renderOverlay() {
    clearOverlay();
    if (!state.overlayMode) return;
    ensureOverlayLayer();
    if (state.overlayMode === 'tab') {
      const els = [];
      try {
        els.push.apply(els, Array.from(document.querySelectorAll(
          'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]'
        )));
      } catch (_) {}
      let n = 0;
      for (const el of els) {
        if (n >= 200) break;
        if (!visible(el) || el.disabled) continue;
        const r = getRect(el);
        overlayMarker(r.x + window.scrollX, r.y + window.scrollY, r.width, r.height,
          String(n + 1), 'm-tab', null);
        n++;
      }
    } else if (state.overlayMode === 'issues') {
      for (const issue of state.issues.slice(0, 100)) {
        if (!issue.selector) continue;
        let el = null;
        try { el = document.querySelector(issue.selector); } catch (_) {}
        if (!el || !visible(el)) continue;
        const r = getRect(el);
        overlayMarker(r.x + window.scrollX, r.y + window.scrollY, r.width, r.height,
          issue.severity === 'critical' ? '!' : '?',
          issue.severity === 'critical' ? 'm-crit' : 'm-warn', issue);
      }
    } else if (state.overlayMode === 'headings') {
      for (const h of state.headings) {
        let el = null;
        try { el = document.querySelector(h.selector); } catch (_) {}
        if (!el || !visible(el)) continue;
        const r = getRect(el);
        overlayMarker(r.x + window.scrollX, r.y + window.scrollY, r.width, r.height,
          'H' + h.level, 'm-head', null);
      }
    }
  }
  function setOverlayMode(mode) {
    state.overlayMode = (state.overlayMode === mode) ? null : mode;
    renderOverlay();
    if (statusEl) {
      statusEl.textContent = state.overlayMode
        ? 'Overlay on: ' + state.overlayMode + '. Click a marker to inspect it.'
        : 'Overlay off.';
    }
    const btns = panel ? panel.querySelectorAll('[data-overlay]') : [];
    btns.forEach(b => {
      b.classList.toggle('active', state.overlayMode === b.getAttribute('data-overlay'));
    });
  }
  let overlayRepositionTimer = null;
  function scheduleOverlayReposition() {
    if (!state.overlayMode) return;
    if (overlayRepositionTimer) return;
    overlayRepositionTimer = setTimeout(() => {
      overlayRepositionTimer = null;
      renderOverlay();
    }, 150);
  }
  window.addEventListener('scroll', scheduleOverlayReposition, { passive: true });
  window.addEventListener('resize', scheduleOverlayReposition);

  /* ============================================================
     SECTION 12 — Hidden-iframe multi-page crawler (TM only)
     ============================================================ */
  function collectCrawlUrls() {
    const urls = [];
    const seen = new Set([location.origin + location.pathname]);
    let skipped = 0;
    try {
      const links = Array.from(document.querySelectorAll('a[href]'));
      for (const a of links) {
        if (urls.length >= state.settings.crawlMaxPages) break;
        let u;
        try { u = new URL(a.getAttribute('href'), location.href); }
        catch (_) { skipped++; continue; }
        if (u.origin !== location.origin) { skipped++; continue; }
        if (['mailto:', 'tel:', 'javascript:'].includes(u.protocol)) { skipped++; continue; }
        u.search = ''; u.hash = '';
        const key = u.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        urls.push(key);
      }
    } catch (_) {}
    return { urls, skipped };
  }
  function loadFrame(frame, url, timeoutMs) {
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeoutMs);
      frame.onload = () => {
        if (done) return;
        done = true; clearTimeout(timer); resolve(true);
      };
      try { frame.src = url; } catch (_) { clearTimeout(timer); resolve(false); }
    });
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function waitWhilePaused() {
    while (state.crawl.paused && !state.crawl.stopped) await sleep(300);
  }
  function renderCrawl() {
    const box = panel ? panel.querySelector('#udd-crawl-box') : null;
    const prog = panel ? panel.querySelector('#udd-crawl-progress') : null;
    if (prog) {
      const total = state.crawl.queue.length || 0;
      prog.textContent = state.crawl.running
        ? 'Crawling ' + state.crawl.done + ' / ' + total + ' pages… (skipped cross-origin/other: ' + state.crawl.skipped + ')'
        : (state.crawl.results.length
          ? 'Crawl finished: ' + state.crawl.results.length + ' pages, ' + state.crawl.skipped + ' skipped.'
          : 'Crawl idle. Same-origin links only, max ' + state.settings.crawlMaxPages + ' pages.');
    }
    if (!box) return;
    if (!state.crawl.results.length) {
      box.innerHTML = '<div class="muted">No crawl results yet.</div>';
      return;
    }
    const totalIssues = state.crawl.results.reduce((s, r) => s + r.issues, 0);
    box.innerHTML = '<div class="muted">Total issues across crawled pages: ' + totalIssues + '</div>' +
      state.crawl.results.map(r =>
        '<div class="issue"><b>Score ' + r.score + ' (' + r.grade + ')</b> — ' +
        r.issues + ' issues, ' + r.controls + ' controls<br><span class="muted">' +
        escHtml(r.url) + '</span></div>').join('');
  }
  async function startCrawl() {
    if (state.crawl.running) { setStatus('Crawl already running.'); return; }
    const found = collectCrawlUrls();
    if (!found.urls.length) {
      setStatus('Crawl found no other same-origin pages to visit (' + found.skipped + ' skipped).');
      return;
    }
    state.crawl = {
      running: true, paused: false, stopped: false,
      queue: found.urls, index: 0, results: [], skipped: found.skipped, done: 0
    };
    renderCrawl();
    setStatus('Crawl started: ' + found.urls.length + ' pages.');
    let frame = document.getElementById(CRAWL_FRAME_ID);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = CRAWL_FRAME_ID;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.style.cssText = 'position:absolute!important;left:-9999px!important;top:0!important;width:1024px!important;height:768px!important;visibility:hidden!important;';
      document.documentElement.appendChild(frame);
    }
    for (let i = 0; i < state.crawl.queue.length; i++) {
      if (state.crawl.stopped) break;
      await waitWhilePaused();
      if (state.crawl.stopped) break;
      state.crawl.index = i;
      const url = state.crawl.queue[i];
      const loaded = await loadFrame(frame, url, 15000);
      if (!loaded) {
        state.crawl.results.push({ url, score: null, grade: '-', issues: 0, controls: 0, error: 'load timeout (15s)' });
        state.crawl.done++;
        renderCrawl();
        continue;
      }
      await sleep(600); // let the framed page settle before scanning
      try {
        const doc = frame.contentDocument;
        if (!doc) throw new Error('no contentDocument (cross-origin?)');
        const r = analyzeDocument(doc, url);
        state.crawl.results.push({
          url, score: r.score, grade: r.grade, issues: r.issues.length,
          controls: r.controls.length, critical: r.issues.filter(x => x.severity === 'critical').length
        });
      } catch (e) {
        state.crawl.results.push({ url, score: null, grade: '-', issues: 0, controls: 0, error: String(e.message).slice(0, 120) });
      }
      state.crawl.done++;
      renderCrawl();
    }
    state.crawl.running = false;
    state.crawl.paused = false;
    try { if (frame) frame.src = 'about:blank'; } catch (_) {}
    renderCrawl();
    setStatus('Crawl done: ' + state.crawl.results.length + ' pages scanned, ' +
      state.crawl.skipped + ' links skipped. Results are in the JSON report too.');
    if (state.report) scanUI(); // refresh report so crawl results are included
  }

  /* ============================================================
     SECTION 13 — Copy / download / HTML report
     ============================================================ */
  async function copyReport() {
    if (!state.reportText) { setStatus('Run SCAN UI first.'); return; }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(state.reportText);
      } else {
        if (outputEl) { outputEl.focus(); outputEl.select(); }
        if (!document.execCommand('copy')) throw new Error('Copy permission unavailable.');
      }
      setStatus('Complete JSON report copied.');
      if (copyButton) {
        copyButton.textContent = 'COPIED';
        setTimeout(() => { copyButton.textContent = 'COPY REPORT'; }, 1500);
      }
    } catch (error) {
      if (outputEl) { outputEl.focus(); outputEl.select(); }
      setStatus(error.message + ' Select text manually.');
    }
  }
  function downloadJSON() {
    if (!state.reportText) { setStatus('Run SCAN UI first.'); return; }
    downloadFile('udd-report-' + fileSlug() + '.json', state.reportText, 'application/json;charset=utf-8');
    setStatus('JSON report downloaded.');
  }
  function buildHTMLReport() {
    if (!state.report) return '';
    const r = state.report;
    const rows = r.issues.map(i =>
      '<tr data-sev="' + escHtml(i.severity) + '"><td>' + escHtml(i.severity) + '</td>' +
      '<td>' + escHtml(i.rule) + '</td><td>' + escHtml(i.message) + '</td>' +
      '<td>' + escHtml(i.fix || '') + '</td><td><code>' + escHtml(i.selector) + '</code></td></tr>'
    ).join('');
    const perf = r.performance || {};
    const diff = r.baselineDiff;
    return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<title>UDD Report — ' + escHtml(r.page.url) + '</title>' +
      '<style>body{font-family:Arial,sans-serif;margin:24px;color:#111}' +
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left;font-size:13px}' +
      'th{background:#eee}.crit{color:#b00020}.warn{color:#8a6d00}' +
      'code{font-size:12px}button{margin:4px;padding:6px 10px}</style></head><body>' +
      '<h1>Universal DOM Diagnostic — Report</h1>' +
      '<p><b>Page:</b> ' + escHtml(r.page.url) + ' &nbsp; <b>Captured:</b> ' + escHtml(r.capturedAt) + '</p>' +
      '<p><b>Score:</b> ' + r.summary.score + '/100 (' + escHtml(r.summary.grade) + ') &nbsp; ' +
      '<b>Gate:</b> ' + escHtml(r.summary.gate) + ' &nbsp; ' +
      '<b>Issues:</b> ' + r.summary.issues + ' (' + r.summary.critical + ' critical, ' +
      r.summary.warning + ' warning, ' + r.summary.info + ' info) &nbsp; ' +
      '<b>Controls:</b> ' + r.summary.visibleInteractiveControls + '</p>' +
      (diff ? '<p><b>Baseline diff:</b> +' + diff.addedCount + ' new, -' + diff.fixedCount +
        ' fixed, ' + diff.unchangedCount + ' unchanged, score delta ' +
        (diff.scoreDelta === null ? 'n/a' : diff.scoreDelta) + '</p>' : '<p>No baseline diff.</p>') +
      '<h2>Performance (measured in-browser)</h2>' +
      '<p>LCP: ' + (perf.lcpMs === null || perf.lcpMs === undefined ? 'not measured' : perf.lcpMs + ' ms (' + perf.lcpVerdict + ')') +
      ' &nbsp; CLS: ' + perf.cls + ' (' + perf.clsVerdict + ')' +
      ' &nbsp; INP: ' + (perf.inpMs === null || perf.inpMs === undefined ? 'not measured' : perf.inpMs + ' ms (' + perf.inpVerdict + ')') +
      ' &nbsp; FCP: ' + (perf.fcpMs === null || perf.fcpMs === undefined ? 'not measured' : perf.fcpMs + ' ms') +
      ' &nbsp; TTFB: ' + (perf.ttfbMs === null || perf.ttfbMs === undefined ? 'not measured' : perf.ttfbMs + ' ms') + '</p>' +
      '<h2>Issues</h2>' +
      '<div><button onclick="filterSev(\'all\')">All</button>' +
      '<button onclick="filterSev(\'critical\')">Critical</button>' +
      '<button onclick="filterSev(\'warning\')">Warning</button>' +
      '<button onclick="filterSev(\'info\')">Info</button></div>' +
      '<table><tr><th>Severity</th><th>Rule</th><th>Issue</th><th>Fix</th><th>Selector</th></tr>' +
      rows + '</table>' +
      '<p><small>Read-only report. No input values, passwords, cookies or network data were collected. ' +
      'Baseline (if any) was stored locally only.</small></p>' +
      '<script>function filterSev(s){var rs=document.querySelectorAll("tr[data-sev]");' +
      'for(var i=0;i<rs.length;i++){rs[i].style.display=(s==="all"||rs[i].getAttribute("data-sev")===s)?"":"none";}}<\/script>' +
      '</body></html>';
  }
  function downloadHTML() {
    if (!state.report) { setStatus('Run SCAN UI first.'); return; }
    downloadFile('udd-report-' + fileSlug() + '.html', buildHTMLReport(), 'text/html;charset=utf-8');
    setStatus('HTML report downloaded.');
  }

  /* ============================================================
     SECTION 14 — Panel (tabs, rules UI, settings UI, drag, keys)
     ============================================================ */
  function showTab(name) {
    if (!panel) return;
    const panes = panel.querySelectorAll('.udd-pane');
    panes.forEach(p => { p.style.display = p.getAttribute('data-pane') === name ? 'block' : 'none'; });
    const tabs = panel.querySelectorAll('[data-tab]');
    tabs.forEach(t => { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
  }
  function renderRulesList() {
    const list = panel ? panel.querySelector('#udd-rules-list') : null;
    if (!list) return;
    if (!state.customRules.length) {
      list.innerHTML = '<div class="muted">No custom rules yet. Paste a JSON rule array below.</div>';
      return;
    }
    list.innerHTML = state.customRules.map((r, idx) =>
      '<div class="issue"><b>' + escHtml(r.id) + '</b> ' +
      '<span class="muted">' + escHtml(r.severity || 'warning') + ' · ' +
      escHtml(typeof r.test === 'string' ? r.test : (r.test && r.test.predicate) || '') + '</span>' +
      '<br>' + escHtml(r.message) +
      '<br><code>' + escHtml(r.selector) + '</code> ' +
      '<button data-rule-toggle="' + idx + '" type="button">' + (r.enabled === false ? 'Enable' : 'Disable') + '</button> ' +
      '<button data-rule-del="' + idx + '" type="button">Delete</button></div>'
    ).join('');
    list.querySelectorAll('[data-rule-toggle]').forEach(b => {
      b.addEventListener('click', () => {
        const i = Number(b.getAttribute('data-rule-toggle'));
        state.customRules[i].enabled = state.customRules[i].enabled === false ? true : false;
        storeSet('customRules', state.customRules);
        renderRulesList();
        setStatus('Custom rule updated. Re-run SCAN to apply.');
      });
    });
    list.querySelectorAll('[data-rule-del]').forEach(b => {
      b.addEventListener('click', () => {
        const i = Number(b.getAttribute('data-rule-del'));
        state.customRules.splice(i, 1);
        storeSet('customRules', state.customRules);
        renderRulesList();
        setStatus('Custom rule deleted. Re-run SCAN to apply.');
      });
    });
  }
  function addCustomRulesFromTextarea() {
    const ta = panel ? panel.querySelector('#udd-rule-json') : null;
    if (!ta || !ta.value.trim()) { setStatus('Paste a JSON array of rules first.'); return; }
    let parsed;
    try { parsed = JSON.parse(ta.value); }
    catch (e) { setStatus('Invalid JSON: ' + e.message); return; }
    if (!Array.isArray(parsed)) { setStatus('Rules must be a JSON array.'); return; }
    const errors = [];
    let added = 0;
    for (const r of parsed) {
      const err = validateCustomRule(r);
      if (err) { errors.push((r && r.id ? r.id : '?') + ': ' + err); continue; }
      if (state.customRules.some(x => x.id === r.id)) { errors.push(r.id + ': id already exists.'); continue; }
      const rule = Object.assign({}, r);
      if (rule.enabled === undefined) rule.enabled = true;
      state.customRules.push(rule);
      added++;
    }
    storeSet('customRules', state.customRules);
    renderRulesList();
    setStatus(added ? 'Added ' + added + ' custom rule(s). Re-run SCAN to apply.' + (errors.length ? ' Errors: ' + errors.join(' | ') : '')
      : 'No rules added. ' + errors.join(' | '));
  }
  function applySettingsToUI() {
    if (!panel) return;
    const set = (id, val) => { const el = panel.querySelector(id); if (el) el.checked = !!val; };
    const setNum = (id, val) => { const el = panel.querySelector(id); if (el) el.value = String(val); };
    set('#udd-set-autoscan', state.settings.autoScan);
    set('#udd-set-optin', state.settings.optInSafeMetadata);
    setNum('#udd-set-hours', state.settings.rescanHours);
    setNum('#udd-set-minscore', state.settings.minScore);
    setNum('#udd-set-maxcrit', state.settings.maxCritical);
    setNum('#udd-set-crawlmax', state.settings.crawlMaxPages);
  }
  function readSettingsFromUI() {
    if (!panel) return;
    const get = id => panel.querySelector(id);
    if (get('#udd-set-autoscan')) state.settings.autoScan = get('#udd-set-autoscan').checked;
    if (get('#udd-set-optin')) state.settings.optInSafeMetadata = get('#udd-set-optin').checked;
    const num = (id, def, min, max) => {
      const el = get(id);
      if (!el) return def;
      const v = Number(el.value);
      return isNaN(v) ? def : Math.max(min, Math.min(max, v));
    };
    state.settings.rescanHours = num('#udd-set-hours', 24, 1, 720);
    state.settings.minScore = num('#udd-set-minscore', 80, 0, 100);
    state.settings.maxCritical = num('#udd-set-maxcrit', 0, 0, 1000);
    state.settings.crawlMaxPages = num('#udd-set-crawlmax', 10, 1, 50);
    saveSettings();
    setStatus('Settings saved (local only).');
  }

  function createPanel() {
    panel = document.createElement('section');
    panel.id = APP_ID;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Universal DOM Diagnostic');
    styleEl = document.createElement('style');
    styleEl.textContent = `
    #${APP_ID} { position:fixed; right:14px; bottom:14px; width:430px; max-width:calc(100vw - 28px); z-index:2147483647; color:#f4f6fa; background:#151a23; border:1px solid #566174; border-radius:12px; box-shadow:0 8px 30px #0009; font:12px/1.45 Arial,sans-serif; color-scheme:dark; }
    #${APP_ID} * { box-sizing:border-box; }
    #${APP_ID} .head { display:flex; align-items:center; justify-content:space-between; padding:11px 12px; background:#202938; border-radius:12px 12px 0 0; cursor:move; }
    #${APP_ID} .title { font-size:13px; font-weight:800; }
    #${APP_ID} .badge { background:#244d3a; color:#a8f0c4; border-radius:20px; padding:3px 7px; font-size:9px; font-weight:800; }
    #${APP_ID} .body { padding:11px; max-height:72vh; overflow:auto; }
    #${APP_ID} .note { padding:8px; margin-bottom:9px; background:#302d1e; color:#eaddb1; border:1px solid #4a4934; border-radius:7px; }
    #${APP_ID} .actions { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
    #${APP_ID} button { border:0; border-radius:6px; padding:8px 7px; cursor:pointer; color:white; font-weight:700; background:#36465e; }
    #${APP_ID} button.active { outline:2px solid #7be495; }
    #${APP_ID} .scan { background:#237a50; }
    #${APP_ID} .copy { background:#286ca6; }
    #${APP_ID} .save { background:#7a5a1e; }
    #${APP_ID} button:disabled { opacity:.4; cursor:not-allowed; }
    #${APP_ID} .status { margin:8px 0; padding:7px; border-radius:6px; background:#0c1119; color:#b7d8ff; overflow-wrap:anywhere; }
    #${APP_ID} .gate { margin:8px 0; padding:8px; border-radius:6px; font-weight:700; }
    #${APP_ID} .gate-pass { background:#123524; color:#7be495; }
    #${APP_ID} .gate-fail { background:#3d1420; color:#ff9a9a; }
    #${APP_ID} .diff { margin:8px 0; padding:8px; border-radius:6px; background:#0c1119; color:#dbe4f0; overflow-wrap:anywhere; }
    #${APP_ID} .diff-sum { margin-bottom:6px; }
    #${APP_ID} .diff-head { font-weight:800; margin:7px 0 3px; }
    #${APP_ID} .diff-item { padding:3px 0; border-top:1px solid #222b3a; }
    #${APP_ID} .diff-item code, #${APP_ID} code { color:#9ecbff; font-size:10px; }
    #${APP_ID} .good { color:#7be495; } #${APP_ID} .bad { color:#ff9a9a; }
    #${APP_ID} .muted { color:#9ca9ba; font-size:11px; }
    #${APP_ID} .tabs { display:flex; flex-wrap:wrap; gap:4px; margin:8px 0; }
    #${APP_ID} .tabs button { padding:5px 8px; font-size:11px; }
    #${APP_ID} .issue { padding:6px 0; border-top:1px solid #222b3a; overflow-wrap:anywhere; }
    #${APP_ID} .sev-critical { border-left:3px solid #ff6b6b; padding-left:6px; }
    #${APP_ID} .sev-warning { border-left:3px solid #e6c200; padding-left:6px; }
    #${APP_ID} .sev-info { border-left:3px solid #6ea8fe; padding-left:6px; }
    #${APP_ID} textarea { display:block; width:100%; height:150px; resize:vertical; padding:8px; border:1px solid #39475a; border-radius:7px; background:#090d13; color:#c8dfcf; font:10px/1.4 Consolas,monospace; }
    #${APP_ID} input[type="text"], #${APP_ID} input[type="number"], #${APP_ID} select { width:100%; padding:6px; margin:3px 0 8px; border:1px solid #39475a; border-radius:6px; background:#090d13; color:#f4f6fa; }
    #${APP_ID} label { display:block; margin-top:6px; }
    #${APP_ID} table.mini { width:100%; border-collapse:collapse; }
    #${APP_ID} table.mini td, #${APP_ID} table.mini th { border:1px solid #39475a; padding:5px; text-align:left; }
    #${APP_ID} .foot { margin-top:7px; color:#9ca9ba; font-size:10px; }
    #${APP_ID}.collapsed .body { display:none; }
    #${OVERLAY_ID} { position:absolute; left:0; top:0; width:0; height:0; z-index:2147483646; pointer-events:none; }
    #${OVERLAY_ID} .udd-marker { position:absolute; background:#ff6b6b; color:#fff; font:700 11px Arial,sans-serif; padding:2px 5px; border-radius:4px; pointer-events:auto; cursor:pointer; box-shadow:0 0 0 2px #fff3; }
    #${OVERLAY_ID} .udd-marker.m-tab { background:#286ca6; }
    #${OVERLAY_ID} .udd-marker.m-warn { background:#b8860b; }
    #${OVERLAY_ID} .udd-marker.m-head { background:#5b4a8a; }
    `;
    panel.innerHTML = `
    <div class="head" id="udd-head">
      <div class="title">DOM DIAGNOSTIC v2.0 — TM ONLY</div>
      <div style="display:flex;gap:7px;align-items:center">
        <span class="badge">READ ONLY</span>
        <button id="udd-collapse" type="button" style="padding:4px 8px" aria-label="Collapse panel">−</button>
        <button id="udd-close" type="button" style="padding:4px 8px" aria-label="Hide panel (Ctrl+Shift+D to reopen)">×</button>
      </div>
    </div>
    <div class="body">
      <div class="note">Read-only scanner. No input values, passwords, cookies, storage or network data are collected. Baseline, rules and settings stay in this browser only. Ctrl+Shift+D toggles this panel.</div>
      <div class="gate gate-pass" id="udd-gate">Gate: not scanned yet.</div>
      <div class="status" id="udd-status">Ready. Press SCAN UI.</div>
      <div class="diff" id="udd-diff">Baseline: checking…</div>
      <div class="tabs">
        <button data-tab="overview" type="button" class="active">Overview</button>
        <button data-tab="issues" type="button">Issues</button>
        <button data-tab="controls" type="button">Controls</button>
        <button data-tab="performance" type="button">Performance</button>
        <button data-tab="crawl" type="button">Crawl</button>
        <button data-tab="rules" type="button">Rules</button>
        <button data-tab="settings" type="button">Settings</button>
      </div>

      <div class="udd-pane" data-pane="overview">
        <div class="actions">
          <button class="scan" id="udd-scan" type="button">SCAN UI</button>
          <button class="save" id="udd-save" type="button" disabled>SAVE BASELINE</button>
          <button id="udd-clear" type="button">CLEAR BASELINE</button>
          <button id="udd-export-baseline" type="button">EXPORT BASELINE</button>
          <button id="udd-import-baseline-btn" type="button">IMPORT BASELINE</button>
          <button class="copy" id="udd-copy" type="button" disabled>COPY REPORT</button>
          <button id="udd-download" type="button" disabled>DOWNLOAD JSON</button>
          <button id="udd-download-html" type="button" disabled>DOWNLOAD HTML</button>
          <button id="udd-overlay-tab" data-overlay="tab" type="button">OVERLAY: TAB ORDER</button>
          <button id="udd-overlay-issues" data-overlay="issues" type="button">OVERLAY: ISSUES</button>
          <button id="udd-overlay-headings" data-overlay="headings" type="button">OVERLAY: HEADINGS</button>
          <button id="udd-rescan" type="button">RE-SCAN NOW</button>
        </div>
        <input type="file" id="udd-import-baseline" accept=".json,application/json" style="display:none">
        <textarea id="udd-output" readonly spellcheck="false" placeholder="Report will appear here..."></textarea>
        <div class="foot">Scans open Shadow DOM and same-origin iframes. Closed Shadow DOM and cross-origin iframe contents cannot be inspected — they are listed as iframe notes in the report.</div>
      </div>

      <div class="udd-pane" data-pane="issues" style="display:none">
        <label>Severity <select id="udd-issue-sev"><option value="all">All</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></label>
        <label>Search <input type="text" id="udd-issue-q" placeholder="rule, message or selector…"></label>
        <div id="udd-issues-list"><div class="muted">No scan yet. Run SCAN UI.</div></div>
      </div>

      <div class="udd-pane" data-pane="controls" style="display:none">
        <div id="udd-controls-list"><div class="muted">No scan yet. Run SCAN UI.</div></div>
      </div>

      <div class="udd-pane" data-pane="performance" style="display:none">
        <button id="udd-perf-refresh" type="button">REFRESH PERFORMANCE</button>
        <div id="udd-perf-box"><div class="muted">Performance is captured from page load. Run SCAN UI to refresh.</div></div>
      </div>

      <div class="udd-pane" data-pane="crawl" style="display:none">
        <div class="actions">
          <button class="scan" id="udd-crawl-start" type="button">START CRAWL</button>
          <button id="udd-crawl-pause" type="button">PAUSE / RESUME</button>
          <button id="udd-crawl-stop" type="button">STOP CRAWL</button>
        </div>
        <div class="status" id="udd-crawl-progress">Crawl idle.</div>
        <div id="udd-crawl-box"><div class="muted">No crawl results yet.</div></div>
      </div>

      <div class="udd-pane" data-pane="rules" style="display:none">
        <div class="muted">Custom rules use predefined predicates only — missingAttribute, hasAttribute, textEmpty, countGreaterThan. No eval or code. Example:<br><code>[{"id":"no-test-id","selector":"button","test":{"predicate":"missingAttribute","attribute":"data-testid"},"severity":"warning","message":"Button has no data-testid.","fix":"Add data-testid."}]</code></div>
        <label>Paste JSON rule array <textarea id="udd-rule-json" style="height:90px" placeholder='[{"id":"...","selector":"...","test":{"predicate":"missingAttribute","attribute":"..."},"severity":"warning","message":"...","fix":"..."}]'></textarea></label>
        <div class="actions">
          <button id="udd-rule-add" type="button">ADD RULES</button>
          <button id="udd-rule-export" type="button">EXPORT PACK</button>
          <button id="udd-rule-import" type="button">IMPORT PACK</button>
        </div>
        <input type="file" id="udd-rule-import-file" accept=".json,application/json" style="display:none">
        <div id="udd-rules-list"></div>
      </div>

      <div class="udd-pane" data-pane="settings" style="display:none">
        <label><input type="checkbox" id="udd-set-autoscan"> Auto-scan on page load / SPA navigation</label>
        <label>Re-scan interval (hours) <input type="number" id="udd-set-hours" min="1" max="720" value="24"></label>
        <label>Regression gate — min score <input type="number" id="udd-set-minscore" min="0" max="100" value="80"></label>
        <label>Regression gate — max critical issues <input type="number" id="udd-set-maxcrit" min="0" max="1000" value="0"></label>
        <label>Crawl max pages <input type="number" id="udd-set-crawlmax" min="1" max="50" value="10"></label>
        <label><input type="checkbox" id="udd-set-optin"> Opt-in safe metadata (OFF by default — only input type, maxlength presence, value-length bucket 0 / 1-10 / 11+, placeholder presence. Never the value.)</label>
        <div class="actions"><button id="udd-set-save" type="button">SAVE SETTINGS</button></div>
        <div class="muted">Settings, baselines and custom rules are stored with GM_setValue (fallback: localStorage) in this browser only. No network calls are made. This gate is in-browser only — it cannot block a pull request or deployment.</div>
      </div>
    </div>
    `;
    document.documentElement.appendChild(styleEl);
    document.documentElement.appendChild(panel);

    statusEl = panel.querySelector('#udd-status');
    outputEl = panel.querySelector('#udd-output');
    diffBoxEl = panel.querySelector('#udd-diff');
    gateBoxEl = panel.querySelector('#udd-gate');
    copyButton = panel.querySelector('#udd-copy');
    downloadButton = panel.querySelector('#udd-download');
    downloadHtmlButton = panel.querySelector('#udd-download-html');
    saveButton = panel.querySelector('#udd-save');

    panel.querySelectorAll('[data-tab]').forEach(b => {
      b.addEventListener('click', () => showTab(b.getAttribute('data-tab')));
    });
    panel.querySelector('#udd-scan').addEventListener('click', scanUI);
    panel.querySelector('#udd-rescan').addEventListener('click', scanUI);
    saveButton.addEventListener('click', saveBaseline);
    panel.querySelector('#udd-clear').addEventListener('click', clearBaseline);
    panel.querySelector('#udd-export-baseline').addEventListener('click', exportBaseline);
    panel.querySelector('#udd-import-baseline-btn').addEventListener('click', () => {
      panel.querySelector('#udd-import-baseline').click();
    });
    panel.querySelector('#udd-import-baseline').addEventListener('change', ev => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importBaselineFromText(String(reader.result || ''));
      reader.readAsText(f);
      ev.target.value = '';
    });
    copyButton.addEventListener('click', copyReport);
    downloadButton.addEventListener('click', downloadJSON);
    downloadHtmlButton.addEventListener('click', downloadHTML);
    panel.querySelectorAll('[data-overlay]').forEach(b => {
      b.addEventListener('click', () => setOverlayMode(b.getAttribute('data-overlay')));
    });
    panel.querySelector('#udd-issue-sev').addEventListener('change', renderIssuesList);
    panel.querySelector('#udd-issue-q').addEventListener('input', renderIssuesList);
    panel.querySelector('#udd-perf-refresh').addEventListener('click', renderPerfTab);
    panel.querySelector('#udd-crawl-start').addEventListener('click', startCrawl);
    panel.querySelector('#udd-crawl-pause').addEventListener('click', () => {
      if (!state.crawl.running) return;
      state.crawl.paused = !state.crawl.paused;
      renderCrawl();
      setStatus(state.crawl.paused ? 'Crawl paused.' : 'Crawl resumed.');
    });
    panel.querySelector('#udd-crawl-stop').addEventListener('click', () => {
      state.crawl.stopped = true;
      state.crawl.paused = false;
      setStatus('Crawl stop requested.');
    });
    panel.querySelector('#udd-rule-add').addEventListener('click', addCustomRulesFromTextarea);
    panel.querySelector('#udd-rule-export').addEventListener('click', () => {
      downloadFile('udd-custom-rules.json', JSON.stringify(state.customRules, null, 2), 'application/json');
      setStatus('Custom rules pack downloaded.');
    });
    panel.querySelector('#udd-rule-import').addEventListener('click', () => {
      panel.querySelector('#udd-rule-import-file').click();
    });
    panel.querySelector('#udd-rule-import-file').addEventListener('change', ev => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result || ''));
          if (!Array.isArray(parsed)) throw new Error('Pack must be a JSON array.');
          const ta = panel.querySelector('#udd-rule-json');
          ta.value = JSON.stringify(parsed, null, 2);
          addCustomRulesFromTextarea();
        } catch (e) { setStatus('Rule pack import failed: ' + e.message); }
      };
      reader.readAsText(f);
      ev.target.value = '';
    });
    panel.querySelector('#udd-set-save').addEventListener('click', () => {
      readSettingsFromUI();
      applySettingsToUI();
    });
    panel.querySelector('#udd-collapse').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      panel.querySelector('#udd-collapse').textContent =
        panel.classList.contains('collapsed') ? '+' : '−';
    });
    panel.querySelector('#udd-close').addEventListener('click', () => {
      panel.style.display = 'none';
      clearOverlay();
      state.overlayMode = null;
    });

    // Draggable header
    const head = panel.querySelector('#udd-head');
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    head.addEventListener('mousedown', ev => {
      if (ev.target && ev.target.tagName === 'BUTTON') return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      startX = ev.clientX; startY = ev.clientY;
      startLeft = r.left; startTop = r.top;
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.left = startLeft + 'px'; panel.style.top = startTop + 'px';
      ev.preventDefault();
    });
    document.addEventListener('mousemove', ev => {
      if (!dragging) return;
      panel.style.left = Math.max(0, startLeft + ev.clientX - startX) + 'px';
      panel.style.top = Math.max(0, startTop + ev.clientY - startY) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    document.addEventListener('keydown', ev => {
      if (ev.ctrlKey && ev.shiftKey && (ev.key === 'D' || ev.key === 'd')) {
        ev.preventDefault();
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
        if (panel.style.display === 'none') { clearOverlay(); state.overlayMode = null; }
      }
    });

    renderDiff(null);
    renderRulesList();
    applySettingsToUI();
    renderCrawl();
  }

  /* ============================================================
     SECTION 15 — Auto-scan + SPA re-scan, menu commands, init
     ============================================================ */
  function maybeAutoScan() {
    if (!state.settings.autoScan) {
      setStatus('Ready. Auto-scan is off — press SCAN UI.');
      return;
    }
    let last = null;
    try { last = storeGet('lastScan:' + location.origin + location.pathname, null); } catch (_) {}
    const intervalMs = (Number(state.settings.rescanHours) || 24) * 3600 * 1000;
    if (last && Date.now() - Number(last) < intervalMs) {
      setStatus('Ready. Last scan was recent (within ' + state.settings.rescanHours + 'h) — press SCAN UI to re-scan.');
      return;
    }
    scanUI();
  }
  function scheduleInitialScan() {
    const run = () => setTimeout(maybeAutoScan, 800);
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run);
  }
  let spaTimer = null;
  function scheduleSpaRescan() {
    if (!state.settings.autoScan || state.scanning) return;
    if (spaTimer) clearTimeout(spaTimer);
    spaTimer = setTimeout(() => { spaTimer = null; scanUI(); }, 1200);
  }
  function setupSpaWatch() {
    try {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function () {
        const r = origPush.apply(this, arguments);
        scheduleSpaRescan();
        return r;
      };
      history.replaceState = function () {
        const r = origReplace.apply(this, arguments);
        scheduleSpaRescan();
        return r;
      };
      window.addEventListener('popstate', scheduleSpaRescan);
    } catch (_) {}
    const startObserver = () => {
      try {
        if (!document.body) return;
        const obs = new MutationObserver(() => scheduleSpaRescan());
        obs.observe(document.body, { childList: true, subtree: true });
      } catch (_) {}
    };
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver);
  }
  function registerMenuCommands() {
    try {
      if (!gmHas('GM_registerMenuCommand')) return;
      GM_registerMenuCommand('UDD: Scan now', () => {
        if (panel) panel.style.display = '';
        scanUI();
      });
      GM_registerMenuCommand('UDD: Toggle panel', () => {
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
      });
      GM_registerMenuCommand('UDD: Start crawl', () => {
        if (panel) { panel.style.display = ''; showTab('crawl'); }
        startCrawl();
      });
    } catch (_) {}
  }

  // Init — panel must exist before any scan renders into it.
  createPanel();
  registerMenuCommands();
  setupSpaWatch();
  scheduleInitialScan();
  console.log('[Universal DOM Diagnostic] v2.0 TM Only initialized. No network calls. Baseline/settings local only.');
})();

