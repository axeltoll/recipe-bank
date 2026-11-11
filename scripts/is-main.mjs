// True when the module at `moduleUrl` is the script node was started with. process.argv[1] is the path as node
// resolved it, which keeps a symlink (and on some systems a different spelling of the same folder), while
// import.meta names the real file; comparing real paths on both sides is the reliable test.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const real = (path) => {
  try { return realpathSync.native(path); } catch { return resolve(path); }
};

export function isMain(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  return real(resolve(entry)) === real(fileURLToPath(moduleUrl));
}
