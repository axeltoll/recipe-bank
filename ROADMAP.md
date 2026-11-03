# Roadmap

Work I plan to do on Recipe Bank, roughly in order. Estimates are my own and include tests and docs.

## Next

- [ ] **Week plan and combined shopping list** (~6 h). Pick several recipes for the week and get one shopping list, with the same ingredient merged by its `key` and amounts kept in the creators' own words.
- [ ] **Exclude ingredients** (~2 h). A "without" filter next to *Has all* / *Has any*: no nuts, no pork, nothing I'm out of.
- [ ] **Filter by tag and nutrition** (~3 h). Tags such as "air fryer" or "high protein" as chips, and a minimum-protein / maximum-calorie filter for recipes that state macros.
- [ ] **Server and API tests** (~4 h). `node:test` coverage for `/api/recipes` and `/api/queue` (add, duplicate → 409, delete, bad input), plus the static build.
- [ ] **Browser smoke test** (~3 h). A headless run that loads the dashboard, filters, opens a recipe and presses a step's timestamp.

## Later

- [ ] **Serving scaling** (~5 h). Scale amounts that are plain numbers and units, and leave words like "a good amount" untouched, marking scaled amounts clearly.
- [ ] **Add and edit recipes in the dashboard** (~8 h). A form that writes a valid `recipes/<id>.json` through the contract in `lib/recipe.mjs`, so a recipe doesn't need hand-written JSON.
- [ ] **Queue from the static site** (~4 h). Let the deployed copy queue a video (for example through a small Cloudflare Function) instead of only copying a request.
- [ ] **Schema version and migration** (~3 h). A `schema` field, a migration script and a JSON Schema export of the recipe contract.
- [ ] **Offline and mobile** (~4 h). Installable PWA with the recipes cached for cooking without signal, and a pass on the mobile layout and keyboard navigation.

## Household planning and budget

- [ ] **Household profile** (~6 h). Set up the household once: how many people, age groups (for example "2 adults, 1 child aged 6–10") and general eating habits (portion size, vegetarian days, how often you cook). It is anonymous and stays on the device: no names, no accounts, nothing sent to a server.
- [ ] **Amounts for your household** (~8 h). Use the profile to turn a week plan into purchase amounts: how much chicken, rice or cheese to buy for everyone, built on serving scaling and the combined shopping list. Amounts that the creator only gave in words stay as words and are flagged.
- [ ] **Food budget** (~6 h). Set a weekly or monthly food budget, record what each shop actually cost, and see spend per meal and per person over time, so purchase amounts and plans get more accurate.
- [ ] **Local prices and deals** (~12 h). Link each shopping-list ingredient to current prices and offers at nearby supermarkets, and suggest where the week's list is cheapest. Uses official store APIs or published offer feeds only (no scraping), cached locally, with a clear "last updated" time.

About 74 hours in total.
