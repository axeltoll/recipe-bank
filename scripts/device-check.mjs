// Device check: measures every dashboard page (home, a recipe and the feature routes) at five widths for sideways
// scroll, small tap targets, over-long lines and unpainted edges, and saves screenshots and a summary in
// .smoke/device/. Pages and selectors come from scripts/browser/selectors.mjs.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRecipes } from '../server.mjs';
import { measureLayout, layoutIssues } from './browser/layout.mjs';
import { ROOT, options, browserAvailable, withBrowser } from './browser/support.mjs';
import { SELECTORS, PAGES } from './browser/selectors.mjs';

const VIEWPORTS = [[390, 844], [768, 1024], [1280, 800], [1920, 1080], [2560, 1440]];
const names = PAGES.map(([name]) => name);
const allowed = [...names, ...VIEWPORTS.map(([width]) => String(width))];
const output = join(ROOT, '.smoke/device');

try {
  // Bad options are reported as a FAIL line like every other error, not as a stack trace.
  const opts = options();
  if (opts.only && !allowed.includes(opts.only)) throw new Error(`--only must be one of: ${allowed.join(', ')}`);
  if (browserAvailable()) {
    const { recipes, invalid } = await loadRecipes();
    if (invalid.length || !recipes.length) throw new Error('Valid recipes are required for the device check');
    const report = { date: new Date().toISOString(), notes: [
      'External images, video embeds and fonts are fulfilled locally; screenshots show layout with fallback fonts and placeholder images.',
      'Tap targets include rendered content below the fold and checkbox labels. Line length is an approximate glyph-width measurement with an 85-character tolerance.',
      'Edge paint checks computed backgrounds at six viewport-edge samples, including HTML/BODY canvas propagation.',
      'At 390 px the home page is measured again with the filter sheet open (Without, tags and nutrition included).',
    ], pages: [] };
    await mkdir(output, { recursive: true });
    await withBrowser(async (page, [origin]) => {
      for (const [width, height] of VIEWPORTS) {
        if (opts.only && /^\d+$/.test(opts.only) && Number(opts.only) !== width) continue;
        await page.setViewport(width, height, width === 390);
        for (const [name, hash, ready] of PAGES) {
          if (opts.only && names.includes(opts.only) && opts.only !== name) continue;
          const route = typeof hash === 'function' ? hash(recipes[0].id) : hash;
          const consoleStart = page.console.length, exceptionStart = page.exceptions.length;
          await page.goto(`${origin}/${route}`);
          await page.waitFor(ready);
          await page.evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
          const measurements = await page.evaluate(measureLayout);
          const issues = layoutIssues(measurements);
          const screenshot = `${name}-${width}x${height}.png`;
          await page.screenshot(join(output, screenshot));
          // On a phone the filters are a bottom sheet behind the Filters button; open it so small chips cannot evade the baseline.
          if (name === 'home' && width === 390) {
            const opened = await page.evaluate(`(() => {
              const toggle = document.querySelector(${JSON.stringify(SELECTORS.filterToggle)});
              if (!toggle || toggle.getAttribute('aria-expanded') === 'true') return false;
              toggle.click();
              return true;
            })()`);
            if (opened) {
              await page.waitFor(SELECTORS.filtersOpen);
              const filters = await page.evaluate(measureLayout);
              const extra = layoutIssues(filters).filter((issue) => !issues.some((old) => JSON.stringify(old) === JSON.stringify(issue)));
              issues.push(...extra.map((issue) => ({ ...issue, state: 'filters-open' })));
              await page.screenshot(join(output, `home-${width}x${height}-filters.png`));
              await page.evaluate(`document.querySelector(${JSON.stringify(SELECTORS.filterToggle)})?.click()`);
            }
          }
          const consoleErrors = page.console.slice(consoleStart).filter((entry) => entry.type === 'error');
          issues.push(...consoleErrors.map((entry) => ({ check: 'console-error', text: entry.text })),
            ...page.exceptions.slice(exceptionStart).map((text) => ({ check: 'exception', text })));
          report.pages.push({ page: name, route, width, height, screenshot, measurements, issues });
          console.log(`${issues.length ? 'FAIL' : 'PASS'} ${name} ${width}x${height}: ${issues.length} finding(s)`);
        }
      }
    }, opts);
    const total = report.pages.reduce((sum, page) => sum + page.issues.length, 0);
    report.passed = total === 0;
    report.findings = total;
    const lines = [report.passed ? 'PASS: device check' : `FAIL: device check (${total} findings)`, ...report.pages.map((page) => {
      const counts = {};
      for (const issue of page.issues) counts[issue.check] = (counts[issue.check] ?? 0) + 1;
      return `${page.page} ${page.width}x${page.height}: ${page.issues.length ? JSON.stringify(counts) : 'pass'}`;
    }), ...report.notes];
    await writeFile(join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(join(output, 'summary.txt'), lines.join('\n') + '\n');
    console.log(lines.join('\n'));
    if (!report.passed) process.exitCode = 1;
  }
} catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
