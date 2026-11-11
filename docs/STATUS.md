# Status

Updated 2026-11-11. The project agent keeps this file true: what is happening now, what comes next, and what waits on
a decision by the owner. Plans and estimates live in [ROADMAP.md](../ROADMAP.md).

## Now

Work packages in progress, each on its own branch. None of them is merged yet.

| Workstream | Branch | What | State |
|---|---|---|---|
| Dashboard redesign | (lane) | A design contract (`docs/design/`), a rebuilt dashboard in `public/`, cook mode, and mount points for the new feature modules | waiting to start |
| Public website | (lane) | A landing page in `site/`, separate from the dashboard | waiting to start |
| Roadmap functions | (lane) | Week plan and combined shopping list, exclude / tag / nutrition filters, serving scaling, server and API tests, UI modules in `public/features/` | waiting to start |
| Recipe Agent | `feat/recipe-agent` | `agent/` definition with entry files per coding agent, an analysis skill, `SELF-HOSTING.md`, `npm run doctor`, captures kept outside the repo | running |
| More platforms | `feat/more-platforms` | Facebook, Pinterest and X videos, and web pages with a video, in `lib/video.mjs` | running |
| Browser smoke test and CI | `test/browser-smoke-ci` | A dependency-free headless smoke test, a device check at five widths, and a GitHub Actions workflow | running |
| Household and budget | `feat/household-budget` | An anonymous household profile and a food budget, as pure logic and UI modules | running |

Every branch must pass `npm test` and `npm run validate`, gets a review by a model from a different family than the
one that wrote it, and lands through a pull request.

## Next

1. Take in each finished workstream on its branch: run the tests, fix what fails, check the dashboard at phone,
   tablet, desktop and wide widths, and open the pull request.
2. Wire the feature modules (week plan, shopping list, scaling, filters, household, budget) into the redesigned
   dashboard's mount points.
3. Queued work packages: add and edit recipes in the dashboard; recipe packs with a schema version, migration and a
   JSON Schema export (`lib/recipe.mjs` already refers to `schema/recipe.schema.json`, which does not exist yet);
   household purchase amounts on top of the week plan; a second design round on what the first one shows; the
   offline / installable app.

## Waiting on a decision

- **Where the public website is hosted, and under which domain.** Nothing is deployed until this is decided.
  Previews only.

## Known gaps

- `lib/recipe.mjs` points to `schema/recipe.schema.json` for the full field reference; that file is missing.
- `thai-chicken-satay-sandwich` is `partial`: the method was not available from the video.
