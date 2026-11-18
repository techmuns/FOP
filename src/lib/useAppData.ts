import { useCallback, useEffect, useState } from 'react';
import type { AppData } from '../types';
import { recomputeHoldings, rollUpProspects } from './wealth';

export type LoadStatus = 'loading' | 'ready' | 'error';

/** Fetch public/data/*.json and expose {status, data, error}, plus a live-price refresh. */
export function useAppData() {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const base = import.meta.env.BASE_URL || '/';
    (async () => {
      try {
        const [ipos, prospects, meta] = await Promise.all([
          fetch(`${base}data/ipos.json`).then((r) => ok(r)),
          fetch(`${base}data/prospects.json`).then((r) => ok(r)),
          fetch(`${base}data/meta.json`).then((r) => ok(r)),
        ]);
        if (!alive) return;
        setData({ ipos, prospects, meta });
        setStatus('ready');
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Pull live prices from the Worker's /api/live-prices and recompute wealth in place. */
  const refreshLivePrices = useCallback(async (): Promise<{ ok: boolean; updated: number; message: string }> => {
    if (!data) return { ok: false, updated: 0, message: 'No data loaded' };
    const tickers = [...new Set(data.ipos.map((i) => i.ticker).filter(Boolean))] as string[];
    if (!tickers.length) return { ok: false, updated: 0, message: 'No tickers to refresh' };
    try {
      const res = await fetch('/api/live-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { prices?: Record<string, { current?: number; marketCap?: number }> };
      const prices = body.prices || {};
      const updated = Object.keys(prices).length;
      if (!updated) return { ok: false, updated: 0, message: 'Live price feed returned nothing' };
      const ipos = recomputeHoldings(data.ipos, prices);
      const prospects = rollUpProspects(ipos);
      setData({ ...data, ipos, prospects });
      return { ok: true, updated, message: `Live prices applied to ${updated} tickers` };
    } catch (e) {
      return { ok: false, updated: 0, message: `Live prices unavailable (${e instanceof Error ? e.message : 'error'})` };
    }
  }, [data]);

  return { status, data, error, refreshLivePrices };
}

async function ok(r: Response) {
  if (!r.ok) throw new Error(`Failed to load ${r.url.split('/').pop()} (HTTP ${r.status})`);
  return r.json();
}
