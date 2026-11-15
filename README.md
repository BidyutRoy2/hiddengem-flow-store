<p align="center">
  <img src="https://raw.githubusercontent.com/BidyutRoy2/hiddengem-flow/main/logo-v2-wordmark.png" alt="HiddenGem Flow" width="480">
</p>

<p align="center">
  <a href="https://github.com/BidyutRoy2/hiddengem-flow"><img src="https://img.shields.io/badge/Official%20Script%20Store-HiddenGem%20Flow-00D084" alt="Official Script Store — HiddenGem Flow"></a>
  <img src="https://img.shields.io/badge/Extension-Chrome%20MV3-FFC24B" alt="Extension: Chrome MV3">
  <img src="https://img.shields.io/badge/Installs-Never%20automatic-12181A" alt="Installs: never automatic">
</p>

# HiddenGem Flow — Official Script Store

This repo is the official script store for the
[HiddenGem Flow](https://github.com/BidyutRoy2/hiddengem-flow) Chrome
extension. Every script listed here appears in the extension's **Script
Store** tab — and nowhere else. There is no website, no account, and no
tracking: just scripts and an index.

**How the extension reads this store**

- Only when you click **Load store** in the extension — never automatically
  when the dashboard opens.
- It fetches `index.json` from `raw.githubusercontent.com` first, with
  jsDelivr as a fallback. A fetched list is saved as a cached copy, so the
  Smart Notification Bridge can check it later without any network request.
- Nothing here installs itself. Every install needs your confirm first,
  after a security scan (0–100 + A–F grade). Installing is always your
  choice; the store only lists.

> **A note on freshness:** after a script is published, upgraded, or
> deleted, a fresh **Load store** can still show the previous list for a
> few minutes — `raw.githubusercontent.com` caches each copy for about
> 5 minutes. Reload **Load store** again after a short wait and the new
> list appears. Deleting a script removes it from this store; anyone who
> already installed it keeps their local copy.

---

## Scripts

*Current as of 15 November 2026 — `index.json` is the source of truth.*

| Script | Version | Runs on | What it does |
| --- | --- | --- | --- |
| [Titan Exchange Auto Trader Pro by HiddenGem](scripts/titan-exchange-auto-trader-pro-by-hiddengem.user.js) | 2.0 | `https://testnet.titanx.cc/trade/*` | Automated trading loop with anti-ban evasion, draggable & minimizable UI, auto faucet claim, safety locks. |
| [Universal DOM Diagnostic v2.0 — TM Only](scripts/universal-dom-diagnostic-v2-0-tm-only.user.js) | 2.0.0 | `*://*/*` | Read-only UI scanner for websites — 30+ diagnostic rules, score, Baseline Diff, hidden-iframe crawler, performance + console capture, overlay, custom rules. Tampermonkey only: no Playwright, no GitHub Actions, no server, no network calls. |
| [9Chain Virtual Node Auto](scripts/9chain-virtual-node-auto.user.js) | 2.0.0 | `https://www.9chain.com/virtual-node` and `https://www.9chain.com/virtual-node/*` | Auto Tap to Earn + Daily Gift + Node Tier & Module Upgrades (CPU/RAM/Anti-Sybil/Firewall/Peer/Relay/Consensus/Sharding). |

---

## How to install a script

For anyone using the HiddenGem Flow extension:

1. Open the extension Dashboard → **Script Store** tab.
2. Click **Load store**.
3. Find the script, click **Install** — the extension scans it first
   (0–100 score + A–F grade) and shows what it found.
4. Click **Confirm** to install. Nothing installs without that confirm.

To let an installed script actually run, two grants are needed in the
browser: **Allow User Scripts** on the extension's Details page, and
**Grant site access** on the script (the extension asks with Chrome's own
prompt). Without them, a script is installed but never runs — silently.

---

## How to publish a script

There are two ways. The publisher page is the easy one; publishing by
hand is the fallback when you have no token.

### Method A — The private publisher page (recommended)

The publisher lives in the extension repo, as one standalone file:

**[`tools/store-uploader.html`](https://github.com/BidyutRoy2/hiddengem-flow/blob/main/tools/store-uploader.html)**

Download that file to your own computer and double-click it. It runs
entirely on your machine — no server, no account, no install. Your
browser talks directly to `api.github.com`; nothing goes through any
server of ours.

**1. Create a token (once)**

The page cannot create a token — you make it on GitHub:

1. GitHub → your avatar → **Settings** → **Developer settings** →
   **Personal access tokens** → **Fine-grained tokens** →
   **Generate new token**.
2. Token name, e.g. `HiddenGem Flow Store Uploader`. Expiration: 90 days
   is a sane default.
3. **Repository access** → **Only select repositories** → choose
   `hiddengem-flow-store` (and nothing else).
4. **Permissions** → **Repository permissions** → **Contents** →
   **Read and write**. Nothing else is needed — do not add other
   permissions.
5. **Generate token**, copy it once, paste it into the page, then click
   **Test connection**. A working token is saved in that browser's
   localStorage only; **Forget token** deletes it.

> **Token safety:** the token is sent only to `api.github.com`, in the
> `Authorization` header — never in a URL, never to any other host, never
> written into the page file, and never sent in chat. It can only do what
> its Contents permission allows, on the one repo you picked. You can
> revoke it any time in GitHub → Settings → Developer settings →
> Personal access tokens. The page is safest kept as a local file on your
> own computer.

**2. Publish a new script**

1. Open the **New Script** tab.
2. Fill in **Name**, **Description**, **Version**, and **@match** (the
   sites the script runs on).
3. Paste the script code, or pick the `.user.js` file — **Import** reads
   the `==UserScript==` block and fills the form for you.
4. Click **Publish**. The page uploads the `.user.js` file to `scripts/`,
   adds its entry to `index.json`, and clears the jsDelivr cache for both
   files. The script then appears in the extension's Script Store.

**3. Upgrade or delete a published script**

Open the **Live Scripts** tab and click **Load live scripts**:

- **Upgrade this script…** — loads the script's current file into the
  upgrade form and suggests the next version (e.g. `1.0.1`). Publish the
  upgrade the same way; the original publish date is kept.
- **Delete** — two clicks: the first arms it (the button turns red and
  shows **Confirm delete**), the second deletes. It removes the entry
  from `index.json` first, then deletes the file from `scripts/`, then
  clears the jsDelivr cache for both. A delete needs the token — there is
  no download-based delete — and it only stops the store listing it;
  anyone who already installed the script keeps their local copy.

If anything goes wrong, the page says so plainly — a failed publish or
delete changes nothing, and the error names what happened.

### Method B — Publish by hand (no token)

Without a token you can still publish, one commit at a time:

1. Add the `.user.js` file under `scripts/`.
2. Add one entry to `index.json` (see [Entry format](#entry-format)).
3. Commit and push to `main`.

The extension will list the script on the next **Load store** (after the
few-minutes cache note above). Clearing the jsDelivr cache is optional —
the extension reads `raw.githubusercontent.com` first.

---

## Entry format

Each entry in `index.json` needs `name`, `version`, and code — either a
`codeUrl` (http/https) or inline `code`. Dates use `YYYY-MM-DD`; never
invent them — leave them out when unknown and the extension shows
"Date not listed".

```json
{
  "name": "My Script",
  "version": "1.0.0",
  "author": "HiddenGem",
  "description": "What the script does, in one or two lines.",
  "matches": ["https://example.com/*"],
  "codeUrl": "https://raw.githubusercontent.com/BidyutRoy2/hiddengem-flow-store/main/scripts/my-script.user.js",
  "publishedAt": "2026-11-15",
  "updatedAt": "2026-11-15"
}
```

Optional fields: `downloadURL`, `updateURL`, `homepage`. `codeUrl` should
always point at the file in this repo, under `scripts/`.

**What a script needs to be listed**

- It must be a JavaScript userscript with a `==UserScript==` block,
  including `name`, `version`, and at least one `@match`.
- Only JavaScript userscripts can run in a browser page. A file in
  another language can be stored here, but the extension will not list
  it as installable.
- The extension scans every script before install (0–100 + A–F grade)
  and flags risky patterns. The scan warns — it never silently blocks,
  and install always needs your confirm.

---

## Repository layout

```text
hiddengem-flow-store/
├── index.json            # The store index — everything the extension lists
├── scripts/              # One .user.js file per published script
│   ├── titan-exchange-auto-trader-pro-by-hiddengem.user.js
│   ├── universal-dom-diagnostic-v2-0-tm-only.user.js
│   └── 9chain-virtual-node-auto.user.js
└── README.md             # This file
```

---

## License

No single license covers this store. Each script is governed by its own
header and license — check the `==UserScript==` block and the file itself
before reusing it.

---

## Links

- **HiddenGem Flow extension** —
  [BidyutRoy2/hiddengem-flow](https://github.com/BidyutRoy2/hiddengem-flow)
  (the extension, the publisher page, and the install guide)
- **Problems with a script in this store?** — open an issue in this repo.
  Problems with the extension itself belong in the extension repo.
