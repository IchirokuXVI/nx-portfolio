import 'reflect-metadata';

import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import {
  ITEM_PATTERNS,
  type GetItemsResult,
} from '@portfolio/luna-shopper/contracts';
import { writeFile } from 'fs/promises';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  describe,
  parseWashSizesArgs,
  runWashSizes,
  type CatalogPort,
} from './app/release-tasks/wash-sizes';

/** How long one catalog answer may take. An update is one row. */
const ASK_TIMEOUT_MS = 30_000;

/**
 * The harvester's one off command of backend plan 0271, INSIDE the image.
 *
 * `webpack.config.js` emits it as `wash-sizes.js` beside `main.js`, and
 * release task 0007 runs it with `kubectl exec deploy/luna-shopper-backend-harvester
 * -- node wash-sizes.js`. It reads the harvester's own database with raw
 * SELECTs on a plain `DataSource`, as `kilo-pieces.ts` does, and speaks to
 * catalog over NATS as the harvester's service actor.
 *
 *   node wash-sizes.js --count
 *       prints `chain <slug> <n>`, `products`, `pack`, `content`, `unread`,
 *       `held` and `mercadona-per-wash`, numbers only. Writes nothing.
 *
 *   node wash-sizes.js --review <file>
 *       the same counts, then the review list of the products that still
 *       qualify in <file>, and the Mercadona note beside it. No database row.
 *
 *   node wash-sizes.js --max <n> --review <file>
 *       the same counts, refuses before any write above <n>, then corrects
 *       each product and writes the list of what it corrected. Prints
 *       `corrected`, `skipped` and `failures`, and exits 1 when any product
 *       failed.
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
    throw new Error(
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
        files: { write: (path, text) => writeFile(path, text, 'utf8') },
        log: (line) => console.log(line),
      },
      options
    );
  } finally {
    await client.close();
    await dataSource.destroy();
  }
}

run().then(
  (failures) => process.exit(failures > 0 ? 1 : 0),
  (err) => {
    // The message, not the stack: the release task prints it as its refusal.
    console.error(describe(err));
    process.exit(1);
  }
);
