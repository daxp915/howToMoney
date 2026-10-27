import type { ParsedRow } from './csv';

// OFX/QFX parser.
//
// OFX is SGML, not XML: tags are frequently unclosed, and banks disagree about
// almost everything except the tag names. Rather than build a document tree,
// this slices out <STMTTRN> blocks and reads the fields it needs, which is
// robust against the malformed markup real exports contain. OFX 2.x is genuine
// XML and parses identically under this approach.

export interface OfxAccount {
  accountId?: string;
  accountType?: string;
  bankId?: string;
  /** Present on credit card statements instead of the bank fields. */
  isCreditCard: boolean;
}

export interface OfxParseResult {
  account: OfxAccount;
  rows: ParsedRow[];
  /** Ledger balance from the file, if it carries one. */
  balance: number | null;
  currency: string | null;
}

/** Reads the first value of an unclosed-or-closed SGML tag. */
function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : null;
}

/**
 * OFX timestamps are YYYYMMDD with an optional HHMMSS and an optional bracketed
 * timezone: 20260318120000[-5:EST]. Only the date is meaningful for a ledger,
 * and taking it at midday UTC stops it sliding a day in western timezones.
 */
export function parseOfxDate(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseOfxAmount(value: string | null): number | null {
  if (value === null) return null;
  // Some exporters use a comma as the decimal separator.
  const cleaned = value.trim().replace(/,/g, '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function isOfx(text: string): boolean {
  return /<OFX>|OFXHEADER|<STMTTRN>/i.test(text.slice(0, 4000));
}

export function parseOfx(input: string): OfxParseResult {
  const text = input.replace(/\r\n/g, '\n');

  const account: OfxAccount = {
    accountId: tag(text, 'ACCTID') ?? undefined,
    accountType: tag(text, 'ACCTTYPE') ?? undefined,
    bankId: tag(text, 'BANKID') ?? undefined,
    isCreditCard: /<CCACCTFROM>/i.test(text)
  };

  const balance = parseOfxAmount(tag(text, 'BALAMT'));
  const currency = tag(text, 'CURDEF');

  const rows: ParsedRow[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  for (const block of blocks) {
    const raw = [
      tag(block, 'FITID') ?? '',
      tag(block, 'DTPOSTED') ?? '',
      tag(block, 'TRNAMT') ?? '',
      tag(block, 'NAME') ?? '',
      tag(block, 'MEMO') ?? ''
    ];

    const postedAt = parseOfxDate(tag(block, 'DTPOSTED') ?? tag(block, 'DTUSER'));
    const amount = parseOfxAmount(tag(block, 'TRNAMT'));

    // NAME is the merchant; MEMO is often a fuller version of the same string,
    // and some banks populate only one of them.
    const name = tag(block, 'NAME');
    const memo = tag(block, 'MEMO');
    const payee = tag(block, 'PAYEE');
    const description = [name, memo].filter(Boolean).join(' ').trim() || payee || '';

    if (!postedAt) {
      rows.push({ postedAt: new Date(0), amount: '0', description, raw, error: 'missing DTPOSTED' });
      continue;
    }
    if (amount === null) {
      rows.push({ postedAt, amount: '0', description, raw, error: 'missing or unreadable TRNAMT' });
      continue;
    }
    if (!description) {
      rows.push({ postedAt, amount: '0', description, raw, error: 'no NAME or MEMO' });
      continue;
    }

    // OFX already signs amounts our way -- debits negative, credits positive --
    // on both bank and credit card statements. No flip, unlike CSV.
    rows.push({ postedAt, amount: amount.toFixed(2), description, raw });
  }

  return { account, rows, balance, currency };
}
