/**
 * Chittorgarh scraper — the IPO universe + promoter / Offer-for-Sale data.
 *
 * List: a JSON report API (discovered from the site's own client bundle).
 *   https://webnodejs.chittorgarh.com/cloud/report/data-read/82/{page}/{month}/{year}/{FY}/0/{mainboard|sme}/0
 *   5 rows per page; paginate until a short/empty page. Gives company, detail URL,
 *   issue price band, issue size, and the fresh / OFS split per IPO.
 * Detail (/ipo/<slug>/<id>/): server-rendered. We read an embedded structured JSON
 *   (ticker, pre/post promoter %, issue sizes, market cap at offer) via targeted
 *   regex, the per-seller OFS table + valuation table via cheerio, and the
 *   registered-office city/state from the page's JSON-LD PostalAddress.
 *
 * IPO disclosures are immutable once listed, so detail pages are scraped once & cached.
 */
import { load } from 'cheerio';
import { fetchJson, fetchText, sleep, nowISO, stripTags, toNum, toCr } from './http.mjs';

const API = 'https://webnodejs.chittorgarh.com/cloud/report/data-read/82';
const PAGE_SIZE = 5;

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function listUrl(param, fy, page) {
  const year = parseInt(fy.slice(0, 4), 10);
  return `${API}/${page}/11/${year}/${fy}/0/${param}/0?search=&v=1-${page}`;
}

function parseDMY(s) {
  const m = String(s || '').match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m || MON[m[2]] == null) return null;
  return new Date(Date.UTC(+m[3], MON[m[2]], +m[1])).toISOString().slice(0, 10);
}

function priceRange(s) {
  const nums = (String(s || '').match(/[0-9]+(?:\.[0-9]+)?/g) || []).map(Number);
  if (!nums.length) return [null, null];
  return [nums[0], nums[nums.length - 1]];
}

function deriveExchange(param, listingAt) {
  const at = String(listingAt || '').toUpperCase();
  const nse = /NSE|EMERGE/.test(at);
  const bse = /BSE/.test(at);
  if (param === 'sme') return nse ? 'NSE SME' : bse ? 'BSE SME' : 'NSE SME';
  return nse ? 'NSE' : bse ? 'BSE' : 'NSE';
}

function normalizeListRow(r, param) {
  const hm = String(r.Company || '').match(/\/ipo\/([a-z0-9-]+)\/(\d+)\//i);
  if (!hm) return null;
  const [slug, id] = [hm[1], hm[2]];
  const [low, high] = priceRange(r['Issue Price (Rs.)']);
  const listing =
    parseDMY(r['Listing Date']) || (r['~IssueCloseDate'] ? String(r['~IssueCloseDate']).slice(0, 10) : null);
  return {
    id,
    slug,
    company: stripTags(r.Company),
    exchange: deriveExchange(param, r['Listing at']),
    segment: param,
    listing_date: listing,
    issue_price_low: low,
    issue_price_high: high,
    issue_size_cr: toNum(r['Issue Amount (Rs.cr.)']) ?? toNum(r['Total Issue Amount (Incl.Firm reservations) (Rs.cr.)']),
    fresh_cr: toNum(r['Fresh Capital (Rs.cr.)']),
    ofs_cr: toNum(r['Offer for sale (Rs.cr.)']),
    source_url: `https://www.chittorgarh.com/ipo/${slug}/${id}/`,
  };
}

/** Fetch every IPO for one segment + financial year (paginated). */
export async function fetchSegmentYear(param, fy, { maxPages = 300, politeMs = 1100, log = () => {} } = {}) {
  const rows = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    let json;
    try {
      json = await fetchJson(listUrl(param, fy, page), { label: `chittorgarh ${param} ${fy} p${page}`, timeout: 35, retries: 3 });
    } catch (e) {
      log(`   ! ${param} ${fy} p${page}: ${e.message}`);
      break;
    }
    const data = json?.reportTableData || [];
    if (!data.length) break;
    let fresh = 0;
    for (const r of data) {
      const row = normalizeListRow(r, param);
      if (!row || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
      fresh++;
    }
    if (fresh === 0 || data.length < PAGE_SIZE) break;
    await sleep(politeMs);
  }
  return rows;
}

/**
 * Collect the universe from an explicit plan of { segment, fy, maxPages } steps.
 * Returns deduped list rows + per-segment counts.
 */
export async function collectUniverse({ plan, politeMs = 1100, log = () => {} }) {
  const byId = new Map();
  const perSegment = {};
  for (const step of plan) {
    const { segment, fy, maxPages = 300 } = step;
    const rows = await fetchSegmentYear(segment, fy, { maxPages, politeMs, log });
    for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
    perSegment[segment] = (perSegment[segment] || 0) + rows.length;
    log(`   · ${segment} ${fy}: ${rows.length} IPOs`);
  }
  return { rows: [...byId.values()], perSegment };
}

// ---- detail page -----------------------------------------------------------

/** Extract a field from the page's embedded (escaped) JSON. Handles \"key\":value and \"key\":\"value\". */
function escField(html, key) {
  const re = new RegExp('\\\\"' + key + '\\\\":\\s*\\\\?"?(-?[0-9][0-9.]*|[^"\\\\,}]*)');
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function cellMatrix($, t) {
  const rows = [];
  $(t)
    .find('tr')
    .each((_, tr) => {
      const cells = [];
      $(tr)
        .find('th,td')
        .each((__, c) => cells.push(stripTags($.html(c))));
      if (cells.length) rows.push(cells);
    });
  return rows;
}

const BAD_CITY = /near|opp|road|rasta|ashram|floor|plot|survey|lane|marg|nagar no|sector|phase|block|char|behind|beside/i;
function guessCity(locality) {
  if (!locality) return null;
  for (const seg of String(locality).split(',')) {
    const s = seg.trim();
    if (s.length >= 3 && s.length <= 28 && !/\d/.test(s) && !BAD_CITY.test(s)) {
      return s.replace(/\s+/g, ' ');
    }
  }
  return null;
}

export function parseDetailHtml(html) {
  const $ = load(html);
  const tables = [];
  $('table').each((_, t) => {
    const rows = cellMatrix($, t);
    if (rows.length) tables.push(rows);
  });

  // OFS per-seller table: header contains "Shares Offered" + "Name". Column layout varies —
  // some tables omit the "Amount (₹ cr.)" column, so detect columns by header and fall back to
  // shares × issue_price_upper (the task's formula) when no amount is disclosed.
  const ofsTable = tables.find((rows) => rows[0] && /Shares Offered/i.test(rows[0].join(' ')) && /Name/i.test(rows[0].join(' ')));
  const ofsRows = [];
  if (ofsTable) {
    const head = ofsTable[0].map((h) => h.toLowerCase());
    const nameIdx = Math.max(0, head.findIndex((h) => /name/.test(h)));
    const catIdx = head.findIndex((h) => /category/.test(h));
    const shrIdx = head.findIndex((h) => /shares offered/.test(h));
    const amtIdx = head.findIndex((h) => /amount/.test(h));
    for (const row of ofsTable.slice(1)) {
      const name = (row[nameIdx] || '').trim();
      if (!name || /^total$/i.test(name)) continue;
      ofsRows.push({
        name,
        category: (catIdx >= 0 ? row[catIdx] : row[1] || '').trim(),
        shares: toNum(shrIdx >= 0 ? row[shrIdx] : row[2]),
        amtCr: amtIdx >= 0 ? toNum(row[amtIdx]) : null,
      });
    }
  }

  // Market cap at offer price (fallback for holding value): valuation table row.
  let offerMcapCr = null;
  const valTable = tables.find((rows) => rows.some((r) => /Market Cap/i.test(r[0] || '')));
  if (valTable) {
    const r = valTable.find((rr) => /Market Cap/i.test(rr[0] || ''));
    if (r) offerMcapCr = toNum(r[2]) ?? toNum(r[1]);
  }
  if (offerMcapCr == null) offerMcapCr = toNum(escField(html, 'market_cap_pre'));

  // pre/post promoter %
  let pre = toNum(escField(html, 'promoter_shareholding_pre_issue'));
  let post = toNum(escField(html, 'promoter_shareholding_post_issue'));
  if (pre == null || post == null) {
    const shTable = tables.find((rows) => rows.some((r) => /Promoter/i.test(r[0] || '') && /%/.test(r.join(' '))));
    const r = shTable?.find((rr) => /Promoter/i.test(rr[0] || ''));
    if (r) {
      pre = pre ?? toNum(r[1]);
      post = post ?? toNum(r[2]);
    }
  }

  const ticker = (escField(html, 'nse_symbol') || '').trim() || (escField(html, 'bse_scripcode') || '').trim() || null;

  // sector from the "Recently … IPOs in <industry>" heading (read raw, stop at tag)
  let sector = null;
  const sm = html.match(/Recently[^<]{0,30}IPOs?\s+in\s+(?:<[^>]+>\s*)?([^<>]{2,60})/i);
  if (sm) sector = sm[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() || null;

  // registered office city/state from JSON-LD PostalAddress
  let state = null;
  let city = null;
  const stateM = html.match(/"addressRegion"\s*:\s*"([^"]+)"/);
  if (stateM) state = stateM[1].replace(/\s+/g, ' ').trim() || null;
  const locM = html.match(/"addressLocality"\s*:\s*"([^"]+)"/);
  if (locM) city = guessCity(locM[1]);

  const high = toNum(escField(html, 'issue_price_upper'));
  const promoters = ofsRows.map((r) => ({
    name: r.name,
    category: r.category,
    is_promoter: /promoter/i.test(r.category),
    ofs_shares: r.shares,
    ofs_cr: r.amtCr != null ? r.amtCr : r.shares != null && high != null ? Math.round((r.shares * high) / 1e7 * 100) / 100 : null,
  }));

  return {
    ticker: ticker || null,
    issue_price_low: toNum(escField(html, 'issue_price_lower')),
    issue_price_high: high,
    issue_size_cr: toCr(toNum(escField(html, 'issue_size_in_amt'))),
    fresh_cr: toCr(toNum(escField(html, 'issue_size_fresh_in_amt'))),
    ofs_cr: toCr(toNum(escField(html, 'issue_size_ofs_in_amt'))),
    pre_promoter_pct: pre,
    post_promoter_pct: post,
    offer_market_cap_cr: offerMcapCr,
    sector,
    city,
    state,
    promoters,
  };
}

/** Scrape one IPO detail page and merge with its list row into a full IPO record. */
export async function scrapeDetail(row, { politeMs = 1200, log = () => {} } = {}) {
  let html;
  try {
    html = await fetchText(row.source_url, { label: `detail ${row.slug}`, timeout: 45, retries: 3 });
  } catch (e) {
    log(`   ! detail ${row.slug}: ${e.message}`);
    return null;
  }
  const d = parseDetailHtml(html);
  if (politeMs) await sleep(politeMs);
  return {
    id: row.id,
    company: row.company,
    ticker: d.ticker,
    exchange: row.exchange,
    listing_date: row.listing_date,
    issue_price_low: d.issue_price_low ?? row.issue_price_low,
    issue_price_high: d.issue_price_high ?? row.issue_price_high,
    issue_size_cr: d.issue_size_cr ?? row.issue_size_cr,
    fresh_cr: d.fresh_cr ?? row.fresh_cr,
    ofs_cr: d.ofs_cr ?? row.ofs_cr,
    pre_promoter_pct: d.pre_promoter_pct,
    post_promoter_pct: d.post_promoter_pct,
    current_promoter_pct: null,
    pledge_pct: null,
    market_cap_cr: null,
    offer_market_cap_cr: d.offer_market_cap_cr,
    sector: d.sector,
    city: d.city,
    state: d.state,
    promoters: d.promoters,
    holding_value_cr: null,
    promoter_ofs_cash_cr: null,
    company_promoter_wealth_cr: null,
    source_url: row.source_url,
    scraped_at: nowISO(),
    data_flags: {},
  };
}
