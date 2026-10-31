# Custom domains

A customer's website lives at `https://<username>.askweave.xyz/<project>/`. With custom domains on, Weave can
also give it its own name, `https://chaipoint.com/`: it finds names with real prices, and once the customer
says yes and pays, it registers the name in the customer's name, sets up DNS, routes it to their site, gets
HTTPS working, checks it from the outside, and messages them the live link on WhatsApp/SMS/web chat.

Code: `weave/domains/` (flow, providers, API) and `weave/sms/domains_store.py` (tables).

## The flow

```
DISCOVERING -> AVAILABLE -> AWAITING_APPROVAL -> PAYMENT_PENDING -> REGISTERING -> REGISTERED
  -> CONFIGURING_DNS -> VERIFYING_DNS -> CONNECTING_HOSTING -> PROVISIONING_SSL -> VERIFYING_DEPLOYMENT -> LIVE
LIVE -> EXPIRING -> LIVE (renewed) | EXPIRED          any state -> FAILED          FAILED -> the failed step (retry)
```

| State | What happens | Who moves it on |
|---|---|---|
| DISCOVERING | The name is checked with the registrar | the quote request |
| AVAILABLE | Free, and priced: first year and renewal, with markup | the quote request |
| AWAITING_APPROVAL | A quote (an order) that expires after `WEAVE_DOMAIN_QUOTE_MINUTES` | the customer's explicit yes |
| PAYMENT_PENDING | Availability and price re-checked; a checkout for exactly the quote is open. The name is held for `WEAVE_DOMAIN_PAYMENT_HOURS` | a payment verified with the payment provider's API |
| REGISTERING | Availability and price re-checked again, then registered with the registrar in the customer's name | runner |
| REGISTERED | Done at the registrar | runner |
| CONFIGURING_DNS | Cloudflare zone created, apex and www pointed at the tunnel, registrar nameservers set to Cloudflare's | runner |
| VERIFYING_DNS | Waits for Cloudflare to see the delegation (zone `active`), up to 72 h | runner |
| CONNECTING_HOSTING | Tunnel ingress rules for the domain and www | runner |
| PROVISIONING_SSL | Waits for Universal SSL (`certificate_status: active`), up to 24 h | runner |
| VERIFYING_DEPLOYMENT | Fetches `https://<domain>/.well-known/weave-domain` with certificate checks; must return the domain's own token | runner |
| LIVE | The customer gets the link | |
| EXPIRING | 30 days before expiry: renewal quoted to the customer; still serving | the customer approves and pays |
| EXPIRED | Not renewed: tunnel route removed, no longer served | |
| FAILED | Reason in `last_error`; `failed_step` set when it can be retried | |

Every change is a row in `domain_events` (from, to, actor, detail), written in the same transaction as the change.

### Money rules

1. **Explicit approval.** The dashboard sends `{order_id, amount_minor, confirm: true}` for the exact quote. In chat
   the AI can only *propose* `domain_approve`; the server then requires the customer's own message to be a plain
   yes (`yes`, `haan`, `buy it`, `confirm`...; `yes but which one?` is not) and an open quote it sent them.
2. **Verified payment.** A webhook is signature-checked (Standard Webhooks), then the payment is fetched from the
   payment provider's API. It must be `succeeded`, for this order (metadata and checkout id), in the quoted
   currency, for at least the quoted amount. Short, wrong-currency, late (quote expired or cancelled) and doubled
   payments are refunded, never registered.
3. **Re-check before buying.** Availability and price are checked at approval and again right before
   registration. A price change before payment asks for a new yes; a rise or a lost name after payment refunds.
4. **No double purchase.** A unique index allows one row per name from PAYMENT_PENDING on, orders have unique
   idempotency keys and payment ids, every step is compare-and-set, the runner leases each domain, and a retry
   after a registrar timeout first asks the registrar whether the name is already ours.

### Background work, retries

`SmsWorker` runs a `sms-domains` thread (only when domains are on): one due step at a time, leased for 5 minutes
(a crashed worker's step is picked up after that), plus quote expiry and renewal checks every minute.

- Provider errors marked transient (timeouts, 5xx, 429, OpenSRS 7xx) retry with exponential backoff:
  30 s, 60 s, 120 s ... capped at 6 h, at most 8 tries, then FAILED.
- Waiting steps (DNS, SSL, deployment check) poll more slowly as time passes (30 s up to 30 min) until their limit.
- If registration fails for good and the registrar confirms the name isn't ours, the payment is refunded.
  Failures after registration keep the payment and can be retried (`POST .../retry`), resuming the failed step.
- A refund that fails is logged as `REFUND FAILED: needs a person` in the domain's events and `refund_status=failed`.

## Routing

`weave/server.py` checks the Host header before anything else. A host that is not `app.askweave.xyz`, not under
`WEAVE_SITES_DOMAIN`, and matches a domain in PROVISIONING_SSL, VERIFYING_DEPLOYMENT, LIVE or EXPIRING serves that
domain's one project from `data/hosted-users/<username>/<slug>/`, with the same CSP sandbox, live data and visit
counting as `<username>.askweave.xyz`. `www.` redirects to the bare name. Only GET/HEAD.

It also checks, on every request, that the account is active and the project still exists and still belongs to
that account. A host nobody connected gets the server's normal treatment (a redirect to `/start` or 401), never
someone's site.

## API

All under the askweave.xyz session cookie. POSTs need `X-Weave: 1`. A domain id that isn't yours is a 404.
Rate limits per account: reads 120 / 10 min, searches 30 / 10 min, writes 20 / 10 min (429 beyond).
Errors are `{"detail", "code"}`; amounts are integers in the smallest currency unit.

| Method and path | Body / query | Returns |
|---|---|---|
| `GET /api/account/domains` | | `{config: {mode, purchasing, problem, currency, tlds, ...}, domains: [summary]}` |
| `GET /api/account/domains/search?q=chai point` | | `{results: [{domain, first_year_minor, renewal_minor, currency}]}`, taken and premium names left out |
| `GET /api/account/domains/check?domain=x.com` | | `{domain, available, first_year_minor?, renewal_minor?, reason?}` |
| `GET /api/account/domains/contact` | | `{contact, problem}` |
| `POST /api/account/domains/contact` | `first_name, last_name, org_name?, address1, address2?, city, state, postal_code, country (IN), phone (+91.9876543210), email` | the saved registrant |
| `POST /api/account/domains` | `{domain, project_id}` | summary with `order` (the quote) and `quote` text. 409 `taken`, `already_yours`, `premium`, `payment_pending` |
| `GET /api/account/domains/{id}` | | summary + `nameservers` + `events` |
| `POST /api/account/domains/{id}/approve` | `{order_id, amount_minor, confirm: true}` | `{checkout_url, amount_minor, currency}`. 409 `price_changed` (with the new `order_id`, `amount_minor`), `quote_expired`, `contact`, `taken`; 503 `purchasing_off` |
| `POST /api/account/domains/{id}/cancel` | | summary (before payment only) |
| `POST /api/account/domains/{id}/retry` | | summary (FAILED after payment only) |
| `POST /api/account/domains/{id}/renew` | | summary + `order_id`, `amount_minor`: approve it like a purchase |
| `POST /api/webhooks/domains/payments` | Dodo webhook | 200; 401 bad signature; 503 when the provider couldn't be asked (Dodo retries) |

A summary is `{id, domain, state, label, project_id, url, first_year_minor, renewal_minor, currency, expires_at,
error, retryable, order: {id, kind, status, amount_minor, currency, quote_expires_at, checkout_url, refund_status}}`.

## Chat

The chat brain has five actions (`weave/sms/brain.py`, carried out in `SmsService._domain_action`):
`domain_suggest` (spec = what to search), `domain_check` and `domain_buy` (domain), `domain_approve`, and
`domain_status`. The server writes every price and status itself; the AI's own wording is not used for them.
The brain's context lists the customer's domains and any quote waiting for their yes. Missing registrant details
are sent to the dashboard (chat doesn't collect a postal address).

## Providers

Each is an interface in `weave/domains/providers.py`, with a fake in `mock.py`:

| Interface | Real adapter | Docs it follows |
|---|---|---|
| `Registrar` | `opensrs.py` (OpenSRS XML API: `NAME_SUGGEST`, `LOOKUP`, `GET_PRICE` new/renewal, `SW_REGISTER`, `GET all_info`, `advanced_update_nameservers`, `RENEW`) | domains.opensrs.guide |
| `DnsProvider`, `SslProvider`, `HostingConnector` | `cloudflare.py` (zones, DNS records, `ssl/verification`, tunnel `configurations`) | developers.cloudflare.com/api |
| `PaymentProvider` | `dodo.py` (`POST /checkouts` with a Pay What You Want product, `GET /payments/{id}`, `POST /refunds`, Standard Webhooks) | docs.dodopayments.com |
| `DeploymentVerifier` | `HttpsVerifier` in `__init__.py` | |

**GoDaddy was considered and not built:** its domain availability API needs 50+ domains on the account (since
May 2024), and it has no reseller model for registering in each customer's name. OpenSRS is a reseller registrar
built for this. Another registrar only needs a new `Registrar` class.

Each provider is real when its credentials are set and faked otherwise. Buying is only switched on when the
registrar and payments are both real or both fake (`WEAVE_DOMAINS=sandbox`), so a real payment can never meet a
fake registration. Real money additionally needs `OPENSRS_ENV=live`, `DODO_PAYMENTS_ENV=live` **and**
`WEAVE_DOMAIN_LIVE_PURCHASES=on`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `WEAVE_DOMAINS` | `off` | `off`, `sandbox` (every provider faked, nothing bought; try the whole flow), `on` |
| `WEAVE_DOMAIN_LIVE_PURCHASES` | `off` | Must be `on` to spend real money |
| `OPENSRS_USERNAME`, `OPENSRS_API_KEY` | | Reseller username and API key (manage.opensrs.com, Account Settings, API settings) |
| `OPENSRS_ENV` | `test` | `test` = horizon.opensrs.net (never registers real names), `live` = rr-n1-tor.opensrs.net (needs the server's IP on the allow-list) |
| `OPENSRS_CURRENCY` | `USD` | The reseller account's currency |
| `CLOUDFLARE_API_TOKEN` | | Zone:Edit, DNS:Edit, SSL and Certificates:Read, Cloudflare Tunnel:Edit on the account |
| `CLOUDFLARE_ACCOUNT_ID` | | The account the tunnel and the new zones live in |
| `CLOUDFLARE_TUNNEL_ID` | | The production tunnel's UUID (the one `scripts/run_prod.sh` runs) |
| `WEAVE_DOMAIN_ORIGIN` | `http://127.0.0.1:<WEAVE_PORT>` | Where the tunnel sends customer domains |
| `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY` | | API key, and the webhook endpoint's `whsec_...` secret |
| `DODO_PAYMENTS_ENV` | `test` | `test` = test.dodopayments.com, `live` = live.dodopayments.com |
| `DODO_DOMAIN_PRODUCT_ID` | | A one-time product with Pay What You Want on (minimum below the cheapest domain), in `WEAVE_DOMAIN_CURRENCY` |
| `WEAVE_DOMAIN_CURRENCY` | `USD` | What customers pay in; must be the Dodo product's currency |
| `WEAVE_DOMAIN_FX_RATE` | `1` | Registrar currency to customer currency (e.g. `84` for USD to INR). Fixed: review it |
| `WEAVE_DOMAIN_MARKUP_PERCENT` | `20` | Added to the registrar's price; prices round up to a whole unit |
| `WEAVE_DOMAIN_MAX_PRICE_MINOR` | `5000` | Names costing the customer more than this in the first year (premiums) are never offered |
| `WEAVE_DOMAIN_TLDS` | `com,in,co.in,net,org,shop,store` | What Weave sells |
| `WEAVE_DOMAIN_QUOTE_MINUTES` | `30` | How long a quote holds before approval |
| `WEAVE_DOMAIN_PAYMENT_HOURS` | `24` | How long an approved checkout holds the name |

## Turning on real purchasing

1. **OpenSRS:** open a reseller account, fund it, and enable the TLDs in `WEAVE_DOMAIN_TLDS` (`.in` and `.co.in`
   need their registry agreements accepted). Copy the API key. In Account Settings, IP Access Rules, add the VPS's
   public IP. Run everything in `OPENSRS_ENV=test` first.
2. **Cloudflare:** in the account that owns the `weave` tunnel, create the API token with the permissions above.
   The tunnel must be remotely managed (it is: `run_prod.sh` starts it with `--token`), with a catch-all rule last.
   Free-plan accounts can add a limited number of pending zones; ask Cloudflare to raise it before launch.
3. **Dodo Payments:** create a one-time product with Pay What You Want, minimum price $1 (or ₹100), in the
   currency you'll charge. Turn adaptive pricing off for it (the amount and currency must match the quote).
   Add a webhook endpoint `https://app.askweave.xyz/api/webhooks/domains/payments` for `payment.succeeded`
   and `payment.failed`, and copy its secret.
4. **Test mode end to end** on the VPS, with `WEAVE_DOMAINS=on`, `OPENSRS_ENV=test`, `DODO_PAYMENTS_ENV=test`,
   and the keys above. Buy a name on the dashboard with Dodo's test card, and watch it reach REGISTERED (OpenSRS
   test never registers anything real, so DNS stops at VERIFYING_DNS: that is expected). `GET /api/account/domains`
   shows `mode: test, purchasing: true`.
5. **Live:** set `OPENSRS_ENV=live`, `DODO_PAYMENTS_ENV=live` with live keys, the live webhook secret, and
   `WEAVE_DOMAIN_LIVE_PURCHASES=on`. Restart. Buy one cheap domain yourself first and check each step in
   `GET /api/account/domains/{id}`.

To stop selling at once, set `WEAVE_DOMAIN_LIVE_PURCHASES=off` and restart: quotes still work, approvals return
503 `purchasing_off`, and domains already bought keep being served and renewed by the runner once paid.
`WEAVE_DOMAINS=off` turns the whole feature off, including serving custom domains.

## Not done yet

- No dashboard screen: the API is ready, `weave/static/site/dashboard.js` doesn't call it yet.
- The registrar is never told to auto-renew (each renewal is paid by the customer first). An expired name sits in
  the registry's grace period, but Weave has no "renew an EXPIRED domain" path yet: that needs a person.
- `WEAVE_DOMAIN_FX_RATE` is a fixed number, not a live rate.
- Domains are only *bought* here; transferring in a name the customer already owns isn't supported.
