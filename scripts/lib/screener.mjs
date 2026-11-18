/**
 * Screener.in — today's promoter holding %, pledged %, and market cap for a LISTED
 * company. Public page, no login: the figures are in the server HTML
 * (e.g. "Market Cap ₹ 18,43,267 Cr." and a "Promoters" row in the shareholding table).
 * Tries the consolidated variant too. Never fabricates — a missing figure stays null.
 */
import { fetchText, toNum, stripTags, sleep } from './http.mjs';

function topRatio(html, label) {
  const sec = (html.match(/id="top-ratios"[\s\S]*?<\/ul>/) || [''])[0];
  for (const li of sec.match(/<li[\s\S]*?<\/li>/g) || []) {
    const t = stripTags(li);
    const re = new RegExp('^\\s*' + label + '\\s*₹?\\s*([0-9][0-9,.]*)', 'i');
    const m = t.match(re);
    if (m) return toNum(m[1]);
  }
  return null;
}

/** Latest (most recent quarter = last column) value of a shareholding row matching labelRe. */
function shareholdingLatest(html, labelRe) {
  const sec = (html.match(/id="shareholding"[\s\S]*?<\/section>/) || [''])[0];
  for (const tr of sec.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const cells = (tr.match(/<td[\s\S]*?<\/td>/g) || []).map(stripTags);
    if (!cells.length || !labelRe.test(cells[0])) continue;
    for (let i = cells.length - 1; i >= 1; i--) {
      const n = toNum(cells[i]);
      if (n != null) return n;
    }
  }
  return null;
}

function parseScreener(html, url, basis) {
  const marketCapCr = topRatio(html, 'Market Cap'); // already in ₹ crore
  const currentPrice = topRatio(html, 'Current Price');
  const promoterPct = shareholdingLatest(html, /Promoter/i);
  const pledgePct = shareholdingLatest(html, /Pledge/i);
  if (marketCapCr == null && promoterPct == null) return null; // not a real company page
  return { marketCapCr, currentPrice, promoterPct, pledgePct, url, basis };
}

/** Resolve a company on Screener by its candidate symbols. Returns the best hit or null. */
export async function fetchScreener(symbols, { politeMs = 1100, log = () => {} } = {}) {
  const tried = [];
  for (const sym of symbols.filter(Boolean)) {
    for (const variant of ['consolidated/', '']) {
      const url = `https://www.screener.in/company/${encodeURIComponent(sym)}/${variant}`;
      tried.push(url);
      let html;
      try {
        html = await fetchText(url, { label: `screener ${sym}`, timeout: 30, retries: 2 });
      } catch {
        continue;
      } finally {
        if (politeMs) await sleep(politeMs);
      }
      const parsed = parseScreener(html, url, variant ? 'consolidated' : 'standalone');
      if (parsed) {
        log(`   ✓ screener ${sym} (${parsed.basis}): promoter ${parsed.promoterPct ?? '—'}% · pledge ${parsed.pledgePct ?? '—'}% · mcap ₹${parsed.marketCapCr ?? '—'} Cr`);
        return parsed;
      }
    }
  }
  log(`   ✗ screener: no page for ${symbols.filter(Boolean).join('/') || '(no symbol)'}`);
  return null;
}
