import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { detectTools } from './local-tools.mjs';

const HINTS = {
  node: { linux: 'Install Node.js 22+ using your package manager or a Node version manager.', darwin: 'Install Node.js 22+ (for example: brew install node).', win32: 'Install Node.js 22+ using the official installer or a Node version manager.' },
  ffmpeg: { linux: 'Install ffmpeg with your distro package manager.', darwin: 'brew install ffmpeg', win32: 'Install FFmpeg and add its bin directory to PATH.' },
  'yt-dlp': { linux: 'Install yt-dlp with your distro package manager or pipx install yt-dlp.', darwin: 'brew install yt-dlp', win32: 'Install the yt-dlp executable and add its directory to PATH.' },
  stt: { linux: 'pipx install whisper-ctranslate2 (or openai-whisper); provide an existing local model.', darwin: 'pipx install whisper-ctranslate2 (or openai-whisper); provide an existing local model.', win32: 'Install Python, then pipx install whisper-ctranslate2 (or openai-whisper); provide an existing local model.' },
  tesseract: { linux: 'Install tesseract-ocr (or tesseract) and English language data with your package manager.', darwin: 'brew install tesseract', win32: 'Install Tesseract OCR with English language data and add it to PATH.' },
};

export function doctorReport({ nodeVersion = process.versions.node, platform = process.platform, lookup } = {}) {
  const tools = detectTools(lookup);
  const hint = (name) => HINTS[name][platform] ?? HINTS[name].linux;
  const supported = /^v?\d+\./.test(nodeVersion) && Number(nodeVersion.replace(/^v/, '').split('.')[0]) >= 22;
  const definitions = [
    ['ffmpeg', 'ffmpeg', tools.ffmpeg],
    ['yt-dlp', 'yt-dlp', tools['yt-dlp']],
    ['stt', 'local speech-to-text (whisper-ctranslate2 or whisper)', tools['whisper-ctranslate2'] || tools.whisper],
    ['tesseract', 'tesseract', tools.tesseract],
  ];
  return {
    node: { version: nodeVersion, minimum: 22, status: supported ? 'found' : 'too-old', hint: hint('node') },
    tools: definitions.map(([id, name, command]) => ({ id, name, status: command ? 'found' : 'missing', command, hint: hint(id) })),
    exitCode: supported ? 0 : 1,
    note: 'Capture tools are optional. A found executable does not verify models, language data or platform access. The dashboard needs only Node.js 22+.',
  };
}

export function doctorMain(args = [], { log = console.log, error = console.error, ...options } = {}) {
  if (args.some((arg) => arg !== '--json')) {
    error('Usage: npm run doctor -- [--json]');
    return 2;
  }
  const report = doctorReport(options);
  if (args.includes('--json')) log(JSON.stringify(report, null, 2));
  else {
    log(`Node.js ${report.node.version}: ${report.node.status} (requires 22+) — ${report.node.hint}`);
    for (const tool of report.tools) log(`${tool.name}: ${tool.status} — ${tool.hint}`);
    log(report.note);
  }
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = doctorMain(process.argv.slice(2));
}
