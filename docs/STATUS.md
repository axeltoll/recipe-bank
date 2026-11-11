# Status

Updated 2026-11-11. The project agent keeps this file true: what is happening now, what comes next, and what waits on
a decision by the owner. Plans and estimates live in [ROADMAP.md](../ROADMAP.md).

## Now

Round 1 is built, integrated and in review as nine stacked pull requests. Merge them in order; each one's base is the
one before it. Every part passes `npm test`, `npm run validate` and `npm run build` on its own.

| PR | Part |
|---|---|
| #3 | Recipe contract, more platforms (Facebook, Pinterest, X, web pages), JSON Schema, migration, recipe packs |
| #4 | Week plan and combined shopping list, Without / tag / nutrition filters, serving scaling, household profile, food budget, purchase amounts, local-prices groundwork, editor logic |
| #5 | Server API (recipe editor, pack import, write checks), static build, the self-hosted Recipe Agent |
| #6 | Dashboard feature modules (`public/features/`) |
| #7 | Dashboard redesign and design contract (`public/`, `docs/design/`) |
| #8 | Browser smoke test, device check at five widths, GitHub Actions CI |
| #9 | Public website: landing page (`site/`) |
| #10 | Public website: docs pages |
| #11 | README, CLAUDE.md, ROADMAP and changelog |

On the full stack: 528 tests pass; the smoke test passes against the live server and the static build; the device
check passes for six pages at 390, 768, 1280, 1920 and 2560 px. A cross-family review and a security and privacy read
found seven blocking issues, all fixed with tests before the split. A review of each part is under way.

## Next

1. Merge the stack once each part has its review.
2. Follow-ups already being built: the design round's remaining logic changes (darker palette, one text-width token,
   timers that survive a reload, nav icons, view transitions), device-check coverage for cook mode and the queue page,
   servings for recipes that count items ("12 nuggets"), and the community list for self-hosters.
3. More tests that probe edge cases across the new modules.

## Waiting on a decision

- **Where the public website is hosted, and under which domain.** Nothing is deployed until this is decided. The
  website's base URL stays empty until then.

## Known gaps

- `thai-chicken-satay-sandwich` is `partial`: the method was not available from the video.
- Local prices and deals have groundwork only; no price source is connected.
