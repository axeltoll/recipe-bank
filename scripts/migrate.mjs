// Upgrades recipes/*.json to the current contract version (lib/migrate.mjs).
//
//   npm run migrate                    dry run: print what would change, write nothing
//   npm run migrate -- --write         save the changed files
//   add --stamp                        also add "schema": <current> to files without it
//
// Changed files are rewritten as 2-space JSON, so a written file may also change layout.
// Each result is checked with validateRecipe before it is written. Exit code 1 on any problem.
// RECIPE_BANK_DIR points at another data folder (one holding recipes/), e.g. for tests.

import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { migrate } from '../lib/migrate.mjs';
import { SCHEMA_VERSION, validateRecipe } from '../lib/recipe.mjs';

const OPTIONS = ['--write', '--stamp'];
const args = process.argv.slice(2);
const unknown = args.filter((a) => !OPTIONS.includes(a));
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}\nUsage: node scripts/migrate.mjs [--write] [--stamp]`);
  process.exit(2);
}
const write = args.includes('--write');
const stamp = args.includes('--stamp');

const DIR = join(resolve(process.env.RECIPE_BANK_DIR ?? join(import.meta.dirname, '..')), 'recipes');
const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
let changed = 0;
let problems = 0;
const fail = (f, msg) => { problems++; console.error(`✗ ${f}: ${msg}`); };

for (const f of files) {
  let recipe;
  try {
    recipe = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  } catch (e) {
    fail(f, `invalid JSON (${e.message})`);
    continue;
  }
  let result;
  try {
    result = migrate(recipe, { stamp });
  } catch (e) {
    fail(f, e.message);
    continue;
  }
  if (!result.changes.length) continue;
  const errs = validateRecipe(result.recipe, f.slice(0, -5));
  if (errs.length) {
    fail(f, `the migrated recipe would be invalid: ${errs.join('; ')}`);
    continue;
  }
  changed++;
  console.log(`${write ? '✓' : '→'} ${f}`);
  for (const c of result.changes) console.log(`    ${c}`);
  if (write) {
    const tmp = join(DIR, `${f}.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(result.recipe, null, 2) + '\n');
    await rename(tmp, join(DIR, f));
  }
}

const summary = `${files.length} recipe(s), contract version ${SCHEMA_VERSION}: `;
if (!changed) console.log(summary + 'nothing to migrate.');
else if (write) console.log(summary + `${changed} file(s) updated.`);
else console.log(summary + `${changed} file(s) would change. Run again with --write to save.`);
if (problems) {
  console.error(`${problems} problem(s).`);
  process.exitCode = 1;
}
