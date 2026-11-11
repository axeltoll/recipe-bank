// The hero mark of the public site: tile geometry (site/js/hero-shapes.js), scroll maths
// (site/js/stage-math.js), and the SVG poster in site/index.html that stands in for the live mark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTiles, cellToXY, GRID, MAX_DELAY, recipeCells, videoCells } from '../site/js/hero-shapes.js';
import { clamp01, easeInOut, lerp, smoothstep, stagePose } from '../site/js/stage-math.js';

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} is not ${expected}`);

test('both shapes stay inside the grid and never use a cell twice', () => {
  for (const [name, cells, count] of [['video', videoCells(), 151], ['recipe', recipeCells(), 220]]) {
    assert.equal(cells.length, count, name);
    assert.equal(new Set(cells.map((p) => `${p.c},${p.r}`)).size, count, `${name}: duplicate cell`);
    for (const p of cells) {
      assert.ok(p.c >= 0 && p.c < GRID.cols && p.r >= 0 && p.r < GRID.rows, `${name}: ${p.c},${p.r}`);
    }
  }
  assert.deepEqual(cellToXY(0, 0), { x: -8.5, y: 15.5 });
  assert.deepEqual(cellToXY(17, 31), { x: 8.5, y: -15.5 });
});

test('the tile list shows the whole video at rest and the whole recipe at the end', () => {
  const tiles = buildTiles();
  assert.equal(tiles.length, 220);
  assert.equal(tiles.filter((t) => t.as === 1).length, 151, 'video tiles');
  assert.equal(tiles.filter((t) => t.bs === 1).length, 220, 'recipe tiles');
  assert.equal(tiles.filter((t) => t.as === 1 && t.aAccent).length, 43, 'play button and played progress');
  assert.equal(tiles.filter((t) => t.bs === 1 && t.bAccent).length, 12, 'three ticked checkboxes');
  assert.equal(tiles.filter((t) => !t.fly).length, 122, 'cells shared by both shapes do not move');

  const videoAt = new Set(videoCells().map((p) => { const { x, y } = cellToXY(p.c, p.r); return `${x},${y}`; }));
  for (const t of tiles) {
    assert.ok(t.delay >= 0 && t.delay <= MAX_DELAY);
    assert.ok(Math.abs(t.ax) <= 8.5 && Math.abs(t.bx) <= 8.5 && Math.abs(t.ay) <= 15.5 && Math.abs(t.by) <= 15.5);
    assert.ok(videoAt.has(`${t.ax},${t.ay}`), 'every tile starts on a video cell, visible or not');
    if (!t.fly) assert.deepEqual([t.lift, t.spin, t.as, t.bs], [0, 0, 1, 1]);
  }
});

test('the poster in index.html draws exactly the video shape', async () => {
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('<svg class="poster"');
  const poster = html.slice(start, html.indexOf('</svg>', start));
  const [plain, accent] = poster.split('<g fill="url(#tile-accent)">');
  assert.ok(start > 0 && accent, 'poster markup not found');

  const cells = (svg, isAccent) => {
    const out = [];
    for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g)) {
      const [x, y, w, h] = m.slice(1).map(Number);
      for (let c = x / 10; c < (x + w) / 10; c++) for (let r = y / 10; r < (y + h) / 10; r++) out.push(`${c},${r},${isAccent}`);
    }
    return out;
  };
  const drawn = [...cells(plain, false), ...cells(accent, true)].sort();
  const expected = videoCells().map((p) => `${p.c},${p.r},${p.accent}`).sort();
  assert.deepEqual(drawn, expected);
});

test('easing helpers hit their end points', () => {
  assert.deepEqual([clamp01(-1), clamp01(0.4), clamp01(3)], [0, 0.4, 1]);
  assert.deepEqual([easeInOut(0), easeInOut(0.5), easeInOut(1)], [0, 0.5, 1]);
  assert.deepEqual([smoothstep(-2), smoothstep(0.5), smoothstep(2)], [0, 0.5, 1]);
  assert.equal(lerp(10, 20, 0.25), 12.5);
});

test('desktop: the stage slides to the landing slot, then scrolls away with it', () => {
  const home = { cx: 900, cy: 400, w: 400, h: 600 };
  const land = { cx: 300, cy: 1400, w: 300, h: 480 };
  const at = (scrollY) => stagePose({ scrollY, home, land, travel: true });

  assert.deepEqual(at(0), { cx: 900, cy: 400, scale: 1, t: 0, parked: false });

  const mid = at(500);
  near(mid.t, 0.5, 't');
  near(mid.cx, 600, 'cx');
  near(mid.cy, 400, 'cy stays at the same viewport height during the travel');
  near(mid.scale, 0.875, 'scale');

  const landed = at(1000);
  near(landed.t, 1, 't');
  near(landed.cx, 300, 'cx');
  near(landed.cy, 400, 'cy');
  near(landed.scale, 0.75, 'scale fits the landing slot');
  assert.equal(landed.parked, false);

  const leaving = at(1300);
  near(leaving.cy, 100, 'scrolls with the page after landing');
  assert.equal(leaving.parked, false);
  assert.equal(at(1700).parked, true, 'above the viewport');
});

test('phones and tablets: no travel, progress runs while the slot scrolls out', () => {
  const home = { cx: 195, cy: 200, w: 350, h: 220 };
  const pose = stagePose({ scrollY: 155, home, land: null, travel: false });
  assert.deepEqual(pose, { cx: 195, cy: 45, scale: 1, t: 0.5, parked: false });
  assert.equal(stagePose({ scrollY: 5000, home, land: null, travel: false }).t, 1);
  // A desktop width without a landing slot behaves the same way.
  assert.equal(stagePose({ scrollY: 0, home, land: null, travel: true }).scale, 1);
});
