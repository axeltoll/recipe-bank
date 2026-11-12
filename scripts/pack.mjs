// Recipe packs from the command line (format and rules: lib/pack.mjs, public/features/PACKS.md).
//
//   npm run packs -- export <id…> [--title "…"] [--out file.json] [--link] [--base URL]
//   npm run packs -- export --all [--out file.json]
//   npm run packs -- import <file.json | pack link> [--write]
//
// export prints the pack (or writes it to --out; --link prints a #pack= link instead).
// import is a dry run unless --write, and only ever creates new recipe files.
// RECIPE_BANK_DIR points at another data folder (one holding recipes/), e.g. for tests.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRecipes, dataPaths } from '../server.mjs';
import {
  exportPack, serializePack, packLink, packFromLink, hasPackLink, readPack, planImport, applyImport, PackError,
} from '../lib/pack.mjs';
import { readPackFile } from './pack-file.mjs';

const { recipesDir: RECIPES_DIR } = dataPaths();
const USAGE = `Usage:
  node scripts/pack.mjs export <id…> [--title "…"] [--out file.json] [--link] [--base URL]
  node scripts/pack.mjs export --all [--out file.json]
  node scripts/pack.mjs import <file.json | pack link> [--write]`;

function parseArgs(argv) {
  const flags = new Set(['--all', '--link', '--write']);
  const values = new Set(['--title', '--out', '--base']);
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) opts[a.slice(2)] = true;
    else if (values.has(a)) {
      if (i + 1 >= argv.length) usage(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) usage(`unknown option ${a}`);
    else opts._.push(a);
  }
  return opts;
}

function usage(msg) {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}

const [command, ...rest] = process.argv.slice(2);
const opts = parseArgs(rest);

if (command === 'export') await exportCommand();
else if (command === 'import') await importCommand();
else usage(command ? `unknown command ${command}` : 'missing command');

async function exportCommand() {
  const { recipes } = await loadRecipes(RECIPES_DIR);
  let picked;
  if (opts.all) {
    if (opts._.length) usage('use either --all or recipe ids');
    picked = recipes;
  } else {
    if (!opts._.length) usage('name at least one recipe id, or --all');
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const missing = opts._.filter((id) => !byId.has(id));
    if (missing.length) {
      console.error(`Not in the bank (or invalid): ${missing.join(', ')}`);
      process.exit(1);
    }
    picked = [...new Set(opts._)].map((id) => byId.get(id));
  }
  let pack;
  try {
    pack = exportPack(picked, { title: opts.title });
    if (opts.link) {
      console.log(packLink(pack, opts.base ?? 'http://127.0.0.1:4780/'));
      return;
    }
  } catch (e) {
    if (!(e instanceof PackError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
  if (opts.out) {
    await writeFile(opts.out, serializePack(pack));
    console.error(`✓ ${pack.recipes.length} recipe(s) → ${opts.out}`);
  } else {
    process.stdout.write(serializePack(pack));
  }
}

async function importCommand() {
  if (opts._.length !== 1) usage('name one pack file or link');
  const [source] = opts._;
  let read;
  if (hasPackLink(source) && !source.toLowerCase().endsWith('.json')) {
    read = packFromLink(source);
  } else {
    let text;
    try {
      text = await readPackFile(source);
    } catch (e) {
      console.error(`Cannot read ${source}: ${e.message}`);
      process.exit(1);
    }
    read = readPack(text); // refuses text over MAX_PACK_CHARS
  }
  if (!read.ok) {
    console.error(`✗ ${read.errors.join(' ')}`);
    process.exit(1);
  }

  const { recipes, invalid } = await loadRecipes(RECIPES_DIR);
  const plan = planImport(read, [...recipes, ...invalid.map((i) => ({ id: i.file.slice(0, -5) }))]);
  console.log(`Pack "${plan.title}"${plan.exported ? ` (exported ${plan.exported})` : ''}: ${plan.items.length} recipe(s)`);
  for (const item of plan.items) {
    const label = {
      new: `+ new        ${item.id}`,
      conflict: `+ renamed    ${item.packId} → ${item.id} (that id is taken by another video)`,
      duplicate: `= duplicate  ${item.id ?? `#${item.index + 1}`} (same video as ${item.duplicateOf}${item.inBank ? '' : ', earlier in this pack'})`,
      invalid: `✗ invalid    ${item.id ?? `#${item.index + 1}`}: ${item.problems.slice(0, 3).join('; ')}`,
    }[item.status];
    console.log(`  ${label}`);
  }

  const { files } = applyImport(plan);
  if (!opts.write) {
    console.log(files.length
      ? `Dry run: ${files.length} recipe file(s) would be created. Run again with --write to create them.`
      : 'Nothing to import.');
    return;
  }
  let created = 0;
  for (const f of files) {
    try {
      await writeFile(join(RECIPES_DIR, `${f.id}.json`), f.contents, { flag: 'wx' });
      created++;
      console.log(`✓ recipes/${f.id}.json`);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      console.error(`! recipes/${f.id}.json already exists; left untouched`);
    }
  }
  console.log(`${created} recipe file(s) created. Run npm run validate, then commit them.`);
}
