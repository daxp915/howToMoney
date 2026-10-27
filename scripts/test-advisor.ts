// The advisor's arithmetic against dates and figures worked out by hand.
// Pure: no database, no model.
//   npm run test:advisor
import { detectPaychecks, expectedPay, payBasis, type Deposit } from '../src/lib/advisor/paychecks';
import { affordability, forecastCash, lowestPoint, type CashEvent } from '../src/lib/advisor/forecast';
import { checkup, type CheckupInput } from '../src/lib/advisor/checkup';
import { formatFig, renderPlain, segments } from '../src/lib/advisor/figures';
import { addDays, rollForward, stepCadence } from '../src/lib/advisor/days';
import { seriesState } from '../src/lib/recurringState';
import { CalcError, evaluate } from '../src/lib/advisor/calc';

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} :: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
}

const TODAY = '2026-09-30';
const dep = (key: string, day: string, amount: number, accountId = 'chk'): Deposit => ({
  key,
  name: key,
  day,
  amount,
  accountId
});

// ---- paychecks ----
const biweekly = ['2026-07-10', '2026-07-24', '2026-08-07', '2026-08-21', '2026-09-04', '2026-09-18'].map((d, i) =>
  dep('ACME PAYROLL', d, i === 3 ? 2410.5 : 2150)
);
// 1st and 15th, sliding a day around weekends.
const semi = ['2026-07-01', '2026-07-15', '2026-07-31', '2026-08-14', '2026-09-01', '2026-09-15'].map((d) =>
  dep('STATE PAYROLL', d, 1800)
);
const monthly = ['2026-08-28', '2026-09-28'].map((d) => dep('RENTAL INCOME', d, 950));
const noise = [dep('VENMO', '2026-07-03', 120), dep('VENMO', '2026-07-20', 40), dep('VENMO', '2026-08-29', 300)];
const tiny = ['2026-07-31', '2026-08-31', '2026-09-30'].map((d) => dep('INTEREST', d, 0.42));
const stopped = ['2026-04-03', '2026-04-17', '2026-05-01', '2026-05-15'].map((d) => dep('OLD JOB', d, 1500));

const series = detectPaychecks([...biweekly, ...semi, ...monthly, ...noise, ...tiny, ...stopped], TODAY);
check(
  'three sources found, by size',
  series.map((s) => [s.key, s.cadence]),
  [
    ['ACME PAYROLL', 'biweekly'],
    ['STATE PAYROLL', 'semimonthly'],
    ['RENTAL INCOME', 'monthly']
  ]
);
check('overtime check does not move the usual amount', series[0].typical, 2150);
check('semimonthly anchors', series[1].anchors, [1, 15]);

const next = expectedPay(series, TODAY, '2026-10-31');
check(
  'October pay dates',
  next.map((p) => [p.day, p.series.key]),
  [
    ['2026-10-01', 'STATE PAYROLL'],
    ['2026-10-02', 'ACME PAYROLL'],
    ['2026-10-15', 'STATE PAYROLL'],
    ['2026-10-16', 'ACME PAYROLL'],
    ['2026-10-28', 'RENTAL INCOME'],
    ['2026-10-30', 'ACME PAYROLL'],
    // November 1st is a Sunday: paid the Friday before, as Aug 1 was.
    ['2026-10-30', 'STATE PAYROLL']
  ]
);

// A biweekly check due yesterday that SimpleFIN has not delivered yet.
const lateSeries = detectPaychecks(
  ['2026-08-18', '2026-09-01', '2026-09-15'].map((d) => dep('GLOBEX PAY', d, 1287.40)),
  TODAY
);
const late = expectedPay(lateSeries, TODAY, '2026-10-15');
check('late pay placed tomorrow', late.map((p) => [p.day, p.late]), [
  ['2026-10-01', true],
  ['2026-10-13', false]
]);
check('two deposits alone are not biweekly', detectPaychecks(biweekly.slice(-2), TODAY).length, 0);

// ---- forecast ----
const events: CashEvent[] = [
  { day: addDays(TODAY, 3), amount: -1000, label: 'Rent', kind: 'bill' },
  { day: addDays(TODAY, 7), amount: 2000, label: 'Paycheck', kind: 'paycheck' }
];
const flat = forecastCash(2000, TODAY, 30, events, 0);
check('rent lands day 3', flat[3].balance, 1000);
check('pay lands day 7', flat[7].balance, 3000);
check('lowest point', lowestPoint(flat), { day: addDays(TODAY, 3), balance: 1000 });
const spending = forecastCash(1000, TODAY, 3, [], 25);
check('everyday spending from tomorrow', spending.map((p) => p.balance), [1000, 975, 950, 925]);

// ---- affordability ----
const fine = affordability(flat, events, 400, 500);
check('fits now', [fine.verdict, fine.buyDay, fine.cushion], ['now', TODAY, 100]);
check('rent is what it runs into', fine.dueBefore.map((e) => e.label), ['Rent']);
const wait = affordability(flat, events, 800, 500);
check('after the paycheck', [wait.verdict, wait.buyDay, wait.unlockedBy?.label], ['wait', addDays(TODAY, 7), 'Paycheck']);
const no = affordability(flat, events, 5000, 500);
check('does not fit', [no.verdict, no.buyDay, no.cushion], ['no', null, -4500]);
const later = affordability(flat, events, 800, 500, addDays(TODAY, 10));
check('asked for a later date', [later.verdict, later.buyDay], ['now', addDays(TODAY, 10)]);
// A purchase near the end of the horizon is not checked against anything and
// must not be offered.
const tailOnly = forecastCash(0, TODAY, 30, [{ day: addDays(TODAY, 25), amount: 900, label: 'Pay', kind: 'paycheck' }], 0);
check('no day inside the tail', affordability(tailOnly, [], 300, 500).verdict, 'no');

// ---- figures ----
check('money', formatFig({ kind: 'money', value: 1234.5 }), '$1,234.50');
check('percent', formatFig({ kind: 'percent', value: 0.142 }), '14%');
check('months', formatFig({ kind: 'months', value: 1.84 }), '1.8 months');
check('date', formatFig({ kind: 'date', value: '2026-10-15' }), 'Oct 15');
const t = { text: 'Cash dips to {{low}} on {{day}}.', figures: { low: { kind: 'money' as const, value: 212 }, day: { kind: 'date' as const, value: '2026-10-03' } } };
check('rendered', renderPlain(t), 'Cash dips to $212.00 on Oct 3.');
check('masked', renderPlain(t, true), 'Cash dips to $••• on Oct 3.');
check('segments', segments(t.text), [{ text: 'Cash dips to ' }, { fig: 'low' }, { text: ' on ' }, { fig: 'day' }, { text: '.' }]);

// ---- checkup ----
// The demo household of handoff 7a: today Sep 29, Everyday Checking
// $10,660.00, High-Yield Savings $11,427.79, bills $2,940.17 a month, an
// average month of $4,236.40.
const base: CheckupInput = {
  today: '2026-09-29',
  historyDays: 120,
  savings: { balance: 11427.79, name: 'High-Yield Savings' },
  checking: 10660,
  averageMonth: 4236.4,
  monthlyBills: 2940.17,
  floor: 500,
  low: { day: '2026-10-08', balance: 3000, before: null },
  envelopes: [],
  daysLeftInMonth: 1,
  resetDay: '2026-10-01',
  priceChanges: [],
  kept: null,
  pace: null,
  goalsBehind: []
};
const texts = (fs: ReturnType<typeof checkup>) => fs.map((f) => renderPlain(f));
const contexts = (fs: ReturnType<typeof checkup>) => fs.map((f) => (f.context ? renderPlain({ text: f.context, figures: f.figures }) : null));

const demo = checkup(base);
check('7a: emergency fund and idle cash', texts(demo), [
  'Emergency fund covers 2.7 months of spending',
  '$4,779.66 has sat in checking above two months of bills'
]);
check('7a: their context lines', contexts(demo), [
  'Target is 3–6 months · High-Yield Savings against an average month',
  'Moving $1,281.41 to savings gets the emergency fund to 3 months'
]);
check('2.7 months is needs action', demo[0].severity, 'action');
check('a finding stays hidden until its figure changes', [demo[0].key, checkup({ ...base, savings: { ...base.savings, balance: 12000 } })[0].key], ['cushion:2.7', 'cushion:2.8']);
check('three months of savings: no cushion finding', checkup({ ...base, savings: { ...base.savings, balance: 13000 } }).map((f) => f.key.split(':')[0]), ['idle']);
check('idle with a full fund', contexts(checkup({ ...base, savings: { ...base.savings, balance: 13000 } })), ['Savings already covers three months of spending']);
check('too little history for a cushion', checkup({ ...base, historyDays: 20, checking: 0 }), []);
check('no bills known: no idle finding', checkup({ ...base, monthlyBills: 0 }).map((f) => f.key.split(':')[0]), ['cushion']);

const quiet: CheckupInput = { ...base, savings: { ...base.savings, balance: 20000 }, checking: 2000 };
check('nothing to say', checkup(quiet), []);
const dip = checkup({ ...quiet, low: { day: '2026-10-03', balance: 212, before: 'Rent' } });
check('dip', [dip[0].severity, renderPlain(dip[0])], ['action', 'Checking dips to $212.00 on Oct 3, under your $500.00 floor']);

const env = (name: string, limit: number, spent: number, emoji = '🛒') => ({ categoryId: name, name, emoji, limit, spent, href: '/x' });
const envs = checkup({ ...quiet, envelopes: [env('Groceries', 600, 743.81), env('Shopping', 250, 300, '🛍️'), env('Fun', 100, 20)] });
check('7a: one row for the envelopes over', texts(envs), ['Groceries is $143.81 over its envelope with 1 day left']);
check('7a: the others in its context', contexts(envs), ['Shopping is over too · both reset Oct 1']);
check('its emoji is the category’s', envs[0].emoji, '🛒');
const nearly = checkup({ ...quiet, daysLeftInMonth: 9, envelopes: [env('Groceries', 600, 560)] });
check('nearly spent with time left', texts(nearly), ['Groceries has $40.00 left with 9 days to go']);

const netflix = checkup({
  ...quiet,
  priceChanges: [{ id: 's1', name: 'Netflix', emoji: '📺', from: 15.49, to: 17.99, day: '2026-09-18', cadenceDays: 30, href: '/r' }]
});
check('7a: price change', [renderPlain(netflix[0]), contexts(netflix)[0], netflix[0].short], [
  'Netflix went from $15.49 to $17.99',
  'From the Sep 18 charge · $30.00 more a year',
  'Netflix went up'
]);

const kept = (income: number, spending: number, before: { income: number; spending: number } | null = null) =>
  checkup({ ...quiet, kept: { months: 3, income, spending, href: '/t', before, threePaychecks: 'July' } });
const good = kept(18000, 11340, { income: 17000, spending: 12920 });
check('7a: kept, up from before', [renderPlain(good[0]), contexts(good)[0], good[0].severity], [
  'You kept 37% of what came in over 3 months',
  'Up from 24% the 3 months before · July had three paychecks',
  'good'
]);
check('spent more than came in', [renderPlain(kept(12000, 12600)[0]), kept(12000, 12600)[0].severity], [
  'You spent $600.00 more than came in over 3 months',
  'action'
]);
check('an ordinary stretch: silent', kept(12000, 11000), []);

check('pace', checkup({ ...quiet, pace: { spent: 2000, projected: 5200, typical: 4000, day: 12, days: 30, href: '/t' } }).map((f) => f.key.split(':')[0]), ['pace']);
check('pace within usual', checkup({ ...quiet, pace: { spent: 2000, projected: 4300, typical: 4000, day: 12, days: 30, href: '/t' } }), []);

const ranked = checkup({ ...base, kept: { months: 3, income: 18000, spending: 11000, href: '/t', before: null, threePaychecks: null } });
check('needs action, then worth a look, then good news', ranked.map((f) => f.severity), ['action', 'look', 'good']);
check('an "Ask about it" link opens Ask with a question', demo[1].link?.href.startsWith('/advisor?q='), true);

// A semimonthly payroll whose end-of-month check came on the 27th of a
// 31-day month: missed by the 3-day window, so a $1,287.40 paycheck vanished.
const td = ['2026-06-29', '2026-07-13', '2026-07-29', '2026-08-12', '2026-08-27', '2026-09-14', '2026-09-29'].map((d) =>
  dep('GLOBEX PAYROLL', d, 1287.40, 'chk')
);
const tdSeries = detectPaychecks(td, '2026-10-02');
check('semimonthly with an early end-of-month check', tdSeries.map((p) => [p.cadence, p.typical]), [['semimonthly', 1287.40]]);
// The same payroll's next dates: the 13th, and the end-of-month check a day
// before the month ends (it never came on the 31st) -- Oct 30, a Friday.
check('end-of-month anchor counts back from the last day', tdSeries[0].anchors, [-1, 13]);
check(
  'Globex October dates',
  expectedPay(tdSeries, '2026-10-05', '2026-11-30').map((p) => p.day),
  ['2026-10-13', '2026-10-30', '2026-11-13', '2026-11-27']
);
check('a prediction says what it is from', payBasis(tdSeries[0]).startsWith('Predicted from 7 past paychecks'), true);

// ---- calculate: arithmetic over registered figures ----
const figs: Record<string, number> = { f2: 6412.5, f14: 1250, f3: 23587.5, f9: 0.14 };
const look = (id: string) => (id in figs ? figs[id] : null);
const calcErr = (e: string) => {
  try {
    evaluate(e, look);
    return 'no error';
  } catch (x) {
    return x instanceof CalcError ? 'CalcError' : 'other';
  }
};
const r2 = (v: number) => Math.round(v * 100) / 100;
check('months to close a gap', r2(evaluate('f3 / f14', look)), 18.87);
check('precedence and parentheses', r2(evaluate('(30000 - f2) / f14', look)), 18.87);
check('times twelve', evaluate('f14 * 12', look), 15000);
check('unary minus', evaluate('-f14 + 2000', look), 750);
check('percent figure as a fraction', r2(evaluate('f14 * f9', look)), 175);
check('unknown figure refused', calcErr('f99 * 2'), 'CalcError');
check('division by zero refused', calcErr('f14 / (f2 - f2)'), 'CalcError');
check('no code, only arithmetic', calcErr('process.exit(1)'), 'CalcError');
check('trailing junk refused', calcErr('f14 * 2)'), 'CalcError');

// ---- cadence stepping (recurring bills added by hand) ----------------------
check('monthly keeps the day of the month', stepCadence('2026-01-31', 30), '2026-02-28');
check('monthly back one', stepCadence('2026-10-09', 30, -1), '2026-09-09');
check('quarterly is three months', stepCadence('2026-08-15', 90), '2026-11-15');
check('yearly is twelve months', stepCadence('2025-10-16', 365), '2026-10-16');
check('weekly steps days', stepCadence('2026-10-01', 7, 2), '2026-10-15');
check('roll to the last due date on or before today', rollForward('2026-07-09', 30, '2026-10-06'), '2026-09-09');
check('roll keeps the 31st after a short month', rollForward('2026-01-31', 30, '2026-03-31'), '2026-03-31');
check('nothing due yet stays put', rollForward('2026-09-20', 30, '2026-10-06'), '2026-09-20');

// ---- is it still recurring? ($lib/recurringState) -------------------------
check('monthly, due next week: ok', seriesState('2026-09-14', 30, '2026-10-06').state, 'ok');
check('monthly, a few days late: still ok', seriesState('2026-09-01', 30, '2026-10-06').state, 'ok');
check('monthly, a cycle and a week late: missed', seriesState('2026-08-14', 30, '2026-10-06'), { state: 'missed', expected: '2026-09-14' });
check('monthly, two cycles gone: stopped', seriesState('2026-07-20', 30, '2026-10-06').state, 'stopped');
check('weekly grace is 3 days', [seriesState('2026-09-26', 7, '2026-10-06').state, seriesState('2026-09-26', 7, '2026-10-07').state, seriesState('2026-09-26', 7, '2026-10-14').state], ['ok', 'missed', 'stopped']);
check('yearly waits a month past due', [seriesState('2025-09-20', 365, '2026-10-06').state, seriesState('2025-09-01', 365, '2026-10-06').state], ['ok', 'missed']);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
