/**
 * Munshot market-data API — FREE, public, no key. Live price + market cap.
 *   POST https://fastapi.muns.io/stock-data
 *   body { ticker_symbol: "<SYMBOL>.NS", type: "stockquote", country: "India" }
 *   response is a "Key=Value,Key=Value,…" string (sometimes JSON-quoted).
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
  // Munshot returns market cap in raw rupees → convert to ₹ crore. Guard tiny values.
  const marketCapCr = mcapRaw == null ? null : mcapRaw > 1e7 ? round(mcapRaw / 1e7) : round(mcapRaw);
  return { currentPrice, marketCapCr };
}

export async function fetchQuote(symbol, { timeout = 35, retries = 2 } = {}) {
  const { status, body } = await curlRaw(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

/** Try a bare ticker as NSE (.NS) then BSE (.BO). Returns a live quote or null. */
export async function fetchForTicker(ticker, { log = () => {}, ...opts } = {}) {
  if (!ticker) return null;
  const sym = /\.(NS|BO)$/i.test(ticker) ? ticker : null;
  const candidates = sym ? [sym] : [`${ticker}.NS`, `${ticker}.BO`];
  for (const c of candidates) {
    const r = await fetchQuote(c, opts);
    if (r.ok && (r.currentPrice != null || r.marketCapCr != null)) {
      log(`   ✓ munshot ${c}: ₹${r.currentPrice ?? '—'} · mcap ₹${r.marketCapCr ?? '—'} Cr`);
      return r;
    }
    await sleep(300);
  }
  log(`   ✗ munshot ${ticker}: no quote`);
  return null;
}
