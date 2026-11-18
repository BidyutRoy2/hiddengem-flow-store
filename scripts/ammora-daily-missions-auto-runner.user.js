// ==UserScript==
// @name        Ammora Daily Missions Auto Runner
// @namespace   hiddengem-flow-store
// @version     1.0.6
// @description Runs the Ammora waitlist daily missions in order: Check in, GIWA ETH Vault transfer (0.001 ETH), 7 swaps (buy/sell x3 buy/sell buy), then stake 1 $tAMM, and returns to the Missions page. Wallet popups must be confirmed by you — the script never clicks inside your wallet.
// @author      HiddenGem
// @match       https://ammora.org/waitlist*
// @grant       none
// ==/UserScript==

/*
  Ammora Daily Missions Auto Runner v1.0.0
  -----------------------------------------
  What it does (in order, with your waits):
    1. Mission page: wait 10s, click "Check in"
    2. Wait 10s, click "Transfer" (GIWA ETH Vault), then the modal
       "Transfer 0.001 ETH" button
    3. Wait 15s, open the Swap page, Buy tab, click quick amount 0.001,
       wait 5s, click "Buy tAMM" on the panel, then click "Buy tAMM"
       again in the "Review buy" modal (that second click sends it)
    4. Wait 15s, Sell tab, enter amount 1, wait 5s, click "Sell tAMM"
       on the panel, then click "Sell tAMM" in the "Review sell" modal
    5-9. Same buy/sell cycle (Sell, Buy, Sell, Buy), each with its review modal
    10. Wait 15s, open the Staking page, enter amount 1, wait 5s,
       click "Deposit", then the confirm modal "Deposit" button
    11. Wait 15s, go back to the Missions page, stop

  v1.0.2 fix: the swap panel button does NOT send the transaction —
  it opens a "Review buy" / "Review sell" modal (section.s2-modal)
  with a second Buy/Sell tAMM button, and THAT button sends it.
  v1.0.1 waited for the modal to close and timed out after 3 minutes
  without ever clicking the review button. v1.0.2 clicks the review
  button, and if the modal is already open (previous run stopped
  there) it confirms it directly. Grounded in UDD reports __4/__5
  (2026-11-18 18:37 UTC): modal section.s2-modal "Review buy" /
  "Review sell", buttons Buy/Sell tAMM + Cancel, all enabled.

  v1.0.3 fix (crash): when a step returned 'skipped', the next .then
  in the same step received the STRING 'skipped' as if it were the
  button and called click() on it — "el.scrollIntoView is not a
  function". Fixed in stepVault + stepStake, and click() now refuses
  non-elements with a clear error. New: the run first reads the Daily
  section on the Missions page (Completed badges + the swaps n/5
  counter) and skips every task already done — swaps already done are
  skipped in order, only the remaining ones run. If everything is
  done, it stops right away with nothing to do.

  v1.0.4 fix: the review modal button STILL was not clicked in some
  runs. Two hardenings: (1) findModalButton used to search only the
  FIRST section.s2-modal — if another (hidden) modal came first in
  the DOM, the review button was never found. It now searches EVERY
  modal, plus a fallback that takes the primary (non-Cancel) button
  of any "Review buy/sell" modal. (2) If the panel click does not
  open the modal in 10s, the panel button is clicked once more.
  New: if a confirm modal is already open when the script starts, it
  is confirmed FIRST, before the mission read. The panel title now
  shows the version (v1.0.4) so a screenshot proves which build ran.
  No-delay rule: the 15s gap between steps now applies ONLY after a
  step that actually ran — after skipped steps (or at the start) the
  next pending task starts right away. The mission read waits at
  most 15s. Pending tasks still keep their own delays.

  v1.0.5 fix: on the Staking page the script said "Amount 1 entered"
  but the field still showed 0 — the value never stuck. The page
  replaces the input while its data loads ("Checking…"), so a value
  set on the old element is silently dropped. New helper
  setAmountAndVerify: sets the amount, checks the live field really
  holds it (and is still in the page), retries on a freshly found
  input up to 5 times, and fails fast with the true cause instead of
  waiting 60s for a Deposit button that can never enable. The stake
  step also re-checks the amount after the 5s wait and re-enters it
  if the page cleared it. Same verification added to the swap Sell
  amount entry. Grounded in UDD reports __2/__3: the staking page
  has exactly ONE input (aria-label "Staking amount", type number,
  placeholder '0'), so a wrong-field find cannot explain it — the
  value was dropped by a re-render.

  v1.0.6 change (owner's word): swaps 5 → 7. The cycle is now
  Buy, Sell, Buy, Sell, Buy, Sell, Buy (4 buys + 3 sells), 11 steps
  in total. The mission counter on the page is still out of 5, so
  after 5 swaps it reads 5/5 and the last 2 swaps still run.

  Wallet rule (cannot be automated): every Transfer / Buy / Sell /
  Deposit opens your wallet popup. YOU confirm (or reject) there.
  The script shows a gold "Waiting for your Confirm in the wallet"
  state and waits up to 3 minutes for the page to settle. If you
  reject, or the wait times out, the script stops with a clear status
  and saves its step — run it again to resume from that step.

  Already-done steps are skipped, not failed: Check in and the Vault
  transfer are once-a-day, so if their button is already gone the
  script moves on. Swaps and staking stop with a clear message if
  their button never becomes clickable (for example low balance).

  Balances needed for the full run: 0.004 test ETH (0.001 vault +
  3 x 0.001 buys) and at least 1 $tAMM (2 sells + 1 stake).

  Selectors are grounded in the Universal DOM Diagnostic reports of
  2026-11-18 (ammora.org/waitlist): nav links, mission buttons
  "Check in" / "Transfer" / "Open Swap" / "Open Staking", swap
  Buy/Sell tabs, quick amount "0.001", the swap and staking amount
  inputs, confirm modal section.s2-modal with "Deposit" / "Cancel".

  v1.0.1 fix: the UDD report's selector strings (button[name="0.001"],
  input[name="Amount to pay"], a[name="Swap"] …) are SYNTHESIZED from
  the accessible name — the live elements have NO name attribute
  (the report itself shows name: ""). v1.0.0 trusted those strings,
  so the quick-amount lookup always returned null and the run stopped
  at Swap 1/5. v1.0.1 finds everything by visible text / aria-label /
  class instead. Only class-based selectors (button.s2-btn,
  section.s2-modal) were ever real.
*/

(function () {
  'use strict';

  // ---------- settings (edit here if the site changes its timings) ----------
  var WAIT_CHECKIN_MS = 10000;   // page open -> Check in
  var WAIT_VAULT_MS = 10000;     // Check in -> Vault transfer
  var WAIT_NEXT_MS = 15000;      // between the swap / staking steps
  var WAIT_CONFIRM_MS = 5000;    // amount set -> action button click
  var STEP_WAIT_MS = 30000;      // max wait for a button/input to appear
  var WALLET_WAIT_MS = 180000;   // max wait for a wallet confirmation
  var STATE_KEY = 'ammora_state'; // { step, updatedAt }
  var STATE_TTL_MS = 30 * 60 * 1000; // resume window after a reload
  var STOP_KEY = 'ammora_stop';
  var VERSION = '1.0.6'; // shown in the panel title — a screenshot proves which build ran

  // ---------- small helpers ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  // Find a visible button whose text matches (exact or starts-with).
  function findButton(text, startsWith) {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var t = norm(b.textContent);
      if (!isVisible(b)) continue;
      if (startsWith ? t.indexOf(text) === 0 : t === text) return b;
    }
    return null;
  }

  // Find a visible button inside ANY confirm modal (section.s2-modal).
  // The site can keep more than one modal mounted — searching only
  // the first one missed the review modal when another modal came
  // first in the DOM.
  function findModalButton(text) {
    var modals = document.querySelectorAll('section.s2-modal');
    for (var m = 0; m < modals.length; m++) {
      var btns = modals[m].querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (isVisible(btns[i]) && norm(btns[i].textContent) === text) return btns[i];
      }
    }
    return null;
  }

  // The review modal's confirm button: exact label first, else the
  // primary (non-Cancel) button inside a "Review buy/sell" modal.
  // Covers a button label that differs slightly from the panel text.
  function confirmReviewModal(actionText) {
    var btn = findModalButton(actionText);
    if (btn) return btn;
    var modals = document.querySelectorAll('section.s2-modal');
    for (var m = 0; m < modals.length; m++) {
      var txt = modals[m].textContent || '';
      if (txt.indexOf('Review buy') === -1 && txt.indexOf('Review sell') === -1) continue;
      var btns = modals[m].querySelectorAll('button.s2-btn');
      for (var i = 0; i < btns.length; i++) {
        var t = norm(btns[i].textContent);
        if (t && t !== 'Cancel' && !btns[i].disabled && isVisible(btns[i])) return btns[i];
      }
    }
    return null;
  }

  // The panel action button: a visible button.s2-btn with this exact
  // text, outside any modal. (The Deposit tab is also a "Deposit"
  // button, so the class + outside-modal scope matters.)
  function findActionButton(text) {
    var btns = document.querySelectorAll('button.s2-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.closest('section.s2-modal')) continue;
      if (isVisible(b) && norm(b.textContent) === text) return b;
    }
    return null;
  }

  // Nav link by visible text. (The site's links have no name
  // attribute — a[name="Swap"] never matches anything.)
  function findNav(name) {
    var links = document.querySelectorAll('header nav a, header a, nav a');
    for (var i = 0; i < links.length; i++) {
      if (isVisible(links[i]) && norm(links[i].textContent) === name) return links[i];
    }
    var all = document.querySelectorAll('a');
    for (var j = 0; j < all.length; j++) {
      if (isVisible(all[j]) && norm(all[j].textContent) === name) return all[j];
    }
    return null;
  }

  function waitFor(fn, timeoutMs, label) {
    var start = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        var v = null;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(poll, 500);
      })();
    });
  }

  // Set a number input the way the site's own code expects: native
  // setter + input/change events so React picks the value up.
  function setInputValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Set an amount and VERIFY it stuck. The page can replace the input
  // while its data loads ("Checking…"), which silently drops a value
  // set on a detached element. Retries on a freshly found input.
  function setAmountAndVerify(findFn, value) {
    var tries = 0;
    function attempt() {
      var input = findFn();
      if (!input) return Promise.resolve(false);
      try { input.focus(); } catch (e) { /* ignore */ }
      setInputValue(input, value);
      return sleep(600).then(function () {
        if (input.isConnected && input.value !== '' && Number(input.value) === Number(value)) return true;
        var fresh = findFn();
        if (fresh && fresh.isConnected && fresh.value !== '' && Number(fresh.value) === Number(value)) return true;
        tries++;
        if (tries >= 5) return false;
        return attempt();
      });
    }
    return attempt();
  }

  // Defensive click: never call scrollIntoView on a non-element.
  // (A 'skipped'/'stopped' string once reached here and crashed the
  // run with "el.scrollIntoView is not a function".)
  function click(el) {
    if (!el || typeof el.click !== 'function') {
      throw new Error('click() got a non-element: ' + String(el));
    }
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    el.click();
  }

  // ---------- state (survives a page reload) ----------
  function loadState() {
    try {
      var s = GM_getValue(STATE_KEY, null);
      if (s && Date.now() - s.updatedAt < STATE_TTL_MS) return s;
    } catch (e) { /* storage unavailable: start fresh */ }
    return { step: 0, updatedAt: Date.now() };
  }
  function saveState(step) {
    try { GM_setValue(STATE_KEY, { step: step, updatedAt: Date.now() }); } catch (e) { /* ignore */ }
  }
  function clearState() {
    try { GM_setValue(STATE_KEY, { step: 0, updatedAt: 0 }); } catch (e) { /* ignore */ }
  }
  function stopRequested() {
    try { return !!GM_getValue(STOP_KEY, false); } catch (e) { return false; }
  }

  // ---------- status panel (bottom-right) ----------
  var panel, panelStep, panelNote;
  function buildPanel() {
    GM_addStyle(
      '#ammora-panel{position:fixed;right:14px;bottom:14px;z-index:99999;' +
      'width:300px;background:#0A0F0D;color:#E8FFF3;border:1px solid #223129;' +
      'border-radius:12px;padding:12px 14px;font:13px/1.5 system-ui,sans-serif;' +
      'box-shadow:0 8px 30px rgba(0,0,0,.5)}' +
      '#ammora-panel b{color:#00D084}' +
      '#ammora-panel .ammora-wait{color:#FFC24B;font-weight:700}' +
      '#ammora-panel .ammora-done{color:#00D084;font-weight:700}' +
      '#ammora-panel .ammora-fail{color:#FF7A7A;font-weight:700}' +
      '#ammora-panel button{margin-top:8px;background:#12181A;color:#E8FFF3;' +
      'border:1px solid #223129;border-radius:8px;padding:6px 12px;cursor:pointer}' +
      '#ammora-panel button:hover{border-color:#00D084}'
    );
    panel = document.createElement('div');
    panel.id = 'ammora-panel';
    var title = document.createElement('div');
    title.innerHTML = '<b>Ammora Daily Missions v' + VERSION + '</b>';
    panelStep = document.createElement('div');
    panelNote = document.createElement('div');
    var stopBtn = document.createElement('button');
    stopBtn.textContent = 'Stop script';
    stopBtn.addEventListener('click', function () {
      try { GM_setValue(STOP_KEY, true); } catch (e) { /* ignore */ }
      setStatus('Stopped by you. Run the script again to resume.', 'fail');
    });
    var resetBtn = document.createElement('button');
    resetBtn.textContent = 'Restart from step 1';
    resetBtn.style.marginLeft = '8px';
    resetBtn.addEventListener('click', function () {
      clearState();
      try { GM_setValue(STOP_KEY, false); } catch (e) { /* ignore */ }
      setStatus('Restarting from step 1…', '');
      setTimeout(function () { location.hash = '#mission'; location.reload(); }, 600);
    });
    panel.appendChild(title);
    panel.appendChild(panelStep);
    panel.appendChild(panelNote);
    panel.appendChild(stopBtn);
    panel.appendChild(resetBtn);
    document.body.appendChild(panel);
  }

  function setStatus(text, kind) {
    if (!panelStep) return;
    panelStep.textContent = text;
    panelStep.className = kind === 'wait' ? 'ammora-wait'
      : kind === 'done' ? 'ammora-done'
      : kind === 'fail' ? 'ammora-fail' : '';
  }
  function setNote(text) { if (panelNote) panelNote.textContent = text || ''; }

  function notify(text) {
    try { GM_notification({ text: text, title: 'Ammora Daily Missions', timeout: 8000 }); } catch (e) { /* ignore */ }
  }

  function fail(message) {
    setStatus(message, 'fail');
    setNote('Step saved — fix it and run the script again to resume.');
    notify(message);
    throw new Error(message);
  }

  // ---------- navigation (SPA: click the nav link, fall back to the hash) ----------
  function goTo(view) {
    // view: 'Mission' | 'Swap' | 'Staking'
    var link = findNav(view);
    if (link) { click(link); return true; }
    location.hash = '#' + view.toLowerCase();
    return true;
  }

  // Wait until the wallet popup is dealt with. The wallet popup itself
  // can never be clicked by a script — you confirm (or reject) it by
  // hand. settleFn() returns true when the page shows the transaction
  // is done (modal closed, button back to a stable label). A button
  // that goes disabled because its amount cleared still counts as
  // settled — only a loading label ("Buying…", "Checking…") means
  // the transaction is still pending.
  function waitForWalletSettled(settleFn) {
    setStatus('Waiting for your Confirm in the wallet…', 'wait');
    setNote('Confirm the transaction in your wallet popup. Rejecting stops the run.');
    var start = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        var settled = false;
        try { settled = !!settleFn(); } catch (e) { settled = false; }
        if (settled) return resolve(true);
        if (Date.now() - start > WALLET_WAIT_MS) return resolve(false);
        setTimeout(poll, 1000);
      })();
    });
  }

  function noModalOpen() {
    var modal = document.querySelector('section.s2-modal');
    return !(modal && isVisible(modal));
  }

  function notLoading(text) {
    var b = findButton(text);
    if (!b) return true; // button gone = the step moved on
    var t = norm(b.textContent);
    return t.indexOf('…') === -1;
  }

  // ---------- mission state (Daily section on the Missions page) ----------
  // Find the row container for a daily mission by its title text:
  // the deepest element whose whole text is the title, then the
  // closest ancestor that holds a button.
  function rowFor(title) {
    var els = document.querySelectorAll('body *');
    var best = null, bestDepth = -1;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (norm(el.textContent) !== title) continue;
      var depth = 0, n = el;
      while (n.parentElement) { depth++; n = n.parentElement; }
      if (depth > bestDepth) { bestDepth = depth; best = el; }
    }
    if (!best) return null;
    var node = best;
    for (var d = 0; d < 6 && node; d++) {
      if (node.querySelector && node.querySelector('button')) return node;
      node = node.parentElement;
    }
    return node;
  }

  // Read which daily tasks are already done today: the Completed
  // badges for Check in / Vault / Stake, and the swaps counter (n/5).
  function missionState() {
    var st = { checkIn: false, vault: false, swapsDone: 0, stake: false, readable: false };
    var r = rowFor('Check in');
    if (r) {
      st.readable = true;
      if (/Completed/.test(r.textContent)) st.checkIn = true;
    }
    r = rowFor('Use the GIWA ETH Vault');
    if (r) {
      st.readable = true;
      if (/Completed/.test(r.textContent)) st.vault = true;
    }
    r = rowFor('Complete swaps');
    if (r) {
      st.readable = true;
      var m = r.textContent.match(/(\d+)\s*\/\s*5/);
      if (m) st.swapsDone = Math.min(7, parseInt(m[1], 10));
    }
    r = rowFor('Stake $tAMM');
    if (r) {
      st.readable = true;
      if (/Completed/.test(r.textContent)) st.stake = true;
    }
    return st;
  }

  // ---------- the steps ----------
  var STEPS = [
    'Check in',
    'GIWA ETH Vault transfer (0.001 ETH)',
    'Swap 1/7 — Buy 0.001 ETH',
    'Swap 2/7 — Sell 1 $tAMM',
    'Swap 3/7 — Buy 0.001 ETH',
    'Swap 4/7 — Sell 1 $tAMM',
    'Swap 5/7 — Buy 0.001 ETH',
    'Swap 6/7 — Sell 1 $tAMM',
    'Swap 7/7 — Buy 0.001 ETH',
    'Stake 1 $tAMM',
    'Back to Missions — done'
  ];

  function totalSteps() { return STEPS.length; }

  // Step 1: Check in (once a day — skip if the button is already gone).
  function stepCheckIn() {
    setStatus('Step 1/11 — Check in…', '');
    setNote('Waiting 10 seconds after page open, then clicking Check in.');
    return sleep(WAIT_CHECKIN_MS).then(function () {
      if (stopRequested()) return 'stopped';
      return waitFor(function () { return findButton('Check in'); }, STEP_WAIT_MS, 'Check in');
    }).then(function (btn) {
      if (!btn) {
        setNote('Check in button not found — already checked in today, skipping.');
        return 'skipped';
      }
      if (btn.disabled) {
        setNote('Check in is already done, skipping.');
        return 'skipped';
      }
      click(btn);
      return waitForWalletSettled(function () {
        var b = findButton('Check in');
        return !b || b.disabled;
      }).then(function (ok) {
        if (!ok) fail('Check in did not settle in 3 minutes. Check the page, then run again.');
        return 'done';
      });
    });
  }

  // Step 2: Vault transfer (once a day — skip if the button is gone).
  function stepVault() {
    setStatus('Step 2/11 — GIWA ETH Vault transfer…', '');
    setNote('Waiting 10 seconds, then opening the vault transfer.');
    return sleep(WAIT_VAULT_MS).then(function () {
      if (stopRequested()) return 'stopped';
      return waitFor(function () { return findButton('Transfer'); }, STEP_WAIT_MS, 'Transfer');
    }).then(function (btn) {
      if (!btn || btn.disabled) {
        setNote('Transfer button not found — vault task already done today, skipping.');
        return 'skipped';
      }
      click(btn);
      // The modal button reads "Transfer 0.001 ETH".
      return waitFor(function () { return findModalButton('Transfer 0.001 ETH') || findButton('Transfer 0.001 ETH', true); }, STEP_WAIT_MS, 'Transfer modal');
    }).then(function (modalBtn) {
      // A 'skipped'/'stopped' result from the previous step is a status,
      // not a button — pass it through untouched, never click it.
      if (modalBtn === 'skipped' || modalBtn === 'stopped') return modalBtn;
      if (!modalBtn) {
        setNote('Vault modal did not open — skipping the vault step.');
        return 'skipped';
      }
      if (modalBtn.disabled) fail('Transfer button is disabled (low ETH balance?). Stopped.');
      click(modalBtn);
      return waitForWalletSettled(noModalOpen).then(function (ok) {
        if (!ok) fail('Vault transfer did not settle in 3 minutes. Check your wallet, then run again.');
        return 'done';
      });
    });
  }

  // Swap panel helpers.
  function swapAmountInput() {
    var byAria = document.querySelector('input[aria-label="Amount to pay"]');
    if (byAria && isVisible(byAria)) return byAria;
    var nums = document.querySelectorAll('input[type="number"]');
    for (var i = 0; i < nums.length; i++) {
      if (isVisible(nums[i])) return nums[i];
    }
    return null;
  }

  function stakingAmountInput() {
    var byAria = document.querySelector('input[aria-label="Staking amount"]');
    if (byAria && isVisible(byAria)) return byAria;
    var nums = document.querySelectorAll('input[type="number"]');
    for (var i = 0; i < nums.length; i++) {
      if (isVisible(nums[i])) return nums[i];
    }
    return null;
  }

  function stepSwap(kind, amountText) {
    // kind: 'buy' | 'sell'. amountText: '0.001' (buy quick button) or '1' (sell input).
    var label = kind === 'buy' ? 'Buy 0.001 ETH' : 'Sell 1 $tAMM';
    setStatus('Swap — ' + label + '…', '');
    setNote('Opening the Swap page.');
    goTo('Swap');
    return waitFor(function () { return findButton(kind === 'buy' ? 'Buy' : 'Sell'); }, STEP_WAIT_MS, 'Swap tab')
      .then(function (tab) {
        if (!tab) fail('Swap page did not load (Buy/Sell tab missing). Stopped.');
        click(tab);
        return sleep(1200);
      })
      .then(function () {
        if (stopRequested()) return 'stopped';
        if (kind === 'buy') {
          // Quick amount by visible text — the button has no name attribute.
          return waitFor(function () { return findButton('0.001'); }, STEP_WAIT_MS, '0.001 quick amount');
        }
        var input = swapAmountInput();
        if (!input) fail('Swap amount input not found. Stopped.');
        setNote('Entering amount ' + amountText + '…');
        return setAmountAndVerify(swapAmountInput, amountText).then(function (ok) {
          if (!ok) fail('Could not enter amount ' + amountText + ' in the swap field. Stopped.');
          return 'typed';
        });
      })
      .then(function (r) {
        if (r === 'stopped') return 'stopped';
        if (kind === 'buy') {
          if (!r) fail('Quick amount 0.001 not found. Stopped.');
          click(r);
        }
        setNote('Amount set. Waiting 5 seconds, then clicking ' + (kind === 'buy' ? 'Buy tAMM' : 'Sell tAMM') + '.');
        return sleep(WAIT_CONFIRM_MS);
      })
      .then(function (r) {
        if (r === 'stopped') return 'stopped';
        var actionText = kind === 'buy' ? 'Buy tAMM' : 'Sell tAMM';
        // If the review modal is already open (a previous run stopped
        // here), confirm it directly instead of clicking the panel.
        var alreadyOpen = confirmReviewModal(actionText);
        if (alreadyOpen) {
          if (alreadyOpen.disabled) fail('Review ' + actionText + ' button is disabled. Stopped.');
          setNote('Review modal is already open — confirming the ' + (kind === 'buy' ? 'buy' : 'sell') + '.');
          click(alreadyOpen);
          return 'confirmed';
        }
        return waitFor(function () {
          var b = findActionButton(actionText);
          return b && !b.disabled ? b : null;
        }, STEP_WAIT_MS, actionText).then(function (btn) {
          if (!btn) fail(actionText + ' never became clickable (low balance?). Stopped.');
          setNote('Panel ' + actionText + ' clicked — waiting for the review modal…');
          click(btn);
          // The panel button opens a "Review buy/sell" modal with a
          // second Buy/Sell tAMM button — that is the one that sends
          // the transaction. If no modal appears, the wallet opens
          // directly instead.
          return waitFor(function () { return confirmReviewModal(actionText); }, 10000, 'Review modal');
        }).then(function (modalBtn) {
          if (modalBtn) return modalBtn;
          // The first panel click did not open the modal — click it once more.
          setNote('Review modal did not appear — clicking the panel button again.');
          var again = findActionButton(actionText);
          if (again) click(again);
          return waitFor(function () { return confirmReviewModal(actionText); }, 20000, 'Review modal retry');
        }).then(function (modalBtn) {
          if (!modalBtn) fail('Review modal never appeared after clicking ' + actionText + '. Stopped.');
          if (modalBtn.disabled) fail('Review ' + actionText + ' button is disabled. Stopped.');
          setNote('Review modal open — confirming the ' + (kind === 'buy' ? 'buy' : 'sell') + '.');
          click(modalBtn);
          return 'confirmed';
        });
      })
      .then(function (r) {
        if (r === 'stopped') return 'stopped';
        var actionText = kind === 'buy' ? 'Buy tAMM' : 'Sell tAMM';
        return waitForWalletSettled(function () {
          return noModalOpen() && notLoading(actionText);
        }).then(function (ok) {
          if (!ok) fail('Swap did not settle in 3 minutes. Check your wallet, then run again.');
          return 'done';
        });
      });
  }

  // The Deposit button: first reads "Checking…" (disabled), then
  // "Deposit". Use the action-button finder: the Deposit tab has the
  // same text.
  function waitForDepositButton() {
    return waitFor(function () {
      var b = findActionButton('Deposit');
      return b && !b.disabled ? b : null;
    }, 60000, 'Deposit button');
  }

  // Step 8: stake 1 $tAMM.
  function stepStake() {
    setStatus('Step 10/11 — Stake 1 $tAMM…', '');
    setNote('Opening the Staking page.');
    goTo('Staking');
    return waitFor(function () { return stakingAmountInput(); }, STEP_WAIT_MS, 'Staking amount input').then(function (input) {
      if (!input) fail('Staking page did not load (amount input missing). Stopped.');
      if (stopRequested()) return 'stopped';
      setNote('Entering amount 1…');
      return setAmountAndVerify(stakingAmountInput, '1');
    }).then(function (ok) {
      if (ok === 'stopped') return 'stopped';
      if (!ok) fail('Could not enter amount 1 in the staking field (the page kept resetting it). Stopped.');
      setNote('Amount 1 entered. Waiting 5 seconds for the Deposit button.');
      return sleep(WAIT_CONFIRM_MS);
    }).then(function (r) {
      if (r === 'stopped') return 'stopped';
      // The page can clear the amount while its "Checking…" resolves —
      // confirm it is still 1 before waiting for the Deposit button.
      var live = stakingAmountInput();
      if (live && live.value !== '' && Number(live.value) === 1) return waitForDepositButton();
      setNote('The staking amount was cleared — entering 1 again.');
      return setAmountAndVerify(stakingAmountInput, '1').then(function (ok2) {
        if (!ok2) fail('Could not enter amount 1 in the staking field (the page kept resetting it). Stopped.');
        return waitForDepositButton();
      });
    }).then(function (btn) {
      if (btn === 'stopped') return 'stopped';
      if (!btn) {
        var live2 = stakingAmountInput();
        if (!live2 || live2.value === '' || Number(live2.value) !== 1) fail('The staking amount was cleared by the page, so Deposit never enabled. Stopped.');
        fail('Deposit button never became clickable (low $tAMM balance?). Stopped.');
      }
      click(btn);
      // Confirm modal: "Approve $tAMM, then confirm the deposit."
      return waitFor(function () { return findModalButton('Deposit'); }, STEP_WAIT_MS, 'Confirm deposit');
    }).then(function (modalBtn) {
      if (modalBtn === 'stopped') return 'stopped';
      if (!modalBtn) fail('Confirm deposit modal did not open. Stopped.');
      click(modalBtn);
      return waitForWalletSettled(function () {
        return noModalOpen() && notLoading('Deposit');
      }).then(function (ok) {
        if (!ok) fail('Deposit did not settle in 3 minutes. Check your wallet, then run again.');
        return 'done';
      });
    });
  }

  // ---------- runner ----------
  // Start: first read today's progress on the Missions page, then
  // run only the tasks that are still pending, step by step.
  function run() {
    buildPanel();
    var state = loadState();
    var step = state.step || 0;
    try { GM_setValue(STOP_KEY, false); } catch (e) { /* ignore */ }

    // If a confirm modal is already open (a previous run stopped with
    // the Review buy/sell, Vault transfer or Confirm deposit modal
    // open), confirm it right away instead of starting over.
    var openBtn = confirmReviewModal('Buy tAMM') || confirmReviewModal('Sell tAMM')
      || findModalButton('Transfer 0.001 ETH') || findModalButton('Deposit');
    if (openBtn && !openBtn.disabled) {
      setStatus('Ammora Daily Missions v' + VERSION + ' — a confirm modal is already open…', '');
      setNote('Confirming the open modal first, then reading today\'s progress.');
      click(openBtn);
      waitForWalletSettled(noModalOpen).then(function (ok) {
        if (!ok) {
          setStatus('The open modal did not close in 3 minutes. Check your wallet, then run again.', 'fail');
          return;
        }
        readMissionAndStart(step);
      });
      return;
    }
    readMissionAndStart(step);
  }

  // Read today's progress on the Missions page, then run only the
  // tasks that are still pending, step by step.
  function readMissionAndStart(step) {
    setStatus('Ammora Daily Missions v' + VERSION + ' — reading today\'s progress…', '');
    setNote('Opening the Missions page to see what is already done.');

    if (location.hash !== '#mission') goTo('Mission');
    waitFor(function () { return rowFor('Check in'); }, 15000, 'Daily missions').then(function () {
      var ms = missionState();
      var skip = {};
      if (ms.readable) {
        if (ms.checkIn) skip[0] = 'Check in already done today';
        if (ms.vault) skip[1] = 'Vault transfer already done today';
        for (var s = 0; s < ms.swapsDone; s++) skip[2 + s] = 'Swap ' + (s + 1) + '/7 already done today';
        if (ms.stake) skip[9] = 'Stake already done today';
        setNote(
          'Today: check in ' + (ms.checkIn ? 'done' : 'pending') +
          ', vault ' + (ms.vault ? 'done' : 'pending') +
          ', swaps ' + ms.swapsDone + '/5' +
          ', stake ' + (ms.stake ? 'done' : 'pending') + '.'
        );
      } else {
        setNote('Mission progress not readable — running all steps; each step still skips itself if already done.');
      }
      startChain(step, skip);
    });
  }

  function startChain(step, skip) {
    setStatus('Ammora Daily Missions v' + VERSION + ' — starting at step ' + (step + 1) + '/' + totalSteps() + '…', '');
    setNote('Wallet popups must be confirmed by you. The script waits for each one.');

    var chain = Promise.resolve();
    var actions = [
      stepCheckIn,
      stepVault,
      function (waitFirst) { setStatus('Step 3/11 — Swap 1/7…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () { return stepSwap('buy'); }); },
      function (waitFirst) { setStatus('Step 4/11 — Swap 2/7…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () { return stepSwap('sell', '1'); }); },
      function (waitFirst) { setStatus('Step 5/11 — Swap 3/7…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () { return stepSwap('buy'); }); },
      function (waitFirst) { setStatus('Step 6/11 — Swap 4/7…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () { return stepSwap('sell', '1'); }); },
      function (waitFirst) { setStatus('Step 7/11 — Swap 5/7…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () { return stepSwap('buy'); }); },
      function (waitFirst) { setStatus('Step 8/11 — Swap 6/7…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () { return stepSwap('sell', '1'); }); },
      function (waitFirst) { setStatus('Step 9/11 — Swap 7/7…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () { return stepSwap('buy'); }); },
      function (waitFirst) { setStatus('Step 10/11 — Stake…', ''); return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(stepStake); },
      function (waitFirst) {
        setStatus('Step 11/11 — Back to Missions…', '');
        return sleep(waitFirst ? WAIT_NEXT_MS : 0).then(function () {
          goTo('Mission');
          return 'done';
        });
      }
    ];

    var skippedCount = 0, ranCount = 0, prevRan = false;
    for (var i = step; i < actions.length; i++) {
      (function (idx) {
        chain = chain.then(function () {
          if (stopRequested()) return 'stopped';
          // Already done today: skip it at once and move to the next
          // task — no waiting for a task that is already done.
          if (skip[idx]) {
            setStatus('Skipping: ' + skip[idx] + '.', '');
            setNote(STEPS[idx] + ': skipped (already done)');
            skippedCount++;
            prevRan = false;
            return 'skipped';
          }
          saveState(idx);
          ranCount++;
          // The 15s gap applies only after a step that actually ran.
          // After skipped steps (or at the start) the next pending
          // task starts right away.
          var waitFirst = prevRan;
          return actions[idx](waitFirst);
        }).then(function (r) {
          if (r === 'stopped') throw new Error('__stopped__');
          if (r === 'skipped') { prevRan = false; return; }
          prevRan = true;
          setNote(STEPS[idx] + ': done');
        });
      })(i);
    }

    chain.then(function () {
      clearState();
      if (ranCount === 0) {
        setStatus('All daily missions already done today — nothing to do.', 'done');
        setNote('Script stopped.');
      } else {
        setStatus('All daily missions done — Check in, vault, 7 swaps, stake. Back on the Missions page.', 'done');
        setNote('Script stopped.');
        notify('Ammora daily missions complete: check in, vault transfer, 7 swaps, 1 stake.');
      }
    }).catch(function (e) {
      if (e && e.message === '__stopped__') {
        setStatus('Stopped. Run the script again to resume.', 'fail');
        return;
      }
      if (e && e.message) setStatus(e.message, 'fail');
    });
  }

  // Start once the page is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

