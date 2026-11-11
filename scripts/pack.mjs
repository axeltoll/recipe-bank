// Recipe packs from the command line (logic in lib/pack.mjs).
//
//   npm run packs -- export                          every recipe, as JSON on stdout
//   npm run packs -- export banana-milk cold-pan-chicken --title "Weeknight" --out weeknight.pack.json
//   npm run packs -- export banana-milk --link https://example.org/   a shareable link instead of a file
//   npm run packs -- import weeknight.pack.json      dry run: what would be added, skipped or renamed
//   npm run packs -- import weeknight.pack.json --write
//   npm run packs -- import "https://example.org/#/import/eyJ…" --write
//
// Import never overwrites: a recipe for a video that is already in the bank is skipped,
// and an id that is taken by a different video gets -2, -3, … appended.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadRecipes } from '../server.mjs';
import { validateRecipe } from '../lib/recipe.mjs';
import { createPack, readPack, planImport, packLink, packFromLink, LINK_PREFIX, PackError } from '../lib/pack.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RECIPES = join(ROOT, 'recipes');
const [cmd, ...rest] = process.argv.slice(2);

function option(name) {
  const i = rest.indexOf(name);
  if (i < 0) return null;
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v ?? null;
}
const flag = (name) => {
  const i = rest.indexOf(name);
  if (i >= 0) rest.splice(i, 1);
  return i >= 0;
};

async function exportPack() {
  const title = option('--title') ?? 'Recipe pack';
  const out = option('--out');
  const link = option('--link');
  const { recipes } = await loadRecipes(RECIPES);
  const ids = rest;
  const missing = ids.filter((id) => !recipes.some((r) => r.id === id));
  if (missing.length) throw new Error(`Not in the bank: ${missing.join(', ')}`);
  const chosen = ids.length ? ids.map((id) => recipes.find((r) => r.id === id)) : recipes;
  const pack = createPack(chosen, { title });
  if (link) {
    console.log(packLink(pack, link));
  } else if (out) {
    await writeFile(out, JSON.stringify(pack, null, 2) + '\n');
    console.error(`wrote ${out}: ${pack.recipes.length} recipe(s)`);
  } else {
    console.log(JSON.stringify(pack, null, 2));
  }
}

async function importPack() {
  const write = flag('--write');
  const source = rest[0];
  if (!source) throw new Error('Usage: npm run packs -- import <file.json | link> [--write]');
  const pack = source.includes(LINK_PREFIX) ? packFromLink(source) : readPack(await readFile(source, 'utf8'));
  const { recipes: existing } = await loadRecipes(RECIPES);
  const plan = planImport(pack.recipes, existing);

  console.log(`Pack "${pack.title}"${pack.created ? ` (${pack.created})` : ''}: ${pack.recipes.length} valid recipe(s), ${pack.invalid.length} invalid.`);
  for (const bad of pack.invalid) console.log(`  ✗ invalid #${bad.index}${bad.id ? ` ${bad.id}` : ''}: ${bad.errors.join('; ')}`);
  for (const d of plan.duplicates) console.log(`  = skip ${d.id}: same video as ${d.existing}`);
  for (const r of plan.renamed) console.log(`  ~ rename ${r.from} → ${r.to} (id already used by another video)`);
  for (const r of plan.add) {
    const errs = validateRecipe(r, r.id);
    if (errs.length) throw new Error(`${r.id}: ${errs.join('; ')}`);
    if (write) await writeFile(join(RECIPES, `${r.id}.json`), JSON.stringify(r, null, 2) + '\n');
    console.log(`  ${write ? '+ added' : '+ would add'} recipes/${r.id}.json`);
  }
  if (!write && plan.add.length) console.log('Dry run. Add --write to write the files, then run npm run validate.');
}

try {
  if (cmd === 'export') await exportPack();
  else if (cmd === 'import') await importPack();
  else {
    console.error('Usage: npm run packs -- export [id …] [--title T] [--out file] [--link base-url]\n       npm run packs -- import <file | link> [--write]');
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof PackError ? e.message : `✗ ${e.message}`);
  process.exit(1);
}
