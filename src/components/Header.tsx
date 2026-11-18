import { Radar } from 'lucide-react';
import { dateLabel } from '../lib/format';
import type { Meta } from '../types';

export function Header({ meta }: { meta?: Meta }) {
  return (
    <header className="border-b border-black/[0.06] bg-white/80 backdrop-blur-md">
      {/* premium gradient bar */}
      <div className="h-1 w-full bg-gradient-to-r from-mun-primary-deep via-mun-violet to-mun-cyan" />
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-mun-primary to-mun-violet shadow-sm">
            <Radar size={20} strokeWidth={2.4} className="text-white" />
          </span>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[15px] font-extrabold tracking-tight text-mun-ink sm:text-[17px]">
                Munshot
              </h1>
              <span className="hidden rounded-full bg-mun-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mun-primary sm:inline">
                Wealth Radar
              </span>
            </div>
            <p className="hidden text-[11.5px] leading-tight text-mun-grey sm:block">
              Freshly-wealthy IPO promoters worth ₹150 Cr+ — a person-first prospect hit-list
            </p>
          </div>
        </div>
        {meta && (
          <div className="hidden text-right md:block">
            <div className="flex items-center justify-end gap-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mun-emerald opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mun-emerald" />
              </span>
              <span className="text-[11px] font-semibold text-mun-slate">Live from IPO disclosures</span>
            </div>
            <p className="tnum mt-0.5 text-[11px] text-mun-grey">
              {meta.counts.qualifying} qualifying targets · updated {dateLabel(meta.generated_at.slice(0, 10))}
            </p>
          </div>
        )}
      </div>
    </header>
  );
}
