# Household and budget features

These standalone modules use plain ES modules, with no dependencies, requests or server writes. Load the two CSS files once. A local preview is at `/features/household-demo.html` after `npm start`; the static build includes the same page.

```js
import { mount as mountHousehold } from '/features/household.mjs';
import { mount as mountBudget } from '/features/budget.mjs';

const householdElement = document.querySelector('#household');
const householdUI = mountHousehold(householdElement);
const budgetUI = mountBudget(document.querySelector('#budget'), { householdElement });
// Before replacing either container:
householdUI.destroy();
budgetUI.destroy();
```

Each `mount(element, options = {})` renders only inside its container and returns `destroy()` to remove its listeners and markup. Household accepts `profile` as an optional initial override. Budget accepts `household`, `today` (`YYYY-MM-DD`), `locale` (Intl locale), and `householdElement` to listen for profile changes. It also returns `setHousehold(profile)` for explicit integration. Mount the household first if supplying a saved profile yourself, and pass that same profile to budget. No stylesheet or dashboard script is imported by the modules.

Both accept `storage`, a Storage-compatible object for embedding/tests; `storage: null` explicitly disables persistence. Otherwise they access localStorage lazily inside try/catch. Missing storage, security errors, corrupt JSON and quota failures leave forms usable in memory and show a notice. Keys:

- `recipe-bank:household`: the normalized profile.
- `recipe-bank:budget`: `{ budget, shops }`, written together when settings or shops change.

Only documented fields are persisted. Changing a currency retains all shops; amounts are never converted. Invalid saved shops are skipped with a visible warning. There is no cross-tab synchronization, account, backend, or automatic collection of costs. Optional shop notes are short, device-local purchase notes; the household has no names or free-text person fields.

## Household contract and week-plan integration

`lib/household.mjs` exports `defaultProfile()`, `validateProfile(p)` (array of problems), `normalizeProfile(p)`, `servingsPerMeal(p)` and `describeProfile(p)`. A profile has this shape:

```js
{
  people: { adult: 2, teen: 0, child11to13: 0, child6to10: 1, child2to5: 0, toddler: 0 },
  portionSize: 'normal', // light | normal | hearty
  vegetarianDays: 0,
  cookingDays: 5,
  portionFactors: {
    age: { adult: 1, teen: 1, child11to13: 0.8, child6to10: 0.6, child2to5: 0.4, toddler: 0.2 },
    size: { light: 0.8, normal: 1, hearty: 1.2 }
  }
}
```

Counts are integers 0–100 per group, with at least one person. Days are integers 0–7; vegetarian days and cooking days are independent (a vegetarian day need not be home-cooked). Factors are numbers 0.1–3. Missing factors use the single exported `DEFAULT_PORTION_FACTORS` table. They are rough common adult-equivalent estimates, not a precise dietary scale. Every factor can be changed in the form. Normalization fills defaults, clamps and rounds counts/days, discards unknown fields and replaces an all-zero household with one adult. Validation rejects invalid inputs rather than silently clamping them.

The week plan should use `servingsPerMeal(profile)` for the estimated number of adult-equivalent servings **per meal**, a number rounded to one decimal with a minimum of `0.1` so small custom factors still give a usable target. Do not multiply again by the number of people or by cooking days. The function already applies age factors and portion size. Cooking/vegetarian days are planning preferences, not serving multipliers. For example, two adults and a child aged 6–10 at normal size gives `2.6` servings.

```js
import { defaultProfile, normalizeProfile, servingsPerMeal } from '/lib/household.mjs';
import { HOUSEHOLD_KEY } from '/features/household.mjs';
import { readStored } from '/features/shared.mjs';

// Reads, including access to the storage getter, must stay inside try/catch.
let profile = normalizeProfile(readStored(() => localStorage, HOUSEHOLD_KEY, defaultProfile()).value);
let targetServings = servingsPerMeal(profile);
householdElement.addEventListener('recipe-bank:household-change', (event) => {
  profile = event.detail.profile;
  targetServings = event.detail.servingsPerMeal;
  // Pass targetServings to the week plan and serving scaling.
  // Recompute its combined shopping list; preserve amounts that cannot be scaled.
});
```

The event bubbles from the mounted element after a valid save, even if storage fails: `recipe-bank:household-change`, detail `{ profile, servingsPerMeal }`. Initial mount does not emit an event. Read initial state or supply a shared profile as above. The household module itself changes no routes and no recipe quantities. In the dashboard, `features/household-target.js` reads the saved profile and hands the serving target to serving scaling and the week plan.

## Budget contract

`lib/budget.mjs` exports `validateBudget`, `validateShop`, `periodOf`, `summary`, `toMinor`, `formatMoney`, `currencyDigits`, `isCurrency` and `isDate`.

- Budget: `{ period: 'week' | 'month', amount: '100.00', currency: 'SEK' }`. Amounts can be decimal strings or finite numbers, non-negative, and must fit in safe integer minor units. A zero budget works as a spend tracker.
- Shop: `{ date: '2026-11-11', total: '25.50', currency: 'SEK', meals: 2, note: 'pantry' }`. `meals` is optional; if present it is a positive safe integer. `note` is optional, single-line, at most 200 characters. Dates must be real calendar dates in years 0001–9999. Currency must be an uppercase ISO 4217 currency supported by the runtime's `Intl.supportedValuesOf('currency')`; arbitrary three-letter strings are rejected.
- `toMinor` uses decimal half-up rounding at the currency's minor-unit precision (JPY: 0, SEK: 2, KWD: 3). All sums use safe integer minor units. Overflow throws a visible error instead of losing precision. `formatMoney` uses Intl and preserves minor units even near the safe integer limit.
- `periodOf(date, period)` returns `{ key, start, end }`, inclusive date boundaries. Weeks start Monday, with ISO week numbers and week-years (January 1 can belong to the previous year); months are calendar months. Dates use UTC arithmetic without daylight-saving shifts. Period boundaries and requested history must stay within years 0001–9999; otherwise an error is thrown rather than returning a truncated expanded-year date.
- `summary(budget, shops, { household, today, periods = 8 })` returns the current period's `key`, `start`, `end`, `currency`, `amountMinor`, `spendMinor`, `remainingMinor`, `shopCount`, `meals`, `mealSpendMinor`, `perMealMinor`, `perPersonMinor`, `otherCurrencies`, plus `people`, `invalidShops` and `history`. `history` is the last 1–52 periods in chronological order, including the current period and empty periods. `today` defaults to the UTC date in pure logic; the UI supplies the device's local calendar date.
- Per-meal cost divides only spend from same-currency shops with explicit meal counts by those recorded meals. Other shops are included in spend, but excluded from that denominator and numerator. Per-person cost divides period spend by the current actual head count, **not** adult-equivalent servings. Ratios round to the nearest minor unit, half-up, and return `null` if unavailable. No meal count is inferred from cooking days. Current household/settings apply to historical rows; past profiles or budgets are not reconstructed. All dated shops within a period are counted, even dates later than today in the current period.
- `otherCurrencies` contains `{ currency, spendMinor, shopCount }` per foreign currency for that period. They are flagged and excluded from budget spend, remaining and ratios. `invalidShops` reports input indexes/problems, without treating bad records as zero. Invalid budgets or options throw. The UI sanitizes persisted data and shows warnings.

After a budget save, shop addition/removal, or CSV import, the element emits the bubbling `recipe-bank:budget-change` event with `{ budget, shops, summary }`. The summary can be `null` if aggregate amounts overflow or period dates are out of range; a rendered error explains the problem. Payloads are copies, so listeners cannot mutate stored state. Updating the household refreshes only the summary, preserving unfinished form entries and CSV text; it does not change budget data or emit a budget-change event.

`renderHousehold` and `renderBudget` are pure HTML renderers used by mount and node tests. All dynamic strings, including notes, status text, amounts and labels, are escaped by `shared.mjs`, which does not import app.js.

## CSV and chart

`exportShopsCsv(shops)` and `importShopsCsv(text)` in `lib/budget.mjs` use the exact header `date,total,currency,meals,note`. Export uses CRLF and quoted fields, escaping quotes by doubling them. Decimal inputs and literal notes are preserved. Import accepts LF/CRLF and an optional UTF-8 BOM, skips fully blank lines, validates every row, and rejects the entire import on invalid dates, amounts, currencies, meals, notes or quoting (row numbers in the message count blank lines, so they match the file). Limits are 1,000,000 text characters and 10,000 shops per import. The UI offers copy/paste export and append-only import; importing the same file twice creates duplicate records. No currency conversion or deduplication is implied. These files contain literal note text and are intended for this importer, which never executes it. Opened in a spreadsheet, a note that starts with `=`, `+`, `-` or `@` is read as a formula: open the file as text, or not at all.

Currencies come from the runtime's ISO 4217 list (`Intl.supportedValuesOf`), or a short fallback list in browsers without it; codes that are not money (`XAU`, `XTS`, `XXX` and the other `NON_MONEY` codes in `lib/budget.mjs`) are refused. The default budget currency is `SEK`; change it in the form.

`renderSpendChart(history, { locale })` in `public/features/budget.mjs` renders a dependency-free SVG bar chart, themed with the same text/accent variables. Each bar has its period and right-aligned exact amount above it, leaving room for large totals. In the UI, the chart keeps a readable minimum width inside a keyboard-focusable scrolling region on narrow screens. The adjacent table is the exact-value and assistive-technology alternative, including per-person/per-meal values and foreign-currency totals. The chart shows only spend in the budget currency.

## Theme properties

Every colour, spacing and radius is read through a custom property with a fallback. Both stylesheets scope rules to their own feature class. Set these on a parent or root; there are no global theme changes.

| Property | Fallback | Purpose |
|---|---|---|
| `--rb-text` | `#202b32` | Main text |
| `--rb-surface` | `#fff` | Feature surface |
| `--rb-input` | `#fff` | Form field background |
| `--rb-border` | `#c7d0d5` | Borders and separators |
| `--rb-muted` | `#52636e` | Secondary text |
| `--rb-accent` | `#286449` | Buttons, details link and chart bars |
| `--rb-on-accent` | `#fff` | Button text |
| `--rb-focus` | `#2873cc` | Visible keyboard focus |
| `--rb-danger` | `#a62727` | Errors and excluded-currency warning |
| `--rb-radius` | `0.75rem` | Feature/fieldset corners |
| `--rb-control-radius` | `0.375rem` | Input/button corners |
| `--rb-space-zero` | `0` | Reset spacing |
| `--rb-space-xs` | `0.25rem` | Label gaps and focus offset |
| `--rb-space-sm` | `0.5rem` | Small gaps/cell padding |
| `--rb-space-md` | `1rem` | Form gaps and margins |
| `--rb-space-lg` | `1.5rem` | Feature padding |
| `--rb-font` | `system-ui, sans-serif` | Font family |

Use a dark palette for text, surface, inputs and borders together. The preview includes a light/dark selector; a chart always has a textual table with exact values.
