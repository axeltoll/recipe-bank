// Validates every recipes/*.json against the contract in lib/recipe.mjs and, once that
// passes, against the JSON Schema in schema/recipe.schema.json (which also covers optional
// fields such as nutrition and source), and checks data/queue.json entries.
// Exit code 1 on any problem.
//
//   node scripts/validate.mjs          human-readable output
//   node scripts/validate.mjs --json   one JSON report on stdout: { ok, recipes, queue, problems, warnings }
//
// RECIPE_BANK_DIR points at another data folder (one holding recipes/ and data/), e.g. for tests.

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRecipe } from '../lib/recipe.mjs';
import { validateSchema, formatSchemaErrors } from '../lib/json-schema.mjs';
import { parseVideoUrl, videoKey } from '../lib/video.mjs';

const REPO = resolve(import.meta.dirname, '..');
const ROOT = resolve(process.env.RECIPE_BANK_DIR ?? REPO);
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const unknown = args.filter((a) => a !== '--json');
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}\nUsage: node scripts/validate.mjs [--json]`);
  process.exit(2);
}

const problems = [];
const warnings = [];
const fail = (where, message) => {
  problems.push({ where, message });
  if (!asJson) console.error(`✗ ${where}: ${message}`);
};
const warn = (where, message) => {
  warnings.push({ where, message });
  if (!asJson) console.warn(`! ${where}: ${message}`);
};

const schema = JSON.parse(await readFile(join(REPO, 'schema', 'recipe.schema.json'), 'utf8'));
const files = (await readdir(join(ROOT, 'recipes'))).filter((f) => f.endsWith('.json')).sort();
const seen = new Map();
for (const f of files) {
  let r;
  try {
    r = JSON.parse(await readFile(join(ROOT, 'recipes', f), 'utf8'));
  } catch (e) {
    fail(f, `invalid JSON (${e.message})`);
    continue;
  }
  const errs = validateRecipe(r, f.slice(0, -5));
  for (const e of errs) fail(f, e);
  // The schema repeats the contract's rules, so only report it once the contract passes.
  if (!errs.length) for (const e of formatSchemaErrors(validateSchema(schema, r))) fail(f, `schema: ${e}`);
  if (!r || typeof r !== 'object') continue;
  const key = videoKey(r.video);
  if (seen.has(key)) fail(f, `same video as ${seen.get(key)}`);
  seen.set(key, f);
}

let queue = [];
try {
  const parsed = JSON.parse(await readFile(join(ROOT, 'data', 'queue.json'), 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('must be an array');
  queue = parsed;
} catch (e) {
  if (e.code !== 'ENOENT') fail('data/queue.json', e.message);
}
const STATUSES = ['queued', 'analyzing', 'failed'];
queue.forEach((q, i) => {
  const at = `data/queue.json[${i}]`;
  if (!q?.id) fail(at, 'id is required');
  if (!parseVideoUrl(q?.video?.url)) fail(at, 'video.url is not a supported link');
  if (!STATUSES.includes(q?.status)) fail(at, `status must be one of ${STATUSES.join(', ')}`);
  if (seen.has(videoKey(q?.video))) {
    warn(at, `already analyzed as ${seen.get(videoKey(q.video))}; remove it from the queue`);
  }
});

// exitCode rather than exit(), so a long report on a pipe is flushed before Node quits.
process.exitCode = problems.length ? 1 : 0;
if (asJson) {
  const report = { ok: problems.length === 0, recipes: files.length, queue: queue.length, problems, warnings };
  console.log(JSON.stringify(report, null, 2));
} else if (problems.length) {
  console.error(`\n${problems.length} problem(s).`);
} else {
  console.log(`✓ ${files.length} recipe(s) and ${queue.length} queue entr${queue.length === 1 ? 'y' : 'ies'} valid.`);
}
