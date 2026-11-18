import { Sparkles } from 'lucide-react';

/** A consistent "this is a preview, full feature ships next" footer used on every tab. */
export function SoonNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-mun-primary/30 bg-mun-primary/[0.04] p-4">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-mun-primary/10 text-mun-primary">
        <Sparkles size={16} strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-[13px] font-bold text-mun-ink">{title}</h4>
          <span className="rounded-full bg-mun-amber/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-mun-amber-dark">
            Preview
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-mun-grey">{body}</p>
      </div>
    </div>
  );
}
