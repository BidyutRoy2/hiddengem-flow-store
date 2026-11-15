// ==UserScript==
// @name        9Chain Virtual Node Auto
// @namespace   hiddengem-flow-store
// @version     2.0.0
// @description Auto Tap to Earn + Daily Gift + Node Tier & Module Upgrades (CPU/RAM/Anti-Sybil/Firewall/Peer/Relay/Consensus/Sharding). https://t.me/hiddengemnews
// @match       https://www.9chain.com/virtual-node
// @match       https://www.9chain.com/virtual-node/*
// @grant       none
// ==/UserScript==

(() => {
    'use strict';

    const CFG = {
        tapDelay: 200,
        actionDelay: 2500,
        logEveryTaps: 25,
        componentHeadings: [
            'CPU',
            'RAM',
            'Anti-Sybil Module',
            'Firewall',
            'Peer Connections',
            'Relay Nodes',
            'Consensus Tuner',
            'Sharding'
        ]
    };

    const state = {
        running: true,
        taps: 0,
        lastActionAt: 0,
        tapTimer: null,
        actionTimer: null
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function norm(s) {
        return (s || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const st = getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
    }

    function isClickable(btn) {
        return !!btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && isVisible(btn);
    }

    function clickEl(el, reason) {
        if (!isClickable(el)) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
        } catch (_) {}
        el.click();
        console.log(`[9Chain] ✅ ${reason}`);
        return true;
    }

    function allButtons() {
        return [...document.querySelectorAll('button, [role="button"]')];
    }

    // ---------- Tap to Earn (keep existing behavior) ----------
    function getTapButton() {
        return allButtons().find(b => norm(b.getAttribute('aria-label')).startsWith('Tap to earn'));
    }

    function getTapRemaining(button) {
        const label = norm(button?.getAttribute('aria-label'));
        const m = label.match(/(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+left/i);
        return m ? Number(m[1].replace(/,/g, '')) : null;
    }

    function tapLoop() {
        if (!state.running) return;
        const btn = getTapButton();
        if (btn) {
            const remaining = getTapRemaining(btn);
            if (remaining === null || remaining > 0) {
                if (isClickable(btn)) {
                    btn.click();
                    state.taps++;
                    if (state.taps % CFG.logEveryTaps === 0) {
                        console.log(`[9Chain] Taps: ${state.taps} | ${norm(btn.getAttribute('aria-label'))}`);
                    }
                }
            }
        }
        state.tapTimer = setTimeout(tapLoop, CFG.tapDelay);
    }

    // ---------- Daily Gift ----------
    function tryDailyGift() {
        const candidates = allButtons().filter(b => {
            const t = norm(b.textContent).toLowerCase();
            const a = norm(b.getAttribute('aria-label')).toLowerCase();
            return t.includes('open gift') || a.includes('open gift') || (t.includes('gift') && (t.includes('open') || t.includes('claim')));
        });
        for (const b of candidates) {
            if (clickEl(b, `Daily gift: ${norm(b.textContent) || norm(b.getAttribute('aria-label'))}`)) return true;
        }
        // fallback: button near "Daily gift" heading
        const h = [...document.querySelectorAll('h1,h2,h3,h4')].find(el => norm(el.textContent).toLowerCase() === 'daily gift');
        if (h) {
            const box = h.closest('section,div,article') || h.parentElement;
            const b = box && [...box.querySelectorAll('button,[role="button"]')].find(x => isClickable(x) && /open|claim|gift/i.test(norm(x.textContent) + ' ' + norm(x.getAttribute('aria-label'))));
            if (b && clickEl(b, `Daily gift (fallback): ${norm(b.textContent)}`)) return true;
        }
        return false;
    }

    // ---------- Node Tier Upgrade ----------
    function tryNodeTierUpgrade() {
        const btn = allButtons().find(b => {
            const a = norm(b.getAttribute('aria-label')).toLowerCase();
            const t = norm(b.textContent).toLowerCase();
            return a.startsWith('raise to tier') || (t.startsWith('upgrade for') && (a.includes('tier') || !!b.closest('[class*="tier"], [class*="node"], section, div')));
        });
        if (btn && clickEl(btn, `Node tier: ${norm(btn.getAttribute('aria-label')) || norm(btn.textContent)}`)) return true;
        return false;
    }

    // ---------- Component Upgrades (CPU/RAM/Anti-Sybil/Firewall/Peer/Relay/Consensus/Sharding) ----------
    function findHeadingContainer(headingText) {
        const target = headingText.toLowerCase();
        const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,div')].filter(el => norm(el.textContent).toLowerCase() === target);
        for (const h of hs) {
            // climb until we find a container that has buttons or looks like a card
            let cur = h;
            for (let i = 0; i < 6 && cur; i++) {
                const btns = cur.querySelectorAll('button,[role="button"]');
                if (btns.length > 0 && i > 0) return cur;
                cur = cur.parentElement;
            }
            if (h.parentElement) return h.parentElement;
        }
        return null;
    }

    function tryComponentUpgrades() {
        let did = false;
        for (const name of CFG.componentHeadings) {
            const box = findHeadingContainer(name);
            if (!box) continue;
            const btns = [...box.querySelectorAll('button,[role="button"]')].filter(b => {
                const t = norm(b.textContent).toLowerCase();
                const a = norm(b.getAttribute('aria-label')).toLowerCase();
                return /upgrade|boost|improve|level up/.test(t + ' ' + a);
            });
            for (const b of btns) {
                if (clickEl(b, `${name} upgrade: ${norm(b.textContent) || norm(b.getAttribute('aria-label'))}`)) {
                    did = true;
                    break; // one per component per cycle
                }
            }
        }
        // Generic fallback: any visible upgrade button not matching nav/language etc, excluding tap/tier handled separately
        if (!did) {
            const extras = allButtons().filter(b => {
                if (!isClickable(b)) return false;
                const t = norm(b.textContent).toLowerCase();
                const a = norm(b.getAttribute('aria-label')).toLowerCase();
                if (a.startsWith('tap to earn') || a.startsWith('raise to tier') || t.includes('open gift')) return false;
                if (/language|account|menu|notification|sign|log ?out/.test(t + ' ' + a)) return false;
                return t === 'upgrade' || /^upgrade\b/.test(t) || a.includes('upgrade cpu') || a.includes('upgrade ram');
            });
            for (const b of extras) {
                if (clickEl(b, `Upgrade (generic): ${norm(b.textContent) || norm(b.getAttribute('aria-label'))}`)) { did = true; break; }
            }
        }
        return did;
    }

    function actionLoop() {
        if (!state.running) return;
        const now = Date.now();
        if (now - state.lastActionAt >= CFG.actionDelay) {
            state.lastActionAt = now;
            try { tryDailyGift(); } catch (e) { console.warn('[9Chain] gift error', e); }
            try { tryNodeTierUpgrade(); } catch (e) { console.warn('[9Chain] tier error', e); }
            try { tryComponentUpgrades(); } catch (e) { console.warn('[9Chain] module error', e); }
        }
        state.actionTimer = setTimeout(actionLoop, 1000);
    }

    function start() {
        if (state.running && (state.tapTimer || state.actionTimer)) {
            console.log('[9Chain] Already running');
            return;
        }
        state.running = true;
        console.log('[9Chain] ▶ Started (tap + gift + upgrades)');
        if (!state.tapTimer) tapLoop();
        if (!state.actionTimer) actionLoop();
    }

    function stop() {
        state.running = false;
        if (state.tapTimer) clearTimeout(state.tapTimer);
        if (state.actionTimer) clearTimeout(state.actionTimer);
        state.tapTimer = state.actionTimer = null;
        console.log(`[9Chain] 🛑 Stopped | taps: ${state.taps}`);
    }

    window.K9_REAL = {
        start,
        stop,
        status() {
            const tap = getTapButton();
            console.log({
                running: state.running,
                taps: state.taps,
                tapLabel: norm(tap?.getAttribute('aria-label')),
                tapRemaining: getTapRemaining(tap)
            });
        },
        runNow() { state.lastActionAt = 0; console.log('[9Chain] runNow'); }
    };

    // React/SPA DOM changes: nudge action loop
    const mo = new MutationObserver(() => { state.lastActionAt = Math.min(state.lastActionAt, Date.now() - CFG.actionDelay + 400); });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}

    console.log('[9Chain] 🚀 Auto v2.0.0 loaded (tap/gift/node+module upgrades)');
    start();
})();

