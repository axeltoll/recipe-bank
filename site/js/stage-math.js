// Scroll maths for the hero's 3D stage. Pure functions, shared by hero-boot.js, hero.js and the tests.

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smoothstep = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

/**
 * Where the stage is for a scroll position.
 *
 * `home` and `land` are boxes in document coordinates ({ cx, cy, w, h }, centre and size): the slot in the
 * hero where the mark rests, and the empty slot beside the "How it works" steps where it lands.
 *
 * With `travel` (desktop): the stage is fixed. It keeps its viewport height while it slides from the home
 * column to the landing column and shrinks to fit the landing slot (t goes 0 to 1). After that it scrolls
 * away with the landing slot, and it is `parked` once it has left the top of the viewport.
 *
 * Without `travel` (phones, tablets): the stage stays in its slot and scrolls with the page; only `t` is
 * used, to turn the video shape into the recipe shape while the slot scrolls out.
 *
 * Returns the stage centre in viewport coordinates, its scale, the progress t and the parked flag.
 */
export function stagePose({ scrollY, home, land, travel }) {
  if (!travel || !land) {
    const span = Math.max(1, home.cy + home.h / 2);
    return { cx: home.cx, cy: home.cy - scrollY, scale: 1, t: clamp01(scrollY / span), parked: false };
  }
  const travelEnd = Math.max(1, land.cy - home.cy);
  const t = clamp01(scrollY / travelEnd);
  const e = easeInOut(t);
  const scale = lerp(1, Math.min(1, land.w / home.w, land.h / home.h), e);
  const cx = lerp(home.cx, land.cx, e);
  const cy = home.cy - Math.max(0, scrollY - travelEnd);
  const parked = cy + (home.h * scale) / 2 < -24;
  return { cx, cy, scale, t, parked };
}
