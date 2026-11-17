// ==UserScript==
// @name        Firstprint Daily Streak Auto-Claim
// @namespace   hiddengem-flow-store
// @version     1.0.2
// @description Automatically claims the Firstprint daily streak reward when you open the Earn page. One claim per day (UTC). Clicks only the visible Claim button — it never signs wallet transactions for you.
// @author      HiddenGem
// @match       https://firstprint.fun/app/*
// @grant       none
// ==/UserScript==

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   *  ROOT CAUSES — confirmed from the actual v1.0.1 source
   *
   *  BUG 1 (the smoking gun) — FALSE CONFIRMATION in doClick():
   *  v1 confirmed success when `!stillThere || pointsMoved`, polling
   *  every 500ms. But right after a click the site disables / re-renders
   *  the button while the claim is still PROCESSING (spinner, wallet
   *  approval pending). findClaimButton() filters out disabled buttons,
   *  so it returns null at the very first poll → v1 instantly "confirms",
   *  saves fpac_claimed_utc = today, and the panel then says
   *  "Already claimed today" for the rest of the day — while the real
   *  claim may have been rejected / never approved and the button comes
   *  back. That is exactly what your screenshot shows.
   *  (Points text moving is also not proof: balances animate and move
   *  for unrelated reasons.)
   *  FIX: success needs a HARD signal sustained on the site itself —
   *  "N days claimed" count increases, OR the header streak chip loses
   *  its .can-claim state, OR points rise while the button stays gone.
   *  A button that merely vanishes/disables during processing is NOT
   *  proof. We observe for the full verify window; if the button is
   *  still there at the end with no hard signal, the day is NOT marked
   *  and the claim is retried.
   *
   *  BUG 2 — @grant none, but the code uses GM_getValue / GM_setValue /
   *  GM_notification. With "@grant none" those APIs are not provided
   *  (strict managers): every gmGet silently falls back and every gmSet
   *  silently does nothing, so the claimed flag and the Auto toggle
   *  never persist. In managers that leak the APIs anyway, Bug 1's
   *  false flag DOES persist and poisons the whole day. Either way the
   *  storage layer is broken by design.
   *  FIX: this script declares @grant none and uses localStorage only —
   *  consistent, no GM APIs anywhere.
   *
   *  BUG 3 — NO SETTLING DELAY + ONE-SHOT ATTEMPT:
   *  v1 clicks the instant the button renders (attemptedThisLoad then
   *  blocks any second auto attempt for that page load), possibly before
   *  the wallet session has finished restoring, and gives up after a
   *  single 30s search window on a slow SPA (UDD: LCP 3.4s).
   *  FIX: wait 10s after page open (as requested), then search for up
   *  to 60s via MutationObserver + polling; check the wallet chip is
   *  present before clicking; failed attempts retry (max 3/day) plus a
   *  60s safety interval and a hashchange trigger.
   *
   *  KEPT FROM v1 (it was correct): UTC day via toISOString(), matching
   *  the button by its "Claim +N" text with .btn-gold preference, and
   *  never signing wallet transactions.
   *
   *  HOUSEKEEPING: v2 uses a NEW storage namespace (fpac2.*) and deletes
   *  old fpac_* keys once, so v1's poisoned flag cannot block it.
   *  You must still DISABLE/DELETE both v1.0.1 and any earlier v2 copy
   *  in your userscript manager — run exactly ONE version.
   * ------------------------------------------------------------------ */

  if (window.__fpac2Running) return;
  window.__fpac2Running = true;

  const CONFIG = {
    INITIAL_WAIT_MS: 10_000,   // your requirement: wait 10s after the site opens
    FIND_TIMEOUT_MS: 60_000,   // keep looking for the button this long (SPA render)
    WALLET_WAIT_MS: 10_000,    // wait for the wallet/session chip before clicking
    VERIFY_TIMEOUT_MS: 45_000, // observe the site this long for hard proof
    MAX_ATTEMPTS: 3,           // clicks per UTC day per tab (unconfirmed ones)
    RETRY_DELAY_MS: 30_000,
    EARN_HASH: '#/earn',
    PANEL_ID: 'fpac2-panel',
  };

  const LS = {
    claimedUTC: 'fpac2.claimedUTC', // ONLY set after verified success
    auto: 'fpac2.auto',             // '1' | '0'
    migrated: 'fpac2.migratedFromV1',
  };

  /* ---------------- helpers ---------------- */

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const utcToday = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC

  function msToNextUtcMidnight() {
    const n = new Date();
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime();
  }
  function fmtHMS(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = (x) => String(x).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }
  const cleanText = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  function isVisible(el) {
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  /* ---------------- one-time migration: drop v1's poisoned flags ----- */

  (function migrateFromV1() {
    try {
      if (localStorage.getItem(LS.migrated)) return;
      for (const store of [localStorage, sessionStorage]) {
        for (const k of Object.keys(store)) {
          // v1 stored fpac_claimed_utc / fpac_enabled (via GM in some
          // managers, localStorage in others). fpac2.* is NOT matched.
          if (/^fpac[_-]/.test(k)) store.removeItem(k);
        }
      }
      localStorage.setItem(LS.migrated, '1');
    } catch { /* storage unavailable — nothing to migrate */ }
  })();

  /* ---------------- finding the REAL claim button ------------------- */

  const CLAIM_TEXT_RE = /^Claim\s*\+\s*\d[\d,]*$/i; // anchored — exact "Claim +100"

  function findClaimButton() {
    const buttons = [...document.querySelectorAll('button')];
    let best = null;
    let bestScore = -1;

    for (const b of buttons) {
      if (b.closest(`#${CONFIG.PANEL_ID}`)) continue;      // never our own panel
      if (b.closest('header')) continue;                   // never the header chip
      if (b.classList.contains('streak-chip')) continue;   // popover toggle, not claim
      if (!CLAIM_TEXT_RE.test(cleanText(b))) continue;
      if (!isVisible(b)) continue;                         // visible + enabled only

      let score = 10;
      if (b.classList.contains('btn-gold')) score += 5;    // UDD: btn btn-gold btn-sm
      const card = b.closest('section, aside, div');
      const around = card ? cleanText(card) : '';
      if (/Daily streak/i.test(around)) score += 5;
      if (/One claim a day/i.test(around)) score += 5;

      if (score > bestScore) { best = b; bestScore = score; }
    }
    return best;
  }

  function findStreakChip() {
    return document.querySelector('button.streak-chip, button.chip.streak-chip');
  }

  function isWalletConnected() {
    // UDD: <a class="chip wallet-chip"> "Signed in as …"
    return !!document.querySelector('.wallet-chip, a.chip.wallet-chip');
  }

  function claimedDaysCount() {
    // UDD: <summary> "November 2026 2 days claimed"
    for (const el of document.querySelectorAll('summary, aside section *')) {
      const m = cleanText(el).match(/(\d+)\s+days?\s+claimed/i);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  }

  function pointsBalance() {
    const el = document.querySelector('a.chip.points, .chip.points');
    const m = el && cleanText(el).match(/([\d,]+)\s*pts/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function snapshot() {
    const chip = findStreakChip();
    return {
      chipCanClaim: chip ? chip.classList.contains('can-claim') : null,
      daysClaimed: claimedDaysCount(),
      points: pointsBalance(),
    };
  }

  function siteLooksClaimed() {
    // Signed in, chip present but no longer claimable, and no real
    // claim button anywhere → the site itself says "done for today".
    const chip = findStreakChip();
    return !!chip && !chip.classList.contains('can-claim') && !findClaimButton();
  }

  /* ---------------- waiting for the button (SPA-safe) --------------- */

  function waitForButton(timeoutMs) {
    return new Promise((resolve) => {
      const found = findClaimButton();
      if (found) return resolve(found);

      const started = Date.now();
      const obs = new MutationObserver(() => {
        const b = findClaimButton();
        if (b) { cleanup(); resolve(b); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });

      const iv = setInterval(() => {
        const b = findClaimButton();
        if (b) { cleanup(); resolve(b); }
        else if (Date.now() - started > timeoutMs) { cleanup(); resolve(null); }
      }, 500);

      function cleanup() { obs.disconnect(); clearInterval(iv); }
    });
  }

  async function waitForWallet(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (isWalletConnected()) return true;
      await wait(500);
    }
    return isWalletConnected();
  }

  /* ------------- verification: HARD signals only (Bug 1 fix) -------- *
   * Observes for the FULL window unless a hard signal lands first.
   * Deliberately NO fail-fast on "button came back": while a wallet
   * approval popup is open, the page button can sit there enabled —
   * that is "pending", not "failed". Only the end state decides.     */
  async function waitForVerification(before, timeoutMs) {
    const started = Date.now();
    let buttonGoneSince = null;

    while (Date.now() - started < timeoutMs) {
      const snap = snapshot();
      const btn = findClaimButton();

      // HARD signal 1: the claimed-days counter went up ("2 days claimed" → 3)
      if (before.daysClaimed != null && snap.daysClaimed != null && snap.daysClaimed > before.daysClaimed) return true;
      // HARD signal 2: the header streak chip stopped offering a claim
      if (before.chipCanClaim === true && snap.chipCanClaim === false) return true;
      // HARD signal 3: points actually arrived AND the button stayed gone
      if (before.points != null && snap.points != null && snap.points > before.points && !btn) return true;

      if (btn) buttonGoneSince = null;
      else if (buttonGoneSince == null) buttonGoneSince = Date.now();

      await wait(1000);
    }

    // End-of-window fallback: button gone continuously for the last
    // 10s+ and the chip no longer offers a claim → treat as claimed.
    // (A transient disable during processing can never reach this:
    // the button would have come back and reset buttonGoneSince,
    // and the chip would still be .can-claim.)
    const endBtn = findClaimButton();
    const chip = findStreakChip();
    if (!endBtn && buttonGoneSince != null && Date.now() - buttonGoneSince >= 10_000) {
      if (!chip || !chip.classList.contains('can-claim')) return true;
    }
    return false;
  }

  /* ---------------- panel UI ---------------------------------------- */

  const panel = document.createElement('div');
  panel.id = CONFIG.PANEL_ID;
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <strong style="font-size:13px">Firstprint Auto-Claim</strong>
      <span style="opacity:.6;font-size:11px">v2.0.1</span>
    </div>
    <div id="fpac2-status" style="font-size:12px;margin:6px 0;line-height:1.45">Starting…</div>
    <div id="fpac2-next" style="font-size:11px;opacity:.65;margin-bottom:8px"></div>
    <div style="display:flex;gap:6px">
      <button id="fpac2-claim" type="button" style="flex:1;background:#2fe6a8;color:#04241a;border:0;border-radius:8px;padding:8px;font-weight:700;cursor:pointer">Claim now</button>
      <button id="fpac2-toggle" type="button" style="background:#23262b;color:#e8e8e8;border:1px solid #3a3e45;border-radius:8px;padding:8px;cursor:pointer"></button>
    </div>
    <div style="font-size:10.5px;opacity:.55;margin-top:7px">Clicks only the real Claim button, then waits for the site to prove it. Wallet approvals stay manual.</div>`;
  Object.assign(panel.style, {
    position: 'fixed', right: '14px', bottom: '14px', zIndex: '2147483647',
    width: '262px', background: '#14161a', color: '#f2f2f2',
    border: '1px solid #2fe6a8', borderRadius: '12px', padding: '12px',
    fontFamily: 'system-ui, sans-serif', boxShadow: '0 8px 28px rgba(0,0,0,.5)',
  });
  document.documentElement.appendChild(panel);

  const statusEl = panel.querySelector('#fpac2-status');
  const nextEl = panel.querySelector('#fpac2-next');
  const toggleEl = panel.querySelector('#fpac2-toggle');
  const setStatus = (t) => { statusEl.textContent = t; try { console.log('[FPAC v2.0.1] ' + t); } catch { /* no console */ } };

  const autoEnabled = () => localStorage.getItem(LS.auto) !== '0';
  function paintToggle() { toggleEl.textContent = `Auto: ${autoEnabled() ? 'ON' : 'OFF'}`; }
  paintToggle();

  toggleEl.addEventListener('click', () => {
    localStorage.setItem(LS.auto, autoEnabled() ? '0' : '1');
    paintToggle();
    if (autoEnabled()) { resetAttemptsIfNewDay(); attemptClaim('toggle'); }
    else setStatus('Auto is OFF. Use “Claim now” or turn Auto on.');
  });
  panel.querySelector('#fpac2-claim').addEventListener('click', () => {
    resetAttemptsIfNewDay();
    attemptClaim('manual');
  });

  setInterval(() => {
    nextEl.textContent = `Next UTC reset in ${fmtHMS(msToNextUtcMidnight())} · Today (UTC): ${utcToday()}`;
  }, 1000);

  /* ---------------- the claim flow ----------------------------------- */

  const state = { running: false, attempts: 0, attemptsDay: utcToday() };
  function resetAttemptsIfNewDay() {
    if (state.attemptsDay !== utcToday()) { state.attemptsDay = utcToday(); state.attempts = 0; }
  }
  const alreadyMarkedToday = () => localStorage.getItem(LS.claimedUTC) === utcToday();
  function markClaimed() { localStorage.setItem(LS.claimedUTC, utcToday()); }

  function realClick(el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus?.();
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    el.click(); // single real click — do NOT also dispatch a synthetic 'click'
  }

  async function attemptClaim(reason) {
    if (state.running) return;
    resetAttemptsIfNewDay();

    if (reason !== 'manual') {
      if (!autoEnabled()) { setStatus('Auto is OFF.'); return; }
      if (alreadyMarkedToday()) {
        setStatus(`Already claimed today (${utcToday()} UTC) — verified.`);
        return;
      }
      if (state.attempts >= CONFIG.MAX_ATTEMPTS) {
        setStatus('Tried 3 times today without site confirmation. Use “Claim now” to retry.');
        return;
      }
    }

    state.running = true;
    try {
      // 1) Make sure we are on the Earn view (hash route, no reload).
      if (!location.hash.includes('/earn')) {
        setStatus('Opening the Earn page…');
        location.hash = CONFIG.EARN_HASH;
        await wait(2500); // let the SPA render the Earn view
      }

      // 2) Find the real button — patiently (SPA + slow network).
      setStatus('Looking for today’s Claim button…');
      let btn = await waitForButton(CONFIG.FIND_TIMEOUT_MS);

      // 3) Fallback: the docs say the claim also lives behind the
      //    top-bar streak chip. Clicking the chip only OPENS it — the
      //    claim is the "Claim +N" button inside, searched for again.
      if (!btn) {
        const chip = findStreakChip();
        if (chip && chip.classList.contains('can-claim')) {
          setStatus('Opening the streak popover from the top bar…');
          chip.click();
          btn = await waitForButton(8000);
        }
      }

      if (!btn) {
        if (siteLooksClaimed()) {
          markClaimed();
          setStatus(`Already claimed today (${utcToday()} UTC) — confirmed on site.`);
        } else {
          setStatus('Claim button not found. Are you signed in? I’ll keep checking while this tab stays open.');
        }
        return;
      }

      // 4) Do not click into a half-restored session (a v1 failure mode):
      //    the wallet chip must be on the page first.
      if (!isWalletConnected()) {
        setStatus('Waiting for your wallet/session to connect…');
        const ok = await waitForWallet(CONFIG.WALLET_WAIT_MS);
        if (!ok) {
          setStatus('Wallet not connected — connect it, then press Claim now. (This attempt was not counted.)');
          return;
        }
        btn = findClaimButton() || btn; // re-grab after the wait; DOM may have re-rendered
      }

      // 5) Click ONCE, then verify against the site — never trust the click.
      const before = snapshot();
      const label = cleanText(btn);
      await wait(400);
      realClick(btn);
      state.attempts += 1;
      setStatus(`Clicked “${label}”. Verifying on the site (up to ${CONFIG.VERIFY_TIMEOUT_MS / 1000}s)… if a wallet approval appears, approve it manually.`);

      const ok = await waitForVerification(before, CONFIG.VERIFY_TIMEOUT_MS);
      if (ok) {
        markClaimed();
        setStatus(`✅ Claimed — the site confirmed it (${utcToday()} UTC). See you after the UTC reset.`);
      } else {
        // KEY FIX vs v1: do NOT mark the day claimed. Retry later.
        setStatus('⚠️ Clicked, but the site did not confirm the claim. NOT marked as claimed — will retry.');
        if (state.attempts < CONFIG.MAX_ATTEMPTS) {
          setTimeout(() => attemptClaim('retry'), CONFIG.RETRY_DELAY_MS);
        }
      }
    } catch (err) {
      setStatus(`Error: ${err?.message || err}. Will retry on the next check.`);
    } finally {
      state.running = false;
    }
  }

  /* ---------------- scheduling / triggers ---------------------------- */

  // Your required flow: site opens → wait 10 seconds → claim on Earn.
  setStatus(`Waiting ${CONFIG.INITIAL_WAIT_MS / 1000}s after page open, then claiming on Earn…`);
  setTimeout(() => attemptClaim('initial'), CONFIG.INITIAL_WAIT_MS);

  // SPA navigation to Earn later (hash change = no reload, no re-run).
  let hashTimer = null;
  window.addEventListener('hashchange', () => {
    if (!location.hash.includes('/earn')) return;
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => attemptClaim('route'), 2000);
  });

  // Safety net: tab left open across the UTC reset, late render, etc.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    resetAttemptsIfNewDay();
    if (autoEnabled() && !alreadyMarkedToday() && !state.running && state.attempts < CONFIG.MAX_ATTEMPTS) {
      attemptClaim('interval');
    }
  }, 60_000);
})();

