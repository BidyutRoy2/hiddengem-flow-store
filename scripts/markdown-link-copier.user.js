// ==UserScript==
// @name         Markdown Link Copier
// @namespace    https://github.com/BidyutRoy2/hiddengem-flow-store
// @version      1.0.1
// @description  Adds a small button on every page. Click it to copy the page title and URL as a Markdown link.
// @author       HiddenGem
// @match        *://*/*
// @grant        GM_notification
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // Top frame only — never run inside iframes.
  if (window.top !== window.self) return;
  // Do not run twice.
  if (document.getElementById('hgf-md-link-btn')) return;

  function notify(text) {
    try {
      if (typeof GM_notification === 'function') {
        GM_notification({ title: 'Markdown Link Copier', text: text });
      }
    } catch (e) {
      // Notifications are best-effort; copying still works without them.
    }
  }

  function flashCopied() {
    var original = button.textContent;
    button.textContent = '✓ Copied!';
    window.setTimeout(function () { button.textContent = original; }, 1500);
  }

  function copyMarkdownLink() {
    var markdown = '[' + document.title + '](' + window.location.href + ')';
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(markdown).then(function () {
        flashCopied();
        notify('Markdown link copied.');
      }, function () {
        notify('Could not copy on this page.');
      });
    } else {
      notify('Clipboard is not available on this page (it needs HTTPS).');
    }
  }

  var button = document.createElement('button');
  button.id = 'hgf-md-link-btn';
  button.type = 'button';
  button.textContent = '⧉ Copy link';
  button.title = 'Copy this page as a Markdown link';
  button.style.position = 'fixed';
  button.style.right = '14px';
  button.style.bottom = '14px';
  button.style.zIndex = '2147483647';
  button.style.padding = '7px 12px';
  button.style.border = '1px solid #00D084';
  button.style.borderRadius = '999px';
  button.style.background = '#0A0F0D';
  button.style.color = '#E8FFF3';
  button.style.font = '13px/1.4 system-ui, sans-serif';
  button.style.cursor = 'pointer';
  button.style.opacity = '0.85';
  button.addEventListener('click', copyMarkdownLink);
  button.addEventListener('mouseenter', function () { button.style.opacity = '1'; });
  button.addEventListener('mouseleave', function () { button.style.opacity = '0.85'; });

  function mount() {
    (document.body || document.documentElement).appendChild(button);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
