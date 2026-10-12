# Recipe Bank

Recipes from the cooking videos you save. Each one has the embedded video, the ingredients as the creator said them, and a step-by-step guide whose steps jump to the right moment in the video. You can filter by ingredient and queue new videos for the research agent.

```bash
npm start   # → http://127.0.0.1:4780
```

- **Filter:** pick ingredients; switch between *Has all* and *Has any*; search by dish or creator.
- **Add video:** paste a YouTube Short, TikTok or Instagram Reel link. It joins `data/queue.json` and shows under *In the queue*. Use *Copy request* to post it in the Recipe Bank Telegram topic.
- **Cook:** tick off ingredients, copy a shopping list, and press a step's timestamp to play the video from there.

The data format and agent rules are in [CLAUDE.md](CLAUDE.md).
