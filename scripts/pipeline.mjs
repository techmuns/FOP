/**
 * Munshot data pipeline — builds public/data/{ipos,prospects,meta}.json.
 *
 *   node scripts/pipeline.mjs seed      # reuse the committed universe, FULL resumable detail scrape + enrich-all
 *   node scripts/pipeline.mjs backfill  # crawl the universe fresh + FULL detail scrape + enrich-all (GitHub Actions)
 *   node scripts/pipeline.mjs refresh   # re-pull live prices + promoter%, pick up new IPOs, recompute (weekly)
 *
 * Resumable & idempotent: existing ipos.json is the detail cache — IPOs already deep-scraped are
 * skipped, and ipos.json is checkpointed during the run so an interrupted run resumes where it left off.
 *
 * Sources: Chittorgarh (universe + promoter/OFS), Screener.in (today's promoter%/pledge/mcap),
 * Munshot API (live price/mcap). All FREE. Nothing is fabricated — missing figures stay null
 * and every record carries provenance flags + a scraped_at stamp.
 *
 * Env knobs: SKIP_CRAWL=1, FORCE_CRAWL=1, MAX_DETAILS=n, ENRICH_CAP=n, POLITE_MS=ms, CHECKPOINT=n,
 *            MB_PAGES=n, SME_PAGES=n, MUNSHOT_TOKEN=...
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowISO, sleep, closePlaywright } from './lib/http.mjs';
import { collectUniverse, scrapeDetail } from './lib/chittorgarh.mjs';
import { fetchScreener } from './lib/screener.mjs';
import { fetchForTicker } from './lib/munshot.mjs';
import { computeCompanyWealth, rollUpProspects } from './lib/wealth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const IPOS_PATH = path.join(DATA, 'ipos.json');
const MODE = (process.argv[2] || 'seed').toLowerCase();

const FLOOR_CR = 25; // keep every promoter worth ≥ ₹25 Cr in prospects.json
const QUALIFY_CR = 150; // the ideal-customer convenience flag
const THRESHOLDS = [25, 50, 100, 150, 250, 500];
const TARGET_YEARS = [2023, 2024, 2025, 2026];

const envInt = (k, d) => (process.env[k] != null && process.env[k] !== '' ? parseInt(process.env[k], 10) : d);
const POLITE_MS = envInt('POLITE_MS', 800);
const CHECKPOINT = envInt('CHECKPOINT', 25);
const log = (m) => console.log(m);

const isSme = (i) => String(i.exchange).includes('SME');
const isListed = (i) => !i.listing_date || new Date(i.listing_date).getTime() <= Date.now();
const needsDetail = (i) => !i.data_flags || i.data_flags.detail === 'list-only';
const inTargetYears = (row) => {
  if (!row.listing_date) return true;
  const y = new Date(row.listing_date).getUTCFullYear();
  return TARGET_YEARS.includes(y) || y > TARGET_YEARS[TARGET_YEARS.length - 1];
};

function buildPlan(mode) {
  const mb = envInt('MB_PAGES', 400);
  const sme = envInt('SME_PAGES', 400);
  const step = (segment, maxPages) => (fy) => ({ segment, fy, maxPages });
  const fys = mode === 'refresh' ? ['2026-27', '2025-26'] : ['2026-27', '2025-26', '2024-25', '2023-24', '2022-23'];
  return [...fys.map(step('mainboard', mb)), ...fys.map(step('sme', sme))];
}

function listRowToIpo(row) {
  return {
    id: row.id,
    company: row.company,
    ticker: null,
    exchange: row.exchange,
    listing_date: row.listing_date,
    issue_price_low: row.issue_price_low,
    issue_price_high: row.issue_price_high,
    issue_size_cr: row.issue_size_cr,
    fresh_cr: row.fresh_cr,
    ofs_cr: row.ofs_cr,
    pre_promoter_pct: null,
    post_promoter_pct: null,
    current_promoter_pct: null,
    pledge_pct: null,
    market_cap_cr: null,
    offer_market_cap_cr: null,
    sector: null,
    city: null,
    state: null,
    promoters: [],
    holding_value_cr: null,
    promoter_ofs_cash_cr: null,
    company_promoter_wealth_cr: null,
    source_url: row.source_url,
    scraped_at: nowISO(),
    data_flags: { detail: 'list-only' },
  };
}

/** Reconstruct a list "row" (what scrapeDetail needs) from a stored IPO record. */
function toRow(ipo) {
  const m = String(ipo.source_url || '').match(/\/ipo\/([a-z0-9-]+)\/(\d+)\//i);
  return {
    id: ipo.id,
    slug: m ? m[1] : ipo.id,
    company: ipo.company,
    exchange: ipo.exchange,
    listing_date: ipo.listing_date,
    issue_price_low: ipo.issue_price_low,
    issue_price_high: ipo.issue_price_high,
    issue_size_cr: ipo.issue_size_cr,
    fresh_cr: ipo.fresh_cr,
    ofs_cr: ipo.ofs_cr,
    source_url: ipo.source_url,
  };
}

/** Enrich one listed IPO with live price (Munshot) + promoter%/pledge/mcap (Screener). */
async function enrich(ipo, { provenance }) {
  if (!ipo.ticker || !isListed(ipo)) return;
  const scr = await fetchScreener([ipo.ticker], { politeMs: POLITE_MS, log }).catch(() => null);
  if (scr) {
    provenance.screener++;
    if (scr.promoterPct != null) {
      ipo.current_promoter_pct = scr.promoterPct;
      ipo.data_flags.current_promoter_pct = 'screener';
    }
    if (scr.pledgePct != null) {
      ipo.pledge_pct = scr.pledgePct;
      ipo.data_flags.pledge_pct = 'screener';
    }
    if (scr.marketCapCr != null) {
      ipo.market_cap_cr = scr.marketCapCr;
      ipo.data_flags.market_cap = 'screener';
    }
  }
  const mun = await fetchForTicker(ipo.ticker, { politeMs: 0, log }).catch(() => null);
  if (mun) {
    provenance.munshot++;
    if (mun.currentPrice != null) ipo.current_price = mun.currentPrice;
    if (mun.marketCapCr != null) {
      ipo.market_cap_cr = mun.marketCapCr;
      ipo.data_flags.market_cap = 'munshot-live';
    }
  } else {
    provenance.munshotFail++;
  }
  // last-resort market cap: the at-offer valuation from the prospectus (clearly flagged)
  if (ipo.market_cap_cr == null && ipo.offer_market_cap_cr != null) {
    ipo.market_cap_cr = ipo.offer_market_cap_cr;
    ipo.data_flags.market_cap = 'offer';
  }
  await sleep(POLITE_MS);
}

function writeIpos(ipos) {
  mkdirSync(DATA, { recursive: true });
  ipos.forEach(computeCompanyWealth);
  writeFileSync(IPOS_PATH, JSON.stringify(ipos, null, 2));
}

function writeAll(ipos, prospects, meta) {
  writeIpos(ipos);
  writeFileSync(path.join(DATA, 'prospects.json'), JSON.stringify(prospects, null, 2));
  writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify(meta, null, 2));
}

async function run() {
  const started = Date.now();
  log(`\n▶ Munshot pipeline — mode=${MODE}\n`);
  const provenance = { screener: 0, munshot: 0, munshotFail: 0, detailOk: 0, detailFail: 0 };
  const blocked = [];

  // ---- load existing (universe base + resumable detail cache) ----
  const existing = existsSync(IPOS_PATH) ? JSON.parse(readFileSync(IPOS_PATH, 'utf8')) : [];
  const byId = new Map(existing.map((i) => [i.id, i]));

  // ---- 1. universe ----
  const skipCrawl = process.env.FORCE_CRAWL === '1' ? false : process.env.SKIP_CRAWL === '1' || MODE === 'rollup' || (MODE === 'seed' && existing.length > 0);
  if (skipCrawl && existing.length) {
    log(`① Universe: reusing ${existing.length} IPOs from ipos.json (FORCE_CRAWL=1 to re-crawl)\n`);
  } else {
    log('① Collecting IPO universe from Chittorgarh…');
    const { rows, perSegment } = await collectUniverse({ plan: buildPlan(MODE), politeMs: POLITE_MS, log });
    let added = 0;
    for (const row of rows.filter(inTargetYears)) {
      if (!byId.has(row.id)) {
        byId.set(row.id, listRowToIpo(row));
        added++;
      }
    }
    log(`   universe now ${byId.size} IPOs (+${added} new; ${perSegment.mainboard || 0} mb / ${perSegment.sme || 0} sme rows fetched)\n`);
  }

  // ---- 2. detail scrape (resumable, prioritised mainboard + largest SME first) ----
  // refresh only picks up a handful of newly-listed IPOs; seed/backfill do every missing one.
  const MAX_DETAILS = envInt('MAX_DETAILS', MODE === 'refresh' ? 120 : Number.MAX_SAFE_INTEGER);
  const need = [...byId.values()].filter(needsDetail).sort((a, b) => {
    const sa = isSme(a) ? 1 : 0;
    const sb = isSme(b) ? 1 : 0;
    if (sa !== sb) return sa - sb; // mainboard first
    return (b.issue_size_cr || 0) - (a.issue_size_cr || 0); // then largest issue
  });
  const targets = MODE === 'rollup' ? [] : need.slice(0, MAX_DETAILS);
  log(`② Detail scrape: ${need.length} missing, doing ${targets.length} (${byId.size - need.length} already cached)…`);
  let done = 0;
  for (const ipo of targets) {
    const rec = await scrapeDetail(toRow(ipo), { politeMs: POLITE_MS, log });
    if (rec) {
      byId.set(rec.id, rec);
      provenance.detailOk++;
    } else {
      provenance.detailFail++;
    }
    if (++done % CHECKPOINT === 0) {
      writeIpos([...byId.values()]);
      log(`   … ${done}/${targets.length} (ok=${provenance.detailOk} fail=${provenance.detailFail}) [checkpoint]`);
    }
  }
  log(`   detail ok=${provenance.detailOk} fail=${provenance.detailFail}\n`);

  // ---- 3. enrich ALL listed tickers (Screener + Munshot) ----
  const ENRICH_CAP = envInt('ENRICH_CAP', Number.MAX_SAFE_INTEGER);
  let toEnrich = MODE === 'rollup' ? [] : [...byId.values()].filter((i) => i.ticker && isListed(i));
  toEnrich.sort((a, b) => (Date.parse(b.listing_date || 0) || 0) - (Date.parse(a.listing_date || 0) || 0));
  if (toEnrich.length > ENRICH_CAP) toEnrich = toEnrich.slice(0, ENRICH_CAP);
  log(`③ Enriching ${toEnrich.length} listed tickers (Screener + Munshot live)…`);
  let en = 0;
  for (const ipo of toEnrich) {
    await enrich(ipo, { provenance });
    if (++en % CHECKPOINT === 0) {
      writeIpos([...byId.values()]);
      log(`   … enriched ${en}/${toEnrich.length} (screener=${provenance.screener} munshot=${provenance.munshot} munshotFail=${provenance.munshotFail})`);
    }
  }
  if (provenance.munshot === 0 && provenance.munshotFail > 0) blocked.push('Munshot live API (HTTP 502 / intermittently unreachable)');
  log(`   screener hits=${provenance.screener} · munshot hits=${provenance.munshot} (fail=${provenance.munshotFail})\n`);

  // ---- 4. wealth + prospects (floor ₹25 Cr, no ₹150 pre-filter) ----
  const ipos = [...byId.values()];
  ipos.forEach(computeCompanyWealth);
  const prospects = rollUpProspects(ipos, { floorCr: FLOOR_CR, qualifyCr: QUALIFY_CR });
  const thresholds = Object.fromEntries(THRESHOLDS.map((t) => [String(t), prospects.filter((p) => p.est_wealth_cr >= t).length]));
  log(`④ Wealth engine: ${prospects.length} prospects (≥₹${FLOOR_CR} Cr). Qualifying ≥₹150 Cr: ${thresholds['150']}\n`);

  // ---- 5. meta + provenance ----
  const detailedTotal = ipos.filter((i) => !needsDetail(i)).length;
  const withMcap = ipos.filter((i) => i.market_cap_cr != null).length;
  // provenance derived from the data itself (accurate regardless of mode / this run)
  const screenerCount = ipos.filter((i) => i.data_flags && (i.data_flags.market_cap === 'screener' || i.data_flags.current_promoter_pct === 'screener')).length;
  const munshotCount = ipos.filter((i) => i.data_flags && i.data_flags.market_cap === 'munshot-live').length;
  const real = [];
  if (detailedTotal > 0) real.push(`Chittorgarh promoter/OFS disclosures (${detailedTotal} detail pages)`);
  if (screenerCount > 0) real.push(`Screener.in promoter% / pledge / market cap (${screenerCount} companies)`);
  if (munshotCount > 0) real.push(`Munshot live price / market cap (${munshotCount} tickers)`);

  const meta = {
    generated_at: nowISO(),
    mode: MODE,
    universe: {
      mainboard: ipos.filter((i) => !isSme(i)).length,
      sme: ipos.filter((i) => isSme(i)).length,
      years: TARGET_YEARS,
    },
    counts: {
      ipos: ipos.length,
      ipos_detailed: detailedTotal,
      prospects: prospects.length,
      qualifying: thresholds['150'],
      thresholds,
    },
    data_sources: [
      { name: 'Chittorgarh', url: 'https://www.chittorgarh.com', status: detailedTotal > 0 ? 'real' : 'partial', note: 'IPO universe, promoters, pre/post shareholding %, Offer-for-Sale per-seller table' },
      { name: 'Screener.in', url: 'https://www.screener.in', status: screenerCount > 0 ? 'real' : 'blocked', note: "Today's promoter holding %, pledged %, market cap" },
      { name: 'Munshot API', url: 'https://fastapi.muns.io/stock-data', status: munshotCount > 0 ? 'real' : 'blocked', note: 'Live price & market cap (bare NSE symbol)' },
    ],
    seeding: {
      mode: MODE,
      real,
      blocked: [...new Set(blocked)],
      notes: [
        `${detailedTotal}/${ipos.length} IPOs deep-scraped for promoter/OFS; ${ipos.length - detailedTotal} list-level only (the backfill Action finishes the rest).`,
        `${withMcap} IPOs have a market cap (munshot-live / screener / at-offer — see each record's data_flags).`,
        `prospects.json keeps everyone ≥ ₹${FLOOR_CR} Cr; the UI threshold slider filters live.`,
      ],
    },
    took_seconds: Math.round((Date.now() - started) / 1000),
  };

  writeAll(ipos, prospects, meta);

  log('✓ wrote public/data/ipos.json, prospects.json, meta.json');
  log(`  IPOs: ${meta.counts.ipos} (detailed ${detailedTotal}) · prospects ≥₹25Cr: ${prospects.length}`);
  log(`  thresholds: ${THRESHOLDS.map((t) => `≥${t}:${thresholds[t]}`).join('  ')}`);
  log(`  real: ${real.join('; ') || '(none)'}`);
  log(`  blocked: ${meta.seeding.blocked.join('; ') || '(none)'}`);
  log(`  took ${meta.took_seconds}s`);
}

run()
  .catch((e) => {
    console.error('\n✗ pipeline failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePlaywright();
  });
