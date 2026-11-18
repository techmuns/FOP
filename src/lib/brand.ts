// Munshot wealth palette + domain colour helpers.
// The ported chart kit takes colours as props, so this file is the single
// source of truth for how the app colours money, sectors, confidence & wealth.
import type { Confidence } from '../types';

export const MUN = {
  primary: '#6366F1', // indigo
  primaryDeep: '#4F46E5',
  violet: '#7C3AED',
  emerald: '#10B981', // money / holding value
  emeraldDark: '#059669',
  amber: '#F59E0B', // cash / OFS taken out
  amberDark: '#D97706',
  rose: '#F43F5E', // alert / high pledge
  cyan: '#06B6D4',
  sky: '#38BDF8',
  ink: '#0F172A',
  slate: '#334155',
  grey: '#64748B',
  light: '#CBD5E1',
  surface: '#F8FAFC',
} as const;

/** Semantic money colours used consistently across every chart & tile. */
export const MONEY = {
  wealth: '#6366F1', // total estimated wealth (indigo)
  holding: '#10B981', // paper wealth still held (emerald)
  holdingDark: '#059669',
  ofs: '#F59E0B', // cash already taken out via OFS (amber)
  ofsDark: '#D97706',
  pledge: '#F43F5E', // high pledge = alert (rose)
} as const;

/** Rich multi-hue categorical set for sectors / groupings. */
export const CATEGORICAL = [
  '#6366F1',
  '#10B981',
  '#F59E0B',
  '#F43F5E',
  '#06B6D4',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#3B82F6',
] as const;

export function colorAt(i: number): string {
  return CATEGORICAL[((i % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length];
}

/** Deterministic, stable sector → colour (same sector is always the same hue). */
export function sectorColor(sector: string | null | undefined): string {
  const s = (sector ?? '').trim().toLowerCase();
  if (!s) return MUN.grey;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return colorAt(h);
}

/** Confidence badge colours. */
export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  HIGH: '#10B981',
  MEDIUM: '#F59E0B',
  LOW: '#94A3B8',
};

/** Wealth bands — richer hue = higher wealth (which is "good" for a target). */
export interface WealthBand {
  key: string;
  label: string;
  min: number; // ₹ crore, inclusive
  max: number; // ₹ crore, exclusive
  color: string;
}
export const WEALTH_BANDS: WealthBand[] = [
  { key: '150-500', label: '₹150–500 Cr', min: 150, max: 500, color: '#38BDF8' },
  { key: '500-1000', label: '₹500 Cr–₹1k Cr', min: 500, max: 1000, color: '#6366F1' },
  { key: '1000+', label: '₹1,000 Cr+', min: 1000, max: Infinity, color: '#7C3AED' },
];
export function wealthBand(cr: number): WealthBand {
  return WEALTH_BANDS.find((b) => cr >= b.min && cr < b.max) ?? WEALTH_BANDS[0];
}
export function wealthBandColor(cr: number): string {
  return wealthBand(cr).color;
}

/** Lighten (amt>0) / darken (amt<0) a hex colour by a factor (−1..1). */
export function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => (amt >= 0 ? Math.round(c + (255 - c) * amt) : Math.round(c * (1 + amt)));
  const to2 = (c: number) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Wealth ramp sky → indigo → violet for an intensity 0..1 (low→high = good). */
export function rampWealth(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0, [56, 189, 248]], // sky
    [0.5, [99, 102, 241]], // indigo
    [1, [124, 58, 237]], // violet
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (c >= stops[i][0] && c <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const f = (c - a[0]) / span;
  const to2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  const ch = [0, 1, 2].map((k) => to2(a[1][k] + (b[1][k] - a[1][k]) * f));
  return `#${ch.join('')}`;
}
