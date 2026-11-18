/**
 * Munshot market-data API — FREE, public, no key. Live price + market cap.
 *   POST https://fastapi.muns.io/stock-data
 *   body { ticker_symbol: "<BARE NSE SYMBOL>", type: "stockquote", country: "India" }
 *   response is a "Key=Value,Key=Value,…" string (usually JSON-quoted).
 *
 * IMPORTANT (verified live): the API wants the BARE symbol — appending ".NS"/".BO"
 * returns HTTP 404; the plain symbol returns 200. Market Cap is in RUPEES → /1e7 = ₹ crore.
 * Optional: set env MUNSHOT_TOKEN to send `Authorization: Bearer …` (only raises rate limits).
 */
import { curlRaw, toNum, round, sleep } from './http.mjs';

const API = 'https://fastapi.muns.io/stock-data';

export function parseKv(str) {
  const o = {};
  for (const pair of String(str).split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) o[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return o;
}

/** Parse the API's response body into { currentPrice, marketCapCr } or null. */
export function parseQuote(text) {
  let s = String(text || '').trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      s = JSON.parse(s);
    } catch {
      /* keep raw */
    }
  }
  if (s.startsWith('{') || s.startsWith('[')) return null; // error / validation payload
  const kv = parseKv(s);
  if (kv['Current Price'] == null && kv['Market Cap'] == null) return null;
  const currentPrice = toNum(kv['Current Price']);
  const mcapRaw = toNum(kv['Market Cap']);
  // Munshot returns market cap in raw rupees → ₹ crore.
  const marketCapCr = mcapRaw == null ? null : round(mcapRaw / 1e7);
  return { currentPrice, marketCapCr };
}

export async function fetchQuote(symbol, { timeout = 35, retries = 2 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.MUNSHOT_TOKEN) headers.Authorization = `Bearer ${process.env.MUNSHOT_TOKEN}`;
  const { status, body } = await curlRaw(API, {
    method: 'POST',
    headers,
    body: { ticker_symbol: symbol, type: 'stockquote', country: 'India' },
    timeout,
    retries,
    label: `munshot ${symbol}`,
  });
  if (status >= 400 || status === 0) return { ok: false, status, symbol };
  const q = parseQuote(body);
  if (!q) return { ok: false, status, symbol, note: 'empty/unparseable' };
  return { ok: true, status, symbol, ...q };
}

/** Query Munshot with the BARE symbol (strip any .NS/.BO). Returns a live quote or null. */
export async function fetchForTicker(ticker, { log = () => {}, ...opts } = {}) {
  if (!ticker) return null;
  const bare = String(ticker).replace(/\.(NS|BO)$/i, '').trim();
  if (!bare) return null;
  const r = await fetchQuote(bare, opts);
  if (r.ok && (r.currentPrice != null || r.marketCapCr != null)) {
    log(`   ✓ munshot ${bare}: ₹${r.currentPrice ?? '—'} · mcap ₹${r.marketCapCr ?? '—'} Cr`);
    return r;
  }
  log(`   ✗ munshot ${bare}: no quote (HTTP ${r.status ?? '?'})`);
  return null;
}
