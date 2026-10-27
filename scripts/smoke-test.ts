// Smoke test for the deterministic layers: transfer matching and the
// false-positive guards. No network, no LLM.
//
// THIS TRUNCATES accounts, transactions and transfer_groups. It refuses to run
// against anything that does not look like a local database unless you set
// ALLOW_DESTRUCTIVE=1 -- pointing it at the NAS would erase your ledger.
import 'dotenv/config';
import { db } from '../src/lib/server/db';
import {
  accounts,
  transactions,
  transferGroups
} from '../src/lib/server/db/schema';
import { matchTransfers } from '../src/lib/server/matching/transfers';
import { eq } from 'drizzle-orm';
import { commitImport } from '../src/lib/server/import/commit';
import { detectMapping, mapRows, parseCsv } from '../src/lib/server/import/csv';

const day = (n: number) => new Date(Date.now() - n * 86400000);

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!pass) failures++;
}

// This test truncates accounts, transactions and transfer_groups, so it refuses
// to touch DATABASE_URL at all -- "is it local?" is not a safe question, because
// the local database is the real one during development. It runs only against a
// database named explicitly for this purpose, and nothing else.
function useTestDatabase() {
  const url = process.env.SMOKE_TEST_DATABASE_URL;
  if (!url) {
    console.error(
      'SMOKE_TEST_DATABASE_URL is not set.\n\n' +
        'This test DELETES every account, transaction and transfer group, so it will\n' +
        'not run against DATABASE_URL. Create a throwaway database and point it there:\n\n' +
        '  docker compose exec -T -u postgres db createdb -U howtomoney howtomoney_test\n' +
        '  SMOKE_TEST_DATABASE_URL=postgres://user:pw@localhost:5432/howtomoney_test npm run test:smoke\n'
    );
    process.exit(1);
  }
  if (/\/howtomoney(\?|$)/.test(url)) {
    console.error('Refusing to run: SMOKE_TEST_DATABASE_URL points at the main database.');
    process.exit(1);
  }
  // The db module reads its URL lazily, on first query, so overriding it here
  // redirects every query in this process.
  //
  // APP_DATABASE_URL has to go with it. `db` prefers it over DATABASE_URL, so
  // leaving the one from .env in place pointed this test -- which opens by
  // deleting every transaction, transfer group and account -- straight at the
  // real database, with the name check above satisfied by a URL nothing used.
  // Row-level security is what actually stopped it: with no `app.user_id` set
  // the deletes matched nothing. A guard that only holds because a second
  // guard holds is not a guard.
  process.env.DATABASE_URL = url;
  delete process.env.APP_DATABASE_URL;
}

/**
 * Every table this test touches is tenant-scoped, so the whole run happens
 * inside one user's scope -- unscoped inserts are refused by the policies, and
 * unscoped deletes silently match nothing.
 */
async function main() {
  useTestDatabase();

  const { runAsUser, systemDb } = await import('../src/lib/server/db');
  const { users } = await import('../src/lib/server/db/schema');

  await systemDb
    .insert(users)
    .values({ email: SMOKE_USER, passwordHash: 'not-a-real-hash' })
    .onConflictDoNothing();
  const [user] = await systemDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, SMOKE_USER));

  await runAsUser(user.id, run);
}

const SMOKE_USER = 'smoke-test@example.invalid';

async function run() {
  await db.delete(transactions);
  await db.delete(transferGroups);
  await db.delete(accounts);

  const [checking] = await db
    .insert(accounts)
    .values({
      providerAccountId: 'chk-1',
      name: 'Everyday Checking',
      orgName: 'Test Bank',
      type: 'depository',
      balance: '5000.00'
    })
    .returning();

  const [card] = await db
    .insert(accounts)
    .values({
      providerAccountId: 'cc-1',
      name: 'Rewards Visa',
      orgName: 'Test Bank',
      type: 'credit',
      balance: '-842.15'
    })
    .returning();

  const [savings] = await db
    .insert(accounts)
    .values({
      providerAccountId: 'sav-1',
      name: 'Savings',
      orgName: 'Other Bank',
      type: 'depository',
      balance: '12000.00'
    })
    .returning();

  await db.insert(transactions).values([
    // 1. The credit card payment: should auto-pair.
    {
      accountId: checking.id,
      providerTxnId: 't-pay-out',
      postedAt: day(10),
      amount: '-842.15',
      description: 'TEST BANK CREDIT CRD AUTOPAY',
      normalizedKey: 'test bank credit crd autopay'
    },
    {
      accountId: card.id,
      providerTxnId: 't-pay-in',
      postedAt: day(9),
      amount: '842.15',
      description: 'PAYMENT THANK YOU',
      normalizedKey: 'payment thank you'
    },
    // 2. The trap: a paycheck and an unrelated same-size expense on different
    //    accounts, days apart. Equal and opposite, but NOT a transfer.
    {
      accountId: checking.id,
      providerTxnId: 't-paycheck',
      postedAt: day(15),
      amount: '2000.00',
      description: 'ACME CORP DIRECT DEP',
      normalizedKey: 'acme corp direct dep'
    },
    {
      accountId: savings.id,
      providerTxnId: 't-rent',
      postedAt: day(14),
      amount: '-2000.00',
      description: 'GREENLEAF PROPERTIES RENT',
      normalizedKey: 'greenleaf properties rent'
    },
    // 3. Two ordinary coffees of the same amount, same account. Never a pair.
    {
      accountId: checking.id,
      providerTxnId: 't-coffee-1',
      postedAt: day(3),
      amount: '-5.75',
      description: 'SQ *BLUE BOTTLE COFF 8837',
      normalizedKey: 'blue bottle coff'
    },
    {
      accountId: checking.id,
      providerTxnId: 't-coffee-2',
      postedAt: day(3),
      amount: '-5.75',
      description: 'SQ *BLUE BOTTLE COFF 8837',
      normalizedKey: 'blue bottle coff'
    },
    // 4. A refund on the same account as the purchase. Not a transfer.
    {
      accountId: card.id,
      providerTxnId: 't-buy',
      postedAt: day(20),
      amount: '-129.99',
      description: 'AMZN Mktp US*RT4ZX',
      normalizedKey: 'amzn mktp us'
    },
    {
      accountId: card.id,
      providerTxnId: 't-refund',
      postedAt: day(18),
      amount: '129.99',
      description: 'AMZN Mktp US*RT4ZX REFUND',
      normalizedKey: 'amzn mktp us refund'
    }
  ]);

  const result = await matchTransfers();
  console.log('\nmatchTransfers ->', result, '\n');

  const rows = await db.select().from(transactions);
  const by = (id: string) => rows.find((r) => r.providerTxnId === id)!;

  check('credit card payment auto-paired', by('t-pay-out').isTransfer && by('t-pay-in').isTransfer);
  check(
    'both legs share one transfer group',
    !!by('t-pay-out').transferGroupId &&
      by('t-pay-out').transferGroupId === by('t-pay-in').transferGroupId
  );

  const [group] = await db
    .select()
    .from(transferGroups)
    .where(eq(transferGroups.id, by('t-pay-out').transferGroupId!));
  check('classified as cc_payment', group?.kind === 'cc_payment', `kind=${group?.kind}`);

  check(
    'paycheck NOT auto-paired with unrelated expense',
    !by('t-paycheck').isTransfer && !by('t-rent').isTransfer
  );
  check(
    'paycheck/expense pair queued for human review instead',
    by('t-paycheck').needsReview && by('t-rent').needsReview
  );

  check(
    'same-account duplicate coffees never paired',
    !by('t-coffee-1').isTransfer && !by('t-coffee-2').isTransfer
  );
  check(
    'same-account refund never treated as a transfer',
    !by('t-buy').isTransfer && !by('t-refund').isTransfer
  );
  check('both legs kept in the ledger', rows.length === 8, `rows=${rows.length}`);

  await testCsvDedup(checking.id);
  await testCategoryUsage(checking.id);
  await testBudgetDefault();

  console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * A CSV export always overlaps what the API already delivered. Getting this
 * wrong duplicates months of spending, so it is tested against a real database
 * rather than reasoned about.
 */
async function testCsvDedup(accountId: string) {
  console.log('\n--- CSV import dedup ---');

  const before = (await db.select().from(transactions)).length;

  // Two of these already exist from the fixtures above: the coffee on day 3 and
  // the card autopay on day 10. The grocery run is new.
  const csv = [
    'Date,Description,Amount',
    `${iso(day(3))},SQ *BLUE BOTTLE COFF 8837,-5.75`,
    `${iso(day(10))},TEST BANK CREDIT CRD AUTOPAY,-842.15`,
    `${iso(day(4))},TRADER JOES #451,-38.21`
  ].join('\n');

  const rows = parseCsv(csv);
  const first = await commitImport(accountId, mapRows(rows, detectMapping(rows)));

  check('recognizes rows the API already delivered', first.duplicates === 2, `dupes=${first.duplicates}`);
  check('imports the genuinely new row', first.imported === 1, `imported=${first.imported}`);

  // Re-importing the identical file must be a no-op.
  const second = await commitImport(accountId, mapRows(rows, detectMapping(rows)));
  check('re-importing the same file adds nothing', second.imported === 0, `imported=${second.imported}`);
  check('re-import sees all three as duplicates', second.duplicates === 3, `dupes=${second.duplicates}`);

  // The ledger holds two identical coffees on day 3 -- two real purchases, not a
  // duplicate. A file listing three must consume both and add exactly one. This
  // is the property a set-based dedup gets wrong: it would call all three
  // duplicates and silently lose a transaction.
  const triples = [
    'Date,Description,Amount',
    `${iso(day(3))},SQ *BLUE BOTTLE COFF 8837,-5.75`,
    `${iso(day(3))},SQ *BLUE BOTTLE COFF 8837,-5.75`,
    `${iso(day(3))},SQ *BLUE BOTTLE COFF 8837,-5.75`
  ].join('\n');
  const tripleRows = parseCsv(triples);
  const tripleResult = await commitImport(accountId, mapRows(tripleRows, detectMapping(tripleRows)));
  check(
    'consumes each existing row exactly once',
    tripleResult.duplicates === 2 && tripleResult.imported === 1,
    `dupes=${tripleResult.duplicates} imported=${tripleResult.imported}`
  );

  const after = (await db.select().from(transactions)).length;
  check('net rows added is exactly 2', after - before === 2, `added=${after - before}`);

  const csvRows = await db.select().from(transactions).where(eq(transactions.provider, 'csv'));
  check('imported rows are tagged as csv', csvRows.length === 2, `n=${csvRows.length}`);
  check(
    'imported rows carry a normalized merchant key',
    csvRows.every((r) => !!r.normalizedKey),
    csvRows.map((r) => r.normalizedKey).join(',')
  );
}

/**
 * A category's default budget (month null) is one row. The unique index used
 * to treat every null month as distinct, so ON CONFLICT never fired and each
 * edit added a row; the month model read the largest, and lowering a budget
 * silently did nothing.
 */
async function testBudgetDefault() {
  const { budgets, categories } = await import('../src/lib/server/db/schema');
  const { setBudget, budgetsForMonth } = await import('../src/lib/server/budgets');

  await db.delete(categories).where(eq(categories.name, 'Smoke Budget'));
  const [cat] = await db.insert(categories).values({ name: 'Smoke Budget', group: 'expense', color: '#8c491a' }).returning();

  await setBudget(cat.id, 200, null);
  await setBudget(cat.id, 100, null);
  const rows = await db.select().from(budgets).where(eq(budgets.categoryId, cat.id));
  check('a default budget edited twice is one row', rows.length === 1, `rows=${rows.length}`);
  const env = (await budgetsForMonth(new Date())).find((b) => b.categoryId === cat.id);
  check('lowering a default budget takes effect', env?.amount === 100, `amount=${env?.amount}`);

  await db.delete(categories).where(eq(categories.id, cat.id));
}

/**
 * Category usage counts. They were once three correlated subqueries that
 * Drizzle rendered as `where "category_id" = "id"` -- a column compared with the
 * inner table's own id -- so every count was 0 and every category read unused,
 * which let a used category be deleted without asking where its rows should go.
 */
async function testCategoryUsage(accountId: string) {
  const { categories, merchants, rules } = await import('../src/lib/server/db/schema');
  const { categoryUsage } = await import('../src/lib/server/categoryUsage');

  await db.delete(rules).where(eq(rules.name, 'smoke usage rule'));
  await db.delete(merchants).where(eq(merchants.normalizedKey, 'smoke usage merchant'));
  await db.delete(categories).where(eq(categories.name, 'Smoke Usage'));

  const [used] = await db
    .insert(categories)
    .values({ name: 'Smoke Usage', group: 'expense', color: '#8c491a' })
    .returning();
  const [unused] = await db
    .insert(categories)
    .values({ name: 'Smoke Unused', group: 'expense', color: '#8c491a' })
    .onConflictDoNothing()
    .returning();

  await db.insert(transactions).values([
    {
      accountId,
      providerTxnId: 'usage-1',
      postedAt: day(4),
      amount: '-3.00',
      description: 'SMOKE USAGE ONE',
      normalizedKey: 'smoke usage one',
      categoryId: used.id
    },
    {
      accountId,
      providerTxnId: 'usage-2',
      postedAt: day(4),
      amount: '-4.00',
      description: 'SMOKE USAGE TWO',
      normalizedKey: 'smoke usage two',
      categoryId: used.id
    }
  ]);
  await db.insert(merchants).values({
    normalizedKey: 'smoke usage merchant',
    displayName: 'Smoke Usage',
    categoryId: used.id
  });
  await db.insert(rules).values({
    name: 'smoke usage rule',
    matchValue: 'SMOKE USAGE',
    setCategoryId: used.id
  });

  const usage = await categoryUsage();
  const u = usage.get(used.id);
  check(
    'category usage counts transactions, merchants and rules',
    u?.transactions === 2 && u?.recent === 2 && u?.merchants === 1 && u?.rules === 1,
    JSON.stringify(u)
  );
  check(
    'a category nothing points at has no usage',
    !unused || !usage.has(unused.id),
    unused ? JSON.stringify(usage.get(unused.id)) : 'already existed'
  );

  await db.delete(rules).where(eq(rules.name, 'smoke usage rule'));
  await db.delete(merchants).where(eq(merchants.normalizedKey, 'smoke usage merchant'));
  await db.delete(transactions).where(eq(transactions.categoryId, used.id));
  await db.delete(categories).where(eq(categories.id, used.id));
  if (unused) await db.delete(categories).where(eq(categories.id, unused.id));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
