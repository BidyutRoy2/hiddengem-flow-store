// ==UserScript==
// @name        Firstprint Daily Streak Auto-Claim
// @namespace   hiddengem-flow-store
// @version     1.0.1
// @description Automatically claims the Firstprint daily streak reward when you open the Earn page. One claim per day (UTC). Clicks only the visible Claim button — it never signs wallet transactions for you.
// @author      HiddenGem
// @match       https://firstprint.fun/app/*
// @grant       none
// ==/UserScript==

/*
  Firstprint Daily Streak Auto-Claim — v1.0.1 (userscript manager)

  What it does
  - On the Earn page (https://firstprint.fun/app/#/earn) it finds the
    "Claim +50" button in the Daily Streak card and clicks it once.
  - One auto-claim per day (UTC, matching the site's own rule).
  - Shows a small status panel (bottom-right) so you always see what
    happened: claimed, already claimed, wallet not connected, or the
    button was not found.

  What it does NOT do
  - It never signs a wallet transaction. If claiming opens your wallet
    (Phantom etc.), approve it yourself — the script cannot and will
    not approve anything.
  - It does not touch the Follow on X / Join Telegram tasks. Those need
    your own social accounts and stay manual.
  - It does not bypass any captcha, check, or limit. If the site adds
    one, the script reports "Claim button not found" and stops.
  - It does not run on any other site or page.

  Install: userscript manager dashboard -> + New userscript -> paste this file
  -> Save. Then open the Earn page while your wallet is connected.
*/

(function () {
  'use strict';

  var VERSION = '1.0.1';
  var MAX_WAIT_MS = 30000;   // how long to wait for the Claim button to render
  var POLL_MS = 500;
  var CONFIRM_MS = 15000;    // how long to wait for proof the claim went through
  var attemptedThisLoad = false;

  function utcToday() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
  }

  function gmGet(key, fallback) {
    try {
      var v = GM_getValue(key, fallback);
      return (v === undefined || v === null) ? fallback : v;
    } catch (e) { return fallback; }
  }
  function gmSet(key, value) {
    try { GM_setValue(key, value); } catch (e) { /* storage unavailable */ }
  }
  function notify(title, text) {
    try { GM_notification({ title: title, text: text, timeout: 6000 }); } catch (e) { /* no notification API */ }
  }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  // The Claim button: <button class="btn btn-gold btn-sm">Claim +50</button>
  // in the Daily Streak card. Matched by text, not by a fragile layout path,
  // so a small redesign does not break it. Gold class preferred when several match.
  function findClaimButton() {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    var matches = btns.filter(function (b) {
      if (b.disabled || !isVisible(b)) return false;
      return /claim\s*\+\s*\d+/i.test(b.textContent || '');
    });
    if (!matches.length) return null;
    var gold = matches.filter(function (b) { return b.classList.contains('btn-gold'); });
    return gold.length ? gold[0] : matches[0];
  }

  function isOnEarnPage() {
    return (location.hash || '').indexOf('#/earn') === 0;
  }
  function isWalletConnected() {
    return !!document.querySelector('.wallet-chip, a.chip.wallet-chip');
  }
  function streakChipCanClaim() {
    var chip = document.querySelector('.streak-chip');
    return chip && chip.classList.contains('can-claim');
  }
  function pointsText() {
    var el = document.querySelector('.chip.points');
    return el ? (el.textContent || '').trim() : '';
  }

  // ---- status panel (bottom-right, dark, collapsible) ----
  var panel = null, statusEl = null, toggleBtn = null;
  function buildPanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'fpac-panel';
    panel.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:999999;' +
      'background:#0d1117;border:1px solid #2dd4a7;border-radius:12px;color:#e6edf3;' +
      'font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:10px 12px;' +
      'width:250px;box-shadow:0 8px 28px rgba(0,0,0,.5);';
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<b>Firstprint Auto-Claim</b><span style="color:#8b949e">v' + VERSION + '</span></div>' +
      '<div id="fpac-status" style="margin:6px 0;color:#c9d1d9;">Starting…</div>' +
      '<div style="display:flex;gap:6px;">' +
      '<button id="fpac-claim" style="flex:1;background:#2dd4a7;color:#06281e;border:0;' +
      'border-radius:8px;padding:6px 8px;font-weight:700;cursor:pointer;">Claim now</button>' +
      '<button id="fpac-toggle" style="background:#21262d;color:#e6edf3;border:1px solid #30363d;' +
      'border-radius:8px;padding:6px 8px;cursor:pointer;"></button></div>' +
      '<div style="margin-top:6px;font-size:11px;color:#8b949e;">Clicks only the Claim button. ' +
      'Wallet approvals stay manual.</div>';
    document.body.appendChild(panel);
    statusEl = panel.querySelector('#fpac-status');
    toggleBtn = panel.querySelector('#fpac-toggle');
    panel.querySelector('#fpac-claim').addEventListener('click', function () {
      setStatus('Manual claim — looking for the button…');
      attemptClaim(true);
    });
    toggleBtn.addEventListener('click', function () {
      var enabled = !isEnabled();
      gmSet('fpac_enabled', enabled);
      refreshToggle();
      setStatus(enabled ? 'Auto-claim enabled.' : 'Auto-claim off — use Claim now.');
    });
    refreshToggle();
  }
  function isEnabled() {
    return gmGet('fpac_enabled', true) !== false;
  }
  function refreshToggle() {
    if (toggleBtn) toggleBtn.textContent = isEnabled() ? 'Auto: ON' : 'Auto: OFF';
  }
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
    try { console.log('[FP Auto-Claim v' + VERSION + '] ' + text); } catch (e) { /* no console */ }
  }

  // ---- the claim attempt ----
  function attemptClaim(manual) {
    if (attemptedThisLoad && !manual) return;
    if (!isOnEarnPage()) {
      setStatus('Open the Earn page (#/earn) to claim.');
      return;
    }
    if (!isEnabled() && !manual) {
      setStatus('Auto-claim is off. Press Claim now.');
      return;
    }
    if (gmGet('fpac_claimed_utc', '') === utcToday()) {
      setStatus('Already claimed today (' + utcToday() + ').');
      return;
    }
    attemptedThisLoad = true;
    var pointsBefore = pointsText();
    var waited = 0;
    var timer = setInterval(function () {
      var btn = findClaimButton();
      if (btn) {
        clearInterval(timer);
        doClick(btn, pointsBefore);
        return;
      }
      waited += POLL_MS;
      if (waited >= MAX_WAIT_MS) {
        clearInterval(timer);
        diagnoseNoButton();
      }
    }, POLL_MS);
  }

  function doClick(btn, pointsBefore) {
    var label = (btn.textContent || '').trim();
    setStatus('Found "' + label + '" — clicking…');
    btn.click();
    // Confirm: the button disappears / disables, or the points balance moves.
    var waited = 0;
    var timer = setInterval(function () {
      var stillThere = findClaimButton();
      var pointsNow = pointsText();
      var pointsMoved = pointsBefore && pointsNow && pointsNow !== pointsBefore;
      if (!stillThere || pointsMoved) {
        clearInterval(timer);
        gmSet('fpac_claimed_utc', utcToday());
        var msg = 'Claimed ' + label + ' — ' + utcToday() + '.';
        setStatus(msg);
        notify('Firstprint daily claim', msg);
        return;
      }
      waited += POLL_MS;
      if (waited >= CONFIRM_MS) {
        clearInterval(timer);
        setStatus('Clicked, but no confirmation yet — a wallet approval ' +
          'window may be waiting. Check the page.');
        notify('Firstprint daily claim', 'Clicked the Claim button. ' +
          'If your wallet asks, approve it yourself.');
      }
    }, POLL_MS);
  }

  function diagnoseNoButton() {
    if (!isWalletConnected()) {
      setStatus('Wallet not connected — connect it, then reload.');
      return;
    }
    if (!streakChipCanClaim()) {
      setStatus('No claim available — already claimed today, or the streak reset.');
      return;
    }
    setStatus('Claim button not found — the page may have changed. ' +
      'Claim it by hand this time.');
  }

  // ---- start: run on load, and again when the SPA route changes ----
  function start() {
    buildPanel();
    if (!isOnEarnPage()) {
      setStatus('On ' + (location.hash || 'the home page') + ' — auto-claim runs on #/earn.');
      return;
    }
    setStatus('Watching for the Claim button…');
    attemptClaim(false);
  }

  var lastHash = location.hash;
  setInterval(function () {
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      attemptedThisLoad = false;
      start();
    }
  }, 1000);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();

