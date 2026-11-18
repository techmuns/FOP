import { useState } from 'react';
import { Target, Rocket, UserSearch, RefreshCw, TriangleAlert, Database, CheckCircle2 } from 'lucide-react';
import { Header } from './components/Header';
import { Tabs, type TabDef } from './components/ui/Tabs';
import { useAppData } from './lib/useAppData';
import { HitListTab } from './tabs/HitListTab';
import { IpoExplorerTab } from './tabs/IpoExplorerTab';
import { Promoter360Tab } from './tabs/Promoter360Tab';
import { dateLabel, num } from './lib/format';
import type { AppData } from './types';

type TabKey = 'hitlist' | 'ipos' | 'promoters';

export default function App() {
  const { status, data, error, refreshLivePrices } = useAppData();
  const [tab, setTab] = useState<TabKey>('hitlist');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [focusPerson, setFocusPerson] = useState<string | null>(null);

  const openPromoter = (person: string) => {
    setFocusPerson(person);
    setTab('promoters');
  };

  const tabs: TabDef<TabKey>[] = [
    { key: 'hitlist', label: 'Hit-List', icon: Target, badge: data ? String(data.meta.counts.qualifying) : undefined },
    { key: 'ipos', label: 'IPO Explorer', icon: Rocket, badge: data ? num(data.meta.counts.ipos) : undefined },
    { key: 'promoters', label: 'Promoter 360', icon: UserSearch, badge: data ? String(data.meta.counts.prospects) : undefined },
  ];

  async function onRefresh() {
    setBusy(true);
    setFlash(null);
    const r = await refreshLivePrices();
    setFlash({ ok: r.ok, msg: r.message });
    setBusy(false);
    window.setTimeout(() => setFlash(null), 4500);
  }

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-40">
        <Header meta={data?.meta} />
        <div className="border-b border-black/[0.06] bg-white/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-2 px-2 sm:px-6">
            <Tabs tabs={tabs} active={tab} onChange={setTab} />
            <div className="flex shrink-0 items-center gap-2">
              {flash && (
                <span className={`hidden text-[11px] font-semibold sm:inline ${flash.ok ? 'text-mun-emerald-dark' : 'text-mun-grey'}`}>
                  {flash.msg}
                </span>
              )}
              <button
                onClick={onRefresh}
                disabled={busy || status !== 'ready'}
                title="Pull live prices from the Munshot API and recompute wealth"
                className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-mun-slate shadow-sm transition hover:border-mun-primary/40 hover:text-mun-primary disabled:opacity-50"
              >
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">Refresh prices</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1240px] px-4 py-5 sm:px-6">
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState msg={error} />}
        {status === 'ready' && data && (
          <>
            {tab === 'hitlist' && <HitListTab data={data} onOpenPromoter={openPromoter} />}
            {tab === 'ipos' && <IpoExplorerTab data={data} onOpenPromoter={openPromoter} />}
            {tab === 'promoters' && <Promoter360Tab data={data} focusPerson={focusPerson} onClearFocus={() => setFocusPerson(null)} />}
          </>
        )}
      </main>

      {status === 'ready' && data && <Provenance data={data} />}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="animate-fade-in">
      <div className="mb-4 h-7 w-56 rounded-lg bg-mun-offwhite-2/70" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[76px] animate-pulse rounded-xl border border-black/[0.05] bg-white/60" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="h-[320px] animate-pulse rounded-2xl border border-black/[0.05] bg-white/60" />
        <div className="h-[320px] animate-pulse rounded-2xl border border-black/[0.05] bg-white/60" />
      </div>
      <p className="mt-5 text-center text-[12.5px] text-mun-grey">Loading IPO disclosures & the prospect hit-list…</p>
    </div>
  );
}

function ErrorState({ msg }: { msg: string | null }) {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-mun-rose/30 bg-white p-6 text-center shadow-card">
      <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-mun-rose/10 text-mun-rose">
        <TriangleAlert size={22} />
      </span>
      <h2 className="text-[15px] font-bold text-mun-ink">Couldn't load the data</h2>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-snug text-mun-grey">{msg || 'Unknown error.'}</p>
      <p className="mt-3 text-[11.5px] text-mun-grey">
        The dashboard reads <code className="rounded bg-mun-offwhite px-1">public/data/*.json</code>. Run{' '}
        <code className="rounded bg-mun-offwhite px-1">npm run seed</code> to generate it.
      </p>
    </div>
  );
}

function Provenance({ data }: { data: AppData }) {
  const dot = (status: string) =>
    status === 'real' ? '#10B981' : status === 'partial' ? '#F59E0B' : status === 'seeded' ? '#64748B' : '#F43F5E';
  return (
    <footer className="mx-auto max-w-[1240px] px-4 pb-10 pt-2 sm:px-6">
      <div className="rounded-2xl border border-black/[0.06] bg-white/70 p-4 shadow-card">
        <div className="mb-2.5 flex items-center gap-2 text-[12px] font-bold text-mun-ink">
          <Database size={14} className="text-mun-primary" /> Data sources
          <span className="ml-auto text-[11px] font-normal text-mun-grey">
            generated {dateLabel(data.meta.generated_at.slice(0, 10))} · {num(data.meta.counts.ipos)} IPOs · {num(data.meta.counts.prospects)} people
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {data.meta.data_sources.map((src) => (
            <div key={src.name} className="rounded-xl border border-black/[0.05] bg-white px-3 py-2">
              <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-mun-ink">
                <span className="h-2 w-2 rounded-full" style={{ background: dot(src.status) }} />
                {src.name}
                <span className="ml-auto text-[10px] font-bold uppercase tracking-wide" style={{ color: dot(src.status) }}>
                  {src.status}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-mun-grey">{src.note}</p>
            </div>
          ))}
        </div>
        {data.meta.seeding && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-black/[0.05] pt-2 text-[11px] text-mun-grey">
            <span className="inline-flex items-center gap-1 font-semibold text-mun-emerald-dark">
              <CheckCircle2 size={12} /> Real: {data.meta.seeding.real.length}
            </span>
            {data.meta.seeding.blocked.length > 0 && (
              <span className="text-mun-rose">Blocked: {data.meta.seeding.blocked.join(', ')}</span>
            )}
            <span className="ml-auto italic">
              Mode: {data.meta.seeding.mode} · wealth ≥ ₹150 Cr qualifies
            </span>
          </div>
        )}
      </div>
    </footer>
  );
}
