import 'reflect-metadata';

import { writeFile } from 'fs/promises';
import { DataSource } from 'typeorm';
import {
  DezaKeysRefusal,
  describe,
  parseDezaKeysArgs,
  runDezaKeys,
} from './app/release-tasks/deza-keys';

/**
 * The harvester's command of backend plan 0272, INSIDE the image.
 *
 * `webpack.config.js` emits it as `deza-keys.js` beside `main.js`, and release
 * task 0008 runs it with `kubectl exec deploy/luna-shopper-backend-harvester
 * -- node deza-keys.js` after the rollout. So the image that computes the new
 * keys is the image that walks next, and the key it writes cannot disagree
 * with the walk (section 2, option A). It connects as `kilo-pieces.ts` does: a
 * plain `DataSource` on the harvester's own database, raw SQL, no Nest. It
 * needs no NATS, because nothing in catalog changes.
 *
 *   node deza-keys.js --count
 *       prints `rows`, `unkeyed`, `moves`, `moves-active`,
 *       `moves-unresolved`, `moves-other`, `collisions` and `active-runs`,
 *       numbers only. Writes nothing.
 *
 *   node deza-keys.js --max <n> [--record <file>]
 *       the same counts, refuses while a run of the chain is in flight, then
 *       re-keys every move that is not a collision in one transaction under a
 *       table lock, and refuses before the commit above <n> moves or when a
 *       count of section 7.1 differs. Prints those counts before and after,
 *       the counts again, and `rekeyed <n>`. Writes the record of section 4.1
 *       to <file> (default /tmp/deza-keys-record.tsv).
 *
 * It needs HARVESTER_DB_URL, which the pod already has.
 */
async function run() {
  const options = parseDezaKeysArgs(process.argv.slice(2));
  const url = process.env['HARVESTER_DB_URL'];
  if (!url) {
    throw new DezaKeysRefusal(
      'HARVESTER_DB_URL must be set. Inside a pod it arrives from the Secret ' +
        'of the environment through _env.tpl.'
    );
  }
  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [],
    synchronize: false,
  });
  await dataSource.initialize();
  try {
    await runDezaKeys(
      {
        db: {
          query: (sql, params) => dataSource.query(sql, params),
          transaction: (work) =>
            dataSource.transaction((manager) =>
              work({ query: (sql, params) => manager.query(sql, params) })
            ),
        },
        files: { write: (path, text) => writeFile(path, text, 'utf8') },
        log: (line) => console.log(line),
      },
      options
    );
  } finally {
    await dataSource.destroy();
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    // The message, not the stack: the release task prints it as its refusal.
    console.error(describe(err));
    process.exit(1);
  }
);
