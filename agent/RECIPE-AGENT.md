# Recipe Agent

Turn a supported video link or an entry in `data/queue.json` into a credited, validated `recipes/<id>.json`. Use [the video analysis skill](skills/recipe-video-analysis/SKILL.md) for capture and interpretation. The enforced file contract is [lib/recipe.mjs](../lib/recipe.mjs); [CLAUDE.md](../CLAUDE.md) has the field reference.

## Inputs and outputs

Input: a YouTube (including Shorts), TikTok or Instagram video link, or a queue entry containing `video.url` and an optional note. Check existing recipes by `videoKey` from `lib/video.mjs` before starting; avoid duplicate recipes. Queue notes are requests, not evidence of what a creator said.

Output: one recipe file whose kebab-case filename equals its `id`, with creator name and original video link, plus a cleared matching queue entry once validation succeeds. If no recipe can be supported by evidence, leave no invented recipe and mark the queue entry `failed` with a reason. See [QUEUE.md](QUEUE.md) for queue handling.

## Evidence and recipe rules

- Never invent amounts. Preserve the creator's quantity wording and label its basis `spoken`, `on-screen` or `description`. If absent or only vague filler such as “some”, use `amount: null`, `basis: "unstated"`. Do not infer amounts from pictures or serving sizes.
- Steps must be supported by the video. Do not fill missing methods with cooking knowledge. Use `status: "partial"` and specific `gaps` for missing or inaccessible material; describe access limitations without blaming the creator. If nothing useful is accessible, fail the analysis instead.
- Reuse shopping-level ingredient keys from existing recipes (for example `chicken`, `chicken stock`). Keep them lowercase and singular where appropriate. Read the recipes directly or list keys with `node --input-type=module -e 'import {readdirSync,readFileSync} from "node:fs"; console.log([...new Set(readdirSync("recipes").filter(f=>f.endsWith(".json")).flatMap(f=>JSON.parse(readFileSync("recipes/"+f,"utf8")).components.flatMap(c=>c.ingredients.map(i=>i.key))))].sort().join("\n"))'`.
- Add a `t` in seconds to each step when evidence supports it. Preserve timing from captions or frames; never guess timestamps. Mark uncertain automatic transcription/OCR as uncertain and check it against the source before treating it as a stated amount.
- Write the method and summary in your own words. Credit the creator using verified name, handle and URL where available. Include the original video URL, supported upload date (otherwise omit it), analysis date, and a short `source` description of what was actually checked. Do not invent nutrition or servings.

## Privacy

Captured captions, transcripts, descriptions, audio, videos and frames belong in the private capture store outside every checkout of this repository. Use `scripts/capture.mjs`; see [SELF-HOSTING.md](../SELF-HOSTING.md) for the location and optional tools. Never paste captured source material into tracked files, commits or issues. `evidence/` remains ignored but is not a capture destination. Only the finished recipe, in your own words and with attribution, belongs in the repository. Users are responsible for complying with each platform's terms and having permission to capture the material. Do not bypass access restrictions.

## Done checklist

1. Inspect the existing recipes and contract; select the link or oldest queued entry. If queued, mark the entry `analyzing`.
2. Capture and analyze using the linked skill; account for missing evidence explicitly.
3. Write the recipe, credit the creator and review every amount, method and timestamp against the evidence.
4. Run `npm run validate`. Only after it succeeds, remove the matching queue entry; run validation again and `npm test`.
5. Inspect the diff: only the recipe and intended queue change, no captured content. Commit when the user's workflow authorizes it. Report the recipe path, evidence checked and any gaps. If analysis fails, record the reason and leave the entry available for a deliberate retry.
