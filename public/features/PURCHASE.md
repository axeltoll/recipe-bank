# Purchase amounts for your household

How much chicken, rice or cheese to buy for the week, for the people in the household profile. It builds on the week plan and combined shopping list (`lib/plan.mjs`), serving scaling (`lib/scale.mjs`) and the household profile (`lib/household.mjs`). Like those, it is not wired into `public/app.js` yet.

| Part | File |
|---|---|
| Logic, pure | `lib/purchase.mjs`: `purchaseList`, `purchaseListText`, `householdLine`, `parseMeasure`, `unitKey`, `normalizePantry`, `planCostEstimate`, `DEFAULT_PANTRY`, `FLAGS` |
| UI | the purchase option of `public/features/shopping-list.mjs` (`mount(el, { household: true })`) |
| Tests | `test/purchase.test.mjs`, `test/purchase-ui.test.mjs` |
| Prices groundwork | `lib/prices.mjs`, `test/prices.test.mjs`, [docs/PRICES.md](../../docs/PRICES.md) |

## In the dashboard

```js
import { mount } from '/features/shopping-list.mjs';

// Same module and the same week plan as the plain shopping list, with purchase amounts on top.
const shop = mount(document.querySelector('#shop'), { recipes: state.recipes, household: true });
// Switch back to the creator-amounts view at any time:
shop.update({ household: false });
```

With `household: true` the module:

- reads the household profile the household module saved (`recipe-bank:household`) and re-renders on its `recipe-bank:household-change` event and on `storage` events from other tabs. Pass `profile` to use a fixed profile instead (then the events are ignored);
- shows "For 2 adults, 1 child aged 6-10 (2.6 servings per meal)" above the list;
- shows, per ingredient, the amount to buy, a **check** badge when part of it could not be scaled, and under it every creator amount it came from (`800g → 520g`, or the creator's words);
- lists recipes that were not scaled and why ("Not scaled: Banana milk (servings not stated, shown as written)");
- leaves the **pantry** out and says so: "Left out: you have these: salt, black pepper." The pantry is editable in place (remove a chip, add keys, reset to the default) and stored under `rb:pantry` (default `salt`, `black pepper`, `cooking oil`); every read and write is in try/catch, and an emptied pantry stays empty;
- copies the purchase list as text (grouped by aisle, flags spelled out) and has a **Print** button; the print stylesheet hides the buttons and the pantry editor.

Without the option nothing changes: the module renders and copies the plain shopping list, and it does not read the household or pantry keys (`test/purchase-ui.test.mjs` checks this).

Extra options: `profile`, `pantry` (initial list), `householdKey`, `pantryKey`. Extra controller methods: `getPurchase()` (the `purchaseList()` result, `null` when the option is off), `getPantry()`, `setPantry(keys)`. Extra event: `rb:pantry-change`, `detail: { pantry }`. Checkboxes share `rb:shopping-checked` with the plain list, because both are keyed by ingredient key. Added lines in the module and its stylesheet are marked `purchase option`.

## How amounts are worked out

`purchaseList(plan, recipes, profile, { pantry, aisles, servesOverride })`:

1. **Servings.** The household's servings per meal come from `servingsPerMeal(profile)` (age factors and portion size already applied). A recipe is scaled by *servings per meal ÷ what it serves × times planned*. Only a plain number of servings counts: `"4"`, `"4 servings"`, `"10 bowls"`. Not scaled, and flagged:
   - `serves: null`: *servings not stated, shown as written*;
   - a rate or two numbers (`"2 thighs per person"`, `"2 large or 4 smaller"`): *servings not a plain number*;
   - items rather than servings (`"12 nuggets"`, `"9 rolls"`, `"7 burritos"`): *recipe makes items, not servings*. How many nuggets one person eats is not ours to guess. The caller can pass the user's own answer as `servesOverride: { 'air-fried-chicken-nuggets': 4 }`; nothing fills it in automatically.
2. **Reading an amount.** `parseMeasure` reads one number or range and a unit: `800g`, `1.5dl`, `1,5 dl`, `1 1/2 cups`, `1½ cups`, `¾ tbsp`, `2–3 cloves`, `2 to 3 cloves`, `about 1 cup` (kept as *about*), `½ cup (about 110 g)` (text in brackets is ignored), `Juice of 1/2 lime` (½ lime), `1 large`, `2 whole garlic bulbs`. Everything else keeps the creator's words.
3. **Adding up.** Amounts with the same unit are added. Exact metric relations are used: g and kg, ml/cl/dl/l, oz and lb. Nothing else is converted, so grams and cups, spoons and millilitres, and `1 large` and `2` stay separate parts of one line: `rice: 1½ cups + 200 g`. A total is shown in the largest unit a creator used that it reaches, and grams and millilitres move up to kg and l at 1000: `800g` twice plus `1 kg` reads `2.6 kg`.
4. **Flags.** A source amount that could not be scaled is shown as written, after the totals (`chicken: 520 g + 2 per person`), and the line is flagged with one of `FLAGS`: `words` (*given in words*), `unparsed` (*could not read the amount*, e.g. `1/0 cup`), `per-unit` (*given per person or per item*; a rate already follows the servings), `unstated` (*amount not given*), `serves-unstated`, `serves-unclear`, `serves-items`. An amount that scales but has two measures or a pack size (`200g / 2dl`, `2 x 400g tins`) is scaled as text (`100g / 1dl`) and kept apart, without a flag.
5. **Pantry.** Keys in `pantry` are removed and listed in `leftOut`.

The result keeps everything the UI needs to show where a number came from:

```js
{
  servings: 2.6, household: '2 adults, 1 child aged 6-10', people: 3, meals: 4,
  recipes: [{ id, title, times, days, serves, servesCount, factor, flag }],
  groups: [{ aisle, label, items: [{
    key: 'chicken', amount: '520 g + 2 per person', flags: ['serves-unstated'], flagged: true,
    parts: [{ kind: 'total', unit: 'g', lo: 520, hi: 520, approx: false, text: '520 g', sources: [0] },
            { kind: 'text', unit: null, text: '2 per person', flag: 'serves-unstated', sources: [1] }],
    sources: [{ recipeId, title, item, original: '800g', amount: '520g', status: 'added', factor: 0.65, times: 1, … }, …],
  }] }],
  leftOut: ['salt'], itemCount, flaggedCount,
}
```

Amounts are scaled exactly, not rounded up to packs: `0.05 can` for one toddler is the honest answer, and rounding to what a shop sells belongs with prices.

## Cost estimate (from the food budget)

`planCostEstimate(purchase, summary)` multiplies the food budget's recorded spend per meal (`summary().perMealMinor` in `lib/budget.mjs`) by the number of planned meals, and divides by the head count for a per-person figure, the same way the budget counts people. It returns `null` until the budget has recorded shops with meal counts. It is a rough figure from past spending, not a price for this list; per-item prices are what `lib/prices.mjs` prepares for.
