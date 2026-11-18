// Indian-style number & currency formatting. Plain language, tabular-nums everywhere.
// NOTE: the data stores money already in ₹ crore (fields named *_cr), so fmtCr is primary.

const CR = 1e7; // one crore (rupees)
const L = 1e5; // one lakh (rupees)

/** Format a value that is ALREADY in ₹ crore, e.g. 1240 → "₹1,240 Cr", 100.7 → "₹100.7 Cr". */
export function fmtCr(nCr: number | null | undefined): string {
  if (nCr == null || !isFinite(nCr)) return '—';
  const abs = Math.abs(nCr);
  const sign = nCr < 0 ? '-' : '';
  if (abs >= 100) return `${sign}₹${Math.round(abs).toLocaleString('en-IN')} Cr`;
  if (abs >= 1) return `${sign}₹${abs.toFixed(1)} Cr`;
  return `${sign}₹${abs.toFixed(2)} Cr`;
}

/** Compact ₹ crore for chart axes: "₹1.2k", "₹480", "₹0.5". */
export function crAxis(nCr: number | null | undefined): string {
  if (nCr == null || !isFinite(nCr)) return '—';
  const abs = Math.abs(nCr);
  const sign = nCr < 0 ? '-' : '';
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  if (abs >= 1) return `${sign}₹${Math.round(abs)}`;
  return `${sign}₹${abs.toFixed(1)}`;
}

/** Full rupee amount with Indian digit grouping, e.g. ₹21,21,23,478. */
export function inr(n: number | null | undefined, decimals = 0): string {
  if (n == null || !isFinite(n)) return '—';
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Compact money from RAW rupees: ₹Cr above a crore, ₹L above a lakh, else plain. */
export function money(n: number | null | undefined, opts?: { crDecimals?: number }): string {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= CR) return `${sign}₹${(abs / CR).toFixed(opts?.crDecimals ?? 2)} Cr`;
  if (abs >= L) return `${sign}₹${(abs / L).toFixed(2)} L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export const toCr = (n: number) => n / CR;

export function pct(n: number | null | undefined, decimals = 1): string {
  if (n == null || !isFinite(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

export function num(n: number | null | undefined, decimals = 0): string {
  if (n == null || !isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-04-01" → "1 Apr 2025" */
export function dateLabel(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** "2025-04-01" → "Apr 2025" (compact, for dense lists). */
export function monthYear(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** First name + last initial for compact labels: "Ankur Aggarwal" → "Ankur A." */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/** Proper initials for an avatar chip: "Ankur Aggarwal" → "AA". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
