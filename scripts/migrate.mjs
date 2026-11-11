// Brings every recipes/*.json up to the current contract version (lib/schema.mjs).
//   npm run migrate              dry run: lists what would change
//   npm run migrate -- --write   rewrites the files that need it, then validates them
// Files already at the current version are never touched.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { migrateRecipe, SCHEMA_VERSION } from '../lib/schema.mjs';
import { validateRecipe } from '../lib/recipe.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'recipes');
const write = process.argv.includes('--write');

let changed = 0;
let problems = 0;
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()) {
  let r;
  try {
    r = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  } catch (e) {
    console.error(`✗ ${f}: invalid JSON (${e.message})`);
    problems++;
    continue;
  }
  let out;
  try {
    out = migrateRecipe(r);
  } catch (e) {
    console.error(`✗ ${f}: ${e.message}`);
    problems++;
    continue;
  }
  if (!out.changed) continue;
  changed++;
  const errs = validateRecipe(out.recipe, f.slice(0, -5));
  if (errs.length) {
    problems++;
    console.error(`✗ ${f}: schema ${out.from} → ${out.to} gives an invalid recipe:\n  ${errs.join('\n  ')}`);
    continue;
  }
  if (write) await writeFile(join(DIR, f), JSON.stringify(out.recipe, null, 2) + '\n');
  console.log(`${write ? '✓ migrated' : '· would migrate'} ${f}: schema ${out.from} → ${out.to}`);
}

console.log(`${changed} file(s) ${write ? 'migrated' : 'to migrate'}; current schema is ${SCHEMA_VERSION}.${!write && changed ? ' Run with --write to apply.' : ''}`);
if (problems) process.exit(1);
