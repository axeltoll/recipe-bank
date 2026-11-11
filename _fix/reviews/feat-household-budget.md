Verdict: GO WITH NITS at f10941df2e7bbe0b412c351aa7267fd2b7a7eac7 · Reviewer: claude fable-5.2 (recipe-bank-pam lane) · Author: codex gpt-6.1-sol (recipe-bank-pam lane)

# feat/household-budget

Reviewed by reading only: no shell, no Node, no browser in this lane. Line numbers refer to the files under `_review/feat-household-budget/`.

I found no real defect. The money arithmetic, the ISO-week logic and the escaping all hold up when traced by hand. The lane's report says the modules were never rendered in a browser; the first nit below is the one thing I would check on the deployed copy before linking to the preview from anywhere.

## Nits, most useful first

### 1. The preview may not load on the deployed static copy
`public/features/household-demo.html:34-35`, `scripts/build-static.mjs:38-44` (unchanged from main)

- **What goes wrong:** the page loads `./household.mjs`, `./budget.mjs` and `./shared.mjs` as modules. The static build writes a `_headers` file that sets a JavaScript `Content-Type` for `/lib/*` only. If the host needs that header for `.mjs` files, which is presumably why the rule exists, the three files under `/features/` are refused as module scripts and the preview is blank. Locally `server.mjs` serves `.mjs` correctly, so this shows only after deploy.
- **Evidence it is real:** `feat/roadmap-functions` adds a `/features/*.mjs` rule to the same `_headers` block for its own modules.
- **Fix:** add `/features/*.mjs` with the same `Content-Type` to `_headers` in `scripts/build-static.mjs`, or make sure the branch that already does it merges first. The README links to this page, so it should work wherever the README is read.

### 2. Every validation builds a fresh `Intl.NumberFormat`
`lib/budget.mjs:6-9` (`currencyDigits`), used by `toMinor`, `validateShop` and `formatMoney`

- **What goes wrong:** the CSV import allows 10,000 shops. Each render validates every shop several times (`summary`, the ledger list, the CSV export in `public/features/budget.mjs:44, 63, 66`) and formats each one, so one click constructs tens of thousands of formatters and the page stalls.
- **Fix:** cache the digits per currency in a `Map`, and the formatter per `locale + currency`.

### 3. `today` is fixed when the module mounts
`public/features/budget.mjs:89`

- **What goes wrong:** a tab left open over midnight, or over a Sunday night, keeps showing the old period as current until reload.
- **Fix:** read `localToday()` inside `render` and `changed` unless `options.today` was passed.

### 4. Two roadmap items are ticked, but the features are a standalone preview
`ROADMAP.md:23, 25`, `README.md:15-16`

- **What goes wrong:** nothing in the dashboard links to `/features/household-demo.html`, and "Amounts for your household" correctly stays open. The README wording ("in the standalone preview") is honest; the roadmap ticks read as "shipped in the app".
- **Also:** the two new README bullets sit above the existing list with a blank line after them, which splits it into two lists.
- **Fix:** move the bullets to the end of the list, and either leave the roadmap boxes open until the modules are mounted in the dashboard or add "(standalone preview)" to the two lines.

### 5. Smaller points

- **`lib/budget.mjs:3`: `Intl.supportedValuesOf` at module load.** A browser without it (Safari before 15.4) throws on import and neither feature mounts. A `try` with a short fallback list would degrade more gently.
- **`lib/budget.mjs:3-5`: non-money ISO codes pass** (`XXX`, `XAU`, `XTS`), because the runtime lists them. Harmless.
- **`lib/budget.mjs:154-163`: CSV export writes notes literally.** A note that starts with `=`, `+`, `-` or `@` is a formula if the file is opened in a spreadsheet. The file is the user's own data and HOUSEHOLD.md says it is meant for this importer; a sentence in the UI's export help would be enough.
- **`lib/budget.mjs:166-205`: a blank line inside or at the end of a CSV rejects the whole import** as "expected five columns". Strict by design; skipping fully empty rows is friendlier for hand-edited files.
- **`public/features/budget.mjs:7`: the default currency is hard-coded** to `SEK`. Deriving it from the locale, or starting empty, suits a public repo better.
- **`public/features/HOUSEHOLD.md:58, 63` uses internal process words** ("the week-plan/serving-scaling lane", "the week-plan lane/PAM"). Nothing private, but meaningless to a reader of the public repo; say "the week plan" instead.
- **`public/features/HOUSEHOLD.md`** lives under `public/` and is therefore served and deployed. Harmless; `docs/` would be the more usual place.
- **Storage format:** budgets and shops are persisted as the decimal strings the user typed (`'25.50'`), and converted to integer minor units for every calculation. That is exact and round-trips through CSV, so I am not asking for a change; note that a stored amount is interpreted with the runtime's current digits for that currency.

## Checked and found in order

**Escaping of every rendered string**
- `public/features/shared.mjs:2-3` escapes `& < > " '`. I followed every interpolation in `renderHousehold`, `renderBudget`, `renderBudgetSummary`, `renderSpendChart` and `renderNotice`: each dynamic value goes through `esc()` or is a literal, including attribute values, the CSV inside the `<textarea>`, the SVG text and the error list.
- Validation errors shown after a submit are written with `textContent` (`budget.mjs:113, 125`, `household.mjs:60-61`).
- Shop notes cannot contain control characters or line breaks (`lib/budget.mjs:70`).

**Storage access**
- The storage object is fetched lazily inside `try` (`shared.mjs:11-24`), so a `localStorage` getter that throws is handled as well as a failing `getItem` or `setItem`.
- Corrupt JSON, a wrong shape, invalid shops and quota errors leave the forms usable and show a notice. Only documented fields are written back (`cleanBudget`, `cleanShop`, `normalizeProfile`).

**Money in minor units**
- `toMinor` (`lib/budget.mjs:12-29`) parses the decimal text with `BigInt`, rounds half-up at the currency's precision and refuses anything beyond `Number.MAX_SAFE_INTEGER`. No float multiplication.
- All sums are integer minor units with an overflow check (`safeAdd`); ratios are `BigInt` divisions, half-up.
- `formatMoney` formats the major part as a `BigInt` and splices the fraction, so no cent is lost near the safe limit; `-$0.01` keeps its sign.
- Currencies are never converted or mixed: foreign-currency shops are totalled separately and excluded from spend, remaining and ratios.

**ISO weeks**
- `periodOf` (`lib/budget.mjs:85-101`) uses UTC arithmetic, Monday as the first day and the Thursday's year.
- I checked by hand: 2021-01-01 → 2020-W53, 2018-12-31 → 2019-W01, 2026-12-31 → 2026-W53, 2026-11-11 → 2026-W46, 0099-01-05 → 0099-W02 (via the 400-year cycle).
- Month ends, leap days and the year 0001 and 9999 limits behave as documented; out-of-range periods throw instead of returning a truncated date.
- The UI passes the device's local date, so "this week" is the user's week.

**No names or personal data**
- A profile is counts per age group, a portion size, two day counts and portion factors. There is no name, birthday, email or free-text person field, and `normalizeProfile` drops unknown fields (tested with a stored `name`).
- The only free text is the optional shop note: 200 characters, one line, device-local.
- No network request anywhere in the five modules.

**Contract, dependencies, privacy**
- No recipe, queue, server, `app.js` or `package.json` change; no dependency.
- No private names, paths, hosts or accounts in code, docs or tests.

**Tests**
- I traced the arithmetic, period, CSV and UI tests by hand, including the summary expectations (`330`, `9670`, `165`), the half-up cases and the fake-element mount tests. They test what they claim.
- Not covered: real browser rendering, native form validation, and persistence across a real reload, as the lane's report states.
