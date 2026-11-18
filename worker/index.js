/**
 * Cloudflare Worker for Munshot — IPO Promoter Wealth Radar.
 *
 *  • Serves the built Vite SPA from dist/ via the ASSETS binding (SPA fallback in wrangler.jsonc).
 *  • POST /api/live-prices  { tickers: ["CRYSTALCP", ...] }
 *      → { prices: { CRYSTALCP: { current, marketCap }, ... } }
 *    Calls the FREE keyless Munshot market-data API server-side (no secrets reach the browser),
 *    with fetch-with-retry and the "Key=Value,…" CSV-string parse. marketCap is returned in ₹ crore
 *    to match the browser wealth engine (src/lib/wealth.ts → recomputeHoldings).
 */

const MUNSHOT_API = 'https://fastapi.muns.io/stock-data';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/live-prices') return handleLivePrices(request, env);
    if (url.pathname === '/api/health') return json({ ok: true, ts: new Date().toISOString() });
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);

    // everything else → static assets (index.html SPA fallback configured in wrangler.jsonc)
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function handleLivePrices(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  let tickers = [];
  try {
    const body = await request.json();
    tickers = Array.isArray(body?.tickers) ? body.tickers : [];
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  tickers = [...new Set(tickers.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()))].slice(0, 600);
  if (!tickers.length) return json({ prices: {}, updated: 0, source: 'munshot' });

  const token = env?.MUNSHOT_TOKEN || null;
  const prices = {};
  const CONCURRENCY = 8;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const batch = tickers.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((t) => fetchQuoteForTicker(t, token)));
    for (const r of results) if (r?.ticker) prices[r.ticker] = { current: r.current, marketCap: r.marketCap };
  }

  return json({ prices, updated: Object.keys(prices).length, source: 'munshot', ts: new Date().toISOString() });
}

/** Query Munshot with the BARE symbol (strip any .NS/.BO — the API 404s on suffixes). */
async function fetchQuoteForTicker(ticker, token) {
  const bare = String(ticker).replace(/\.(NS|BO)$/i, '').trim();
  if (!bare) return null;
  const q = await fetchQuote(bare, token);
  if (q && (q.current != null || q.marketCap != null)) return { ticker, ...q };
  return null;
}

// Munshot's gateway 502s intermittently, so retry with exponential backoff + jitter: the
// "Refresh prices" button self-recovers within a few hundred ms instead of returning nothing.
async function fetchQuote(symbol, token, retries = 3) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const backoff = (attempt) => 250 * 2 ** attempt + Math.floor(Math.random() * 150);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      let res;
      try {
        res = await fetch(MUNSHOT_API, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ticker_symbol: symbol, type: 'stockquote', country: 'India' }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      // retry 5xx / 429 (transient); give up on other 4xx (e.g. 404 = ticker not covered)
      if (!res.ok) {
        if ((res.status >= 500 || res.status === 429) && attempt < retries) {
          await sleep(backoff(attempt));
          continue;
        }
        return null;
      }
      return parseQuote(await res.text());
    } catch {
      if (attempt < retries) await sleep(backoff(attempt));
    }
  }
  return null;
}

/** Parse the "Key=Value,Key=Value,…" response → { current, marketCap(₹cr) } | null. */
function parseQuote(text) {
  let s = String(text || '').trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      s = JSON.parse(s);
    } catch {
      /* keep raw */
    }
  }
  if (s.startsWith('{') || s.startsWith('[')) return null; // error / validation payload
  const kv = {};
  for (const pair of s.split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) kv[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  const n = (v) => {
    if (v == null) return null;
    const x = parseFloat(String(v).replace(/[₹,%\s]/g, ''));
    return isFinite(x) ? x : null;
  };
  if (kv['Current Price'] == null && kv['Market Cap'] == null) return null;
  const current = n(kv['Current Price']);
  const mcapRaw = n(kv['Market Cap']);
  // Munshot returns market cap in raw rupees → ₹ crore.
  const marketCap = mcapRaw == null ? null : Math.round((mcapRaw / 1e7) * 100) / 100;
  return { current, marketCap };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
