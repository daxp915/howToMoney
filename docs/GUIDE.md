# howToMoney: Setup and User Guide

The full reference: installation, deployment, and how each part of the app works.
For an overview, see the [main README](../README.md).

Self-hosted expense tracker. Monarch Money's job, on your own hardware, for about
$29/year instead of $100+.

- **Bank sync** — SimpleFIN Bridge (read-only, ~$15/yr)
- **Categorization** — rules → learned merchant memory → Claude, in that order, so
  the model only ever sees merchants the system has never encountered
- **Transfer matching** — deterministic pairing of equal-and-opposite legs, so
  paying your credit card off your checking account stops looking like spending
- **Review queue** — everything uncertain lands in front of a human, and one
  correction is permanent

## How categorization stays cheap

| Layer | Handles | Cost |
|---|---|---|
| 1. Rules | user-defined exact matches | free |
| 2. Merchant memory | learned `normalized_key → category` | free |
| 3. Claude | unseen merchants only, batched, deduplicated by merchant | cents |
| 4. Review queue | anything below 68% confidence | your attention |

Layer 3 classifies each *distinct merchant* once, not each transaction. Twelve
Starbucks visits are one row of work. After the first sync the steady-state
volume is roughly ten new merchants a month, which is a fraction of a cent.

Expect ~$1.70 one-time for a two-year backfill on `claude-opus-5`, then well
under $0.50/month. Set `AI_MODEL=claude-haiku-4-5` to cut that by ~5x, or
`AI_PROVIDER=none` to run rules and memory only.

---

## 1. Local setup (laptop)

```bash
npm install
npm run setup -- --host localhost
```

`setup` creates `.env`, generates `POSTGRES_PASSWORD` and `ENCRYPTION_KEY`,
wires up `DATABASE_URL`, and lists which secrets are still missing. It never
prints a secret's value, and it is safe to re-run.

Then open `.env` and fill in four things by hand:

| Key | Where it comes from |
|---|---|
| `SIMPLEFIN_SETUP_TOKEN` | the SimpleFIN Bridge UI (step 2) |
| `ANTHROPIC_API_KEY` | console.anthropic.com — optional, `AI_PROVIDER=none` works without it |
| `SEED_EMAIL` | your login email |
| `SEED_PASSWORD` | your login password |

## 2. Connect SimpleFIN

1. Create an account at <https://beta-bridge.simplefin.org/> and connect your
   banks and cards there ($15/yr).
2. Generate a **setup token** and paste it into `.env` as
   `SIMPLEFIN_SETUP_TOKEN`.
3. Claim it:

```bash
npm run simplefin:claim
```

This exchanges the token for a long-lived access URL, stores it **encrypted in
the database** (`provider_credentials`, AES-256-GCM under `ENCRYPTION_KEY`),
blanks the spent token, and prints only the list of connected account names as
proof it worked.

A setup token can be claimed **once**. The resulting access URL is portable —
copy it to the NAS later rather than burning a second token.

The access URL carries HTTP basic credentials. It is read-only, so no money can
move through it, but it exposes your full transaction history. Keeping it
encrypted in the database rather than in `.env` means a database dump and a
copied `.env` are each useless alone — which matters, because dumps are the
thing that actually gets copied to other machines.

**Upgrading from an older install:** leave `SIMPLEFIN_ACCESS_URL` where it is.
The next sync reads it, encrypts it into the table, and uses the table from then
on. Once `provider_credentials` has a row you can blank the env var.

Losing `ENCRYPTION_KEY` means the stored credential cannot be read and you have
to claim a fresh setup token. Back it up wherever you keep the rest of `.env`.

## 3. Database and first sync

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db
npm run db:migrate
npm run db:seed          # reads SEED_EMAIL / SEED_PASSWORD from .env
```

Pull real data with the AI layer off first — free, and it proves ingestion and
transfer matching before a single token is spent:

```bash
AI_PROVIDER=none npm run sync:once -- 730
```

Check the numbers, then categorize for real:

```bash
npm run sync:once
npm run dev              # http://localhost:5173
```

The backfill is the only expensive AI run (~$1.70 on `claude-opus-5` for two
years of history). Watch the cost it reports; if it looks wrong, stop and check
`AI_MODEL`.

If port 5432 is already taken on your machine, set `DB_PORT=5433` in `.env` and
re-run `npm run setup -- --host localhost`.

---

## 4. Synology / DSM deployment

DSM ships an old Docker (20.10) with **compose v1 only**, and a login shell whose
`PATH` and sudo rules differ from an interactive one. Four gotchas, all one-time:

**Docker lives outside the default PATH.** Non-interactive SSH cannot find it,
and sudo matches its rules on the absolute path, so use `/usr/local/bin/docker`
in scripts and sudoers entries rather than bare `docker`.

**`/etc/sudoers.d` may not exist** and DSM has no `visudo`. Create the directory
first, and verify sudo still works before closing your session — a malformed
sudoers file locks you out and an open session is the way back in.

**Compose v1 does not understand `!reset`.** That is why exposure here is
additive: the base file publishes nothing and an overlay opts in. Installing the
v2 plugin is still worth it:

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
sudo /usr/local/bin/docker compose version
```

**Check which volume has room.** DSM's convention is `/volume1/docker`, which is
often the full one. `docker info | grep "Root Dir"` shows where images live;
`df -h` shows where the project should.

```bash
sudo mkdir -p /volume2/docker/howtomoney
sudo chown "$USER" /volume2/docker/howtomoney
```

There is no `git` on DSM by default. Push the working tree from a machine that
has one:

```bash
rsync -az --delete --exclude node_modules --exclude .git --exclude data \
  --exclude .svelte-kit --exclude build \
  ./ user@nas:/volume2/docker/howtomoney/
```

Copy `.env` across separately. **DSM disables the SFTP subsystem**, so plain
`scp` fails with `subsystem request failed on channel 0` — force the legacy
protocol with `-O`:

```bash
scp -O .env user@nas:/volume2/docker/howtomoney/.env
```

Then set `DATABASE_URL`'s host to `db`, point `ORIGIN` at the real HTTPS URL,
and paste `CLOUDFLARE_TUNNEL_TOKEN`. Editing only the host portion
(`sed -i 's|@localhost:5432|@db:5432|'`) avoids retyping the password.

**Docker 20.10 does not create bind-mount directories**, unlike newer versions.
Without this the database container fails to start with
`Bind mount failed: '…/data/postgres' does not exists`:

```bash
cd /volume2/docker/howtomoney
mkdir -p data/postgres
sudo /usr/local/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
sudo /usr/local/bin/docker compose exec web npm run db:migrate
sudo /usr/local/bin/docker compose exec web npm run db:seed
```

### Moving an existing database instead of re-syncing

If you have already been running locally, migrate the database rather than
re-syncing: it preserves learned merchants, your rules and your review
decisions, and avoids paying for categorization a second time.

```bash
docker compose exec -T db pg_dump -U howtomoney --clean --if-exists howtomoney > htm.sql
scp -O htm.sql user@nas:/volume2/docker/howtomoney/
ssh user@nas 'cd /volume2/docker/howtomoney && \
  sudo /usr/local/bin/docker compose exec -T db psql -U howtomoney -d howtomoney < htm.sql && rm htm.sql'
```

Delete the dump from both machines afterwards — it is your entire financial
history in plaintext.

Postgres data lives in `./data/postgres` under the project folder. Exclude it
from Synology indexing and make sure its volume is in Hyper Backup. If the `db`
container cannot write it, `sudo chown -R 999:999 data/postgres` — 999 is the
postgres image's UID.

## 5. Cloudflare Tunnel + Access

This is the part that decides whether your bank data is safe. Do not skip it and
do not substitute a port forward.

1. Buy the domain on **Cloudflare Registrar** (at cost, no markup) or move its
   nameservers to Cloudflare.
2. Zero Trust dashboard → **Networks → Tunnels → Create a tunnel** (Cloudflared).
   Copy the tunnel token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. In the tunnel's **Public Hostname** tab, route `money.yourdomain.com` to
   `http://web:3000`.
4. Zero Trust → **Access → Applications → Add a self-hosted application** for
   that hostname. Policy: *Allow*, rule *Emails* → your address only. Pick
   one-time PIN or Google as the identity provider.
5. Confirm the router has **no** port forwards to the NAS. The tunnel is
   outbound-only; nothing needs to be open.

### Verify Access from outside — do not trust the dashboard

Access has several ways to look configured while protecting nothing: a policy
set to *Bypass*, an application whose hostname is `www.example.com` when the
tunnel serves the apex `example.com`, or a wizard abandoned before its final
save. All three leave the tunnel forwarding every request straight to the app.

Two edge-handled paths settle it. They are answered by Cloudflare, not your
server, but only when an application covers that hostname:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/cdn-cgi/access/get-identity
curl -sI https://example.com/ | grep -i location
```

`404` from the first means **no application covers this hostname**. A `location`
header pointing anywhere other than `*.cloudflareaccess.com` — your own
`/login`, for instance — means the request reached your app unfiltered.

Working Access sends an unauthenticated request to `*.cloudflareaccess.com`.
Anything else, stop the tunnel until it is fixed:

```bash
sudo /usr/local/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml stop cloudflared
```

Once it is right, unauthenticated traffic is rejected at Cloudflare's edge and
never reaches the NAS. The app's own password and TOTP login is the second,
independent layer — keep both.

## 6. Backups

The Postgres volume holds your entire financial history and, more importantly,
your accumulated merchant memory and corrections. Losing it means starting the
training loop over.

The production overlay runs a `backup` service that does this daily: a
`pg_dump`, checked, encrypted to a public certificate the NAS cannot decrypt,
kept 30 days in `./backups`. How it works, where the private key lives, and how
to restore are in [`backup/README.md`](../backup/README.md).

Backups currently stay on the NAS. Keep at least one copy off it.

---

## Importing CSV history

SimpleFIN serves at most 89 days, and some connections serve far less — a card
connected today may only carry a few weeks. CSV export from the bank is the only
route to older history.

**Import → pick the account → upload → confirm the column mapping → import.**

The mapping step exists because no two banks agree on a format. The importer
guesses from the header row and shows a preview; you correct it if the guess is
wrong. Two settings matter more than the rest:

- **Flip the sign.** Most credit card exports report a purchase as a *positive*
  number. This project's convention is money out = negative. In the preview,
  spending must be negative and payments positive. Discover needs the flip;
  Chase does not.
- **Date order.** `03/04/2026` is ambiguous. The importer scans the file for a
  value above 12 in either position and picks accordingly, defaulting to US
  order when the file is genuinely ambiguous.

Separate Debit/Credit columns are supported for banks that don't use a single
signed amount.

### Overlapping imports are safe

An export almost always overlaps what the API already delivered. Two defences:

1. Each imported row gets a deterministic synthesized id, so re-importing the
   same file is a no-op.
2. Rows are fuzzy-matched against what's already in that account — same amount,
   within three days, same merchant (or same day, which is conclusive on its
   own). Each existing row is consumable **once**. That last part matters: two
   identical $5.75 coffees on one day are two purchases, and a set-based check
   would collapse them into one and silently lose a transaction.

Imported rows are tagged `provider = 'csv'` and then run through exactly the
same pipeline as synced ones — normalization, transfer matching, categorization.

## Operations

| Task | Command |
|---|---|
| CSV parser tests (pure, safe anywhere) | `npm test` |
| Matcher + import dedup tests | `SMOKE_TEST_DATABASE_URL=…/howtomoney_test npm run test:smoke` |
| Manual sync | `npm run sync:once` or the **Sync now** button |
| Backfill more history | `npm run sync:once -- 730` |
| Re-run matching + categorization on stored data | call `reprocess()` in `src/lib/server/sync/sync.ts` |
| Follow the worker | `docker compose logs -f worker` |
| AI spend per run | `sync_runs.ai_cost_usd` |

## Design notes

**Sign convention.** Money out is negative on every account type, including
credit cards. Every aggregate depends on this.

**Both transfer legs are kept.** A transfer is two real ledger entries, not a
duplicate. `is_transfer` removes them from spending rollups while leaving net
worth correct. Deleting a leg would break the balance.

**Transfer matching is not an LLM job.** Equal magnitude, opposite sign, within
five days, on different accounts is exact arithmetic. The scorer requires
positive evidence — a credit-card-payment shape, a payment keyword, or a shared
institution — before pairing automatically, because a paycheck and an unrelated
same-size expense are otherwise indistinguishable from a transfer. Without
evidence, the pair goes to the review queue instead of being matched silently.

**Pending reconciliation.** SimpleFIN has no `pending_transaction_id`, so a
charge that posts can arrive under a new id while the pending row still exists.
`upsertTransactions` pairs them by account, exact amount and a six-day window,
then promotes the pending row in place so its category and transfer link survive.

**Raw payloads are kept.** `transactions.raw` holds the provider's JSON, so
re-processing never needs a refetch.

## Where things are

Four places: **Home** (am I okay this month -- what is left of the budget, a
pace chart, the transactions to review, what is due this week), **Activity**
(every transaction, money in and out by month, search, the detail of one
transaction, splitting), **Plan** (envelopes, the recurring calendar, goals)
and **Wealth** (net worth, every account, brokerage and loan detail).
**Settings** opens from your initials: connections, categories, rules, the
look, privacy and your account. The **Advisor** opens over any screen from the
ask bar, ⌘K, or the phone's Ask button. Press **h** anywhere to hide every
amount (it shows `$•••`).

## Budgets

A monthly limit per expense category, set and changed right on its row in
**Plan** (click the amount). Rows read spent | bar | budget: green up to 85%,
yellow ("Watch") to 100%, red with "$X over" past it; a bill paid exactly in
full is green with a check. Plan groups categories into Bills (counted on their
due date), Everyday and Savings (your goals' monthly asks), and shows what is
left to assign from the income expected this month. A bill with no limit yet is
planned at its recurring charge until you set one.

## Activity

Money in (teal) and out (grey) by month, a feed grouped by day, and a
"<month> in review" card where the feed crosses into the previous month. The
same exclusions as every other figure apply: transfers between your own
accounts, rows you hid, pending rows, and investment accounts. Every new
transaction arrives **unreviewed** (a dot) until you mark it; Home collects
them. Changing a category offers **Always use for <merchant>**, which makes a
rule and files that merchant's past rows too. **Split** divides one purchase
across categories in dollars; budgets count the parts, and Undo puts it back.

## Goals

A goal is a balance moving from where it was the day you set it toward a number
you pick. Saving and paying off debt are the same arithmetic, so there is no
type to choose:

- **Save** — link a savings account, set the target above the balance.
- **Pay off** — link the card or loan and set the target to `0`. The balance is
  negative, so paying it down counts upward.

Progress is measured from a **snapshot taken when the goal was created**, not
from zero. An account already holding $8,000 does not show a $10,000 goal as 80%
done on day one, and the pace figure means something.

A goal that tracks an account follows it on every sync. A goal with no account
linked carries a figure you type — for cash, or an institution SimpleFIN cannot
reach.

With a target date set, the page shows what that date now demands per month.
After two weeks of history it also shows the pace actually achieved and where
that lands; under two weeks it says so rather than projecting a completion date
from a single paycheck. **Behind schedule** counts goals whose projection misses
their date — a goal with no projection yet is not counted as behind.

Achieved, archived and reopened are all user decisions. Nothing changes a goal's
status automatically, including reaching the target.

## Loans

One card per loan being paid: what is still owed, when it is paid off, the
monthly payment, the next due date, the rate and the interest still to pay.
SimpleFIN sends no interest rate, so the app estimates one from how the balance
falls against the payments (it needs a payment inside 25 days of balance
history), or you type it in with **Enter it** — the payoff date and the Advisor
use whichever is there, and **Go back to the estimate** clears yours. Rename a
loan from its ⋯ menu ("Tundra loan" reads better than "AUTO LOAN (3304)").

A loan counts as **paid off** once nothing is owed and no payment has gone to it
for 60 days. Paid-off loans are listed without a balance, payoff date or rate.

## Advisor

Two parts. The **checkup** is worked out by the app after each sync, with no AI
and nothing sent anywhere: an emergency fund short of three months, cash sitting
in checking above two months of bills, an envelope over its limit, a bill that
changed price, how much of your income you kept over three months. **×** hides a
finding until its figure changes; "N hidden · Show" brings them back.

**Ask** (the ask bar, ⌘K, or the phone's Ask button -- it opens over the
screen you are on and knows which one) takes a question in plain words — "Can I afford an $800 TV?", "When is
the car paid off if I add $200 a month?", "Where can I cut $300?". The app
works out every figure from your ledger; Claude only chooses which ones to look
up and explains them. It sees totals, categories and merchant names, never your
transactions or account numbers, and a figure in an answer is always the app's
(each one links to the transactions behind it and hides with the privacy
toggle). Affordability is judged on your checking account, against a floor you
set in **Settings → Advisor** ($500 unless you change it). Investing answers are
general guidance, never a pick.

Questions are kept under **History**; reopening one re-runs it on today's
figures. A question costs a few cents of API time (on the same key as
categorization); the checkup costs nothing.

## Recurring

Detected from history, not declared. A charge qualifies when its intervals
cluster on a cadence (weekly, fortnightly, monthly, quarterly, yearly) **and**
its amounts stay within 20% of each other:

- **Three occurrences** is the general bar.
- **Two** is enough only when the amounts are identical to the cent and the gap
  lands on a cadence. Two similar charges a month apart happen by chance;
  two *identical* ones do not. This matters because SimpleFIN serves 90 days, so
  a monthly subscription can appear at most three times.

Every interval has to fit, not just the median — otherwise a shop visited at
random that happens to average 30 days qualifies. Variable-amount merchants are
rejected by design.

**Suspected** covers what arithmetic cannot reach. A card connected last month
cannot show a monthly subscription more than once, so `ANTHROPIC* CLAUDE SUB`
and `GOOGLE *SPOTIFY MUSIC` are invisible to cadence detection no matter how
obvious they are to a reader. The model already labels each new merchant as a
subscription while categorizing, at no extra cost, so a single sighting of a
recognised subscription is surfaced separately -- a name is weaker evidence than
a demonstrated cadence, and its monthly cost is a guess until the second charge
lands.

`merchants.is_subscription` is nullable on purpose: null means "never asked",
false means "asked, no". Merchants resolved from cache never reach the model, so
a non-null default would make an unasked merchant indistinguishable from a
rejected one. `backfillSubscriptionFlags()` answers the question once per
merchant and then has nothing left to do.

The page totals what recurring costs per month and per year, flags a series
whose latest charge differs from its historical average (**price changed**), and
marks one that has missed two cadences as stopped. Ignoring a series is a
decision that survives resyncs.

## Rules

Checked before the merchant cache and before the model. Lower priority runs
first and the first match wins. A rule matches on description or merchant key by
contains / equals / regex, optionally narrowed to one account or an amount
range, and can set a category, rename the merchant, mark it a transfer, or
exclude it from totals.

**Test** is a dry run that counts pattern hits without writing.
**Apply to existing** releases everything the cache and the model decided and
re-runs categorization, so a new rule reaches transactions already in the
ledger. Categories set by hand are never touched, and the cache means it rarely
costs anything.

A regex is validated when the rule is saved. Left to fail at sync time it would
be swallowed per-transaction and silently match nothing.

## Passwords

**Security** → **Password**. It asks for your current password as well as the
new one: the session cookie already proved you once, but a change is exactly
what a stolen cookie would go for. A successful change signs out every other
session and leaves the one you are using alone, so changing it because somebody
else might have it actually ends their access.

Minimum twelve characters. A long passphrase beats a short one with symbols in
it.

**Temporary passwords.** When an admin creates an account or resets one, the
password is something two people know. That account is marked, and until it sets
its own password every page in the app redirects to the change form. An admin
reset also signs out all of that user's sessions immediately.

The admin who resets a password never sees the new one — **Users** shows a
*temporary password* chip until the person replaces it, and nothing more.

## Two-factor authentication

**Security** → set up authenticator. Scan the QR (or enter the setup key), then
enter a code to confirm. Nothing changes until a valid code is submitted, so an
abandoned setup can't lock you out. Turning it off re-checks your password —
disabling a second factor is exactly what a stolen session would try.

This is the app's own layer, independent of Cloudflare Access. Access decides
who reaches the server; this decides who gets in once they have. Keep both.

## Importing OFX/QFX

Same flow as CSV, minus the mapping step — OFX names its own fields and already
signs amounts the way this app does (debits negative on both bank and card
statements), so there is nothing to configure and no sign to flip.

The parser slices `<STMTTRN>` blocks rather than building a document tree,
because OFX 1.x is SGML with routinely unclosed tags. OFX 2.x is real XML and
parses the same way.

## More than one person

Each person gets their own everything: accounts, transactions, categories,
budgets, goals, rules, learned merchants and their own SimpleFIN connection.
Nothing is shared and there is no combined view.

**Adding someone** — as an admin, go to **Users**, enter their email and a
temporary password. There is no public signup route, so a misconfigured
Cloudflare Access policy cannot turn into a stranger with an account. Add their
email to the Access policy too, or they will never reach the login page. Send
the temporary password out of band; the app makes them replace it before it lets
them do anything else, so you do not end up knowing their password.

**Their bank connection** — they sign in and go to **Bank link**. They need
their own SimpleFIN Bridge subscription (about $15/yr, paid to SimpleFIN): they
connect their banks there, generate a setup token, and paste it in. Their bank
passwords never reach this server, and the read-only key that results is
encrypted under their row.

**How separation is enforced** — by PostgreSQL, not by careful coding. Every
table carries a `user_id` and a row-level security policy; the app connects as a
restricted role the policies apply to. A query that forgets to filter returns
nothing rather than someone else's money. `npm run test:isolation` proves it by
trying to cross the boundary in six different ways.

**The sync worker** runs one pass per person with a connection. One revoked
token doesn't stop anybody else's sync.

**Setup on an existing install:**

```bash
npm run db:migrate     # adds user_id everywhere, assigns existing rows to you
npm run db:approle     # creates the restricted role, writes APP_DATABASE_URL
```

Accounts that already exist are not asked to change their password — they chose
it themselves. Only accounts created or reset from the **Users** page are.

Your existing data is assigned to the first user in the database, and you are
made an admin. Both commands are safe to re-run.
