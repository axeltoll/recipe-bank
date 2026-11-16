// Test preload: a write of a .json file stops after a few bytes, as a full disk would.
// Temp files (the atomic publish path) are left alone. Loaded with node --import.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const real = fs.promises.writeFile;

fs.promises.writeFile = async function writeFile(path, data, options) {
  const name = String(path);
  if (process.env.PARTIAL_JSON === '1' && name.endsWith('.json') && !name.includes('.tmp')) {
    await real(path, String(data).slice(0, 8), options);
    throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
  }
  return real(path, data, options);
};
