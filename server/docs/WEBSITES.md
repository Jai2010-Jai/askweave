# Websites in Weave

Weave builds **Android apps** (Kotlin/Compose APKs) and **websites** through the same conversation on WhatsApp, SMS
and the web chat. Both kinds share one project list, one build queue, one set of status and cancel commands, and
one notification path.

## How a website is built

The generator is [`website-engine/`](../../website-engine/), run by `weave/web/bridge.mjs` in a child process:

1. `researchDesignInspirations`: reads the minimal.gallery feed, then asks the AI for a topic analysis and three
   design directions (fonts, palette, components).
2. `generateBespokeHtml`: the AI writes one complete, responsive HTML page (Tailwind CDN plus Google Fonts).
   Extra pages (`WEAVE_WEBSITE_PAGES`) are planned and written by the bridge itself.
3. `redesignBespokeHtml`: applies a change ("make the hero darker") to the current page.

The bridge routes `glm-*` models to GLM and every other model to Gemini, stubs `dotenv` (the engine never reads a
`.env`), and turns any canned or unchanged page into a real error, so a build never "succeeds" without the AI.

Output is validated (`weave/web/validate.py`): complete HTML, under 1 MB, scripts only from allowed HTTPS CDNs,
no iframes, `<base>`, meta refresh, or forms that post to other sites. Each version is kept in
`data/sites/<id>/site/`. A change writes a new version, so a failed change never touches the last good one.

## Setup

In `server/.env`:

```
WEAVE_WEBSITE_ENGINE_DIR=../website-engine   # relative paths are resolved from server/
WEAVE_WEBSITE_DEPLOY=weave                   # every finished site goes live on its subdomain
WEAVE_SITES_DOMAIN=askweave.xyz
```

Node.js 20 or later must be on `PATH` (or set `WEAVE_NODE_BIN`). No `npm install` is needed for the engine.

## Using it

- "Create a premium website for my coffee brand" starts a website build.
- "Build an Android inventory app" starts an Android build.
- "Build something for my bakery" makes Weave ask: "Android app or website?"
- "make the buttons bigger" changes the **active** project, whichever kind it is ("show my projects",
  "switch to 2").
- "send the link" sends a website's **private preview**: `/preview/<token>/`, expiring after
  `WEAVE_SMS_LINK_TTL_HOURS`, up to 200 page views.
- "what are you building?" or "how's it going?" reports the current job. It never starts one.

Previews are served from your Weave server through the same tunnel as the APK links. The page is sent with a
CSP `sandbox` policy (no `allow-same-origin`), so generated scripts can't read Weave cookies or call Weave
APIs, can't send data anywhere (`connect-src 'none'`, `form-action 'none'`), and can load scripts and styles
only from the allowed CDNs. A preview is **not** a public deployment, and Weave always says which one it sent.

## Hosting

With `WEAVE_WEBSITE_DEPLOY=weave`, a finished website is copied into `data/hosted-users/<username>/<project>/`
(atomic swap) and served by the Weave server at `https://<username>.askweave.xyz/<project>/`. The `*.askweave.xyz`
DNS record points at the same Cloudflare tunnel as `app.askweave.xyz`; the server tells them apart by the Host
header (`weave/web/hosting.py`). Hosted pages get the same CSP sandbox as previews.

`WEAVE_WEBSITE_DEPLOY=netlify` (with `NETLIFY_AUTH_TOKEN`) is an older alternative: an owner texts `PUBLISH` and the
exact version is uploaded to a `*.netlify.app` site. It is off in production and was only tested against a fake
Netlify API.

## Live data: products, menu, services and stock

Every account has its own data tables (`weave/sms/data_store.py`, logic in `weave/site/data.py`), so a live site is
not frozen at build time.

- **Marking:** the website generator marks the list of things a business sells with `data-weave-list="products"`
  (or `menu`, `services`), each card with `data-weave-item`, and the values with `data-weave-field="name|price|..."`.
- **Seeding:** when a site is first published to an account, those items become the owner's table. A table that
  already exists is never overwritten by a rebuild.
- **Serving:** each page served from `<username>.<sites_domain>` gets the account's public tables added before
  `</body>`, with a small script that redraws each marked list (one copy of the first card per row). Rows with
  stock 0, or `available` off, are marked "Sold out". The page stays sandboxed with `connect-src 'none'`: the data
  travels inside the page. The page's ETag includes the data version, so a change shows on the next visit.
- **Managing:** the dashboard's "Your products & stock" section edits rows, uploads and downloads CSV, and can
  hide a table from the sites. On WhatsApp the chat AI's `stock` action handles "chai stock 20", "sold 3 cakes",
  "samosa price 15", "add veg puff 30 rupees, 40 pieces", "remove the brownie", "show my products" and
  "what's low?". The reply says what actually changed, not what the AI guessed.
- **Limits:** 20 tables per account, 2,000 rows per table, 30 fields. Data is deleted with the account.

## Limitations

- Websites are single static pages, with optional design options 2 and 3: no backend, logins, databases, payments
  or working forms.
- weave sends only the first 8,000 characters of the current page to Gemini when applying a change. Long pages can
  lose content in a change. Weave records this in the build log.
- weave's design-research reply sometimes isn't valid JSON (2 of 3 real runs on 2026-10-21; one was before JSON mode
  was requested). weave then uses generic canned design directions. Weave retries the research once, records
  `research: fallback` in the build record when it still fails, and names the site from the page title. The page
  itself is still written by Gemini.
- Website builds don't appear in the local dashboard's History. Their logs are in `data/sites/<id>/build.log`.
- One website build runs at a time, and each user has one job at a time across both kinds.
- Generated pages load Tailwind and Google Fonts from public CDNs when viewed.
