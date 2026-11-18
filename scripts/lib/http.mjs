/**
 * Tiny HTTP helper used by every scraper — FREE, no Firecrawl, no API keys.
 *
 * It shells out to `curl` on purpose: in this build environment outbound HTTPS
 * goes through a pre-configured agent proxy (curl already trusts its CA), and on
 * GitHub Actions runners curl reaches the internet directly. One code path works
 * in both places, with retries + exponential backoff.
 *
 * Playwright (headless chromium, pre-installed) is used ONLY as a fallback when a
 * page returns a non-200 / challenge / empty body. Launched with no options.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const pExecFile = promisify(execFile);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const nowISO = () => new Date().toISOString();

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export function round(n, d = 2) {
  if (n == null || !isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Low-level curl → { status, body }. Does not throw on HTTP status; throws only on transport failure after retries. */
export async function curlRaw(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeout = 45, retries = 4, label = url } = opts;
  const tmp = path.join(os.tmpdir(), `mun-${Date.now()}-${Math.random().toString(36).slice(2)}.out`);
  const args = ['-sS', '--compressed', '--location', '--max-time', String(timeout), '-A', UA, '-o', tmp, '-w', '%{http_code}'];
  if (method !== 'GET') args.push('-X', method);
  const hdrs = { 'Accept-Language': 'en-US,en;q=0.9', ...headers };
  for (const [k, v] of Object.entries(hdrs)) args.push('-H', `${k}: ${v}`);
  if (body != null) args.push('--data-binary', typeof body === 'string' ? body : JSON.stringify(body));
  args.push(url);

  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const { stdout } = await pExecFile('curl', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      const status = parseInt(String(stdout).trim(), 10) || 0;
      let text = '';
      try {
        text = await readFile(tmp, 'utf8');
      } catch {
        /* no body */
      }
      await unlink(tmp).catch(() => {});
      return { status, body: text };
    } catch (e) {
      lastErr = e;
      if (attempt < retries - 1) await sleep(1200 * 2 ** attempt);
    }
  }
  await unlink(tmp).catch(() => {});
  throw new Error(`curl transport failed after ${retries} tries: ${label}\n${lastErr?.stderr || lastErr?.message || lastErr}`);
}

const CHALLENGE = /just a moment|cf-browser-verification|attention required|enable javascript and cookies|captcha-delivery/i;

export function looksBlocked(status, body) {
  return status === 0 || status >= 400 || !body || body.length < 200 || CHALLENGE.test(body.slice(0, 4000));
}

/** Fetch HTML text; on block, transparently retry with Playwright. Throws if both fail. */
export async function fetchText(url, opts = {}) {
  const { status, body } = await curlRaw(url, opts);
  if (!looksBlocked(status, body)) return body;
  if ((opts.method || 'GET') === 'GET') {
    const html = await renderWithPlaywright(url).catch(() => null);
    if (html && !looksBlocked(200, html)) return html;
  }
  if (status >= 400 || status === 0) throw new Error(`HTTP ${status} for ${opts.label || url}`);
  return body;
}

/** Fetch + parse JSON (no Playwright fallback — JSON endpoints are plain). */
export async function fetchJson(url, opts = {}) {
  const { status, body } = await curlRaw(url, opts);
  if (status >= 400 || status === 0) throw new Error(`HTTP ${status} for ${opts.label || url}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Invalid JSON from ${opts.label || url}: ${String(body).slice(0, 160)}`);
  }
}

// ---- Playwright fallback (lazy; degrades gracefully if unavailable) --------
let _pw = null;
export async function renderWithPlaywright(url, { timeout = 45000, waitUntil = 'domcontentloaded', settle = 1200 } = {}) {
  try {
    if (!_pw) {
      const mod = await import('playwright').catch(() => null);
      if (!mod?.chromium) {
        console.warn('   ⚠ Playwright unavailable — fallback skipped');
        return null;
      }
      _pw = { chromium: mod.chromium, browser: null };
    }
    if (!_pw.browser) _pw.browser = await _pw.chromium.launch();
    const ctx = await _pw.browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { timeout, waitUntil });
      if (settle) await page.waitForTimeout(settle);
      return await page.content();
    } finally {
      await ctx.close().catch(() => {});
    }
  } catch (e) {
    console.warn('   ⚠ Playwright fallback failed:', e.message);
    return null;
  }
}

export async function closePlaywright() {
  if (_pw?.browser) {
    await _pw.browser.close().catch(() => {});
    _pw.browser = null;
  }
}

// ---- small parse helpers ---------------------------------------------------
export function stripTags(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8377;|&rupee;/g, '₹')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse an Indian-grouped number string → number | null. Strips ₹, commas, %, spaces. */
export function toNum(s) {
  if (s == null) return null;
  const x = parseFloat(String(s).replace(/[₹,%\s]/g, '').replace(/[^0-9.\-]/g, ''));
  return isFinite(x) ? x : null;
}

/** Rupees → crore. */
export const toCr = (rupees) => (rupees == null || !isFinite(rupees) ? null : round(rupees / 1e7));
