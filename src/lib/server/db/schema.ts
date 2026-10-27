import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  index,
  uniqueIndex,
  unique,
  pgEnum,
  primaryKey,
  type AnyPgColumn
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Sign convention, enforced everywhere: money out is negative, money in is
// positive, on every account type including credit cards.

export const accountTypeEnum = pgEnum('account_type', [
  'depository',
  'credit',
  'loan',
  'investment',
  'other'
]);

export const categorySourceEnum = pgEnum('category_source', [
  'none',
  'rule',
  'memory',
  'ai',
  'user'
]);

export const transferKindEnum = pgEnum('transfer_kind', ['cc_payment', 'internal', 'manual']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  // Admins manage accounts for other people. There is no public signup: the
  // only way a user exists is that an admin created them, which keeps a
  // misconfigured Access policy from turning into a stranger with a ledger.
  isAdmin: boolean('is_admin').notNull().default(false),
  passwordHash: text('password_hash').notNull(),
  // Set whenever somebody other than the account holder chose the password --
  // account creation and an admin reset. A temporary password is one two people
  // know, so every page redirects to the change form until it is replaced.
  // Existing rows default to false: they set their own password already.
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  // Null until the guided setup has been finished. Every route but the setup
  // itself redirects back to it while this is null, because an account with no
  // bank connected has nothing to show and every page would be an empty table.
  // Existing users are backfilled in the migration: they are already set up.
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  totpSecret: text('totp_secret'),
  totpConfirmedAt: timestamp('totp_confirmed_at', { withTimezone: true }),
  // The beta's day-30 question, "how would you feel if you could no longer
  // use it?": 'very' | 'somewhat' | 'not', or 'skipped'. Null = not asked yet.
  // Above 40% 'very' is the usual sign a product has found its people.
  pmfAnswer: text('pmf_answer'),
  pmfAnsweredAt: timestamp('pmf_answered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Registration is invite-only, and this table is the invite list.
 *
 * Cloudflare Access sits in front of the app, but its policy is an email
 * allowlist and nothing more -- an open signup form behind it would hand a full
 * tenancy to anyone that allowlist admits, including anyone added to it by
 * mistake. A code is a second, deliberate act by an admin.
 *
 * Only the hash is stored. A database dump then contains no usable invite: the
 * codes are high-entropy random strings, so a plain SHA-256 is enough -- there
 * is nothing to brute force, unlike a human-chosen password.
 *
 * Not a tenant table: an invite exists before the user it creates does, so it
 * carries no user_id and no row-level security policy, and every query against
 * it goes through `systemDb` explicitly.
 */
export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  codeHash: text('code_hash').notNull().unique(),
  /** Optional: when set, only this address can redeem the code. */
  email: text('email'),
  note: text('note'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' })
});

/**
 * Failed sign-in attempts, keyed `email:<address>` or `ip:<address>`
 * (`auth/throttle.ts`). In the database rather than in process memory so a
 * second web container shares the allowance instead of doubling it, and a
 * restart does not hand an attacker a fresh one. Not a tenant table: it is
 * written before anyone is signed in, and holds no money.
 */
export const authThrottle = pgTable('auth_throttle', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull()
});

/**
 * One row per person per calendar day they used the app: the beta's "who
 * came back this week" (admin › Beta). Written beside `sessions.last_seen_at`,
 * before any user scope exists, so like `sessions` it is not a tenant table
 * and has no row-level security -- it holds dates, never money -- and it is
 * read only through `systemDb` on the admin page.
 */
export const userActiveDays = pgTable(
  'user_active_days',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull()
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })]
);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // What the Security page lists each session by. Both null on sessions made
  // before they existed; sign-in time needs no column of its own, because the
  // expiry is fixed at creation and never slides.
  userAgent: text('user_agent'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
});

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant key. Defaults from the `app.user_id` setting that every request
    // sets, so inserts never have to remember it, and row-level security
    // filters on the same value -- a query that forgets to scope returns
    // nothing instead of somebody else's money.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    provider: text('provider').notNull().default('simplefin'),
    providerAccountId: text('provider_account_id').notNull(),
    orgName: text('org_name'),
    name: text('name').notNull(),
    nickname: text('nickname'),
    type: accountTypeEnum('type').notNull().default('depository'),
    currency: text('currency').notNull().default('USD'),
    balance: numeric('balance', { precision: 14, scale: 2 }),
    availableBalance: numeric('available_balance', { precision: 14, scale: 2 }),
    balanceDate: timestamp('balance_date', { withTimezone: true }),
    // Excluded from net worth and spending rollups when false.
    isActive: boolean('is_active').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    // A loan's annual rate in percent, typed in by the user. SimpleFIN sends
    // none; null means "not entered", and the Loans page falls back to an
    // estimate from the balance history.
    interestRate: numeric('interest_rate', { precision: 6, scale: 3 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('accounts_provider_key').on(t.userId, t.provider, t.providerAccountId)]
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Tenant key. Defaults from the `app.user_id` setting that every request
  // sets, so inserts never have to remember it, and row-level security
  // filters on the same value -- a query that forgets to scope returns
  // nothing instead of somebody else's money.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
  name: text('name').notNull(),
  // income | expense | transfer -- drives which rollups it appears in.
  group: text('group').notNull().default('expense'),
  icon: text('icon'),
  // Identity swatch shown beside the name. Charts encode magnitude with a single
  // hue and carry identity in the label, so this never has to survive a
  // colorblind-safety check against the other categories -- which matters,
  // because the user can create unlimited categories and no validated
  // categorical palette extends past eight slots.
  color: text('color').notNull().default('#6da7ec'),
  isSystem: boolean('is_system').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0)
});

// Learned merchant cache. This is what keeps the LLM bill near zero: after the
// first sighting of a merchant, categorization is a primary-key lookup forever.
export const merchants = pgTable(
  'merchants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant key. Defaults from the `app.user_id` setting that every request
    // sets, so inserts never have to remember it, and row-level security
    // filters on the same value -- a query that forgets to scope returns
    // nothing instead of somebody else's money.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    // Output of normalizeDescription() -- the cache key.
    normalizedKey: text('normalized_key').notNull(),
    displayName: text('display_name').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null'
    }),
    source: categorySourceEnum('source').notNull().default('ai'),
    confidence: real('confidence'),
    // Set when the model recognises the merchant as a subscription service from
    // its descriptor alone. Lets a charge seen only once still surface as a
    // suspected recurring cost -- a 90-day window cannot show a monthly
    // subscription more than three times, and a newly connected card often
    // shows it once.
    // Nullable on purpose: null means 'never asked', false means 'asked, no'.
    // A non-null default would make an unasked merchant indistinguishable from
    // one the model rejected, and merchants resolved from cache never reach the
    // model at all.
    isSubscription: boolean('is_subscription'),
    // A user correction pins the mapping so the AI layer never overwrites it.
    pinnedByUser: boolean('pinned_by_user').notNull().default(false),
    seenCount: integer('seen_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('merchants_key').on(t.userId, t.normalizedKey)]
);

export const transferGroups = pgTable('transfer_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Tenant key. Defaults from the `app.user_id` setting that every request
  // sets, so inserts never have to remember it, and row-level security
  // filters on the same value -- a query that forgets to scope returns
  // nothing instead of somebody else's money.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
  kind: transferKindEnum('kind').notNull().default('internal'),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  confidence: real('confidence').notNull().default(1),
  matchedBy: text('matched_by').notNull().default('auto'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant key. Defaults from the `app.user_id` setting that every request
    // sets, so inserts never have to remember it, and row-level security
    // filters on the same value -- a query that forgets to scope returns
    // nothing instead of somebody else's money.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('simplefin'),
    providerTxnId: text('provider_txn_id').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    transactedAt: timestamp('transacted_at', { withTimezone: true }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    description: text('description').notNull(),
    payee: text('payee'),
    memo: text('memo'),
    normalizedKey: text('normalized_key').notNull(),
    // Cleaned name for display, e.g. "Blue Bottle Coffee". Falls back to description.
    merchantName: text('merchant_name'),
    merchantId: uuid('merchant_id').references(() => merchants.id, {
      onDelete: 'set null'
    }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null'
    }),
    categorySource: categorySourceEnum('category_source').notNull().default('none'),
    categoryConfidence: real('category_confidence'),
    transferGroupId: uuid('transfer_group_id').references(() => transferGroups.id, {
      onDelete: 'set null'
    }),
    isTransfer: boolean('is_transfer').notNull().default(false),
    pending: boolean('pending').notNull().default(false),
    // Surfaces in the review queue.
    needsReview: boolean('needs_review').notNull().default(false),
    // Kept out of spending rollups without deleting the row.
    excluded: boolean('excluded').notNull().default(false),
    note: text('note'),
    /**
     * When somebody looked at the row (v2's "Mark as reviewed"). Null means
     * unreviewed: a synced row lands unreviewed and carries the accent dot
     * until it is marked. Rows that predate the column were backfilled as
     * reviewed except those already waiting in the review queue.
     */
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /**
     * A split part points at the row it was split from. The parent is set
     * `excluded` so every rollup counts the parts instead -- the existing
     * exclusions already keep it out everywhere -- and the parts carry
     * provider 'split'. Deleting the parent deletes its parts.
     */
    splitParentId: uuid('split_parent_id').references((): AnyPgColumn => transactions.id, {
      onDelete: 'cascade'
    }),
    // Full provider payload, so reprocessing never needs a refetch.
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('transactions_provider_key').on(t.userId, t.provider, t.providerTxnId),
    index('transactions_account_posted').on(t.accountId, t.postedAt),
    index('transactions_posted').on(t.postedAt),
    index('transactions_normalized').on(t.normalizedKey),
    index('transactions_review').on(t.needsReview),
    index('transactions_split_parent').on(t.splitParentId),
    index('transactions_transfer_group').on(t.transferGroupId)
  ]
);

export const rules = pgTable('rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Tenant key. Defaults from the `app.user_id` setting that every request
  // sets, so inserts never have to remember it, and row-level security
  // filters on the same value -- a query that forgets to scope returns
  // nothing instead of somebody else's money.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
  name: text('name').notNull(),
  priority: integer('priority').notNull().default(100),
  matchField: text('match_field').notNull().default('description'),
  matchType: text('match_type').notNull().default('contains'),
  matchValue: text('match_value').notNull(),
  // Optional narrowing: only apply on one account.
  accountId: uuid('account_id').references(() => accounts.id, {
    onDelete: 'cascade'
  }),
  amountMin: numeric('amount_min', { precision: 14, scale: 2 }),
  amountMax: numeric('amount_max', { precision: 14, scale: 2 }),
  setCategoryId: uuid('set_category_id').references(() => categories.id, {
    onDelete: 'cascade'
  }),
  setMerchantName: text('set_merchant_name'),
  setIsTransfer: boolean('set_is_transfer'),
  setExcluded: boolean('set_excluded'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// A CSV import is two steps -- upload, then confirm the column mapping -- so the
// file has to survive between requests. Keeping the raw text means a mapping can
// be corrected and re-applied without asking the user to upload again.
export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Tenant key. Defaults from the `app.user_id` setting that every request
  // sets, so inserts never have to remember it, and row-level security
  // filters on the same value -- a query that forgets to scope returns
  // nothing instead of somebody else's money.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  rawCsv: text('raw_csv').notNull(),
  mapping: jsonb('mapping'),
  status: text('status').notNull().default('pending'),
  rowCount: integer('row_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * A budget is a monthly limit on a category. `month` null means the recurring
 * default that applies to every month; a row with `month` set overrides the
 * default for that one month only. Two rows instead of a rollover column, so
 * editing one month never disturbs the others.
 */
export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant key. Defaults from the `app.user_id` setting that every request
    // sets, so inserts never have to remember it, and row-level security
    // filters on the same value -- a query that forgets to scope returns
    // nothing instead of somebody else's money.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    // First day of the month this override applies to; null = the default.
    month: timestamp('month', { withTimezone: true }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  // NULLS NOT DISTINCT: the default (month null) is one row per category.
  // A plain unique index treats every null month as distinct, so the
  // ON CONFLICT in setBudget() never fired for a default and each edit added
  // a row; the page read the largest, and lowering a budget did nothing.
  (t) => [unique('budgets_category_month').on(t.userId, t.categoryId, t.month).nullsNotDistinct()]
);

/**
 * A detected recurring charge -- subscriptions, rent, insurance, loan payments.
 * Derived from transaction history rather than declared, and refreshed on every
 * sync, so the interesting part is what changes: an amount that moved, or a
 * series that stopped arriving.
 */
export const recurringSeries = pgTable(
  'recurring_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant key. Defaults from the `app.user_id` setting that every request
    // sets, so inserts never have to remember it, and row-level security
    // filters on the same value -- a query that forgets to scope returns
    // nothing instead of somebody else's money.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    normalizedKey: text('normalized_key').notNull(),
    merchantName: text('merchant_name').notNull(),
    accountId: uuid('account_id').references(() => accounts.id, {
      onDelete: 'cascade'
    }),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null'
    }),
    /** 7, 14, 30, 90 or 365 -- the cadence the intervals cluster around. */
    cadenceDays: integer('cadence_days').notNull(),
    averageAmount: numeric('average_amount', {
      precision: 14,
      scale: 2
    }).notNull(),
    lastAmount: numeric('last_amount', { precision: 14, scale: 2 }).notNull(),
    /** Set when the most recent charge differs from the historical average. */
    amountChanged: boolean('amount_changed').notNull().default(false),
    occurrences: integer('occurrences').notNull().default(0),
    firstSeen: timestamp('first_seen', { withTimezone: true }).notNull(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(),
    nextExpected: timestamp('next_expected', { withTimezone: true }),
    /** active | ended | ignored -- `ignored` is a user decision and survives resyncs. */
    status: text('status').notNull().default('active'),
    /**
     * Made by the person -- "Mark as recurring" on a transaction, or a bill
     * added by hand (`normalized_key` 'manual:…', no account). Detection never
     * rewrites it; `refreshUserSeries()` keeps its last charge current.
     */
    userSet: boolean('user_set').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('recurring_key').on(t.userId, t.normalizedKey, t.accountId)]
);

/**
 * A savings target or a debt payoff. Both are the same arithmetic -- a balance
 * moving from where it started toward where it should end -- so there is no
 * `kind` column: paying off a card is a goal whose target is *above* its
 * starting point, and saving is one whose target is below. Direction is derived
 * from the two numbers, which makes it impossible for them to disagree.
 *
 * `startingAmount` is a snapshot taken when the goal is created, not a live
 * figure. Progress is measured against it, so re-syncing an account can move
 * the current balance but never silently rewrites how far along the goal is.
 *
 * A goal linked to an account tracks that account's balance. An unlinked goal
 * carries `manualAmount`, which the user edits -- for money the app cannot see,
 * like a cash envelope or an account at an institution SimpleFIN cannot reach.
 */
export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Tenant key. Defaults from the `app.user_id` setting that every request
  // sets, so inserts never have to remember it, and row-level security
  // filters on the same value -- a query that forgets to scope returns
  // nothing instead of somebody else's money.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
  name: text('name').notNull(),
  targetAmount: numeric('target_amount', { precision: 14, scale: 2 }).notNull(),
  /** Balance (or manual figure) when the goal was created. */
  startingAmount: numeric('starting_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  targetDate: timestamp('target_date', { withTimezone: true }),
  accountId: uuid('account_id').references(() => accounts.id, {
    onDelete: 'set null'
  }),
  /** Only consulted when `accountId` is null. */
  manualAmount: numeric('manual_amount', { precision: 14, scale: 2 }),
  /** active | achieved | archived -- all three are user decisions, never automatic. */
  status: text('status').notNull().default('active'),
  note: text('note'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Provider credentials, encrypted at rest with `ENCRYPTION_KEY`.
 *
 * A SimpleFIN access URL is long-lived, read-only and the only thing standing
 * between a copied file and a full transaction history, so it does not belong
 * in a plaintext `.env` that every backup and every root process can read. The
 * env var is still honoured as a fallback and is imported into this table on
 * first use.
 *
 * One row per provider today. When accounts become per-user, this grows a
 * `user_id` and becomes the table each person's own bank link lives in.
 */
export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant key. Defaults from the `app.user_id` setting that every request
    // sets, so inserts never have to remember it, and row-level security
    // filters on the same value -- a query that forgets to scope returns
    // nothing instead of somebody else's money.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    provider: text('provider').notNull().default('simplefin'),
    /** Output of encryptSecret() -- `v1.<iv>.<tag>.<ciphertext>`. */
    secret: text('secret').notNull(),
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('provider_credentials_provider').on(t.userId, t.provider)]
);

/**
 * One row per bank connected through Plaid (a Plaid "Item").
 *
 * SimpleFIN is one credential per person covering every bank; Plaid is one
 * access token per bank, each with its own position in the transaction feed,
 * so it cannot share `provider_credentials`' one-row-per-provider shape.
 *
 * `cursor` is where `/transactions/sync` left off. It is written in the same
 * transaction as the rows it produced, so a sync that fails half-way replays
 * from the old cursor instead of skipping what it never stored.
 */
export const plaidItems = pgTable(
  'plaid_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    itemId: text('item_id').notNull(),
    /** Output of encryptSecret() -- never the raw access token. */
    accessToken: text('access_token').notNull(),
    institutionId: text('institution_id'),
    institutionName: text('institution_name'),
    cursor: text('cursor'),
    /** Plaid's error_code from the last sync (e.g. ITEM_LOGIN_REQUIRED); null when healthy. */
    errorCode: text('error_code'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex('plaid_items_item').on(t.userId, t.itemId)]
);

/**
 * One balance per account per day, written by every sync.
 *
 * Investment balances move with the market and leave no transaction trail,
 * which is why they are excluded from cash flow and from the net-worth
 * walk-back -- there is nothing in the ledger to walk back through. That also
 * means performance cannot be derived after the fact: the only way to know what
 * a portfolio was worth last month is to have written it down last month. This
 * table is that record, and it starts paying off a day after it exists.
 *
 * Every account is captured, not just investments: a stored daily balance makes
 * the net-worth curve a measurement rather than a reconstruction.
 */
export const accountBalances = pgTable(
  'account_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant key. Defaults from the `app.user_id` setting that every request
    // sets, so inserts never have to remember it, and row-level security
    // filters on the same value -- a query that forgets to scope returns
    // nothing instead of somebody else's money.
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    // A calendar day, not an instant. Several syncs a day overwrite each other
    // rather than stacking up, so the series stays one point per day.
    asOf: date('as_of').notNull(),
    balance: numeric('balance', { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('account_balances_day').on(t.userId, t.accountId, t.asOf),
    index('account_balances_as_of').on(t.asOf)
  ]
);

/**
 * What each investment account held, per day, written by every sync.
 *
 * Same reasoning as `account_balances`, one level down: SimpleFIN reports the
 * positions as they stand today and nothing about yesterday, so allocation over
 * time and per-fund performance exist only if they are written down daily.
 *
 * `holding_key` is the ticker, or the description when a position has none.
 * Two lots of the same fund in one account are summed into one row. A sync
 * replaces the day's rows for an account wholesale, so a position sold in the
 * afternoon does not linger from the morning's run.
 *
 * `purchase_price` is the provider's average cost per share. It arrives as
 * "0.00" when unknown (a 401(k) plan, the money-market sweep) and is stored as
 * null then -- zero would read as a position bought for nothing, which is a
 * gain of 100%. The provider's `cost_basis` has been "0.00" on every position
 * observed, so it is not stored; basis is shares x purchase price.
 */
export const holdingSnapshots = pgTable(
  'holding_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    asOf: date('as_of').notNull(),
    holdingKey: text('holding_key').notNull(),
    symbol: text('symbol'),
    description: text('description'),
    shares: numeric('shares', { precision: 20, scale: 6 }).notNull(),
    marketValue: numeric('market_value', { precision: 14, scale: 2 }).notNull(),
    purchasePrice: numeric('purchase_price', { precision: 16, scale: 6 }),
    currency: text('currency').notNull().default('USD'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex('holding_snapshots_day').on(t.userId, t.accountId, t.asOf, t.holdingKey),
    index('holding_snapshots_as_of').on(t.asOf)
  ]
);

/**
 * Per-user display preferences: which tabs are shown, and in what order the
 * dashboard's cards appear.
 *
 * Stored rather than kept in the browser, because these are decisions about the
 * account ("I do not track budgets"), not about the device, and they have to
 * survive a new phone. Which also means the nav is not the only thing that
 * reads them -- hiding a tab has to refuse its route, or a bookmark walks
 * straight back into a feature somebody turned off.
 */
export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Tenant key. Defaults from the `app.user_id` setting that every request
  // sets, so inserts never have to remember it, and row-level security
  // filters on the same value -- a query that forgets to scope returns
  // nothing instead of somebody else's money.
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' })
    .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
  /** Paths switched off, e.g. ["/budgets"]. Absent means everything is shown. */
  hiddenTabs: jsonb('hidden_tabs').$type<string[]>().notNull().default([]),
  /**
   * Dashboard card ids in display order, and the ones switched off, kept
   * separate on purpose: a card added by a later version is absent from both,
   * and "absent" has to mean "new, show it" rather than "hidden", or every
   * upgrade would quietly hide its own new feature from everyone who had ever
   * opened Settings.
   */
  dashboardCards: jsonb('dashboard_cards').$type<string[] | null>(),
  hiddenCards: jsonb('hidden_cards').$type<string[]>().notNull().default([]),
  /** Set once the welcome tour has been seen, so it is not shown again. */
  tourSeenAt: timestamp('tour_seen_at', { withTimezone: true }),
  /**
   * Advisor checkup findings put away. A key names a situation, and carries
   * its month or its new price, so the same thing happening again next month
   * is a new finding rather than a hidden one.
   */
  dismissedFindings: jsonb('dismissed_findings').$type<string[]>().notNull().default([]),
  /** One-time tips put away with "Got it" (v2), by tip id. */
  dismissedTips: jsonb('dismissed_tips').$type<string[]>().notNull().default([]),
  /** Checking the Advisor's forecast keeps in reserve; null = ADVISOR_FLOOR. */
  advisorFloor: numeric('advisor_floor', { precision: 14, scale: 2 }),
  /**
   * When a SimpleFIN token was last claimed. The first sync after
   * it lands every row unreviewed -- a thousand dots -- so Activity offers
   * "Review just the last 2 weeks" until one of its two answers clears this.
   * Null for a connection made before the card existed: it is never shown
   * for history that is not new.
   */
  firstSyncAt: timestamp('first_sync_at', { withTimezone: true }),
  /** Email when a connection breaks (Settings). On unless switched off. */
  emailAlerts: boolean('email_alerts').notNull().default(true),
  /**
   * The connection issue keys the last alert email covered. A key not in
   * here is news and is mailed; an empty list after a non-empty one is the
   * "all fixed" mail. See `planAlert()` in $lib/alertPlan.
   */
  alertedIssues: jsonb('alerted_issues').$type<string[]>().notNull().default([]),
  /** When the last alert email went out, for the every-3-days reminder. */
  alertedAt: timestamp('alerted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Tenant key. Defaults from the `app.user_id` setting that every request
  // sets, so inserts never have to remember it, and row-level security
  // filters on the same value -- a query that forgets to scope returns
  // nothing instead of somebody else's money.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'),
  accountsSynced: integer('accounts_synced').notNull().default(0),
  txnsInserted: integer('txns_inserted').notNull().default(0),
  txnsUpdated: integer('txns_updated').notNull().default(0),
  transfersMatched: integer('transfers_matched').notNull().default(0),
  aiCalls: integer('ai_calls').notNull().default(0),
  aiCostUsd: numeric('ai_cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  error: text('error')
});

/**
 * A sync somebody asked for, and whoever is running it (`$lib/server/syncJob`).
 *
 * `sync_runs` records what a sync did; this records that one is *owed*. It is
 * what lets the guard against two syncs at once hold across processes (the web
 * containers and the worker) and what lets a sync whose process died -- a
 * deploy, a crash -- be picked up again instead of silently never finishing.
 * At most one open job per user, enforced by the partial unique index, so the
 * claim is an INSERT that either wins or conflicts.
 *
 * `heartbeat_at` is touched while the job runs; a stale one means its runner is
 * gone and the worker takes the job over.
 */
export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    /** 'manual' (the Sync button), 'schedule' (the worker), 'webhook' (Plaid said there is news). */
    origin: text('origin').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
    /** How many runners have started it; a job that keeps killing its runner is given up on. */
    attempts: integer('attempts').notNull().default(1),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Set when the sync threw before or outside its `sync_runs` row. */
    error: text('error'),
    /** When the page showed `error`; a failure is reported once. */
    errorSeenAt: timestamp('error_seen_at', { withTimezone: true })
  },
  (t) => [
    uniqueIndex('sync_jobs_one_open')
      .on(t.userId)
      .where(sql`${t.finishedAt} IS NULL`),
    index('sync_jobs_user_requested').on(t.userId, t.requestedAt)
  ]
);

/**
 * Advisor conversations. A conversation is a title and a list of turns; a turn
 * is one question and the answer to it, stored together because that is how
 * they are read back -- the question as a heading, the answer as a card.
 *
 * The answer is kept as the app produced it: text with `{{placeholders}}`, the
 * figures that fill them, and the structured result behind any chart. Nothing
 * of the model's working (tool calls, raw tool output) is stored; a follow-up
 * sends the earlier questions and answers, and the model asks the tools again.
 */
export const advisorConversations = pgTable(
  'advisor_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    /** The first question, trimmed. */
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('advisor_conversations_updated').on(t.userId, t.updatedAt)]
);

export const advisorTurns = pgTable(
  'advisor_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .default(sql`(nullif(current_setting('app.user_id', true), ''))::uuid`),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => advisorConversations.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    /** pending | done | error. A pending turn is being answered right now. */
    status: text('status').notNull().default('pending'),
    /** See `Answer` in `src/lib/server/advisor/agent.ts`. Null until done. */
    answer: jsonb('answer'),
    /**
     * The lookups the answer ran, for the "Working it out" card (7d): one line
     * each, done or running. Kept after the answer for the record.
     */
    steps: jsonb('steps').$type<Array<{ label: string; done: boolean }>>().notNull().default([]),
    /** Set when a past question is reopened and re-run on today's figures. */
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    error: text('error'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true })
  },
  (t) => [index('advisor_turns_conversation').on(t.conversationId, t.createdAt)]
);

export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type Merchant = typeof merchants.$inferSelect;
export type Rule = typeof rules.$inferSelect;

export type Budget = typeof budgets.$inferSelect;
export type RecurringSeries = typeof recurringSeries.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type AccountBalance = typeof accountBalances.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
