# Mail relay Worker (feedback, connection alerts, heartbeat)

The app has no mail path of its own: the home server runs no SMTP daemon, which
would be one more service to patch and secure. This Worker is the
mail path. It takes one JSON POST from the app's **Help** page and sends it to a
single fixed address through Cloudflare Email Routing.

Three routes, all requiring the shared secret (`x-htm-secret`):

| Route | From | Mails |
|---|---|---|
| `POST /` | Help page | `RECIPIENT` |
| `POST /alert` `{to, subject, text, html?}` | worker container, after each sync pass (`checkAlerts()`) | the user it concerns |
| `POST /heartbeat` | worker container, hourly | nobody -- a cron every 30 min mails `RECIPIENT` once when heartbeats stop for `DOWN_AFTER_HOURS` (3), and once when they resume |

It is not an open relay: Email Routing delivers only to verified destination
addresses, so a second household's address must be verified before it gets
alerts. State (last heartbeat, "down" mailed) lives in a KV namespace.

**Every email is drawn by `src/lib/email.ts`** (`renderEmail()`, shared with the app;
wrangler bundles it from outside this folder, so deploy from a full checkout).
The app renders connection alerts (`$lib/alertPlan`) and posts both parts; the
Worker renders its own -- server down/back and Help reports -- from
`src/lib/relayMails.ts`. An `/alert` without `html` still gets a plain layout,
so the app and the Worker can be deployed in either order.

**The icons are served by this Worker**: `public/email/*.png` at
`/email/<file>` (static assets, matched before `fetch()`, no secret). The
renderer points at them (`EMAIL_ASSET_BASE`), so `wrangler deploy` after any
icon change.

To look: `npm run email:preview -- --shots --local` (HTML, text, light/dark at
600 and 390, in the temp folder), `/dev/email/<kind>` under `npm run dev`, or
`npm run email:send -- you@example.com` for all eight in a real inbox.

Email Routing itself (step 1) is a dashboard step. Until it is on, sends
return `502 could not find account config of sending domain`.

## Deploying

1. **Enable Email Routing** on your zone and verify your own
   email as a destination address. Cloudflare refuses to send to an
   unverified destination — that refusal is what keeps this from being an open
   mailer if the URL leaks.

2. Create a KV namespace (`npx wrangler kv namespace create STATE`) and put its
   id in `wrangler.jsonc`, along with your `SENDER`, `RECIPIENT` and `APP_URL`.

3. Generate a secret and give it to both sides:

   ```bash
   openssl rand -base64 32
   ```

4. Deploy:

   ```bash
   cd workers/feedback
   npx wrangler deploy
   npx wrangler secret put SHARED_SECRET   # paste the value from step 3
   ```

5. Set `EMAIL_ASSET_BASE` in `src/lib/email.ts` to `<worker-url>/email/`, then
   put the same values in the app's `.env`:

   ```
   FEEDBACK_WEBHOOK_URL=https://howtomoney-feedback.<your-subdomain>.workers.dev
   FEEDBACK_WEBHOOK_SECRET=<the value from step 3>
   ```

   Restart the web container. With either variable missing, the Help page still
   accepts a report and writes it to the container log — it just says plainly
   that mail is not configured.

## Testing it

```bash
curl -X POST "$FEEDBACK_WEBHOOK_URL" \
  -H 'content-type: application/json' \
  -H "x-htm-secret: $FEEDBACK_WEBHOOK_SECRET" \
  -d '{"userId":"test","kind":"test","message":"hello from curl"}'
```

A `403` means the secret does not match; a `502` carries Cloudflare's own reason,
which is almost always an unverified destination address.
