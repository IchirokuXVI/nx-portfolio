import 'reflect-metadata';

import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import {
  ITEM_PATTERNS,
  type GetItemsResult,
} from '@portfolio/luna-shopper/contracts';
import { readFile, writeFile } from 'fs/promises';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  guardOutput,
  parseWashSizesArgs,
  runWashSizes,
  WashSizesRefusal,
  type CatalogPort,
} from './app/release-tasks/wash-sizes';

/** All of standard input, as text. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** How long one catalog answer may take. An update is one row. */
const ASK_TIMEOUT_MS = 30_000;

/**
 * The harvester's one off command of backend plan 0271, INSIDE the image.
 *
 * `webpack.config.js` emits it as `wash-sizes.js` beside `main.js`, and
 * release tasks 0007 and 0009 run it with `kubectl exec deploy/luna-shopper-backend-harvester
 * -- node wash-sizes.js`. It reads the harvester's own database with raw
 * SELECTs on a plain `DataSource`, as `kilo-pieces.ts` does, and speaks to
 * catalog over NATS as the harvester's service actor.
 *
 *   node wash-sizes.js --count
 *       prints `chain <slug> <n>`, `products`, `pack`, `content`, `unread`,
 *       `held`, and one line per kind of note (`pack-of-units`,
 *       `short-wash-word`, `sum`, `mercadona-per-wash`), numbers only.
 *       Writes nothing.
 *
 *   node wash-sizes.js --review <file>
 *       the same counts, then the review list of the products that still
 *       qualify in <file>, each `planned`, and the notes beside it
 *       (`<file>` with `.notes.tsv` for `.tsv`). No database row. Prints
 *       `save 1` when a run with no product to correct must still save the
 *       lists (a recorded `planned` line, or a new note), else `save 0`.
 *
 *   node wash-sizes.js --max <n> --review <file>
 *       the same counts, refuses before any write above <n>, then corrects
 *       each product and writes the list: `corrected` for each product whose
 *       update went through, `planned` for the rest. Prints `corrected`,
 *       `skipped` and `failures`, and exits 1 when any product failed.
 *
 *   ... --recorded <file|->
 *       with either list: the ConfigMap earlier runs saved, as
 *       `kubectl get -o json` prints it (`-` reads standard input, empty
 *       means none). Every line it holds stays in the lists written, and
 *       each `planned` line whose product catalog now holds with no size and
 *       as `UNIT` is written `corrected` (the reconcile, which only reads).
 *
 *   ... --selection sum-and-short-word
 *       with any mode: release task 0009's selection (backend plan 0279), the
 *       products whose size is a printed sum (`35+18 lavados`) or El Jamón's
 *       short word (`40lav`), instead of task 0007's printed wash count. The
 *       same lines are printed; `pack` is always 0, and the notes keep only
 *       `pack-of-units` and `mercadona-per-wash`. Refusals of a recorded list
 *       name `configmap/release-task-0009-review`. With no `--selection` (or
 *       `--selection printed-count`) the command is task 0007's, unchanged.
 *
 * It needs HARVESTER_DB_URL, NATS_URL and HARVESTER_ACTOR_ID, which the pod
 * already has. Catalog knows that actor as a service (`SERVICE_ACTOR_IDS`).
 */
async function run() {
  const options = parseWashSizesArgs(process.argv.slice(2));
  const url = process.env['HARVESTER_DB_URL'];
  const natsUrl = process.env['NATS_URL'];
  const actor = process.env['HARVESTER_ACTOR_ID'];
  if (!url || !natsUrl || !actor) {
    throw new WashSizesRefusal(
      'HARVESTER_DB_URL, NATS_URL and HARVESTER_ACTOR_ID must all be set. ' +
        'Inside a pod they arrive from the Secret of the environment through ' +
        '_env.tpl, and catalog knows the actor through SERVICE_ACTOR_IDS.'
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [],
    synchronize: false,
    // Stated, not left to the default: a logged query error or slow query
    // prints its parameters, which are product ids, to the deploy log.
    logging: false,
    maxQueryExecutionTime: undefined,
  });
  await dataSource.initialize();
  const client = ClientProxyFactory.create({
    transport: Transport.NATS,
    options: { servers: [natsUrl] },
  });
  const send = <T>(subject: string, payload: Record<string, unknown>) =>
    firstValueFrom(
      client.send<T>(subject, payload).pipe(timeout(ASK_TIMEOUT_MS))
    );
  const catalog: CatalogPort = {
    getMany: async (ids) =>
      (await send<GetItemsResult>(ITEM_PATTERNS.getMany, { ids })).items,
    update: (input) => send(ITEM_PATTERNS.update, { userId: actor, ...input }),
  };

  try {
    await client.connect();
    return await runWashSizes(
      {
        harvester: { query: (sql, params) => dataSource.query(sql, params) },
        catalog,
        files: {
          write: (path, text) => writeFile(path, text, 'utf8'),
          read: (path) => (path === '-' ? readStdin() : readFile(path, 'utf8')),
        },
        log: (line) => console.log(line),
      },
      options
    );
  } finally {
    await client.close();
    await dataSource.destroy();
  }
}

// Prints the one line `describe` words and stops, for an uncaught error and
// for the command's own failure. Never the stack, and never the message of an
// error the command did not word itself: the release task prints this line
// into a public log. A warning prints its class and code only.
const fail = guardOutput(
  process,
  (line) => console.error(line),
  (code) => process.exit(code)
);

run().then((failures) => process.exit(failures > 0 ? 1 : 0), fail);
