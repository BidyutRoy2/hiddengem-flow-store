// ==UserScript==
// @name        Titan Exchange Auto Trader Pro by HiddenGem
// @namespace   hiddengem-flow-store
// @version     2.0
// @description Automated trading loop with anti-ban evasion, draggable & minimizable UI, auto faucet claim, safety locks
// @author      HiddenGem
// @match       https://testnet.titanx.cc/trade/*
// @grant       none
// ==/UserScript==

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // ANTI-BAN / ANTI-DETECTION CONFIGURATION
    // ═══════════════════════════════════════════════════════════════
    const ANTI_BAN = {
        // Human-like timing variations
        baseDelay: 1000,
        jitterRange: 0.4,        // ±40% random variation
        microJitter: 150,        // ±150ms micro-delays
        actionDelay: { min: 300, max: 800 },  // Between actions

        // Behavioral patterns
        randomPauses: true,       // Occasional longer pauses
        pauseProbability: 0.08,   // 8% chance per loop
        pauseDuration: { min: 3000, max: 12000 }, // 3-12s "thinking" pause

        // Mouse simulation
        simulateMouseMove: true,
        clickOffset: 4,           // Random click offset ±4px

        // Session management
        maxLoopsPerSession: 0,    // 0 = unlimited
        sessionBreakProbability: 0.02, // 2% chance to take extended break
        sessionBreakDuration: { min: 60000, max: 300000 }, // 1-5 min break

        // Page interaction
        randomScroll: true,
        scrollProbability: 0.15,
        tabSwitchProbability: 0.05,
    };

    // ═══════════════════════════════════════════════════════════════
    // TRADING CONFIGURATION
    // ═══════════════════════════════════════════════════════════════
    const CONFIG = {
        enabled: false,
        leverage: 20,
        marginMode: 'Cross',
        orderType: 'Market',
    };

    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════
    let isRunning = false;
    let loopCount = 0;
    let sessionStartTime = Date.now();
    let uiMinimized = false;
    let uiPosition = { x: null, y: null };

    // ═══════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randomFloat(min, max) {
        return Math.random() * (max - min) + min;
    }

    function humanDelay(baseMs, type = 'normal') {
        let delay = baseMs;

        // Add jitter
        const jitter = delay * ANTI_BAN.jitterRange * (Math.random() * 2 - 1);
        delay += jitter;

        // Add micro-jitter
        delay += randomInt(-ANTI_BAN.microJitter, ANTI_BAN.microJitter);

        // Occasional longer "thinking" pause
        if (ANTI_BAN.randomPauses && Math.random() < ANTI_BAN.pauseProbability) {
            delay += randomInt(ANTI_BAN.pauseDuration.min, ANTI_BAN.pauseDuration.max);
        }

        return Math.max(50, Math.floor(delay));
    }

    function log(msg, type = 'info') {
        const prefix = `[TitanPro ${new Date().toLocaleTimeString()}]`;
        const styles = {
            info: 'color: #0988F0',
            success: 'color: #36b85a',
            error: 'color: #ee4a5c',
            warn: 'color: #f3a13f',
            debug: 'color: #888'
        };
        console.log(`%c${prefix} ${msg}`, styles[type] || styles.info);
    }

    // Simulate human-like mouse movement before click
    function simulateMouseApproach(element) {
        if (!ANTI_BAN.simulateMouseMove || !element) return;

        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Create mousemove events approaching the target
        const steps = randomInt(3, 6);
        const startX = centerX + randomInt(-100, 100);
        const startY = centerY + randomInt(-100, 100);

        for (let i = 0; i <= steps; i++) {
            const progress = i / steps;
            const ease = 1 - Math.pow(1 - progress, 3); // Ease out cubic
            const x = startX + (centerX - startX) * ease + randomInt(-2, 2);
            const y = startY + (centerY - startY) * ease + randomInt(-2, 2);

            const event = new MouseEvent('mousemove', {
                clientX: x, clientY: y,
                bubbles: true, cancelable: true,
                view: window
            });
            document.dispatchEvent(event);
        }
    }

    // Click with human-like behavior (FIXED: now properly awaits pre-click delay)
    async function humanClick(element, description) {
        if (!element) throw new Error(`${description} not found`);

        // Simulate approach
        simulateMouseApproach(element);

        // Small delay before click
        const preClickDelay = randomInt(50, 200);
        await sleep(preClickDelay);

        // Random click offset within element
        const rect = element.getBoundingClientRect();
        const offsetX = randomInt(-ANTI_BAN.clickOffset, ANTI_BAN.clickOffset);
        const offsetY = randomInt(-ANTI_BAN.clickOffset, ANTI_BAN.clickOffset);

        const clickEvent = new MouseEvent('click', {
            clientX: rect.left + rect.width / 2 + offsetX,
            clientY: rect.top + rect.height / 2 + offsetY,
            bubbles: true, cancelable: true,
            view: window,
            detail: 1
        });
        element.dispatchEvent(clickEvent);

        log(`Human-clicked ${description}`);
        return true;
    }

    // Robust element finder with multiple strategies
    function findElement(selectors, description) {
        if (typeof selectors === 'string') selectors = [selectors];

        for (const sel of selectors) {
            try {
                const el = document.querySelector(sel);
                if (el && isVisible(el)) return el;
            } catch (e) {}
        }

        // Fallback: search by text content
        const buttons = document.querySelectorAll('button, [role="button"], [tabindex="0"]');
        for (const btn of buttons) {
            if (!isVisible(btn)) continue;
            const text = btn.textContent.trim().toLowerCase();
            for (const sel of selectors) {
                const match = sel.match(/:has-text\("([^"]+)"\)/);
                if (match && text.includes(match[1].toLowerCase())) {
                    return btn;
                }
            }
        }
        return null;
    }

    // Find element by accessible name (aria-label or accessible name)
    function findByAccessibleName(name, tag = 'button') {
        const els = document.querySelectorAll(tag);
        for (const el of els) {
            if (!isVisible(el)) continue;
            const ariaLabel = el.getAttribute('aria-label') || '';
            const accessibleName = el.getAttribute('aria-labelledby')
                ? document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || ''
                : '';
            if (ariaLabel.toLowerCase().includes(name.toLowerCase()) ||
                accessibleName.toLowerCase().includes(name.toLowerCase())) {
                return el;
            }
        }
        return null;
    }

    // Find element by exact or partial text content
    function findByText(text, tag = 'button', exact = false) {
        const els = document.querySelectorAll(tag);
        for (const el of els) {
            if (!isVisible(el)) continue;
            const elText = el.textContent.trim();
            if (exact ? elText === text : elText.toLowerCase().includes(text.toLowerCase())) {
                return el;
            }
        }
        return null;
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' &&
               style.visibility !== 'hidden' &&
               style.opacity !== '0' &&
               el.offsetWidth > 0 &&
               el.offsetHeight > 0;
    }

    function setInputValue(selector, value, description) {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`${description} input not found`);

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(el, value);

        ['input', 'change', 'blur'].forEach(evt => {
            el.dispatchEvent(new Event(evt, { bubbles: true }));
        });

        log(`Set ${description} to ${value}`);
        return true;
    }

    function getRandomSide() {
        return Math.random() < 0.5 ? 'buy' : 'sell';
    }

    // ═══════════════════════════════════════════════════════════════
    // FAUCET / TESTNET TOKEN POPUP HANDLER
    // ═══════════════════════════════════════════════════════════════

    // Check if "Top up your account" popup is open
    function isFaucetPopupOpen() {
        // Look for the heading "Top up your account"
        const headings = document.querySelectorAll('h2, h3, h4, [role="heading"]');
        for (const h of headings) {
            if (h.textContent.trim().includes('Top up your account') && isVisible(h)) {
                return true;
            }
        }
        // Also check for the sheet-dismiss (Close) button near the popup area
        const closeBtn = document.querySelector('button.sheet-dismiss');
        if (closeBtn && isVisible(closeBtn)) {
            return true;
        }
        return false;
    }

    // Check if faucet is on cooldown
    function isFaucetOnCooldown() {
        // Search for "Faucet on cooldown" text anywhere in the page
        const allText = document.body.innerText;
        return allText.includes('Faucet on cooldown') || allText.includes('Try again in');
    }

    // Check if "Claim testnet tokens" button is enabled (not on cooldown)
    function getClaimButton() {
        // Find by class name (from DOM report: "sheet-btn-primary w-full flex-none")
        const btn = document.querySelector('button.sheet-btn-primary');
        if (btn && btn.textContent.trim().includes('Claim testnet tokens')) {
            return btn;
        }
        // Fallback by text
        return findByText('Claim testnet tokens', 'button');
    }

    // Close the faucet popup
    function getPopupCloseButton() {
        // Primary: the sheet-dismiss button (X button on popup)
        const closeBtn = document.querySelector('button.sheet-dismiss');
        if (closeBtn && isVisible(closeBtn)) return closeBtn;

        // Fallback: find Close button by aria-label
        return findByAccessibleName('Close', 'button');
    }

    // Handle faucet popup: claim if possible, close if cooldown
    async function handleFaucetPopup() {
        if (!isFaucetPopupOpen()) return false;

        log('Faucet popup detected!', 'warn');
        await sleep(randomInt(500, 1000));

        if (isFaucetOnCooldown()) {
            // Cooldown active - just close the popup
            log('Faucet on cooldown - closing popup', 'warn');
            const closeBtn = getPopupCloseButton();
            if (closeBtn) {
                await humanClick(closeBtn, 'Close faucet popup (cooldown)');
                await sleep(randomInt(500, 1000));
            }
            return true;
        }

        // Try to claim tokens
        const claimBtn = getClaimButton();
        if (claimBtn && !claimBtn.disabled) {
            log('Claiming testnet tokens!', 'success');
            await humanClick(claimBtn, 'Claim testnet tokens');
            await sleep(randomInt(3000, 5000)); // Wait for claim to process

            // After claiming, close popup if still open
            if (isFaucetPopupOpen()) {
                const closeBtn = getPopupCloseButton();
                if (closeBtn) {
                    await humanClick(closeBtn, 'Close faucet popup (after claim)');
                    await sleep(randomInt(500, 1000));
                }
            }
            return true;
        } else if (claimBtn && claimBtn.disabled) {
            // Button is disabled (might be cooldown or processing)
            log('Claim button disabled - closing popup', 'warn');
            const closeBtn = getPopupCloseButton();
            if (closeBtn) {
                await humanClick(closeBtn, 'Close faucet popup (disabled)');
                await sleep(randomInt(500, 1000));
            }
            return true;
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════════
    // SAFETY LOCKS - Prevent accidental setting changes
    // ═══════════════════════════════════════════════════════════════

    // Ensure Market tab is always selected (never click Limit or Scale)
    function ensureMarketOrderType() {
        // Find Market tab by role="tab"
        const tabs = document.querySelectorAll('button[role="tab"]');
        for (const tab of tabs) {
            const text = tab.textContent.trim();
            if (text === 'Market') {
                const isSelected = tab.getAttribute('aria-selected') === 'true';
                if (!isSelected) {
                    log('Market tab is NOT selected - this should not happen. Skipping click to avoid issues.', 'warn');
                    // Do NOT click - just warn. If Market is already selected we're fine.
                    return false;
                }
                return true;
            }
        }
        log('Market tab not found in DOM', 'error');
        return false;
    }

    // Block clicks on dangerous buttons using event delegation
    function installSafetyLocks() {
        document.addEventListener('click', function(e) {
            if (!isRunning) return; // Only block when bot is running

            const target = e.target.closest('button, [role="tab"]');
            if (!target) return;

            const ariaLabel = (target.getAttribute('aria-label') || '').toLowerCase();
            const title = (target.getAttribute('title') || '').toLowerCase();
            const text = target.textContent.trim().toLowerCase();
            const role = target.getAttribute('role') || '';

            // Block Limit tab
            if (role === 'tab' && text === 'limit') {
                e.stopPropagation();
                e.preventDefault();
                log('BLOCKED: Limit tab click (locked to Market)', 'warn');
                return false;
            }

            // Block Scale tab
            if (role === 'tab' && text === 'scale') {
                e.stopPropagation();
                e.preventDefault();
                log('BLOCKED: Scale tab click (locked to Market)', 'warn');
                return false;
            }

            // Block Detach as floating window
            if (ariaLabel.includes('detach as floating window') || title.includes('detach as floating window')) {
                e.stopPropagation();
                e.preventDefault();
                log('BLOCKED: Detach as floating window click (locked)', 'warn');
                return false;
            }

            // Block Adjust leverage
            if (ariaLabel.includes('leverage') || title.includes('adjust leverage')) {
                e.stopPropagation();
                e.preventDefault();
                log('BLOCKED: Leverage adjustment click (locked at ' + CONFIG.leverage + 'x)', 'warn');
                return false;
            }

            // Block Margin mode change
            if (ariaLabel.includes('margin mode')) {
                e.stopPropagation();
                e.preventDefault();
                log('BLOCKED: Margin mode change click (locked to ' + CONFIG.marginMode + ')', 'warn');
                return false;
            }
        }, true); // Use capture phase to intercept before the page handler

        log('Safety locks installed: Market locked, Leverage locked, Margin mode locked, Detach locked', 'success');
    }

    // ═══════════════════════════════════════════════════════════════
    // TRADING STEPS WITH ANTI-BAN (FIXED SELECTORS)
    // ═══════════════════════════════════════════════════════════════

    async function stepRandomSide() {
        const side = getRandomSide();
        log(`Random side: ${side.toUpperCase()}`);

        let btn = null;

        if (side === 'buy') {
            // Find Buy / Long button using aria-pressed and text
            const sideBtns = document.querySelectorAll('button.relative.z-10');
            for (const b of sideBtns) {
                if (b.textContent.trim().includes('Buy') && b.textContent.trim().includes('Long')) {
                    btn = b;
                    break;
                }
            }
            // Fallback: find by exact text
            if (!btn) btn = findByText('Buy / Long', 'button');
        } else {
            const sideBtns = document.querySelectorAll('button.relative.z-10');
            for (const b of sideBtns) {
                if (b.textContent.trim().includes('Sell') && b.textContent.trim().includes('Short')) {
                    btn = b;
                    break;
                }
            }
            if (!btn) btn = findByText('Sell / Short', 'button');
        }

        if (!btn) throw new Error(`${side} button not found`);
        await humanClick(btn, `${side} button`);
        await sleep(humanDelay(ANTI_BAN.actionDelay.min, 'action'));
    }

    async function stepSetMaxSize() {
        // Find the Max button in the size percentage row
        // From DOM: className contains "tabular-nums", text is "Max"
        const allBtns = document.querySelectorAll('button.tabular-nums');
        let maxBtn = null;

        for (const btn of allBtns) {
            const text = btn.textContent.trim();
            if (text === 'Max' && isVisible(btn)) {
                maxBtn = btn;
                break;
            }
        }

        // Fallback: search all buttons for "Max" that's not a percentage
        if (!maxBtn) {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const text = btn.textContent.trim();
                if (text === 'Max' && isVisible(btn) && !btn.closest('.ob-grid')) {
                    maxBtn = btn;
                    break;
                }
            }
        }

        if (!maxBtn) throw new Error('MAX button not found');
        await humanClick(maxBtn, 'MAX size');
        await sleep(humanDelay(ANTI_BAN.actionDelay.min, 'action'));
    }

    async function stepConfirmOrder() {
        // The confirm button text changes based on side: "Buy ..." or "Sell ..."
        // It has class containing "rounded-[var(--r-pill)]" and is the main action button
        // When size is entered, it becomes enabled

        // Wait a bit for the button to update
        await sleep(randomInt(300, 600));

        // Find the big buy/sell confirm button
        const confirmBtns = document.querySelectorAll('button');
        let confirmBtn = null;

        for (const btn of confirmBtns) {
            const text = btn.textContent.trim();
            const className = btn.className || '';

            // It's the confirm button if:
            // 1. Contains "Buy" or "Sell" (but not "Buy / Long" or "Sell / Short")
            // 2. Has the right class (flex items-center justify-center rounded-...)
            // 3. Is not disabled
            // 4. Is not in the side selector area
            if (className.includes('flex items-center justify-center rounded-[var(--r-pill)]') &&
                (text.includes('Buy') || text.includes('Sell')) &&
                !text.includes('Long') && !text.includes('Short') &&
                !btn.disabled) {
                confirmBtn = btn;
                break;
            }
        }

        // Fallback: look for the submit button by its large size
        if (!confirmBtn) {
            for (const btn of confirmBtns) {
                const text = btn.textContent.trim();
                const rect = btn.getBoundingClientRect();
                // The confirm button is ~279px wide, ~51px tall
                if (rect.width > 250 && rect.height > 40 &&
                    (text.includes('Buy') || text.includes('Sell')) &&
                    !text.includes('Long') && !text.includes('Short') &&
                    !btn.disabled && isVisible(btn)) {
                    confirmBtn = btn;
                    break;
                }
            }
        }

        if (!confirmBtn) throw new Error('Confirm button not found or still disabled');
        if (confirmBtn.disabled) throw new Error('Confirm button is disabled - size might not be set');

        await humanClick(confirmBtn, 'Confirm Order');
        await sleep(humanDelay(ANTI_BAN.actionDelay.max, 'action'));
    }

    async function stepCloseAll() {
        // First ensure we're on the Positions tab
        const positionsTab = findByText('Positions', 'button');

        if (positionsTab && isVisible(positionsTab)) {
            await humanClick(positionsTab, 'Positions tab');
            await sleep(humanDelay(500, 'normal'));
        }

        // Wait for position to appear
        await sleep(randomInt(1000, 2000));

        // Look for "Close All" button
        let closeBtn = findByText('Close All', 'button') || findByText('Close all', 'button');

        // Also look for individual close buttons (X icon on each position)
        if (!closeBtn) {
            // Try to find close button for individual positions
            const allBtns = document.querySelectorAll('button');
            for (const btn of allBtns) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const text = btn.textContent.trim().toLowerCase();
                if ((text.includes('close') && !text.includes('history')) ||
                    ariaLabel.toLowerCase().includes('close position') ||
                    ariaLabel.toLowerCase().includes('close all')) {
                    if (isVisible(btn) && !btn.disabled) {
                        closeBtn = btn;
                        break;
                    }
                }
            }
        }

        if (closeBtn) {
            await humanClick(closeBtn, 'Close All / Close Position');
            await sleep(humanDelay(1000, 'normal'));

            // Handle confirmation dialog if it appears
            await sleep(randomInt(500, 1000));
            const confirmClose = findByText('Confirm', 'button') || findByText('Close', 'button');
            if (confirmClose && isVisible(confirmClose) && !confirmClose.disabled) {
                // Make sure this is a confirmation button, not a navigation button
                const rect = confirmClose.getBoundingClientRect();
                if (rect.width > 80) { // Confirmation buttons are usually wider
                    await humanClick(confirmClose, 'Confirm Close');
                }
            }
        } else {
            log('Close All not found - no positions to close', 'warn');
        }
        await sleep(humanDelay(ANTI_BAN.actionDelay.max, 'action'));
    }

    // Random behavioral actions to appear human
    async function randomBehavior() {
        if (ANTI_BAN.randomScroll && Math.random() < ANTI_BAN.scrollProbability) {
            const scrollAmount = randomInt(-300, 300);
            window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            log(`Random scroll: ${scrollAmount}px`, 'debug');
            await sleep(randomInt(500, 1500));
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PRE-LOOP CHECKS
    // ═══════════════════════════════════════════════════════════════

    async function preLoopChecks() {
        // 1. Handle faucet popup if it appears
        await handleFaucetPopup();

        // 2. Verify Market order type is selected
        if (!ensureMarketOrderType()) {
            log('WARNING: Market order type may not be selected!', 'warn');
            // Try to click Market tab to fix it
            const tabs = document.querySelectorAll('button[role="tab"]');
            for (const tab of tabs) {
                if (tab.textContent.trim() === 'Market' && tab.getAttribute('aria-selected') !== 'true') {
                    await humanClick(tab, 'Force Market tab');
                    await sleep(humanDelay(500, 'normal'));
                    break;
                }
            }
        }

        // 3. Dismiss any other unexpected popups/modals/overlays
        await dismissUnexpectedPopups();
    }

    // Dismiss any unexpected popups that might appear
    async function dismissUnexpectedPopups() {
        // Look for any overlay/modal close buttons
        const dismissBtns = document.querySelectorAll(
            'button[aria-label="Close"], button[aria-label="Dismiss"], button.sheet-dismiss'
        );
        for (const btn of dismissBtns) {
            if (isVisible(btn)) {
                // Don't close our own panel!
                if (btn.closest('#titan-pro-panel')) continue;

                // Check if it's the faucet popup (already handled)
                const parent = btn.closest('[role="dialog"], .sheet, .modal, [data-radix-portal]');
                if (parent) {
                    log('Dismissing unexpected popup', 'warn');
                    await humanClick(btn, 'Dismiss popup');
                    await sleep(randomInt(500, 1000));
                }
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PERIODIC FAUCET CHECK (runs independently)
    // ═══════════════════════════════════════════════════════════════
    function startFaucetWatcher() {
        setInterval(async () => {
            if (isFaucetPopupOpen()) {
                log('Faucet popup detected by watcher', 'warn');
                await handleFaucetPopup();
            }
        }, 5000); // Check every 5 seconds
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN LOOP WITH SESSION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    async function runLoop() {
        if (!isRunning) return;

        try {
            loopCount++;
            const sessionTime = Math.floor((Date.now() - sessionStartTime) / 1000 / 60);
            log(`=== Loop #${loopCount} | Session: ${sessionTime}min ===`);

            // Pre-loop safety checks
            await preLoopChecks();

            // Random pre-loop behavior
            await randomBehavior();

            await stepRandomSide();
            await sleep(humanDelay(ANTI_BAN.baseDelay, 'normal'));

            await stepSetMaxSize();
            await sleep(humanDelay(ANTI_BAN.baseDelay, 'normal'));

            await stepConfirmOrder();
            await sleep(humanDelay(ANTI_BAN.baseDelay * 1.5, 'normal'));

            await stepCloseAll();
            await sleep(humanDelay(ANTI_BAN.baseDelay, 'normal'));

            // Random post-loop behavior
            await randomBehavior();

            log(`=== Loop #${loopCount} complete ===`, 'success');

            // Session break check
            if (ANTI_BAN.maxLoopsPerSession > 0 && loopCount >= ANTI_BAN.maxLoopsPerSession) {
                log('Max loops reached, stopping', 'warn');
                stopTrading();
                return;
            }

            if (Math.random() < ANTI_BAN.sessionBreakProbability) {
                const breakMs = randomInt(ANTI_BAN.sessionBreakDuration.min, ANTI_BAN.sessionBreakDuration.max);
                log(`Taking session break: ${Math.floor(breakMs/1000/60)}min`, 'warn');
                updateStatus(`Break: ${Math.floor(breakMs/1000/60)}min`);
                await sleep(breakMs);
                log('Resuming after break');
            }

            await sleep(humanDelay(500, 'normal'));

            if (isRunning) runLoop();
        } catch (error) {
            log(`Error: ${error.message}`, 'error');
            updateStatus(`Error: ${error.message}`);

            // On error, check for popups that might be blocking
            await handleFaucetPopup();
            await dismissUnexpectedPopups();

            await sleep(humanDelay(5000, 'error'));
            if (isRunning) runLoop();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // DRAGGABLE & MINIMIZABLE UI
    // ═══════════════════════════════════════════════════════════════
    function createControlPanel() {
        const existing = document.getElementById('titan-pro-panel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'titan-pro-panel';
        panel.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 2147483647;
            background: var(--surface, #1a1a1a);
            border: 1px solid var(--border, #333);
            border-radius: 12px;
            padding: 0;
            min-width: 260px;
            max-width: 320px;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            color: var(--t1, #fff);
            user-select: none;
            transition: all 0.2s ease;
        `;

        // Restore saved position
        if (uiPosition.x !== null && uiPosition.y !== null) {
            panel.style.left = `${uiPosition.x}px`;
            panel.style.top = `${uiPosition.y}px`;
            panel.style.right = 'auto';
        }

        panel.innerHTML = `
            <!-- Title Bar (Drag Handle) -->
            <div id="titan-titlebar" style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 14px;
                cursor: move;
                border-bottom: 1px solid var(--border, #333);
                border-radius: 12px 12px 0 0;
                background: linear-gradient(180deg, var(--surface-3, #252525) 0%, var(--surface, #1a1a1a) 100%);
            ">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 16px;">⚡</span>
                    <h3 style="margin: 0; font-size: 13px; font-weight: 600;">Titan Pro v2.0</h3>
                    <span id="titan-loop-badge" style="
                        background: var(--surface-3, #333);
                        padding: 2px 8px;
                        border-radius: 10px;
                        font-size: 10px;
                        font-weight: 600;
                        color: var(--t2, #888);
                    ">Loops: 0</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    <button id="titan-minimize" title="Minimize (M)" style="
                        width: 24px; height: 24px; border: none; border-radius: 6px;
                        background: var(--surface-3, #333); color: var(--t2, #888);
                        cursor: pointer; font-size: 14px; line-height: 1;
                        display: flex; align-items: center; justify-content: center;
                    ">−</button>
                    <button id="titan-close-panel" title="Hide (Alt+T)" style="
                        width: 24px; height: 24px; border: none; border-radius: 6px;
                        background: var(--surface-3, #333); color: var(--t2, #888);
                        cursor: pointer; font-size: 14px; line-height: 1;
                        display: flex; align-items: center; justify-content: center;
                    ">×</button>
                </div>
            </div>

            <!-- Content Area -->
            <div id="titan-content" style="padding: 14px;">
                <!-- Enable Toggle -->
                <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; cursor: pointer;">
                    <input type="checkbox" id="titan-enabled" ${CONFIG.enabled ? 'checked' : ''} style="
                        width: 18px; height: 18px; accent-color: #0988F0; cursor: pointer;
                    ">
                    <span style="font-size: 13px; font-weight: 500;">Enable Automation</span>
                </label>

                <!-- Start/Stop Button -->
                <button id="titan-start" style="
                    width: 100%;
                    padding: 12px;
                    border-radius: 8px;
                    border: none;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    background: ${CONFIG.enabled ? 'var(--red-deep, #ee4a5c)' : 'var(--surface-3, #333)'};
                    color: white;
                    opacity: ${CONFIG.enabled ? '1' : '0.5'};
                    transition: all 0.2s;
                " ${!CONFIG.enabled ? 'disabled' : ''}>
                    ${isRunning ? 'STOP LOOP' : 'START LOOP'}
                </button>

                <!-- Status -->
                <div id="titan-status" style="margin-top: 10px; padding: 8px; border-radius: 6px; background: var(--surface-3, #252525); font-size: 11px; text-align: center;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <span id="titan-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: ${CONFIG.enabled ? '#36b85a' : '#666'};"></span>
                        <span id="titan-status-text">${CONFIG.enabled ? 'Ready' : 'Disabled'}</span>
                    </div>
                    <div style="margin-top: 4px; color: var(--t3, #666); font-size: 10px;">
                        Session: <span id="titan-session-time">0m</span> | Loops: <span id="titan-loop-count">0</span>
                    </div>
                </div>

                <!-- Safety Lock Indicators -->
                <div style="margin-top: 10px; padding: 8px; border-radius: 6px; background: var(--surface-3, #252525); font-size: 10px; line-height: 1.8;">
                    <div style="font-weight: 600; color: var(--t1, #fff); margin-bottom: 4px;">🔒 Safety Locks (Active While Running)</div>
                    <div style="color: #36b85a;">✓ Order Type: Market (locked)</div>
                    <div style="color: #36b85a;">✓ Leverage: 20× (locked)</div>
                    <div style="color: #36b85a;">✓ Margin Mode: Cross (locked)</div>
                    <div style="color: #36b85a;">✓ Detach Window: Blocked</div>
                    <div style="color: #36b85a;">✓ Faucet Popup: Auto-handle</div>
                </div>

                <!-- Anti-Ban Settings (Collapsible) -->
                <details id="titan-settings" style="margin-top: 10px;">
                    <summary style="cursor: pointer; font-size: 11px; color: var(--t2, #888); font-weight: 500;">⚙ Anti-Ban Settings</summary>
                    <div style="margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 10px;">
                        <label><input type="checkbox" id="ab-jitter" checked> Timing Jitter</label>
                        <label><input type="checkbox" id="ab-mouse" checked> Mouse Simulation</label>
                        <label><input type="checkbox" id="ab-pauses" checked> Random Pauses</label>
                        <label><input type="checkbox" id="ab-scroll" checked> Random Scroll</label>
                        <label><input type="checkbox" id="ab-breaks" checked> Session Breaks</label>
                        <label><input type="checkbox" id="ab-tabs" checked> Tab Switching</label>
                    </div>
                    <div style="margin-top: 8px; display: flex; gap: 8px; font-size: 10px;">
                        <label>Base Delay: <input type="number" id="ab-delay" value="${ANTI_BAN.baseDelay}" min="500" max="5000" step="100" style="width: 60px; padding: 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--t1);">ms</label>
                    </div>
                </details>

                <!-- Quick Stats -->
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border, #333); font-size: 10px; color: var(--t3, #666); line-height: 1.8;">
                    <div>🛡 Anti-ban: Active</div>
                    <div>🖱 Human-like clicks & timing</div>
                    <div>📍 Random mouse approach</div>
                    <div>⏱ Jitter: ±${Math.round(ANTI_BAN.jitterRange * 100)}% + ${ANTI_BAN.microJitter}ms</div>
                    <div>🎯 Click offset: ±${ANTI_BAN.clickOffset}px</div>
                </div>
            </div>

            <!-- Minimized Bar -->
            <div id="titan-minimized" style="display: none; padding: 8px 12px; border-top: 1px solid var(--border); cursor: move;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <span style="font-size: 11px; font-weight: 600;">⚡ Titan Pro v2.0</span>
                    <span id="titan-mini-status" style="font-size: 10px; color: var(--t2);">Stopped</span>
                    <button id="titan-restore" style="width: 20px; height: 20px; border: none; border-radius: 4px; background: var(--surface-3); color: var(--t2); cursor: pointer; font-size: 12px;">+</button>
                </div>
            </div>
        `;

        document.body.appendChild(panel);

        // ═══════════════════════════════════════════════════════
        // DRAG FUNCTIONALITY
        // ═══════════════════════════════════════════════════════
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let panelStart = { x: 0, y: 0 };

        const titlebar = panel.querySelector('#titan-titlebar');
        const minimizedBar = panel.querySelector('#titan-minimized');

        function startDrag(e, startX, startY) {
            isDragging = true;
            dragStart = { x: startX, y: startY };
            const rect = panel.getBoundingClientRect();
            panelStart = { x: rect.left, y: rect.top };
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.transition = 'none';
            document.body.style.userSelect = 'none';
        }

        function doDrag(e) {
            if (!isDragging) return;
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            if (!clientX) return;

            const dx = clientX - dragStart.x;
            const dy = clientY - dragStart.y;
            const newX = Math.max(0, Math.min(window.innerWidth - 280, panelStart.x + dx));
            const newY = Math.max(0, Math.min(window.innerHeight - 100, panelStart.y + dy));

            panel.style.left = `${newX}px`;
            panel.style.top = `${newY}px`;
            uiPosition = { x: newX, y: newY };
        }

        function endDrag() {
            isDragging = false;
            panel.style.transition = 'all 0.2s ease';
            document.body.style.userSelect = '';
        }

        // Mouse events
        [titlebar, minimizedBar].forEach(el => {
            el.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                startDrag(e, e.clientX, e.clientY);
            });
        });

        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', endDrag);

        // Touch events for mobile
        [titlebar, minimizedBar].forEach(el => {
            el.addEventListener('touchstart', (e) => {
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
                startDrag(e, e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
        });

        document.addEventListener('touchmove', (e) => doDrag(e.touches[0]), { passive: true });
        document.addEventListener('touchend', endDrag);

        // ═══════════════════════════════════════════════════════
        // UI EVENT HANDLERS
        // ═══════════════════════════════════════════════════════
        const elements = {
            enabled: panel.querySelector('#titan-enabled'),
            start: panel.querySelector('#titan-start'),
            statusText: panel.querySelector('#titan-status-text'),
            statusDot: panel.querySelector('#titan-status-dot'),
            close: panel.querySelector('#titan-close-panel'),
            minimize: panel.querySelector('#titan-minimize'),
            restore: panel.querySelector('#titan-restore'),
            content: panel.querySelector('#titan-content'),
            minimized: panel.querySelector('#titan-minimized'),
            loopBadge: panel.querySelector('#titan-loop-badge'),
            loopCount: panel.querySelector('#titan-loop-count'),
            sessionTime: panel.querySelector('#titan-session-time'),
            miniStatus: panel.querySelector('#titan-mini-status'),
        };

        // Anti-ban setting checkboxes
        ['jitter', 'mouse', 'pauses', 'scroll', 'breaks', 'tabs'].forEach(key => {
            const cb = panel.querySelector(`#ab-${key}`);
            if (cb) cb.addEventListener('change', (e) => {
                ANTI_BAN[`random${key.charAt(0).toUpperCase() + key.slice(1)}`] = e.target.checked;
                log(`Anti-ban ${key}: ${e.target.checked ? 'on' : 'off'}`);
            });
        });

        const delayInput = panel.querySelector('#ab-delay');
        if (delayInput) delayInput.addEventListener('change', (e) => {
            ANTI_BAN.baseDelay = parseInt(e.target.value) || 1000;
            log(`Base delay: ${ANTI_BAN.baseDelay}ms`);
        });

        elements.enabled.addEventListener('change', (e) => {
            CONFIG.enabled = e.target.checked;
            elements.start.disabled = !CONFIG.enabled;
            elements.start.style.opacity = CONFIG.enabled ? '1' : '0.5';
            elements.start.style.background = CONFIG.enabled ? 'var(--red-deep, #ee4a5c)' : 'var(--surface-3, #333)';
            elements.statusText.textContent = CONFIG.enabled ? 'Ready' : 'Disabled';
            elements.statusDot.style.background = CONFIG.enabled ? '#36b85a' : '#666';
            elements.miniStatus.textContent = CONFIG.enabled ? 'Ready' : 'Disabled';
            log(`Automation ${CONFIG.enabled ? 'enabled' : 'disabled'}`);
        });

        elements.start.addEventListener('click', () => {
            if (!CONFIG.enabled) return;
            toggleTrading();
        });

        elements.close.addEventListener('click', () => {
            panel.style.display = 'none';
        });

        elements.minimize.addEventListener('click', () => toggleMinimize());
        elements.restore.addEventListener('click', () => toggleMinimize());

        function toggleMinimize() {
            uiMinimized = !uiMinimized;
            elements.content.style.display = uiMinimized ? 'none' : 'block';
            elements.minimized.style.display = uiMinimized ? 'block' : 'none';
            elements.minimize.textContent = uiMinimized ? '+' : '−';
            panel.style.borderRadius = uiMinimized ? '12px' : '12px 12px 0 0';
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key.toLowerCase() === 't') {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            }
            if (e.key === 'm' && !e.altKey && !e.ctrlKey && !e.metaKey) {
                const active = document.activeElement;
                if (active !== elements.start && active.tagName !== 'INPUT') {
                    toggleMinimize();
                }
            }
        });

        // Status update interval
        setInterval(() => {
            if (elements.loopCount) elements.loopCount.textContent = loopCount;
            if (elements.loopBadge) elements.loopBadge.textContent = `Loops: ${loopCount}`;
            if (elements.sessionTime) {
                const mins = Math.floor((Date.now() - sessionStartTime) / 60000);
                const secs = Math.floor((Date.now() - sessionStartTime) / 1000) % 60;
                elements.sessionTime.textContent = `${mins}m ${secs}s`;
            }
            if (elements.miniStatus && isRunning) {
                elements.miniStatus.textContent = `Running #${loopCount}`;
            }
        }, 1000);

        return panel;
    }

    function updateStatus(msg) {
        const statusText = document.querySelector('#titan-status-text');
        const miniStatus = document.querySelector('#titan-mini-status');
        if (statusText) statusText.textContent = msg;
        if (miniStatus) miniStatus.textContent = msg;
    }

    function toggleTrading() {
        const startBtn = document.querySelector('#titan-start');
        const statusDot = document.querySelector('#titan-status-dot');

        if (!isRunning) {
            isRunning = true;
            loopCount = 0;
            sessionStartTime = Date.now();
            startBtn.textContent = 'STOP LOOP';
            startBtn.style.background = 'var(--fixed-green, #36b85a)';
            updateStatus('Running...');
            statusDot.style.background = '#36b85a';
            log('Auto trader STARTED', 'success');
            log('Safety locks ENGAGED: Market/Leverage/Margin/Detach locked', 'success');
            runLoop();
        } else {
            isRunning = false;
            startBtn.textContent = 'START LOOP';
            startBtn.style.background = 'var(--red-deep, #ee4a5c)';
            updateStatus('Stopped');
            statusDot.style.background = '#f3a13f';
            log('Auto trader STOPPED');
            log('Safety locks DISENGAGED', 'warn');
        }
    }

    function stopTrading() {
        isRunning = false;
        const startBtn = document.querySelector('#titan-start');
        const statusDot = document.querySelector('#titan-status-dot');
        if (startBtn) {
            startBtn.textContent = 'START LOOP';
            startBtn.style.background = 'var(--red-deep, #ee4a5c)';
        }
        updateStatus('Stopped');
        if (statusDot) statusDot.style.background = '#f3a13f';
    }

    // ═══════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════
    function init() {
        log('═══════════════════════════════════════════════════');
        log('Titan Exchange Auto Trader Pro v2.0 by HiddenGem');
        log('═══════════════════════════════════════════════════');
        log('NEW Features:');
        log('  ✓ Auto faucet claim + cooldown popup dismiss');
        log('  ✓ Market order type locked (Limit/Scale blocked)');
        log('  ✓ Leverage locked (no accidental changes)');
        log('  ✓ Margin mode Cross locked');
        log('  ✓ Detach floating window blocked');
        log('  ✓ Fixed human-click async timing');
        log('  ✓ Improved DOM selectors from diagnostic report');
        log('  ✓ Pre-loop safety checks');
        log('  ✓ Periodic faucet popup watcher');
        log('═══════════════════════════════════════════════════');
        log('Shortcuts: Alt+T = Toggle panel, M = Minimize/Restore');

        createControlPanel();
        installSafetyLocks();
        startFaucetWatcher();

        // Initial faucet check after a short delay
        setTimeout(async () => {
            await handleFaucetPopup();
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

