// Loan arithmetic against numbers worked out by hand. Pure: no database.
//   npm run test:loans
import {
  addMonths,
  estimateApr,
  projectPayoff,
  regularPayment,
  type BalancePoint
} from '../src/lib/loanMath';

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} :: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
}
function near(label: string, got: number | null, want: number, tol: number) {
  const ok = got !== null && Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} :: ${got} (want ${want} ±${tol})`);
}

// ---- regular payment ----
check('steady payments', regularPayment([946.7, 946.7, 946.7]), 946.7);
// The Pinecrest Bank refinance: two regular payments, then the payoff, newest first.
check('payoff is the odd one out', regularPayment([47888.65, 615.04, 615.04]), 615.04);
check('no repeat: the latest', regularPayment([500, 600]), 500);
check('nothing paid', regularPayment([]), null);

// ---- payoff ----
check('no interest', projectPayoff(10000, 1000, 0), { payments: 10, interest: 0 });
check('partial last payment', projectPayoff(10500, 1000, 0), { payments: 11, interest: 0 });
// $20,000 over 60 months at 6% is the textbook $386.66 payment, ~$3,199.60 interest.
const book = projectPayoff(20000, 386.66, 6);
check('textbook 60 months', book?.payments, 60);
near('textbook interest', book?.interest ?? null, 3199.6, 2);
// $60,000 at 12% accrues $600 a month; $500 never gets anywhere.
check('payment below interest', projectPayoff(60000, 500, 12), null);
check('already paid off', projectPayoff(0, 946.7, 6), { payments: 0, interest: 0 });

// ---- next due ----
const iso = (d: Date) => d.toISOString().slice(0, 10);
check('next month', iso(addMonths(new Date('2026-09-03T12:00:00Z'), 1)), '2026-10-03');
check('31st into a short month', iso(addMonths(new Date('2027-01-31T12:00:00Z'), 1)), '2027-02-28');
check('across a year', iso(addMonths(new Date('2026-12-15T12:00:00Z'), 2)), '2027-02-15');

// ---- rate estimate ----
function days(from: string, to: string, owed: (day: string) => number): BalancePoint[] {
  const out: BalancePoint[] = [];
  for (let t = Date.parse(from + 'T12:00:00Z'); t <= Date.parse(to + 'T12:00:00Z'); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, owed: owed(day) });
  }
  return out;
}

// A feed that only moves on payment day (some lenders' look like this): $10,000
// owed, $300 paid on Oct 3 of which $50 was interest.
const stepwise = days('2026-09-20', '2026-10-20', (d) => (d < '2026-10-03' ? 10000 : 9750));
near('stepwise feed', estimateApr(stepwise, [{ day: '2026-10-03', amount: 300 }]), 6.08, 0.01);

// Too short a stretch to hold a month of interest.
const short = days('2026-09-20', '2026-10-05', (d) => (d < '2026-10-03' ? 10000 : 9750));
check('stretch too short', estimateApr(short, [{ day: '2026-10-03', amount: 300 }]), null);

// A feed that accrues daily at 6%.
const daily = days('2026-09-20', '2026-10-21', (d) => {
  const n = (Date.parse(d) - Date.parse('2026-09-20')) / 86400000;
  return 10000 + (10000 * 0.06 * n) / 365 - (d >= '2026-10-03' ? 300 : 0);
});
near('daily-accrual feed', estimateApr(daily, [{ day: '2026-10-03', amount: 300 }]), 6.0, 0.1);

// A balance that fell by more than the payment (a fee reversed, a correction)
// would read as a negative rate; it is thrown away, not shown.
const odd = days('2026-09-20', '2026-10-20', (d) => (d < '2026-10-03' ? 10000 : 9000));
check('implausible drop', estimateApr(odd, [{ day: '2026-10-03', amount: 300 }]), null);

// No payment inside the snapshots: nothing to learn from.
check('no payment', estimateApr(stepwise, [{ day: '2026-09-03', amount: 300 }]), null);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
