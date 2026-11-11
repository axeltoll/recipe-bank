// Writes schema/recipe.schema.json from lib/schema.mjs (`npm run schema`).
// test/schema.test.mjs fails when the committed file is out of date.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { recipeJsonSchema } from '../lib/schema.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const out = join(ROOT, 'schema', 'recipe.schema.json');
await mkdir(join(ROOT, 'schema'), { recursive: true });
await writeFile(out, JSON.stringify(recipeJsonSchema(), null, 2) + '\n');
console.log('wrote schema/recipe.schema.json');
