# Supabase backend

One Edge Function, `coaching`, which generates the GPS dead zone driving tip.

It exists so the Anthropic API key lives on the server. Previously the app
called `api.anthropic.com` directly with the key compiled into the JavaScript
bundle, where anyone who installed the app could extract it.

## Deploy

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and a linked
project (`supabase link --project-ref <your-project-ref>`).

```bash
# 1. Store the Anthropic key as a project secret (never commit it)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# 2. Deploy the function
supabase functions deploy coaching
```

`supabase/config.toml` already sets `verify_jwt = false` for this function. If
your CLI ignores it, pass the flag explicitly:

```bash
supabase functions deploy coaching --no-verify-jwt
```

Secrets take effect immediately — no redeploy needed after `secrets set`.

## Configure the app

Put the project URL and publishable (anon) key in `Config.js` — see
`Config.example.js`. Both are safe to ship: the publishable key is designed for
client use. The Anthropic key is not, and no longer appears there.

## Local development

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > supabase/functions/.env   # gitignored
supabase functions serve coaching --env-file supabase/functions/.env
```

Then point `SUPABASE_URL` at `http://localhost:54321` in your local `Config.js`.

## Contract

`POST /functions/v1/coaching`

Headers: `apikey: <publishable-or-anon-key>` (also accepted as
`Authorization: Bearer <key>`), `Content-Type: application/json`.

```jsonc
// request
{ "zoneName": "Ted Williams Tunnel" }

// 200
{ "coaching": "Stay in the right lane through the tunnel..." }

// error (any non-2xx)
{ "error": "Upstream rate limit" }
```

| Status | Meaning | Client retries? |
|---|---|---|
| 400 | Missing or non-string `zoneName`, or unparseable body | No |
| 401 | Missing/unrecognized project key | No |
| 405 | Not a POST | No |
| 429 | Per-instance throttle, or Anthropic rate limit | Yes |
| 500 | `ANTHROPIC_API_KEY` unset or rejected | Yes |
| 502 | Anthropic returned an error or an empty message | Yes |

The client (`getCoachingScript` in `App.js`) treats 429 and 5xx as retryable,
retries once honouring `Retry-After`, and otherwise falls back to a static
safety tip. A failure degrades the tip; it never blocks the route preview.

## Design notes

**Not a passthrough proxy.** The client sends only a tunnel name. The model,
prompt and `max_tokens` are fixed server-side. A generic
`POST /v1/messages` relay would have moved the key off the device but left an
open LLM endpoint anyone could drive with arbitrary prompts at your expense.

**The endpoint is still reachable by anyone who extracts the publishable key**,
which ships in the app bundle like any Supabase client key. That is expected and
is why the interface is narrow: the worst an attacker gets is driving tips about
arbitrary tunnel names, capped at 150 output tokens. To lock it down further,
add Supabase Auth and set `verify_jwt = true`.

**Rate limiting is per-isolate.** The in-memory counter bounds one Edge Function
instance, not the project, so it will not stop a distributed abuser. For a real
quota use the [Redis-backed approach](https://supabase.com/docs/guides/functions/examples/rate-limiting),
and set spend limits in the Anthropic Console as the backstop.
