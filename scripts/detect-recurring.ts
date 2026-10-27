import 'dotenv/config';
import { detectRecurring } from '../src/lib/server/matching/recurring';
import { runAsUser } from '../src/lib/server/db';
import { resolveUserArg } from './lib/whose';

// Runs on every sync too; this is for re-running detection after an import or a
// tolerance change without waiting for the next sync.
resolveUserArg(process.argv[2])
  .then((user) => runAsUser(user.id, detectRecurring))
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
