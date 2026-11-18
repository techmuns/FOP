# Munshot — IPO Promoter Wealth Radar (India)

**Liquidity-event intelligence.** We work *backwards* from Indian IPOs to find freshly-wealthy
people worth targeting for wealth management. When a company IPOs (NSE/BSE mainboard + SME), the
prospectus discloses the **promoters**, their **pre/post shareholding %**, and how much they sold
(**Offer-for-Sale**). From that we estimate each promoter's wealth and build a **person-first
prospect hit-list**, gated to a **≥ ₹150 crore** ideal-customer profile.

> IPO disclosures → de-anonymise beneficiaries → estimate wealth → rank the hottest targets.

**Status:** Prompt 1 (foundation + pipeline + shell) and Prompt 2 (full **Hit-List** and
**IPO Explorer** tabs + the full-universe deep-scrape) are done. **Promoter 360** is still a
placeholder — its per-person drill-down is Prompt 3.

---

## Stack

- **React + TypeScript + Vite + Tailwind CSS**, icons via **lucide-react**.
- **Dependency-free SVG chart kit** (no chart library) — ported from the FDC design system and
  re-skinned to a premium wealth palette.
- **npm**. Static `dist/` served by a tiny **Cloudflare Worker** that also exposes one live-price API.
- Scrapers are **free**: `curl` + `cheerio`, with a **Playwright** (headless Chromium) fallback.
  No Firecrawl, no paid APIs, no keys.

## Getting started

```bash
npm install
npm run seed      # scrape REAL data → public/data/*.json (takes a few minutes)
npm run dev       # Vite dev server
npm run build     # type-check + build to dist/
```

The dashboard reads `public/data/{ipos,prospects,meta}.json` at runtime.

## Data pipeline

```
scripts/
  pipeline.mjs            orchestrator — modes: seed | backfill | refresh
  lib/
    http.mjs              curl-based fetch (works via the agent proxy AND on CI) + Playwright fallback
    chittorgarh.mjs       IPO universe (JSON report API) + detail pages (promoters, OFS table, pre/post %)
    screener.mjs          today's promoter holding %, pledged %, market cap
    munshot.mjs           live price + market cap (free, keyless)
    wealth.mjs            wealth + person-aggregation engine (mirror of src/lib/wealth.ts)
```

```bash
npm run seed       # reuse the committed universe + FULL resumable detail scrape + enrich-all
npm run backfill   # crawl the universe fresh + every detail page + enrich-all (GitHub Actions)
npm run refresh    # re-pull live prices + promoter%, pick up new IPOs, recompute (weekly)
node scripts/pipeline.mjs rollup   # fast: recompute prospects/meta from ipos.json (no network)
```

The scrape is **resumable & idempotent**: `ipos.json` is the detail cache, already-scraped IPOs
are skipped, and `ipos.json` is checkpointed mid-run. `prospects.json` keeps **everyone ≥ ₹25 Cr**
(the UI threshold slider filters live); `meta.json` reports counts at ≥50/100/150/250/500 Cr.

### Sources

| Source | What we take | How |
| --- | --- | --- |
| **Chittorgarh** | IPO universe, promoters, pre/post shareholding %, per-seller Offer-for-Sale table, sector, registered state | JSON report API + server-rendered detail pages (immutable once listed → scraped once) |
| **Screener.in** | Today's promoter holding %, pledged %, market cap | Public company page (no login) |
| **Munshot API** | Live price + market cap | `POST https://fastapi.muns.io/stock-data` with the **bare NSE symbol** (no `.NS`); market cap is in rupees → ÷1e7 = ₹ crore. Optional `MUNSHOT_TOKEN` bearer only raises rate limits. |

### Wealth engine (per company, all `*_cr` in ₹ crore)

```
holding_value_cr          = (current_promoter_pct / 100) × market_cap_cr
                            current_promoter_pct: Screener today → fallback Chittorgarh post-issue %
                            market_cap_cr:        Munshot live → Screener → at-offer valuation (flagged)
promoter_ofs_cash_cr      = Σ (OFS rows where the seller is a promoter)         # exact, HIGH confidence
company_promoter_wealth_cr= holding_value_cr + promoter_ofs_cash_cr
```

**Person roll-up** (the hit-list unit): names are normalised (honorifics stripped, case-folded) and
grouped across companies. OFS cash is summed from the exact per-seller table (**HIGH**). Group holding
value is attributed to the named promoter(s) with a confidence flag — **HIGH** (single promoter),
**MEDIUM** (single named group vehicle), **LOW** (split assumed across several). Kept only if estimated
wealth ≥ ₹150 Cr; sorted by OFS cash. Every figure carries provenance (`data_flags`) and a `scraped_at`
stamp — nothing is fabricated; missing figures stay `null`.

### Schemas

`public/data/ipos.json`, `prospects.json`, `meta.json` — see `src/types.ts` for the exact shapes.

## Deploy (Cloudflare) — configure once, auto-deploy forever

The build output is static; a small Worker (`worker/index.js`) serves `dist/` and adds
`POST /api/live-prices` (calls Munshot server-side so no secrets reach the browser).

**One-time setup** so every push auto-deploys (no manual deploys, ever):

1. Cloudflare dashboard → **Workers & Pages → Create → Connect to Git**, pick this repo.
2. Build command **`npm run build`**, output directory **`dist`** (Wrangler config is already in
   `wrangler.jsonc`, incl. the `ASSETS` binding + SPA fallback).
3. Save. From then on, every push to the production branch builds and deploys automatically — and
   because the data refresh workflows commit JSON to the repo, fresh data redeploys itself too.

Local: `npx wrangler dev` (serves the Worker + built assets) or `npx wrangler deploy`.

## GitHub Actions

- **`.github/workflows/ipo-backfill.yml`** — manual (`workflow_dispatch`); full detail-page backfill
  across the 3-year universe; commits `ipos.json` + `prospects.json` + `meta.json`.
- **`.github/workflows/refresh.yml`** — weekly cron + manual; re-pulls live prices + promoter %,
  recomputes wealth, picks up new IPOs, commits.

Both mirror a checkout → setup-node 22 → `npm ci` → scrape → commit-if-changed pattern (no `[skip ci]`,
so Cloudflare redeploys).

## Tabs

1. **Hit-List** (`Target`) — the money screen. A **wealth-threshold slider + preset chips**
   (₹50/100/150/250/500 Cr) that everything reacts to live; 4 stat tiles; a Top-20 hero bar chart;
   filters (exchange / sector / state / year / took-OFS / confidence / search); the sortable core
   table (person · companies · est. wealth · OFS · holding · city/state · sector · pledge ·
   confidence); and **Export to Excel** (client-side `.xlsx`, lazy-loaded SheetJS). Row click → Promoter 360.
2. **IPO Explorer** (`Rocket`) — the evidence layer. Sub-tabs All/Mainboard/SME + year + search;
   three charts (IPOs/month stacked mainboard-vs-SME, fresh-vs-OFS by year, wealth-by-sector donut);
   and the full IPO table with an in-cell fresh/OFS split bar. Row click → the lead promoter's 360.
3. **Promoter 360** (`UserSearch`) — **placeholder** (Prompt 3). It already receives the focused
   person from a row click and shows a bridge card; the full per-person drill-down is next.
