/**
 * What a row in an investment account's ledger means, and the period
 * arithmetic built on it. Pure -- covered by `npm run test:assets`.
 *
 * A brokerage feed is mostly the broker moving your own money around inside
 * the account: a contribution lands as cash, is swept into the core money
 * market ("PURCHASE INTO CORE ACCOUNT"), redeemed from it ("REDEMPTION FROM
 * CORE") and spent on a fund ("YOU BOUGHT"). Several of those rows are
 * positive, and adding them up would count one contribution three times. So
 * the question asked of every row is narrower: did money arrive from outside
 * the account (put in), leave it (withdrawal), or grow inside it (growth)?
 * Everything else is internal and ignored -- its effect is already in the
 * balance.
 */

export type Flow = 'put-in' | 'withdrawal' | 'growth' | 'internal';

// Checked first: these rows move money between positions in one account, and
// some of them carry words ("PURCHASE", "PERIODIC INVESTMENT") that would
// otherwise read as money arriving.
const INTERNAL = /CORE ACCOUNT|YOU BOUGHT|YOU SOLD|REINVEST|REDEMPTION|EXCHANGE|PURCHASE|\bSWEEP\b/i;
const GROWTH = /DIVIDEND|INTEREST|CAP(ITAL)?\s*GAIN|realizedGainLoss/i;
const PUT_IN = /CONTRIBUTION|ROLLOVER|DEPOSIT|EMPLOYER MATCH|TRANSFER(RED)? (IN|FROM)|JOURNALED/i;
const WITHDRAWAL = /WITHDRAWAL|DISTRIBUTION|TRANSFER(RED)? (OUT|TO)/i;

export function classifyFlow(description: string, amount: number, isTransfer = false): Flow {
  if (INTERNAL.test(description)) return 'internal';
  if (amount > 0) {
    if (GROWTH.test(description)) return 'growth';
    if (PUT_IN.test(description) || isTransfer) return 'put-in';
    return 'internal';
  }
  if (amount < 0 && (WITHDRAWAL.test(description) || isTransfer)) return 'withdrawal';
  return 'internal';
}

/** A dividend, as opposed to interest or a gain -- "Dividends paid" counts only these. */
export const isDividend = (description: string) => /DIVIDEND/i.test(description);

/**
 * How money put in arrived, for the "Money in" list: a payroll or periodic
 * contribution repeats on its own; a rollover or a transfer is something
 * somebody did once.
 */
export const isAutomatic = (description: string) => /CONTRIBUTION|PERIODIC|PAYROLL/i.test(description);

export interface PeriodResult {
  start: number;
  putIn: number;
  end: number;
  /** end - start - put in: dividends, interest and price changes together. */
  market: number;
  /** market / (start + half of put in) -- money that arrived mid-period was
   *  invested for about half of it. Null when there was nothing to earn on. */
  return: number | null;
}

export function periodResult(start: number, putIn: number, end: number): PeriodResult {
  const market = end - start - putIn;
  const base = start + putIn / 2;
  return { start, putIn, end, market, return: base > 0 ? market / base : null };
}

export type Period = '1m' | '3m' | '6m' | 'ytd' | '1y' | 'all';
export const PERIODS: { key: Period; label: string }[] = [
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: 'ytd', label: 'This year' },
  { key: '1y', label: '1Y' },
  { key: 'all', label: 'All' }
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The first day of a period ending `today` (YYYY-MM-DD), or null for "All". */
export function periodStart(period: Period, today: string): string | null {
  const d = new Date(today + 'T12:00:00Z');
  switch (period) {
    case '1m':
      d.setUTCMonth(d.getUTCMonth() - 1);
      return iso(d);
    case '3m':
      d.setUTCMonth(d.getUTCMonth() - 3);
      return iso(d);
    case '6m':
      d.setUTCMonth(d.getUTCMonth() - 6);
      return iso(d);
    case 'ytd':
      return `${today.slice(0, 4)}-01-01`;
    case '1y':
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return iso(d);
    case 'all':
      return null;
  }
}

const BRANDS =
  /^(Fidelity|Vanguard|Schwab|iShares|SPDR|American Funds|T\. ?Rowe Price|Invesco|BlackRock|State Street|JPMorgan|Dodge & Cox)\s+/i;

/**
 * A fund's name as a person would say it: "Fidelity ZERO Total Market Index
 * Fund" is "Total Market", "VANGUARD TOTAL STK MKT ETF" is "Total Stock
 * Market". Display only -- the holding key never changes.
 */
export function fundName(description: string | null, symbol: string | null): string {
  let s = (description ?? symbol ?? '').replace(/[®™]/g, '').trim();
  if (!s) return symbol ?? '';
  if (s === s.toUpperCase()) {
    s = s
      .toLowerCase()
      .replace(/\b(stk)\b/g, 'stock')
      .replace(/\b(mkt)\b/g, 'market')
      .replace(/\b(intl)\b/g, 'international')
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/\b(Etf|Us|Reit|Esg)\b/g, (w) => w.toUpperCase());
  }
  s = s.replace(BRANDS, '').replace(/^ZERO\s+/i, '');
  s = s.replace(/\s+(Fund|ETF|Portfolio|Shares|Class [A-Z]+|Admiral|Investor|Institutional)$/i, '');
  s = s.replace(/\s+(Fund|ETF)$/i, '');
  // "Total Market Index" -> "Total Market"; "500 Index" keeps its word.
  if (/\s+Index$/i.test(s) && !/^\d+\s+Index$/i.test(s)) s = s.replace(/\s+Index$/i, '');
  return s.trim() || (symbol ?? description ?? '');
}
