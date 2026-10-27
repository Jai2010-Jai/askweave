# Website engine

The website generator the Weave server runs through [`server/weave/web/bridge.mjs`](../server/weave/web/bridge.mjs).
Only the files the bridge loads are kept, taken from [adityapokuri229/weave](https://github.com/adityapokuri229/weave)
(MIT, see `LICENSE`):

| File | What it does |
|---|---|
| `src/portfolio/designInspirationResearcher.js` | Reads the minimal.gallery feed and asks the AI for a topic analysis and three design directions |
| `src/portfolio/bespokeHtmlGenerator.js` | Writes one complete, responsive HTML page (Tailwind + Google Fonts) from a direction, and applies changes |
| `src/gemini-client.js` | The AI calls. The bridge routes `glm-*` models to GLM and others to Gemini, and disables the `agy` CLI path |
| `src/auth.js` | Stub: always "not signed in" (the original OAuth sign-in was removed) |

No `npm install` is needed: the bridge stubs `dotenv` and the files use only Node built-ins.
