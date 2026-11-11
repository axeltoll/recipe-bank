// Reads a pack file for scripts/pack.mjs. Kept apart from the CLI so tests can call it directly.

import { open } from 'node:fs/promises';
import { MAX_PACK_BYTES } from '../lib/pack.mjs';

// Checks the size before reading and reads at most that many bytes, so a huge file or a device such
// as /dev/zero is refused instead of filling memory.
export async function readPackFile(path) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('not a regular file');
    if (info.size > MAX_PACK_BYTES) {
      throw new Error(`the file is too large (${info.size.toLocaleString('en-US')} bytes; a pack is at most ${MAX_PACK_BYTES.toLocaleString('en-US')})`);
    }
    // One spare byte shows a file that grew after stat().
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > info.size) throw new Error('the file changed while it was read');
    return buffer.toString('utf8', 0, length);
  } finally {
    await file.close();
  }
}
