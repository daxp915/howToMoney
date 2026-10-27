// CSV parsing and column detection.
//
// Every bank exports a different shape, so nothing here assumes a format. The
// parser is RFC 4180; the detection layer guesses a mapping from the header row
// and the user confirms or corrects it before anything is written.

/** RFC 4180 parser: handles quoted fields, escaped quotes and embedded newlines. */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop blank lines, which trail most exports.
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export type DateOrder = 'auto' | 'mdy' | 'dmy' | 'ymd';

export interface ColumnMapping {
  dateColumn: number;
  descriptionColumn: number;
  /** Single signed amount column. -1 when using separate debit/credit columns. */
  amountColumn: number;
  debitColumn: number;
  creditColumn: number;
  dateOrder: DateOrder;
  /**
   * Credit card exports often report a purchase as a positive number. Our
   * convention is money out = negative, so those files need flipping.
   */
  invertAmount: boolean;
  hasHeader: boolean;
}

export interface ParsedRow {
  postedAt: Date;
  amount: string;
  description: string;
  /** Populated when the row could not be interpreted; such rows are skipped. */
  error?: string;
  raw: string[];
}

const HEADER_PATTERNS = {
  // "Post Date" beats "Transaction Date" -- the posted date is what reconciles
  // against what the bank's API reports.
  postDate: /^(post(ing|ed)?[\s._-]*date|date[\s._-]*posted)$/i,
  anyDate: /date/i,
  description: /^(description|payee|merchant|name|memo|details?|transaction)$/i,
  anyDescription: /(description|payee|merchant|name|memo|detail)/i,
  amount: /^(amount|value|transaction[\s._-]*amount)$/i,
  anyAmount: /amount/i,
  debit: /(debit|withdrawal|charge|money[\s._-]*out)/i,
  credit: /(credit|deposit|payment|money[\s._-]*in)/i
};

function findColumn(headers: string[], ...patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex((h) => pattern.test(h.trim()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function looksLikeHeader(row: string[]): boolean {
  // A header row has no parseable amount and no parseable date in it.
  const numericish = row.filter((c) => /^-?[$(]?\s*[\d,]+\.?\d*\)?$/.test(c.trim())).length;
  return numericish === 0;
}

export function detectMapping(rows: string[][]): ColumnMapping {
  const hasHeader = rows.length > 0 && looksLikeHeader(rows[0]);
  const headers = hasHeader ? rows[0] : rows[0].map((_, i) => `column ${i + 1}`);

  const dateColumn = findColumn(headers, HEADER_PATTERNS.postDate, HEADER_PATTERNS.anyDate);
  const descriptionColumn = findColumn(
    headers,
    HEADER_PATTERNS.description,
    HEADER_PATTERNS.anyDescription
  );
  let amountColumn = findColumn(headers, HEADER_PATTERNS.amount, HEADER_PATTERNS.anyAmount);

  // Separate debit/credit columns are only used when there is no single amount.
  let debitColumn = -1;
  let creditColumn = -1;
  if (amountColumn === -1) {
    debitColumn = findColumn(headers, HEADER_PATTERNS.debit);
    creditColumn = findColumn(headers, HEADER_PATTERNS.credit);
  }
  if (amountColumn === -1 && debitColumn === -1 && creditColumn === -1) amountColumn = -1;

  const body = hasHeader ? rows.slice(1) : rows;

  return {
    dateColumn,
    descriptionColumn,
    amountColumn,
    debitColumn,
    creditColumn,
    dateOrder: detectDateOrder(body.map((r) => r[dateColumn] ?? '')),
    invertAmount: false,
    hasHeader
  };
}

/**
 * Distinguishes 03/04/2026 the 4th of March from the 3rd of April by looking for
 * a value above 12 in either position across the whole file. Ambiguous files
 * default to US ordering, and the user can override.
 */
export function detectDateOrder(samples: string[]): DateOrder {
  let firstOver12 = false;
  let secondOver12 = false;
  let isoCount = 0;

  for (const s of samples) {
    const v = s.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(v)) {
      isoCount++;
      continue;
    }
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }

  if (isoCount > 0 && !firstOver12 && !secondOver12) return 'ymd';
  if (firstOver12 && !secondOver12) return 'dmy';
  return 'mdy';
}

export function parseDate(value: string, order: DateOrder): Date | null {
  const v = (value ?? '').trim();
  if (!v) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (iso) return utc(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    let year = Number(parts[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;

    const effective = order === 'auto' ? 'mdy' : order;
    const month = effective === 'dmy' ? b : a;
    const dayOfMonth = effective === 'dmy' ? a : b;
    if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
    return utc(year, month, dayOfMonth);
  }

  // Fall back to the runtime parser for formats like "15 Jan 2026".
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function utc(year: number, month: number, day: number): Date {
  // Midday UTC keeps a date from sliding across a day boundary when it is later
  // rendered in a negative-offset timezone.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** Handles "$1,234.56", "(45.00)" for negatives, and "45.00 DR"/"CR" suffixes. */
export function parseAmount(value: string): number | null {
  let v = (value ?? '').trim();
  if (!v) return null;

  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  if (/\bDR\b/i.test(v)) negative = true;
  if (/\bCR\b/i.test(v)) negative = false;

  v = v.replace(/[A-Za-z$\s,]/g, '');
  if (v.startsWith('-')) {
    negative = true;
    v = v.slice(1);
  }
  if (v === '' || !/^\d*\.?\d*$/.test(v)) return null;

  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function mapRows(rows: string[][], mapping: ColumnMapping): ParsedRow[] {
  const body = mapping.hasHeader ? rows.slice(1) : rows;

  return body.map((raw) => {
    const dateText = raw[mapping.dateColumn] ?? '';
    const postedAt = parseDate(dateText, mapping.dateOrder);
    const description = (raw[mapping.descriptionColumn] ?? '').trim();

    let amount: number | null = null;
    if (mapping.amountColumn >= 0) {
      amount = parseAmount(raw[mapping.amountColumn] ?? '');
    } else {
      const debit = parseAmount(raw[mapping.debitColumn] ?? '');
      const credit = parseAmount(raw[mapping.creditColumn] ?? '');
      // Debit columns are written as positive magnitudes; money out is negative.
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = Math.abs(credit);
      else if (debit !== null || credit !== null) amount = 0;
    }

    if (!postedAt) return { postedAt: new Date(0), amount: '0', description, raw, error: `unreadable date: "${dateText}"` };
    if (amount === null) return { postedAt, amount: '0', description, raw, error: 'unreadable amount' };
    if (!description) return { postedAt, amount: '0', description, raw, error: 'empty description' };

    const signed = mapping.invertAmount ? -amount : amount;
    return { postedAt, amount: signed.toFixed(2), description, raw };
  });
}
