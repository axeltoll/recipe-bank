// A small JSON Schema (draft 2020-12) validator for the subset that
// schema/recipe.schema.json uses. No dependencies, no DOM, no Node APIs.
// It throws on a keyword it does not know, so the schema cannot quietly grow
// past what this file checks. `format` is an annotation, as in 2020-12 by default.

const ANNOTATIONS = new Set([
  '$schema', '$id', '$comment', '$defs', 'title', 'description', 'examples', 'default',
  'format', 'deprecated', 'readOnly', 'writeOnly',
]);
const ASSERTIONS = new Set([
  '$ref', 'type', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum',
  'minItems', 'maxItems', 'items', 'properties', 'required', 'additionalProperties',
  'allOf', 'anyOf', 'if', 'then', 'else',
]);

/** Every keyword this validator understands (assertions and annotations). */
export const SUPPORTED_KEYWORDS = new Set([...ANNOTATIONS, ...ASSERTIONS]);

const MAX_DEPTH = 64;
const regexCache = new Map();

/**
 * Validate `value` against `schema`. Returns a list of { path, message };
 * empty means valid. Paths look like validateRecipe's: components[0].steps[1].t.
 */
export function validateSchema(schema, value) {
  const errors = [];
  check(schema, value, '', schema, errors, 0);
  return errors;
}

/** Format errors from validateSchema as strings, e.g. "tags[0]: must match ...". */
export function formatSchemaErrors(errors) {
  return errors.map((e) => `${e.path || '(root)'}: ${e.message}`);
}

function check(s, v, path, root, errors, depth) {
  if (depth > MAX_DEPTH) throw new Error(`schema nesting deeper than ${MAX_DEPTH} at ${path || '(root)'}`);
  if (s === true) return;
  if (s === false) return void errors.push({ path, message: 'is not allowed' });
  if (!s || typeof s !== 'object') throw new Error(`invalid schema at ${path || '(root)'}`);
  for (const k of Object.keys(s)) {
    if (!SUPPORTED_KEYWORDS.has(k)) throw new Error(`unsupported schema keyword "${k}"`);
  }
  const fail = (message) => errors.push({ path, message });

  if (s.$ref !== undefined) check(resolveRef(root, s.$ref), v, path, root, errors, depth + 1);

  if (s.type !== undefined) {
    const types = [].concat(s.type);
    if (!types.some((t) => hasType(v, t))) return void fail(`must be ${types.join(' or ')}`);
  }
  if (s.enum !== undefined && !s.enum.some((e) => same(e, v))) {
    fail(`must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (s.const !== undefined && !same(s.const, v)) fail(`must be ${JSON.stringify(s.const)}`);

  if (typeof v === 'string') {
    if (s.pattern !== undefined && !regex(s.pattern).test(v)) fail(`must match ${s.pattern}`);
    const len = [...v].length;
    if (s.minLength !== undefined && len < s.minLength) fail(`must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && len > s.maxLength) fail(`must be at most ${s.maxLength} characters`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) fail(`must be >= ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) fail(`must be <= ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) fail(`must have at least ${s.minItems} item(s)`);
    if (s.maxItems !== undefined && v.length > s.maxItems) fail(`must have at most ${s.maxItems} item(s)`);
    if (s.items !== undefined) v.forEach((item, i) => check(s.items, item, `${path}[${i}]`, root, errors, depth + 1));
  }
  if (isObject(v)) {
    for (const k of s.required ?? []) {
      if (!has(v, k)) errors.push({ path: join(path, k), message: 'is required' });
    }
    const props = s.properties ?? {};
    for (const k of Object.keys(props)) {
      if (has(v, k)) check(props[k], v[k], join(path, k), root, errors, depth + 1);
    }
    if (s.additionalProperties !== undefined) {
      for (const k of Object.keys(v)) {
        if (Object.hasOwn(props, k) || v[k] === undefined) continue;
        check(s.additionalProperties, v[k], join(path, k), root, errors, depth + 1);
      }
    }
  }

  for (const sub of s.allOf ?? []) check(sub, v, path, root, errors, depth + 1);
  if (s.anyOf !== undefined && !s.anyOf.some((sub) => passes(sub, v, path, root, depth))) {
    fail('must match at least one of the allowed shapes');
  }
  if (s.if !== undefined) {
    const branch = passes(s.if, v, path, root, depth) ? s.then : s.else;
    if (branch !== undefined) check(branch, v, path, root, errors, depth + 1);
  }
}

function passes(s, v, path, root, depth) {
  const errs = [];
  check(s, v, path, root, errs, depth + 1);
  return errs.length === 0;
}

function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !(ref === '#' || ref.startsWith('#/'))) {
    throw new Error(`only local $ref values are supported, got ${JSON.stringify(ref)}`);
  }
  let node = root;
  for (const raw of ref.slice(2).split('/').filter((p, i, all) => !(all.length === 1 && p === ''))) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) throw new Error(`$ref ${ref} does not resolve`);
    node = node[key];
  }
  return node;
}

function hasType(v, t) {
  switch (t) {
    case 'null': return v === null;
    case 'boolean': return typeof v === 'boolean';
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'array': return Array.isArray(v);
    case 'object': return isObject(v);
    default: throw new Error(`unknown type "${t}"`);
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// A key that is set to undefined is absent, as it would be after JSON.stringify.
const has = (o, k) => Object.hasOwn(o, k) && o[k] !== undefined;
const join = (path, k) => (path ? `${path}.${k}` : k);

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function regex(pattern) {
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern, 'u');
    regexCache.set(pattern, re);
  }
  return re;
}
