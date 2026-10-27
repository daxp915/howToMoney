// OFX/QFX parser tests. Pure functions, no database.
import { isOfx, parseOfx, parseOfxDate } from '../src/lib/server/import/ofx';

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  if (!pass) failures++;
}

// ---- Dates ----------------------------------------------------------------
check('plain YYYYMMDD', parseOfxDate('20260318')?.toISOString().slice(0, 10) === '2026-03-18');
check(
  'with time and bracketed zone',
  parseOfxDate('20260318120000[-5:EST]')?.toISOString().slice(0, 10) === '2026-03-18'
);
check('midday UTC survives negative offsets', parseOfxDate('20260318')?.getUTCHours() === 12);
check('garbage is null', parseOfxDate('not-a-date') === null);
check('empty is null', parseOfxDate(null) === null);

// ---- Bank statement, unclosed SGML tags (OFX 1.x, the common case) --------
{
  const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>USD
<BANKACCTFROM><BANKID>011000015<ACCTID>4821<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260722120000[-5:EST]<TRNAMT>-142.67<FITID>202607220001<NAME>ATT PAYMENT</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260914120000[-5:EST]<TRNAMT>1287.40<FITID>202609140002<NAME>GLOBEX CORP<MEMO>PAYROLL</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>3871.20<DTASOF>20260918</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  check('detected as OFX', isOfx(ofx));

  const r = parseOfx(ofx);
  check('reads both transactions', r.rows.length === 2, `n=${r.rows.length}`);
  check('no unreadable rows', r.rows.every((x) => !x.error));
  check('debit stays negative', r.rows[0].amount === '-142.67', r.rows[0].amount);
  check('credit stays positive', r.rows[1].amount === '1287.40', r.rows[1].amount);
  check('date parsed', r.rows[0].postedAt.toISOString().slice(0, 10) === '2026-07-22');
  check('NAME used as description', r.rows[0].description === 'ATT PAYMENT', r.rows[0].description);
  check(
    'NAME and MEMO combined',
    r.rows[1].description === 'GLOBEX CORP PAYROLL',
    r.rows[1].description
  );
  check('account id read', r.account.accountId === '4821', String(r.account.accountId));
  check('not flagged as credit card', r.account.isCreditCard === false);
  check('ledger balance read', r.balance === 3871.20, String(r.balance));
  check('currency read', r.currency === 'USD', String(r.currency));
}

// ---- Credit card statement (OFX 2.x, well-formed XML) ---------------------
{
  const qfx = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
 <CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
  <CURDEF>USD</CURDEF>
  <CCACCTFROM><ACCTID>xxxx3021</ACCTID></CCACCTFROM>
  <BANKTRANLIST>
   <STMTTRN>
    <TRNTYPE>DEBIT</TRNTYPE>
    <DTPOSTED>20260910</DTPOSTED>
    <TRNAMT>-54.95</TRNAMT>
    <FITID>A1</FITID>
    <NAME>AMAZON MKTPL*R12XY</NAME>
   </STMTTRN>
   <STMTTRN>
    <TRNTYPE>CREDIT</TRNTYPE>
    <DTPOSTED>20260903</DTPOSTED>
    <TRNAMT>988.40</TRNAMT>
    <FITID>A2</FITID>
    <NAME>INTERNET PAYMENT - THANK YOU</NAME>
   </STMTTRN>
  </BANKTRANLIST>
 </CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;

  const r = parseOfx(qfx);
  check('XML-style OFX parses', r.rows.length === 2, `n=${r.rows.length}`);
  check('flagged as credit card', r.account.isCreditCard === true);
  // The CSV importer needs a sign flip for card exports; OFX does not.
  check('card purchase already negative', r.rows[0].amount === '-54.95', r.rows[0].amount);
  check('card payment already positive', r.rows[1].amount === '988.40', r.rows[1].amount);
  check(
    'closing tags stripped from values',
    r.rows[0].description === 'AMAZON MKTPL*R12XY',
    r.rows[0].description
  );
}

// ---- Malformed rows are reported, not dropped ----------------------------
{
  const bad = `<OFX><BANKTRANLIST>
<STMTTRN><TRNAMT>-5.00<FITID>B1<NAME>NO DATE</STMTTRN>
<STMTTRN><DTPOSTED>20260101<FITID>B2<NAME>NO AMOUNT</STMTTRN>
<STMTTRN><DTPOSTED>20260102<TRNAMT>-1.00<FITID>B3</STMTTRN>
<STMTTRN><DTPOSTED>20260103<TRNAMT>-2.50<FITID>B4<NAME>GOOD ROW</STMTTRN>
</BANKTRANLIST></OFX>`;

  const r = parseOfx(bad);
  check('all four rows accounted for', r.rows.length === 4, `n=${r.rows.length}`);
  check('missing date flagged', !!r.rows[0].error, r.rows[0].error ?? '');
  check('missing amount flagged', !!r.rows[1].error, r.rows[1].error ?? '');
  check('missing description flagged', !!r.rows[2].error, r.rows[2].error ?? '');
  check('valid row kept', !r.rows[3].error && r.rows[3].amount === '-2.50');
}

check('plain CSV not mistaken for OFX', !isOfx('Date,Description,Amount\n2026-01-01,X,-1.00'));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
