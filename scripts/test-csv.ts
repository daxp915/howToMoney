// Parser tests for the CSV importer. Pure functions only -- no database, no
// network, safe to run anywhere. The fixtures are the real export shapes of the
// institutions in use.
import { detectMapping, mapRows, parseAmount, parseCsv, parseDate } from '../src/lib/server/import/csv';

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!pass) failures++;
}

// ---- RFC 4180 -------------------------------------------------------------
{
  const rows = parseCsv('a,b,c\n1,"two, with comma",3\n4,"say ""hi""",6\n');
  check('splits plain fields', rows[1][0] === '1');
  check('respects quoted comma', rows[1][1] === 'two, with comma', rows[1][1]);
  check('unescapes doubled quotes', rows[2][1] === 'say "hi"', rows[2][1]);
  check('drops trailing blank line', rows.length === 3, `len=${rows.length}`);
}
{
  const rows = parseCsv('a,b\n"line\none",2\n');
  check('handles newline inside quotes', rows[1][0] === 'line\none', JSON.stringify(rows[1][0]));
}
{
  const rows = parseCsv('﻿Date,Amount\n01/02/2026,5\n');
  check('strips BOM', rows[0][0] === 'Date', JSON.stringify(rows[0][0]));
}

// ---- Amounts --------------------------------------------------------------
check('plain amount', parseAmount('12.34') === 12.34);
check('currency and thousands', parseAmount('$1,234.56') === 1234.56);
check('leading minus', parseAmount('-45.00') === -45);
check('parentheses mean negative', parseAmount('(45.00)') === -45);
check('DR suffix means negative', parseAmount('45.00 DR') === -45);
check('CR suffix stays positive', parseAmount('45.00 CR') === 45);
check('blank is null', parseAmount('') === null);
check('garbage is null', parseAmount('n/a') === null);

// ---- Dates ----------------------------------------------------------------
check('ISO date', parseDate('2026-03-04', 'ymd')?.toISOString().slice(0, 10) === '2026-03-04');
check('US order', parseDate('03/04/2026', 'mdy')?.toISOString().slice(0, 10) === '2026-03-04');
check('EU order', parseDate('03/04/2026', 'dmy')?.toISOString().slice(0, 10) === '2026-04-03');
check('two-digit year', parseDate('03/04/26', 'mdy')?.toISOString().slice(0, 10) === '2026-03-04');
check('rejects impossible month', parseDate('13/45/2026', 'mdy') === null);
check(
  'midday UTC survives negative offsets',
  parseDate('2026-03-04', 'ymd')?.getUTCHours() === 12
);

// ---- Discover: purchases positive, needs a sign flip ----------------------
{
  const csv = [
    'Trans. Date,Post Date,Description,Amount,Category',
    '09/10/2026,09/11/2026,"AMAZON MKTPL*R12XY",54.95,Merchandise',
    '09/03/2026,09/03/2026,"INTERNET PAYMENT - THANK YOU",-988.40,Payments and Credits'
  ].join('\n');

  const rows = parseCsv(csv);
  const m = detectMapping(rows);
  check('detects header', m.hasHeader);
  check('prefers Post Date over Trans. Date', m.dateColumn === 1, `col=${m.dateColumn}`);
  check('finds description', m.descriptionColumn === 2, `col=${m.descriptionColumn}`);
  check('finds amount', m.amountColumn === 3, `col=${m.amountColumn}`);

  const flipped = mapRows(rows, { ...m, invertAmount: true });
  check('purchase becomes negative after flip', flipped[0].amount === '-54.95', flipped[0].amount);
  check('payment becomes positive after flip', flipped[1].amount === '988.40', flipped[1].amount);
}

// ---- Chase: purchases already negative, no flip ---------------------------
{
  const csv = [
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '08/24/2026,08/25/2026,TRADER JOE S #451,Groceries,Sale,-38.21,',
    '08/25/2026,08/26/2026,AUTOMATIC PAYMENT - THANK,,Payment,60.00,'
  ].join('\n');

  const rows = parseCsv(csv);
  const m = detectMapping(rows);
  const mapped = mapRows(rows, m);
  check('chase purchase stays negative', mapped[0].amount === '-38.21', mapped[0].amount);
  check('chase payment stays positive', mapped[1].amount === '60.00', mapped[1].amount);
  check('chase description read', mapped[0].description === 'TRADER JOE S #451');
}

// ---- Separate debit / credit columns -------------------------------------
{
  const csv = [
    'Date,Description,Debit,Credit,Balance',
    '2026-07-02,GROCERY OUTLET,52.10,,1000.00',
    '2026-07-03,PAYROLL DEPOSIT,,2400.00,3400.00'
  ].join('\n');

  const rows = parseCsv(csv);
  const m = detectMapping(rows);
  check('no single amount column found', m.amountColumn === -1, `col=${m.amountColumn}`);
  check('finds debit column', m.debitColumn === 2, `col=${m.debitColumn}`);
  check('finds credit column', m.creditColumn === 3, `col=${m.creditColumn}`);

  const mapped = mapRows(rows, m);
  check('debit becomes negative', mapped[0].amount === '-52.10', mapped[0].amount);
  check('credit stays positive', mapped[1].amount === '2400.00', mapped[1].amount);
}

// ---- Unambiguous day-first detection --------------------------------------
{
  const csv = ['Date,Description,Amount', '25/12/2026,BOXING DAY,10.00'].join('\n');
  const m = detectMapping(parseCsv(csv));
  check('detects day-first from a day above 12', m.dateOrder === 'dmy', m.dateOrder);
}

// ---- Bad rows are reported, not silently dropped --------------------------
{
  const csv = [
    'Date,Description,Amount',
    'not-a-date,SOMETHING,10.00',
    '2026-01-05,,10.00',
    '2026-01-06,VALID ROW,10.00'
  ].join('\n');
  const mapped = mapRows(parseCsv(csv), detectMapping(parseCsv(csv)));
  check('flags unreadable date', !!mapped[0].error, mapped[0].error ?? '');
  check('flags empty description', !!mapped[1].error, mapped[1].error ?? '');
  check('keeps the good row', !mapped[2].error);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
