import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  parseNumber, formatDecimal, formatFraction, scaleAmount, scaleIngredient, scaleRecipe, parseServes, factorFor, formatFactor,
} from '../lib/scale.mjs';

test('parseNumber reads every way a number is written in a recipe', () => {
  assert.deepEqual(parseNumber('3'), { value: 3, style: 'int', comma: false });
  assert.deepEqual(parseNumber('1.5'), { value: 1.5, style: 'decimal', comma: false });
  assert.deepEqual(parseNumber('1,5'), { value: 1.5, style: 'decimal', comma: true });
  assert.deepEqual(parseNumber('1,000'), { value: 1000, style: 'int', comma: false });
  assert.deepEqual(parseNumber('1/2'), { value: 0.5, style: 'fraction', comma: false });
  assert.deepEqual(parseNumber('1 1/2'), { value: 1.5, style: 'fraction', comma: false });
  assert.deepEqual(parseNumber('½'), { value: 0.5, style: 'unicode', comma: false });
  assert.deepEqual(parseNumber('1½'), { value: 1.5, style: 'unicode', comma: false });
  assert.deepEqual(parseNumber('2 ¾'), { value: 2.75, style: 'unicode', comma: false });
  assert.equal(parseNumber('1/0'), null);
  assert.equal(parseNumber('abc'), null);
});

test('formatFraction and formatDecimal', () => {
  assert.equal(formatFraction(1.5), '1½');
  assert.equal(formatFraction(1.5, { ascii: true }), '1 1/2');
  assert.equal(formatFraction(0.25), '¼');
  assert.equal(formatFraction(0.75, { ascii: true }), '3/4');
  assert.equal(formatFraction(1 / 3), '⅓');
  assert.equal(formatFraction(7 / 3), '2⅓');
  assert.equal(formatFraction(0.875), '⅞');
  assert.equal(formatFraction(3 * (1 / 3)), '1');
  assert.equal(formatFraction(0.9999), '1');
  assert.equal(formatFraction(2), '2');
  assert.equal(formatFraction(2.4), '2.4'); // no close kitchen fraction
  assert.equal(formatFraction(0.01), '0.01');
  assert.equal(formatDecimal(266.666), '267');
  assert.equal(formatDecimal(21.666), '21.7');
  assert.equal(formatDecimal(2.25, { comma: true }), '2,25');
  assert.equal(formatDecimal(3.1), '3.1');
  assert.equal(formatDecimal(0.004), '0.004');
});

const scales = [
  // [creator's amount, factor, scaled]
  ['800g', 2, '1600g'],
  ['800g', 1 / 3, '267g'],
  ['15g', 1 / 3, '5g'],
  ['65g', 1 / 3, '21.7g'],
  ['1.5dl', 2, '3dl'],
  ['1.5dl', 1 / 3, '0.5dl'],
  ['1,5 dl', 1.5, '2,25 dl'],
  ['1,000 g', 2, '2000 g'],
  ['2 tbsp', 0.5, '1 tbsp'],
  ['2 tbsp', 0.25, '½ tbsp'],
  ['2 tbsp', 1 / 3, '⅔ tbsp'],
  ['3 tbsp', 1 / 3, '1 tbsp'],
  ['3', 0.5, '1½'],
  ['7', 1 / 3, '2⅓'],
  ['1', 0.1, '0.1'],
  ['Juice of 1/2 lime', 2, 'Juice of 1 lime'],
  ['Juice of 1/2 lime', 4, 'Juice of 2 limes'],
  ['200g / 2dl', 2, '400g / 4dl'],
  ['about 1 cup', 2, 'about 2 cups'],
  ['approx. 200 g', 1.5, 'approx. 300 g'],
  ['approximately 2 cups', 0.5, 'approximately 1 cup'],
  ['~ 100 ml', 2, '~ 200 ml'],
  ['½ cup (about 110 g)', 2, '1 cup (about 220 g)'],
  ['½ cup (about 110 g)', 4, '2 cups (about 440 g)'],
  ['1½ cups', 0.5, '¾ cup'],
  ['1 ½ tsp', 2, '3 tsp'],
  ['1 1/2 cups', 2, '3 cups'],
  ['1 1/2 cups', 0.5, '3/4 cup'],
  ['½ tsp', 3, '1½ tsp'],
  ['1/2–1', 2, '1–2'],
  ['1/2–1', 0.5, '1/4–1/2'],
  ['½–1 tsp', 0.5, '¼–½ tsp'],
  ['2-3', 1.5, '3-4½'],
  ['2 to 3 cloves', 2, '4 to 6 cloves'],
  ['1 can', 2, '2 cans'],
  ['1 Can', 3, '3 Cans'],
  ['2 packets', 0.5, '1 packet'],
  ['1 large onion', 2, '2 large onions'],
  ['3 large eggs', 0.5, '1½ large eggs'],
  ['2 eggs', 0.5, '1 egg'],
  ['1 egg', 0.5, '½ egg'],
  ['1 medium', 2, '2 medium'],
  ['2 whole garlic bulbs', 2, '4 whole garlic bulbs'],
  ['2 lb (~907 g)', 2, '4 lb (~1814 g)'],
  ['2 tbsp (30 ml)', 0.5, '1 tbsp (15 ml)'],
  ['1 tsp spoken / 1 tbsp in description', 2, '2 tsp spoken / 2 tbsp in description'],
  ['20 g (for both)', 2, '40 g (for both)'],
  ['1 tsp each', 2, '2 tsp each'],
  ['2 x 400g tins', 2, '4 x 400g tins'],
  ['2 × 400 g', 3, '6 × 400 g'],
  ['500g 5% beef mince', 2, '1000g 5% beef mince'],
];

test('scales plain numbers and units, keeping the rest of the text', () => {
  for (const [input, factor, expected] of scales) {
    const r = scaleAmount(input, factor);
    assert.equal(r.amount, expected, `${input} × ${factor}`);
    assert.equal(r.scaled, true, input);
    assert.equal(r.reason, 'scaled', input);
    assert.equal(r.original, input);
  }
});

const kept = [
  ['a good amount', 'words'],
  ['A handful', 'words'],
  ['a couple', 'words'],
  ['some', 'words'],
  ['enough for 12 subs', 'words'],
  ['½ a garlic head', 'words'],
  ['5%', 'words'],
  ['1/0 cup', 'words'],
  ['2 per person', 'per-unit'],
  ['20 g per roll', 'per-unit'],
  ['2–3 oz per patty; 2 patties per burger', 'per-unit'],
  ['1 apiece', 'per-unit'],
  [null, 'unstated'],
  ['   ', 'unstated'],
];

test('a count next to a pack size scales only the count', () => {
  // The weight is the size of one pack, so halving the recipe does not halve the tin.
  assert.equal(scaleAmount('1 400g can', 0.5).amount, '½ 400g can');
  assert.equal(scaleAmount('1 400g can', 2).amount, '2 400g cans');
  assert.equal(scaleAmount('2 (400g) cans', 0.5).amount, '1 (400g) can');
  assert.equal(scaleAmount('1 (14 oz) can', 2).amount, '2 (14 oz) cans');
  assert.equal(scaleAmount('2 cans (400g each)', 0.5).amount, '1 can (400g each)');
  assert.equal(scaleAmount('2 x 400g (14 oz)', 0.5).amount, '1 x 400g (14 oz)');
  // A measure and its bracketed equivalent still both scale, and a slash pack stays whole.
  assert.equal(scaleAmount('2 x 400g/14oz', 0.5).amount, '1 x 400g/14oz');
  assert.equal(scaleAmount('½ cup (about 110 g)', 0.5).amount, '¼ cup (about 55 g)');
  assert.equal(scaleAmount('2 tbsp (30 ml)', 0.5).amount, '1 tbsp (15 ml)');
});

test('a bracket scales unless it is a pack size', () => {
  const rows = [
    ['3 eggs (about 150 g)', '6 eggs (about 300 g)'],
    ['4 chicken thighs (about 600 g)', '8 chicken thighs (about 1200 g)'],
    ['8 ounces (225 g)', '16 ounces (450 g)'],
    ['8 fl oz (240 ml)', '16 fl oz (480 ml)'],
    ['2 heaped tbsp (40 g)', '4 heaped tbsp (80 g)'],
    ['1 scant cup (about 100 g)', '2 scant cups (about 200 g)'],
    ['2 sticks (1 cup) butter', '4 sticks (2 cups) butter'],
    ['1 lemon (2 tbsp juice)', '2 lemons (4 tbsp juice)'],
    ['1 pint (568 ml)', '2 pint (1136 ml)'],
    ['2 x 400g tins (about 3 cups)', '4 x 400g tins (about 6 cups)'],
  ];
  for (const [input, expected] of rows) {
    assert.equal(scaleAmount(input, 2).amount, expected, input);
  }
  // Straight after the count, or after a container: the bracket is the pack size and stays.
  assert.equal(scaleAmount('2-3 (200g) fillets', 2).amount, '4-6 (200g) fillets');
  assert.equal(scaleAmount('2 cans (400g)', 2).amount, '4 cans (400g)');
  assert.equal(scaleAmount('1 jar (500 g)', 2).amount, '2 jars (500 g)');
});

test('a kept bracket does not take the plural of the container count', () => {
  // Cups and spoons scale (they are the whole amount). A clove inside the bracket stays as written.
  assert.equal(scaleAmount('2 jars (about 2 cloves)', 0.5).amount, '1 jar (about 2 cloves)');
  assert.equal(scaleAmount('1 jar (about 1 clove) salsa', 2).amount, '2 jars (about 1 clove) salsa');
});

test('a total, or a cup or spoon, scales even after a container', () => {
  const doubled = [
    ['2 cans (800g total)', '4 cans (1600g total)'],
    ['2 packs (16 oz total)', '4 packs (32 oz total)'],
    ['2 cans (800 g in total)', '4 cans (1600 g in total)'],
    ['2 cans (800g altogether)', '4 cans (1600g altogether)'],
    ['2 cans (800g combined)', '4 cans (1600g combined)'],
    ['2 cans (800g in all)', '4 cans (1600g in all)'],
    ['2 jars (about 2 cups)', '4 jars (about 4 cups)'],
    ['2 tins (about 3 cups)', '4 tins (about 6 cups)'],
    ['2 tubs (2 cups) ricotta', '4 tubs (4 cups) ricotta'],
    ['1 can (1½ cups)', '2 cans (3 cups)'],
    ['1 jar (about 1 cup) salsa', '2 jars (about 2 cups) salsa'],
    ['2 cans (1 tsp)', '4 cans (2 tsp)'],
    ['2 jars (1 tbsp)', '4 jars (2 tbsp)'],
  ];
  for (const [input, expected] of doubled) {
    assert.equal(scaleAmount(input, 2).amount, expected, input);
  }
  assert.equal(scaleAmount('2 jars (about 2 cups)', 0.5).amount, '1 jar (about 1 cup)');
  assert.equal(scaleAmount('1 can (1½ cups) coconut milk', 0.5).amount, '½ can (¾ cup) coconut milk');
  assert.equal(scaleAmount('1 bag (about 6 cups) spinach', 6.1 / 6).amount, '1 bag (about 6.1 cups) spinach');
  // "each" is still one container, so the cup stays.
  assert.equal(scaleAmount('2 cans (1 cup each)', 2).amount, '4 cans (1 cup each)');
});

test('an adjective before a bracket still leaves the can size alone', () => {
  const rows = [
    ['1 large (28 oz) can', '2 large (28 oz) cans'],
    ['1 small (8 oz) can tomato sauce', '2 small (8 oz) cans tomato sauce'],
    ['1 big (400g) tin', '2 big (400g) tins'],
  ];
  for (const [input, expected] of rows) {
    assert.equal(scaleAmount(input, 2).amount, expected, input);
  }
  // A weight after an adjective is the ingredient itself when no container follows.
  assert.equal(scaleAmount('2 large (about 300g) potatoes', 2).amount, '4 large (about 600g) potatoes');
});

test('a pack size written "oz." stays the size of one can', () => {
  // The period is part of the unit, so the weight is not a second measure.
  assert.equal(scaleAmount('1 15 oz. can', 2).amount, '2 15 oz. cans');
  assert.equal(scaleAmount('1 15 oz. can', 0.5).amount, '½ 15 oz. can');
  const household = scaleAmount('1 15 oz. can', 6.1 / 6);
  assert.equal(household.amount, '1 15 oz. can');
  assert.equal(household.scaled, true);
});

test('a bare pack size keeps its weight when the unit is spelled out', () => {
  const rows = [
    ['1 14-ounce can', '2 14-ounce cans'],
    ['1 14 ounce can', '2 14 ounce cans'],
    ['1 28-oz can', '2 28-oz cans'],
    ['1 250g tub', '2 250g tub'],
    ['1 330ml bottle', '2 330ml bottle'],
    ['1 large 800g tin', '2 large 800g tins'],
  ];
  for (const [input, expected] of rows) {
    assert.equal(scaleAmount(input, 2).amount, expected, input);
  }
});

test('the count word agrees with the number as shown, after rounding', () => {
  assert.equal(scaleAmount('1½ cups', 0.67).amount, '1 cup'); // 1.005 is shown as 1
  assert.equal(scaleAmount('2 cans', 0.505).amount, '1 can');
  assert.equal(scaleAmount('1 cup', 1.01).amount, '1 cup');
  assert.equal(scaleAmount('1 cup', 1.5).amount, '1½ cups');
  assert.equal(scaleAmount('2 cans', 0.5).amount, '1 can');
});

test('leaves words, rates and missing amounts exactly as they were', () => {
  for (const [input, reason] of kept) {
    const r = scaleAmount(input, 2);
    assert.equal(r.reason, reason, String(input));
    assert.equal(r.scaled, false, String(input));
    assert.equal(r.amount, reason === 'unstated' ? null : input, String(input));
  }
});

test('a number that rounds back to the same text was still scaled', () => {
  for (const amount of ['1 cup', '1 tsp']) {
    const r = scaleAmount(amount, 6.1 / 6);
    assert.equal(r.amount, amount, amount);
    assert.equal(r.reason, 'scaled', amount);
    assert.equal(r.scaled, true, amount);
  }
  assert.equal(scaleAmount('a good amount', 6.1 / 6).reason, 'words');
});

test('factor 1 changes nothing; a bad factor throws', () => {
  assert.deepEqual(scaleAmount('800g', 1), { amount: '800g', original: '800g', scaled: false, reason: 'same' });
  for (const f of [0, -1, NaN, Infinity, '2', null]) assert.throws(() => scaleAmount('800g', f), RangeError, String(f));
});

test('scaleIngredient and scaleRecipe mark what changed', () => {
  const s = scaleIngredient({ item: 'Chicken', key: 'chicken', amount: '800g', basis: 'spoken' }, 1.5);
  assert.deepEqual(s, {
    item: 'Chicken', key: 'chicken', amount: '1200g', basis: 'spoken', scaled: true, originalAmount: '800g', scaleReason: 'scaled',
  });
  // An amount on an unstated ingredient is never shown, scaled or not.
  assert.equal(scaleIngredient({ item: 'Salt', key: 'salt', amount: '1 tsp', basis: 'unstated' }, 2).amount, null);

  const recipe = {
    id: 'r', title: 'R', serves: '4', nutrition: { per: 'serving', calories: 500 },
    components: [{ name: 'Main', steps: [{ text: 'Cook.', t: 3 }], ingredients: [
      { item: 'Chicken', key: 'chicken', amount: '800g', basis: 'spoken' },
      { item: 'Salt', key: 'salt', amount: 'a pinch', basis: 'spoken' },
      { item: 'Rice', key: 'rice', amount: '2 per person', basis: 'spoken' },
      { item: 'Oil', key: 'cooking oil', amount: null, basis: 'unstated' },
    ] }],
  };
  const out = scaleRecipe(recipe, 2);
  assert.deepEqual(out.scale, { factor: 2, scaled: 1, kept: 2, unstated: 1 });
  assert.deepEqual(out.components[0].ingredients.map((i) => i.amount), ['1600g', 'a pinch', '2 per person', null]);
  assert.deepEqual(out.components[0].steps, recipe.components[0].steps);
  assert.deepEqual(out.nutrition, recipe.nutrition);
  assert.equal(recipe.components[0].ingredients[0].amount, '800g', 'the input is not mutated');
  assert.deepEqual(scaleRecipe(recipe, 1).scale, { factor: 1, scaled: 0, kept: 0, unstated: 1 });
});

test('parseServes only trusts a single plain number', () => {
  assert.deepEqual(parseServes('4'), { count: 4, unit: null });
  assert.deepEqual(parseServes('10 bowls'), { count: 10, unit: 'bowls' });
  assert.deepEqual(parseServes('about 12 nuggets'), { count: 12, unit: 'nuggets' });
  assert.deepEqual(parseServes('2 wraps (the description lists 2 flatbreads)'), { count: 2, unit: 'wraps' });
  assert.deepEqual(parseServes('serves 4'), { count: 4, unit: null });
  assert.equal(parseServes('2 thighs per person'), null);
  assert.equal(parseServes('Approximately 2 large sandwiches or 4 smaller sandwiches'), null);
  assert.equal(parseServes('12 bars in the description; 5 bars in the spoken tutorial (unresolved)'), null);
  assert.equal(parseServes('4-6'), null);
  assert.equal(parseServes('0'), null);
  assert.equal(parseServes('not stated'), null);
  assert.equal(parseServes(null), null);
});

test('factorFor and formatFactor', () => {
  assert.equal(factorFor({ serves: '4' }, 6), 1.5);
  assert.equal(factorFor({ serves: '10 bowls' }, 5), 0.5);
  assert.equal(factorFor({ serves: '2 thighs per person' }, 4), null);
  assert.equal(factorFor({ serves: '4' }, 0), null);
  assert.equal(factorFor({ serves: '4' }, 'x'), null);
  assert.equal(formatFactor(2), '×2');
  assert.equal(formatFactor(0.5), '×½');
  assert.equal(formatFactor(1.5), '×1½');
});

test('every real amount either scales or is kept word for word', async () => {
  const dir = resolve(import.meta.dirname, '..', 'recipes');
  let scaledCount = 0;
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(await readFile(join(dir, f), 'utf8'));
    for (const factor of [0.5, 2, 3]) {
      const out = scaleRecipe(r, factor);
      out.components.forEach((c, ci) => c.ingredients.forEach((ing, ii) => {
        const before = r.components[ci].ingredients[ii];
        const where = `${f} ${before.item} "${before.amount}" × ${factor}`;
        if (ing.scaled) {
          assert.notEqual(ing.amount, before.amount, where);
          assert.match(ing.amount, /\d|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/, where);
          scaledCount++;
        } else {
          assert.equal(ing.amount, before.basis === 'unstated' ? null : before.amount, where);
        }
      }));
    }
  }
  assert.ok(scaledCount > 100, `only ${scaledCount} amounts scaled`);
});
