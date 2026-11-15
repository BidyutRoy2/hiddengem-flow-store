# HiddenGem Flow — Official Script Store

This repo is the official script store for the
[HiddenGem Flow](https://github.com/BidyutRoy2/hiddengem-flow) Chrome
extension. The extension's **Script Store** tab reads `index.json` from here
(jsDelivr first, raw GitHub as fallback) — only when you click **Load store**.
Nothing is fetched or installed automatically.

## Scripts

| Script | Version | What it does |
| --- | --- | --- |
| [Markdown Link Copier](scripts/markdown-link-copier.user.js) | 1.0.0 | Adds a small button on every page. Click it to copy the page title and URL as a Markdown link. |

## How to publish a script

The private publisher page lives in the extension repo:
[`tools/store-uploader.html`](https://github.com/BidyutRoy2/hiddengem-flow/blob/main/tools/store-uploader.html)
— open it from your computer, no server. It needs a fine-grained Personal
Access Token (Contents read/write on this repo only), publishes the script to
`scripts/`, updates `index.json`, and clears the jsDelivr cache for both files.

Without the token you can still publish by hand: add the `.user.js` file under
`scripts/` and add one entry to `index.json`.

## Entry format

Each entry in `index.json` needs `name`, `version`, and code — either a
`codeUrl` (http/https) or inline `code`. Optional: `author`, `description`,
`matches` (URL patterns), `downloadURL`, `updateURL`, `homepage`,
`publishedAt`, `updatedAt` (dates as `YYYY-MM-DD`; never invented — leave them
out when unknown and the extension shows "Date not listed").

## License

Scripts are published under MIT unless the script's own header says otherwise.
