// Builds a throwaway demo database full of invented money, for showing the app
// to somebody without showing them your bank balance.
//
//   npm run demo:seed            # creates/rebuilds howtomoney_demo
//
// Then run the app against it, with the bank and AI keys blanked so nothing
// can reach SimpleFIN or Anthropic (dotenv never overrides a variable that is
// already set, even to empty):
//
//   DATABASE_URL=postgres://howtomoney:…/howtomoney_demo \
//   APP_DATABASE_URL=postgres://howtomoney_app:…/howtomoney_demo \
//   SIMPLEFIN_ACCESS_URL= SIMPLEFIN_SETUP_TOKEN= ANTHROPIC_API_KEY= \
//   AI_PROVIDER=none FEEDBACK_WEBHOOK_URL= ORIGIN=http://localhost:5174 \
//   npx vite dev --port 5174
//
// APP_DATABASE_URL must be the restricted `howtomoney_app` role, as in
// production. Pointed at the superuser, RLS enforces nothing and a second
// account sees the demo household's credential and accounts -- which once made
// the welcome flow look connected for a user who had linked nothing.
//
// Log in as demo@example.com / demo-password.
//
// Safety: this script only ever writes to a database whose name ends in
// `_demo`. It derives that URL from DATABASE_URL by swapping the database name,
// drops and recreates it, runs the migrations, and seeds one household. The
// real database is never connected to except to issue CREATE/DROP DATABASE for
// the demo one.
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo-password';

function demoUrl(base: string): string {
  const u = new URL(base);
  u.pathname = '/' + u.pathname.replace(/^\//, '').replace(/(_demo)?$/, '_demo');
  return u.toString();
}

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error('DATABASE_URL is not set');
const url = demoUrl(baseUrl);
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_demo')) throw new Error(`refusing: ${dbName} is not a demo database`);

// Recreate the demo database from nothing, via the maintenance database.
{
  const admin = new URL(baseUrl);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  await sql.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  await sql.end();
}
{
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  // The restricted role is cluster-wide and already exists from
  // `npm run db:approle`; it only needs rights in this database. Without it the
  // demo would have to run as the superuser, which bypasses RLS.
  const [{ exists }] = await sql<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = 'howtomoney_app') as exists`;
  if (exists) {
    await sql.unsafe(`GRANT CONNECT ON DATABASE "${dbName}" TO howtomoney_app`);
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO howtomoney_app`);
    await sql.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO howtomoney_app`
    );
    await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO howtomoney_app`);
  }
  await sql.end();
  console.log(`rebuilt ${dbName}`);
}

// Point every module at the demo database before the lazy db module first
// connects. APP_DATABASE_URL must move too -- `db` prefers it.
process.env.DATABASE_URL = url;
delete process.env.APP_DATABASE_URL;

const { db, systemDb, runAsUser } = await import('../src/lib/server/db');
const s = await import('../src/lib/server/db/schema');
const { createUser } = await import('../src/lib/server/users');
const { normalizeDescription, titleCase } = await import('../src/lib/server/sync/normalize');
const { matchTransfers } = await import('../src/lib/server/matching/transfers');
const { detectRecurring } = await import('../src/lib/server/matching/recurring');
const { eq } = await import('drizzle-orm');
const { saveSimpleFinAccessUrl } = await import('../src/lib/server/simplefin/credentials');

// ---- deterministic randomness, so every rebuild shows the same numbers ----
let seed = 20260924;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const cents = (n: number) => Math.round(n * 100);

const DAY = 86_400_000;
const today = new Date();
today.setHours(12, 0, 0, 0);
const DAYS = 120;
const start = new Date(today.getTime() - DAYS * DAY);

const { id: userId } = await createUser({
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
  isAdmin: true,
  mustChangePassword: false,
  onboarded: true
});
await systemDb.insert(s.userPreferences).values({ userId, tourSeenAt: new Date() });

await runAsUser(userId, async () => {
  const cats = await db.select().from(s.categories);
  const cat = (name: string) => {
    const c = cats.find((c) => c.name === name);
    if (!c) throw new Error(`no category ${name}`);
    return c.id;
  };

  // ---- accounts: opening balance 120 days ago; today's is derived ----
  type Acct = { key: string; name: string; org: string; type: 'depository' | 'credit' | 'loan' | 'investment'; open: number };
  const ACCTS: Acct[] = [
    { key: 'chk', name: 'EVERYDAY CHECKING (4821)', org: 'Maple Credit Union', type: 'depository', open: 3240.18 },
    { key: 'sav', name: 'High-Yield Savings - 7730 (7730)', org: 'Maple Credit Union', type: 'depository', open: 14100 },
    { key: 'card', name: 'Cashback Rewards Visa (1954)', org: 'Harbor Bank', type: 'credit', open: -1184.52 },
    { key: 'loan', name: 'AUTO LOAN (0612)', org: 'Harbor Bank', type: 'loan', open: -11240 },
    { key: 'inv', name: 'Index Fund Brokerage (3308)', org: 'Pinecrest Investments', type: 'investment', open: 38900 }
  ];
  const ids: Record<string, string> = {};
  for (const a of ACCTS) {
    const [row] = await db
      .insert(s.accounts)
      .values({
        provider: 'demo',
        providerAccountId: `demo-${a.key}`,
        orgName: a.org,
        name: a.name,
        type: a.type,
        balance: '0',
        balanceDate: today,
        lastSyncedAt: today
      })
      .returning({ id: s.accounts.id });
    ids[a.key] = row.id;
  }

  // A card the provider stopped returning, as a real sync would leave it:
  // deactivated, never deleted. It is what the Bank link page calls out.
  await db.insert(s.accounts).values({
    provider: 'demo',
    providerAccountId: 'demo-store',
    orgName: 'Northwind Store Card',
    name: 'Demo (5512)',
    type: 'credit',
    balance: '0',
    isActive: false
  });

  // Three student loans, paid off long ago (handoff 8a): nothing owed, and
  // their last payments well before the 120-day ledger, so no cash-flow
  // figure anywhere moves. Only the loan's own side of each payment exists.
  const STUDENT = [
    { last4: '2210', last: '2025-08-14', payment: 312.4 },
    { last4: '1143', last: '2025-02-18', payment: 188.15 },
    { last4: '1142', last: '2024-06-12', payment: 205.9 }
  ];
  let studentTxn = 0;
  for (const l of STUDENT) {
    const [row] = await db
      .insert(s.accounts)
      .values({
        provider: 'demo',
        providerAccountId: `demo-student-${l.last4}`,
        orgName: 'Harbor Student Lending',
        name: `STUDENT LOAN (${l.last4})`,
        type: 'loan',
        balance: '0',
        balanceDate: today,
        lastSyncedAt: today
      })
      .returning({ id: s.accounts.id });
    for (let k = 0; k < 3; k++) {
      const day = new Date(l.last + 'T12:00:00Z');
      day.setUTCMonth(day.getUTCMonth() - k);
      await db.insert(s.transactions).values({
        accountId: row.id,
        provider: 'demo',
        providerTxnId: `demo-student-${++studentTxn}`,
        postedAt: day,
        transactedAt: day,
        amount: l.payment.toFixed(2),
        description: 'PAYMENT RECEIVED THANK YOU',
        normalizedKey: normalizeDescription('PAYMENT RECEIVED THANK YOU'),
        categoryId: cat('Transfer'),
        categorySource: 'rule',
        categoryConfidence: 0.92
      });
    }
  }

  // Looks connected, and cannot reach anything: `.invalid` never resolves.
  await saveSimpleFinAccessUrl('https://demo:demo@demo.invalid/simplefin', 'demo');

  // ---- the ledger ----
  type Txn = { acct: string; day: Date; amount: number; desc: string; cat: string; review?: boolean; pending?: boolean };
  const txns: Txn[] = [];
  const add = (acct: string, day: Date, amount: number, desc: string, cat: string, extra: Partial<Txn> = {}) =>
    txns.push({ acct, day, amount: Math.round(amount * 100) / 100, desc, cat, ...extra });

  for (let t = start.getTime(); t <= today.getTime(); t += DAY) {
    const d = new Date(t);
    const dom = d.getDate();
    const dow = d.getDay();
    const daysIn = Math.floor((t - start.getTime()) / DAY);

    // Paid every other Friday.
    if (dow === 5 && Math.floor(daysIn / 7) % 2 === 0) add('chk', d, 2846.12, 'ACME ROBOTICS PAYROLL DIRECT DEP', 'Salary');

    if (dom === 1) {
      add('chk', d, -1695, 'PARKVIEW APARTMENTS RENT ONLINE PMT', 'Rent & Mortgage');
      add('chk', d, -500, 'ONLINE TRANSFER TO SAVINGS', 'Transfer');
      add('sav', d, 500, 'ONLINE TRANSFER FROM CHECKING', 'Transfer');
    }
    if (dom === 3) add('card', d, -15.49, 'NETFLIX.COM', 'Subscriptions');
    if (dom === 5) add('chk', d, -between(78, 118), 'CITY POWER & LIGHT BILL PAY', 'Utilities');
    if (dom === 7) add('card', d, -11.99, 'SPOTIFY USA', 'Subscriptions');
    if (dom === 9) add('card', d, -70, 'XFINITY INTERNET', 'Internet & Phone');
    if (dom === 10) {
      add('chk', d, -412.37, 'HARBOR BANK AUTO LOAN PAYMENT', 'Transfer');
      add('loan', d, 412.37, 'PAYMENT RECEIVED THANK YOU', 'Transfer');
    }
    if (dom === 12) add('card', d, -45, 'MINT MOBILE', 'Internet & Phone');
    if (dom === 14) add('card', d, -42, 'CITY FITNESS CLUB MEMBERSHIP', 'Fitness');
    // An automatic monthly contribution to the brokerage.
    if (dom === 15) {
      add('chk', d, -600, 'TRANSFER TO PINECREST BROKERAGE', 'Transfer');
      add('inv', d, 600, 'TRANSFER FROM EVERYDAY CHECKING', 'Transfer');
    }
    if (dom === 18) add('card', d, -128.5, 'GEICO AUTO INSURANCE', 'Insurance');
    if (dom === 20) add('card', d, -2.99, 'APPLE.COM/BILL ICLOUD', 'Subscriptions');
    if (dom === 28) add('sav', d, between(38, 44), 'INTEREST PAYMENT', 'Other Income');

    // Groceries twice a week, coffee most weekdays, dinner out a few times.
    if (dow === 0 || dow === 3)
      add('card', d, -between(46, 152), pick(["TRADER JOE'S #512", 'WHOLE FOODS MKT #10233', 'SAFEWAY #1841']), 'Groceries');
    if (dow >= 1 && dow <= 5 && rand() < 0.55)
      add('card', d, -between(4.25, 7.8), pick(['BLUE BOTTLE COFFEE', 'STARBUCKS STORE 08812', 'PHILZ COFFEE']), 'Coffee');
    if (rand() < 0.32)
      add('card', d, -between(14, 86), pick(['CHIPOTLE 2241', 'SWEETGREEN MISSION', 'TST* LITTLE STAR PIZZA', 'SQ *TACO BAR', 'DOORDASH*THAI BASIL']), 'Restaurants');
    if (rand() < 0.1) add('card', d, -between(38, 62), pick(['SHELL OIL 57442', 'CHEVRON 0091234']), 'Gas & Fuel');
    if (rand() < 0.14) add('card', d, -between(12, 140), 'AMAZON MKTPL*2K4LP', 'Shopping');
    if (rand() < 0.05) add('card', d, -between(9, 32), pick(['AMC THEATRES', 'STEAM PURCHASE']), 'Entertainment');
    if (rand() < 0.04) add('card', d, -between(18, 64), 'CVS/PHARMACY #0921', 'Health & Medical');
    if (rand() < 0.03) add('card', d, -between(22, 90), 'CHEWY.COM', 'Pets');
    if (rand() < 0.04) add('card', d, -between(25, 180), 'HOME DEPOT #6621', 'Home & Garden');
    if (rand() < 0.03) add('card', d, -between(20, 60), 'LYFT *RIDE', 'Transportation');
  }

  // One-offs that give the charts some texture.
  const ago = (n: number) => new Date(today.getTime() - n * DAY);
  add('card', ago(64), -486.2, 'DELTA AIR LINES', 'Travel');
  add('card', ago(61), -312.8, 'AIRBNB * HMQ8X2', 'Travel');
  add('card', ago(40), -85, 'RED CROSS DONATION', 'Gifts & Donations');
  add('chk', ago(33), 640, 'VENMO CASHOUT', 'Other Income');
  add('card', ago(22), 34.99, 'AMAZON MKTPL REFUND', 'Refund');
  add('card', ago(95), -60, 'ATM WITHDRAWAL 4411', 'Cash & ATM');
  // The brokerage: a one-off top-up from savings, and dividends the broker
  // reinvests at once -- a pair that nets to nothing in the balance.
  add('sav', ago(64), -142.17, 'ONLINE TRANSFER TO PINECREST', 'Transfer');
  add('inv', ago(64), 142.17, 'TRANSFER FROM HIGH-YIELD SAVINGS', 'Transfer');
  for (const [n, amt, fund] of [[4, 91.4, 'VTSAX'], [28, 21.84, 'VBTLX'], [95, 84.12, 'VTSAX']] as const) {
    add('inv', ago(n), amt, `DIVIDEND RECEIVED ${fund}`, 'Other Income');
    add('inv', ago(n), -amt, `REINVESTMENT ${fund}`, 'Other Income');
  }
  // A month that ran short, so the shortfall views have something to show.
  add('chk', new Date(today.getFullYear(), today.getMonth() - 2, 16, 12), -2380, 'MIDAS AUTO SERVICE #214', 'Transportation');
  // The review queue should not be empty in a demo of it.
  add('card', ago(6), -23.4, 'SQ *KNC GOODS', 'Uncategorized', { review: true });
  add('card', ago(4), -58.0, 'PAYPAL *JOHNSMITH', 'Uncategorized', { review: true });
  add('card', ago(1), -18.62, 'BLUE BOTTLE COFFEE', 'Coffee', { pending: true });
  add('card', ago(0), -64.3, "TRADER JOE'S #512", 'Groceries', { pending: true });

  // Pay the card off in full on the 22nd, from checking.
  txns.sort((a, b) => a.day.getTime() - b.day.getTime());
  const withPayments: Txn[] = [];
  let cardBal = cents(ACCTS.find((a) => a.key === 'card')!.open);
  const payDays: Date[] = [];
  for (let m = new Date(start.getFullYear(), start.getMonth(), 22, 12); m <= today; m = new Date(m.getFullYear(), m.getMonth() + 1, 22, 12))
    if (m > start) payDays.push(m);
  for (const t of txns) {
    while (payDays.length && payDays[0] <= t.day) {
      const day = payDays.shift()!;
      const amt = -cardBal / 100;
      withPayments.push({ acct: 'chk', day, amount: -amt, desc: 'HARBOR BANK CARD AUTOPAY', cat: 'Transfer' });
      withPayments.push({ acct: 'card', day, amount: amt, desc: 'AUTOPAY PAYMENT THANK YOU', cat: 'Transfer' });
      cardBal = 0;
    }
    if (t.acct === 'card') cardBal += cents(t.amount);
    withPayments.push(t);
  }

  // Merchant memory, so the app looks like it has learned these.
  const merchantIds = new Map<string, string>();
  for (const t of withPayments) {
    if (t.cat === 'Transfer' || t.review) continue;
    const key = normalizeDescription(t.desc);
    if (merchantIds.has(key)) continue;
    const [m] = await db
      .insert(s.merchants)
      .values({
        normalizedKey: key,
        displayName: titleCase(key),
        categoryId: cat(t.cat),
        source: 'ai',
        confidence: 0.92,
        isSubscription: t.cat === 'Subscriptions' ? true : false
      })
      .onConflictDoNothing()
      .returning({ id: s.merchants.id });
    if (m) merchantIds.set(key, m.id);
  }

  let n = 0;
  const running: Record<string, number> = Object.fromEntries(ACCTS.map((a) => [a.key, cents(a.open)]));
  const daily = new Map<string, number>(); // `${acct}|${yyyy-mm-dd}` -> cents
  for (const t of withPayments) {
    const key = normalizeDescription(t.desc);
    running[t.acct] += cents(t.amount);
    daily.set(`${t.acct}|${t.day.toISOString().slice(0, 10)}`, running[t.acct]);
    await db.insert(s.transactions).values({
      accountId: ids[t.acct],
      provider: 'demo',
      providerTxnId: `demo-${++n}`,
      postedAt: t.day,
      transactedAt: t.day,
      amount: t.amount.toFixed(2),
      description: t.desc,
      normalizedKey: key,
      merchantName: t.cat === 'Transfer' ? null : titleCase(key),
      merchantId: merchantIds.get(key) ?? null,
      categoryId: cat(t.cat),
      categorySource: t.review ? 'ai' : t.cat === 'Transfer' ? 'rule' : 'memory',
      categoryConfidence: t.review ? 0.52 : 0.92,
      needsReview: !!t.review,
      pending: !!t.pending
    });
  }

  // Investments move with the market as well as the ledger: a gentle upward
  // walk, plus whatever the ledger put in that day.
  const invIn = new Map<string, number>();
  for (const t of withPayments)
    if (t.acct === 'inv') {
      const day = t.day.toISOString().slice(0, 10);
      invIn.set(day, (invIn.get(day) ?? 0) + cents(t.amount));
    }
  let inv = cents(ACCTS.find((a) => a.key === 'inv')!.open);
  for (let t = start.getTime(); t <= today.getTime(); t += DAY) {
    inv = Math.round(inv * (1 + between(-0.009, 0.0115))) + (invIn.get(new Date(t).toISOString().slice(0, 10)) ?? 0);
    daily.set(`inv|${new Date(t).toISOString().slice(0, 10)}`, inv);
  }
  running.inv = inv;

  for (const a of ACCTS) {
    await db
      .update(s.accounts)
      .set({ balance: (running[a.key] / 100).toFixed(2) })
      .where(eq(s.accounts.id, ids[a.key]));
  }
  // Daily snapshots, carried forward over days with no activity.
  for (const a of ACCTS) {
    let last = cents(a.open);
    for (let t = start.getTime(); t <= today.getTime(); t += DAY) {
      const day = new Date(t).toISOString().slice(0, 10);
      last = daily.get(`${a.key}|${day}`) ?? last;
      await db
        .insert(s.accountBalances)
        .values({ accountId: ids[a.key], asOf: day, balance: (last / 100).toFixed(2) })
        .onConflictDoNothing();
    }
  }

  // Holdings for the brokerage, the last 30 days: four positions whose own
  // prices wander, scaled each day so they sum to that day's balance above.
  // A contribution buys more of the US fund twelve days ago; the bond fund
  // was bought above today's price; the cash sweep reports no purchase price.
  // Enough to show a gain, a loss, a missing cost basis and market movement
  // separated from money added.
  const FUNDS = [
    { key: 'VTSAX', description: 'Total Stock Market Index Fund', shares: 520, price: 24.1, drift: [-0.012, 0.014] },
    { key: 'VTIAX', description: 'Total International Stock Index Fund', shares: 1100, price: 13.4, drift: [-0.013, 0.013] },
    { key: 'VBTLX', description: 'Total Bond Market Index Fund', shares: 650, price: 10.05, drift: [-0.003, 0.003] },
    { key: 'VMFXX', description: 'Federal Money Market Fund', shares: 212.4, price: 1, drift: [0, 0] }
  ];
  const HOLD_DAYS = 30;
  // Built in memory first: the purchase prices are set against the final
  // prices (the daily scaling makes the starting ones meaningless), so the US
  // fund is well up, international a little, and bonds slightly under water.
  const PAID_VS_NOW: Record<string, number> = { VTSAX: 0.78, VTIAX: 0.93, VBTLX: 1.04 };
  const rowsOut: Array<{ day: string; key: string; description: string; shares: number; price: number }> = [];
  for (let d = HOLD_DAYS; d >= 0; d--) {
    const t = today.getTime() - d * DAY;
    const day = new Date(t).toISOString().slice(0, 10);
    if (d === 12) FUNDS[0].shares += 38;
    for (const f of FUNDS) f.price *= 1 + between(f.drift[0], f.drift[1]);
    // The sweep sits at $1; the funds are scaled to make up the rest.
    const cash = FUNDS.filter((f) => f.key === 'VMFXX').reduce((sum, f) => sum + f.shares, 0);
    const raw = FUNDS.filter((f) => f.key !== 'VMFXX').reduce((sum, f) => sum + f.shares * f.price, 0);
    const k = ((daily.get(`inv|${day}`) ?? running.inv) / 100 - cash) / raw;
    for (const f of FUNDS) {
      rowsOut.push({ day, key: f.key, description: f.description, shares: f.shares, price: f.key === 'VMFXX' ? 1 : f.price * k });
    }
  }
  const finalPrice = new Map(rowsOut.filter((r) => r.day === rowsOut.at(-1)!.day).map((r) => [r.key, r.price]));
  for (const r of rowsOut) {
    const paid = PAID_VS_NOW[r.key] ? finalPrice.get(r.key)! * PAID_VS_NOW[r.key] : null;
    await db
      .insert(s.holdingSnapshots)
      .values({
        accountId: ids.inv,
        asOf: r.day,
        holdingKey: r.key,
        symbol: r.key,
        description: r.description,
        shares: r.shares.toFixed(6),
        marketValue: (r.shares * r.price).toFixed(2),
        purchasePrice: paid === null ? null : paid.toFixed(6)
      })
      .onConflictDoNothing();
  }

  const matched = await matchTransfers(DAYS + 5);
  const recurring = await detectRecurring();

  // Envelopes and goals.
  const BUDGETS: Record<string, number> = {
    Groceries: 650, Restaurants: 400, Coffee: 90, Shopping: 250, Entertainment: 80,
    Subscriptions: 40, 'Gas & Fuel': 120, Utilities: 110, 'Internet & Phone': 120, Travel: 300
  };
  for (const [name, amount] of Object.entries(BUDGETS))
    await db.insert(s.budgets).values({ categoryId: cat(name), amount: amount.toFixed(2) });

  const bal = (k: string) => (running[k] / 100).toFixed(2);
  const inMonths = (m: number) => new Date(today.getFullYear(), today.getMonth() + m, 1);
  await db.insert(s.goals).values([
    { name: 'Emergency fund', targetAmount: '25000', startingAmount: '14100', accountId: ids.sav, targetDate: inMonths(14), sortOrder: 0 },
    { name: 'Pay off the car', targetAmount: '0', startingAmount: '-11240', accountId: ids.loan, targetDate: inMonths(22), sortOrder: 1 },
    { name: 'Japan trip', targetAmount: '4500', startingAmount: '0', manualAmount: '1350', targetDate: inMonths(8), sortOrder: 2, note: 'Cash envelope in the drawer' }
  ]);

  await db.insert(s.syncRuns).values({
    startedAt: new Date(Date.now() - 3 * 60_000),
    finishedAt: new Date(Date.now() - 2 * 60_000),
    status: 'completed',
    accountsSynced: ACCTS.length,
    txnsInserted: n
  });

  console.log(
    `seeded ${n} transactions over ${DAYS} days; ${matched.matched} transfers paired, ` +
      `${JSON.stringify(recurring)} recurring; balances: ` +
      ACCTS.map((a) => `${a.key} ${bal(a.key)}`).join(', ')
  );
});

console.log(`\nlog in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
process.exit(0);
