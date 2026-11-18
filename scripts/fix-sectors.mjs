/**
 * One-off: resolve the industry/sector for IPOs that scraped with a null sector, IN PLACE
 * (preserving every other field). Industry id → name via the per-industry report page (cached),
 * then a hardcoded mega-name fallback. Then recompute prospects/meta with `pipeline.mjs rollup`.
 *
 *   node scripts/fix-sectors.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, sleep } from './lib/http.mjs';
import { parseDetailHtml, resolveIndustryName, megaSector } from './lib/chittorgarh.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IPOS = path.join(ROOT, 'public', 'data', 'ipos.json');
const POLITE_MS = process.env.POLITE_MS ? parseInt(process.env.POLITE_MS, 10) : 500;

const ipos = JSON.parse(readFileSync(IPOS, 'utf8'));
const nulls = ipos.filter((i) => !i.sector && i.data_flags && i.data_flags.detail !== 'list-only' && i.source_url);
console.log(`▶ fixing sectors for ${nulls.length} null-sector IPOs…`);

let fixed = 0;
let i = 0;
for (const ipo of nulls) {
  i++;
  try {
    const html = await fetchText(ipo.source_url, { label: `sector ${ipo.id}`, timeout: 40, retries: 2 });
    const d = parseDetailHtml(html);
    let sector = d.sector;
    if (!sector && d.industry_id) sector = await resolveIndustryName(d.industry_id, { log: () => {} });
    if (!sector) sector = megaSector(ipo.company);
    if (sector) {
      ipo.sector = sector;
      ipo.industry_id = d.industry_id || ipo.industry_id || null;
      fixed++;
    }
  } catch (e) {
    console.log(`  ! ${ipo.company}: ${e.message}`);
  }
  if (i % 20 === 0) {
    writeFileSync(IPOS, JSON.stringify(ipos, null, 2));
    console.log(`  … ${i}/${nulls.length} (fixed ${fixed}) [checkpoint]`);
  }
  await sleep(POLITE_MS);
}
writeFileSync(IPOS, JSON.stringify(ipos, null, 2));
const stillNull = ipos.filter((x) => !x.sector && x.data_flags && x.data_flags.detail !== 'list-only').length;
console.log(`✓ fixed ${fixed}/${nulls.length}. Still null: ${stillNull}. Now run: node scripts/pipeline.mjs rollup`);
