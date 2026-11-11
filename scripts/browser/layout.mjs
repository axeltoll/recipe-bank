// Runs in the page. Return measurements only; keep thresholds independently testable.
export function measureLayout() {
  const visible = (el) => el.getClientRects().length > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(), id: el.id || undefined,
    text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 100),
  });
  const targets = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [tabindex="0"]')]
    .filter((el) => !el.disabled && visible(el))
    .map((el) => {
      // The label is the actual hit area of a checkbox/radio, including its text.
      const hit = el.matches('input[type="checkbox"], input[type="radio"]') && el.labels?.length ? el.labels[0] : el;
      const r = hit.getBoundingClientRect();
      return { ...describe(el), width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
    });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const textLines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode());) {
    const parent = node.parentElement;
    if (!node.textContent.trim() || !visible(parent) || parent.closest('script, style, button, select, textarea, svg')) continue;
    const style = getComputedStyle(parent);
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // Average glyph width for readable prose, rather than CSS ch (the width of '0').
    const sample = 'The quick brown fox jumps over the lazy dog. ';
    const charWidth = context.measureText(sample).width / sample.length;
    if (!charWidth) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const widest = Math.max(0, ...[...range.getClientRects()].map((r) => r.width));
    const estimatedCharacters = Math.min(node.textContent.trim().length, widest / charWidth);
    if (estimatedCharacters > 80) textLines.push({ ...describe(parent), estimatedCharacters: Math.round(estimatedCharacters), width: Math.round(widest) });
  }
  const paints = (el) => {
    const style = getComputedStyle(el);
    if (Number(style.opacity) === 0 || style.visibility !== 'visible') return false;
    const color = style.backgroundColor;
    return style.backgroundImage !== 'none' || (color !== 'transparent' && !/rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color));
  };
  // HTML's background, or BODY's propagated canvas background, covers the viewport
  // even when the document is shorter than the screenshot. Inspect both edges too.
  const canvasPainted = paints(document.documentElement) || paints(document.body);
  const edgeSamples = [0, innerWidth - 1].flatMap((x) => [0, Math.floor(innerHeight / 2), innerHeight - 1].map((y) => ({
    x, y, painted: canvasPainted || document.elementsFromPoint(x, y).some(paints),
  })));
  return {
    width: innerWidth, height: innerHeight,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    targets, textLines, edgeSamples,
    background: { html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor },
  };
}

export function layoutIssues(measurements) {
  const issues = [];
  if (measurements.scrollWidth > measurements.width) issues.push({ check: 'sideways-scroll', scrollWidth: measurements.scrollWidth, viewport: measurements.width });
  if (measurements.width === 390) for (const target of measurements.targets) {
    if (target.width < 44 || target.height < 44) issues.push({ check: 'tap-target', ...target });
  }
  // Allow small font-metric differences around the 80-character target.
  for (const line of measurements.textLines) if (line.estimatedCharacters > 85) issues.push({ check: 'line-length', ...line });
  if (measurements.width >= 1920) for (const edge of measurements.edgeSamples) {
    if (!edge.painted) issues.push({ check: 'unpainted-edge', ...edge });
  }
  return issues;
}
