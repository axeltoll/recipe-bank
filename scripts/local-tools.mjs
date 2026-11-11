// Optional executables are detected locally; no commands or network requests run.
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const TOOL_NAMES = ['yt-dlp', 'ffmpeg', 'whisper-ctranslate2', 'whisper', 'tesseract'];

function checkExecutable(candidate, mode) {
  accessSync(candidate, mode);
  if (!statSync(candidate).isFile()) throw new Error('Not an executable file.');
}

export function findExecutable(name, { env = process.env, platform = process.platform, accessible = checkExecutable } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const searchPath = env.PATH ?? env.Path ?? '';
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.EXE').split(';') : [''];
  // Only absolute entries: a relative one ('.', 'bin') would resolve against the working directory, which
  // is usually this repository, so a planted file there could run in place of a real tool.
  for (const dir of searchPath.split(paths.delimiter).filter((d) => d && paths.isAbsolute(d))) {
    for (const ext of extensions) {
      // spawn without a shell: Windows batch wrappers are not executable here.
      if (platform === 'win32' && ext.toLowerCase() !== '.exe') continue;
      const candidate = paths.resolve(dir, name + ext);
      try {
        accessible(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch { /* try the next PATH entry */ }
    }
  }
  return null;
}

export function detectTools(lookup = findExecutable) {
  return Object.fromEntries(TOOL_NAMES.map((name) => [name, lookup(name) || null]));
}

// Await each foreground command; never invoke a shell or silently ignore errors.
// `timeout` (ms, 0 = none) kills a stalled tool and reports it as an error, so a hung download
// cannot hang the capture (and the agent waiting for it).
export function runCommand(command, args, { cwd, maxBuffer = 16 * 1024 * 1024, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ status: null, error, stdout: '', stderr: '' }); return; }
    let stdout = '';
    let stderr = '';
    let error;
    let bytes = 0;
    const timer = timeout > 0 ? setTimeout(() => {
      error = new Error(`Timed out after ${timeout / 1000} s; the tool was stopped.`);
      child.kill('SIGKILL');
    }, timeout) : null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const collect = (target) => (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBuffer) {
        error = new Error('Tool output exceeded the capture log limit.');
        child.kill();
        return;
      }
      if (target === 'stdout') stdout += chunk;
      else stderr += chunk;
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', (err) => {
      error ??= err;
      // A tool that never started may not emit 'close'; settle now (a later 'close' changes nothing).
      if (child.pid === undefined) {
        if (timer) clearTimeout(timer);
        resolve({ status: null, stdout, stderr, error });
      }
    });
    child.on('close', (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    });
  });
}
