// Geometry for the hero mark: one set of tiles that reads as a video (a phone frame with a play button and
// a progress bar) and reflows into a recipe (a card with a title and six ingredient rows with checkboxes).
// Original geometry for Recipe Bank. Pure data, no three.js, so node:test can check it.

export const GRID = { cols: 18, rows: 32 };
/** Share of the morph that is spent on staggered starts (tiles lower in the recipe start later). */
export const MAX_DELAY = 0.45;

const PLAY_FIRST_ROW = 11;
const PLAY_FIRST_COL = 6;
const PLAY_WIDTHS = [1, 2, 4, 5, 7, 7, 5, 4, 2, 1]; // tiles per row of the play triangle, top to bottom
const CAPTION = { row: 25, from: 3, to: 11 };
const PROGRESS = { row: 28, from: 3, to: 14, playedTo: 7 };

const TITLE = { rows: [3, 4], from: 3, to: 11 };
const INGREDIENT_ROWS = [7, 11, 15, 19, 23, 27]; // first of two tile rows each
const LINE_LENGTHS = [8, 6, 9, 5, 7, 8];
const CHECKBOX_COLS = [3, 4];
const LINE_FIRST_COL = 6;
const CHECKED_ROWS = 3; // the first three checkboxes are ticked (accent)

const cell = (c, r, accent = false) => ({ c, r, accent });

/** The outline both shapes share: a one-tile frame with the four corner tiles left out. */
function frame() {
  const out = [];
  const lastC = GRID.cols - 1;
  const lastR = GRID.rows - 1;
  for (let c = 1; c < lastC; c++) out.push(cell(c, 0), cell(c, lastR));
  for (let r = 1; r < lastR; r++) out.push(cell(0, r), cell(lastC, r));
  return out;
}

/** Tiles of the video shape. */
export function videoCells() {
  const out = frame();
  PLAY_WIDTHS.forEach((w, i) => {
    for (let k = 0; k < w; k++) out.push(cell(PLAY_FIRST_COL + k, PLAY_FIRST_ROW + i, true));
  });
  for (let c = CAPTION.from; c <= CAPTION.to; c++) out.push(cell(c, CAPTION.row));
  for (let c = PROGRESS.from; c <= PROGRESS.to; c++) out.push(cell(c, PROGRESS.row, c <= PROGRESS.playedTo));
  return out;
}

/** Tiles of the recipe shape. */
export function recipeCells() {
  const out = frame();
  for (const r of TITLE.rows) for (let c = TITLE.from; c <= TITLE.to; c++) out.push(cell(c, r));
  INGREDIENT_ROWS.forEach((first, i) => {
    for (const r of [first, first + 1]) {
      for (const c of CHECKBOX_COLS) out.push(cell(c, r, i < CHECKED_ROWS));
      for (let k = 0; k < LINE_LENGTHS[i]; k++) out.push(cell(LINE_FIRST_COL + k, r));
    }
  });
  return out;
}

/** Grid cell to object space: one unit per tile, centred on the origin, y up. */
export function cellToXY(c, r) {
  return { x: c - (GRID.cols - 1) / 2, y: (GRID.rows - 1) / 2 - r };
}

// Deterministic 0..1 value per cell, so the mark looks the same on every load.
function noise(c, r, salt) {
  const v = Math.sin(c * 12.9898 + r * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

const key = (p) => `${p.c},${p.r}`;
const byRowThenCol = (p, q) => p.r - q.r || p.c - q.c;

/**
 * Pairs the two shapes into one tile list. A tile is { ax, ay, as, aAccent, bx, by, bs, bAccent, delay,
 * z0, lift, spin, fly }: position, scale (0 = hidden) and accent flag in the video shape (a) and in the
 * recipe shape (b). Cells that exist in both shapes stay where they are. The rest are paired in reading
 * order; the shape with fewer cells hides its surplus tiles (scale 0) inside its own cells.
 */
export function buildTiles() {
  const a = videoCells();
  const b = recipeCells();
  const inA = new Set(a.map(key));
  const bByKey = new Map(b.map((p) => [key(p), p]));
  const pairs = [];
  const aOnly = [];
  for (const p of a) {
    const same = bByKey.get(key(p));
    if (same) pairs.push([p, 1, same, 1]);
    else aOnly.push(p);
  }
  const bOnly = b.filter((p) => !inA.has(key(p)));
  aOnly.sort(byRowThenCol);
  bOnly.sort(byRowThenCol);
  const count = Math.max(aOnly.length, bOnly.length);
  for (let i = 0; i < count; i++) {
    const pb = bOnly[i] ?? bOnly[i % (bOnly.length || 1)] ?? aOnly[i];
    const pa = aOnly[i] ?? aOnly[i % (aOnly.length || 1)] ?? pb;
    pairs.push([pa, i < aOnly.length ? 1 : 0, pb, i < bOnly.length ? 1 : 0]);
  }
  return pairs.map(([pa, as, pb, bs]) => {
    const from = cellToXY(pa.c, pa.r);
    const to = cellToXY(pb.c, pb.r);
    const fly = from.x !== to.x || from.y !== to.y || as !== bs;
    return {
      ax: from.x, ay: from.y, as, aAccent: pa.accent,
      bx: to.x, by: to.y, bs, bAccent: pb.accent,
      delay: (pb.r / (GRID.rows - 1)) * MAX_DELAY,
      z0: (noise(pb.c, pb.r, 1) - 0.5) * 0.3,
      lift: fly ? 2 + noise(pa.c, pa.r, 2) * 5 : 0,
      spin: fly ? (noise(pa.c, pb.r, 3) - 0.5) * 2.4 : 0,
      fly,
    };
  });
}
