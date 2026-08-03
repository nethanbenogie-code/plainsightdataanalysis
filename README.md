# Plainsight Data analysis

**Your numbers, explained in plain English. No formulas, no SQL.**

Drop in a CSV of your sales and get a readable summary: totals, month-by-month
trend, breakdown by product or region, and a plain-English readout of what's
growing, what's slipping, and what to check next.

Built for small business owners working from Square, Shopify, QuickBooks, or
plain spreadsheet exports — not for analysts. There is nothing to configure to
get charts, and nothing is uploaded to read your file.

<!-- Add a screenshot here — e.g. docs/screenshot.png — it's the single biggest
     thing a GitHub reader wants and this README doesn't have one yet. -->

---

## Which version do I want?

Three builds share the same analysis engine but differ in where the AI runs.
Pick by what you're willing to set up:

| | [`plainsight.html`](plainsight.html) | [`extension/`](extension/) | [`plainsight.jsx`](plainsight.jsx) |
|---|---|---|---|
| **Setup** | Open the file | Load unpacked in Chrome | `npm install && npm run dev` |
| **AI runs on** | Claude, **or your machine** | Claude (hosted) | Your machine |
| **Local models (Ollama / LM Studio)** | **Yes** | No | Yes |
| **Needs an API key** | No | **Yes** — your own | No |
| **Works with no AI at all** | Yes — copy/paste into a chat | Charts + export only | Charts + export only |
| **Best for** | Everything, honestly | Daily use in the browser | Existing React projects |

**Start with `plainsight.html`.** Double-click it. Click *Try sample data*. It is
the only build that does all three: hosted AI, local models, and clipboard
hand-off — with no toolchain.

---

## Quick start

### Standalone page

```bash
# no install, no build, no server
start plainsight.html          # Windows
open plainsight.html           # macOS
```

Charts, column pickers, and CSV export work immediately.

For the AI readout there are two paths. Inside Claude, *Explain my data* calls
the API directly. Everywhere else — including a local file — use **Copy prompt
for Claude**, which puts a readable, aggregate-only prompt on your clipboard to
paste into any chat:

```
I run a small business and I'm trying to understand my numbers. Below is a
summary of my data — aggregate totals only, no individual transactions.

Metric: revenue
Total: 55,950
Latest month vs the month before: +11.4%
Best month: 2025-12 (6,140)
...
```

Two buttons: one for the general readout, one that appends your typed question.
The panel shows exactly what was copied before you paste it anywhere.

**Or run the analysis on your own machine.** The header has a settings control
showing the current analyst:

```
● Ollama · llama3.1:8b  ▼      [Export CSV] [Print report] [Load a different file]
```

Click it to pick between **Claude (in-app)**, **Ollama**, and **LM Studio**, set
the server address, choose a model, and adjust the timeout. Your choice persists
across reloads, and the page probes for a running local server on load — see
[Local models](#local-models) below.

### Browser extension

Manifest V3, for Chrome / Edge / Brave. Full instructions in
[`extension/README.md`](extension/README.md).

```
chrome://extensions → Developer mode → Load unpacked → select extension/
```

Needs **your own Anthropic API key**, entered on the options page — an extension
has no proxy in front of it, so the keyless call the hosted build relies on
doesn't work here. Charts and export still work without a key.

### React build

```bash
npm install
npm run dev          # http://localhost:5173
```

Also `npm run build` (outputs to `dist/`) and `npm run preview` to serve the
production build. Requires Node 18+. Same app as the standalone page, rendered
by React with Recharts instead of Chart.js.

### Local models

Supported by **`plainsight.html`** (no build needed) and `plainsight.jsx`. The
browser talks to a model server on `localhost` — **nothing leaves your machine**.

| Provider | Default | Start it with |
|---|---|---|
| [Ollama](https://ollama.com) | `http://localhost:11434` | `ollama serve` then `ollama pull llama3.1` |
| [LM Studio](https://lmstudio.ai) | `http://localhost:1234` | Developer tab → load a model → Start Server |

Provider, address, model, and timeout live behind the header settings control
and persist across reloads. The app probes the server on load and lists the
models it finds — for Ollama it asks `/api/show` for each one and hides
embedding-only models, which can't hold a conversation and otherwise get
auto-selected and fail at generation time for no visible reason.

> **Expect local generation to be slow.** An 8B model on CPU took **~80 seconds**
> for the full insights readout in testing. The default timeout is 120s; raise it
> in settings if you're on a bigger model or slower hardware.

> ⚠️ **CORS will be your first problem, not the code.** A browser calling
> `localhost` is a cross-origin request that both servers block by default.
> Set `OLLAMA_ORIGINS` to your dev origin (or `*` while developing), or enable
> CORS in LM Studio's server settings. The app's error messages name this
> explicitly, because `fetch` reports "blocked by CORS" and "nothing listening"
> as the same bare `TypeError`.

---

## What it does

- **Column detection** — guesses which columns are dates, numbers, and
  categories, then prefers a money-shaped metric (`revenue`, `amount`, `total`…).
  All three are overridable from dropdowns.
- **Messy-CSV tolerance** — handles `$1,234.50`, `€`, `£`, `₱`, `%`, and
  accounting negatives like `(1,200)` → `-1200`. Blank cells are treated as
  missing, not zero.
- **Charts** — monthly trend and a top-8 category breakdown, labelled
  *(top 8 of 23)* when truncated so a partial view never reads as complete.
- **CSV export** — the summary, the monthly and category tables, and any AI
  insights, in one file.
- **Print** — a clean print stylesheet for a one-page report.

### Privacy

Your CSV is parsed in the browser and **never uploaded**. Only aggregate figures
— monthly totals, category totals, row counts, and your typed question — are
ever sent anywhere, and only when you use an AI feature. The React build sends
those to `localhost`, so nothing leaves the machine at all.

---

## Project structure

```
plainsight.html      standalone single-file app (Chart.js + PapaParse via CDN)
plainsight.jsx       React component — local models via Ollama / LM Studio
main.jsx             React entry point
index.html           Vite entry point
vite.config.js       dev server on :5173, builds to dist/
package.json         React / Recharts / PapaParse + Vite
extension/
  manifest.json      MV3; requests only `storage` + api.anthropic.com
  background.js      service worker — opens the dashboard tab
  dashboard.html/.js the app (markup and logic split; MV3 forbids inline script)
  options.html/.js   API key entry, validation, removal
  vendor/            PapaParse 5.4.1, Chart.js 4.4.1 (vendored — MV3 blocks CDNs)
  icons/             16/32/48/128 PNGs
```

Hosted AI calls use `claude-opus-5`. To switch to a cheaper model, change the
`model:` field — `claude-sonnet-5` handles these prompts well.

---

## Known limitations

Worth knowing before you rely on this:

- **The analysis and provider logic is duplicated across builds.** The same
  `toNum`, `monthKey`, `buildSummary`, and the Ollama/LM Studio adapters live in
  both `plainsight.html` and `plainsight.jsx`. A bug fixed in one does not fix
  the other — **this has already happened twice**, most recently with the
  embedding-model filter. Extracting a shared module is the most valuable next
  change to this repo.
- **The production bundle is ~574 kB** (167 kB gzipped), mostly Recharts. Fine
  for a local tool; worth code-splitting before shipping it anywhere real.
- **The extension is not Chrome Web Store ready.** It needs real icons (the
  current ones are generated placeholders), a privacy policy URL, and
  justification for the host permission.
- **API keys in the extension are stored unencrypted** in `chrome.storage.local`
  — the only storage an extension has. See
  [`extension/README.md`](extension/README.md#privacy-and-the-key-storage-tradeoff)
  for the tradeoff and the backend-proxy alternative.
- **Category charts show the top 8 only.** Labelled, but the AI sees the same
  truncated list.
- **Month-over-month compares the last two months present**, which may not be
  consecutive if your data has gaps.

## Not included yet

There is no `LICENSE`. Worth adding before publishing — without one, nobody can
legally reuse the code. Not added here because the choice is yours (MIT and
Apache-2.0 are the usual defaults).
