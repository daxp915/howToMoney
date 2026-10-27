// Asset-class rules, against real fund names. Pure: no database.
//   npm run test:assets
import { assetClass, type AssetClass } from '../src/lib/assetClass';
import { classifyFlow, fundName, periodResult, periodStart, type Flow } from '../src/lib/investmentFlow';

let failures = 0;
function check(symbol: string | null, description: string, want: AssetClass) {
  const got = assetClass(symbol, description);
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${symbol ?? '-'} ${description} :: ${got}${ok ? '' : ` (want ${want})`}`);
}

// The positions SimpleFIN reported for the first real sync.
check('FZROX', 'Fidelity ZERO Total Market Index Fund', 'us');
check('FXAIX', 'Fidelity 500 Index Fund', 'us');
check('FZILX', 'Fidelity ZERO International Index Fund', 'intl');
check('SPAXX', 'Fidelity Government Money Market Fund', 'cash');
check('RFUTX', 'American Funds 2060 Target Date Retirement Fund®', 'target');

// Order matters: a target-date fund mentions retirement *and* often "income",
// an international bond fund is a bond fund.
check('VTTSX', 'Vanguard Target Retirement 2060 Fund', 'target');
check('VTABX', 'Vanguard Total International Bond Index Fund', 'bonds');
check('VBTLX', 'Total Bond Market Index Fund', 'bonds');
check('VMFXX', 'Federal Money Market Fund', 'cash');
check(null, 'Some Private Placement LP', 'other');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
