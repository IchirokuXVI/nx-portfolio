import 'reflect-metadata';

import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import {
  ITEM_LINKED_IMAGE_PATTERNS,
  ITEM_PATTERNS,
  type FindItemByEanResult,
  type FindItemCreatedFromEntryResult,
  type GetItemsResult,
} from '@portfolio/luna-shopper/contracts';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource } from 'typeorm';
import {
  describe,
  parseKiloPiecesArgs,
  runKiloPieces,
  type CatalogPort,
} from './app/release-tasks/kilo-pieces';

/** How long one catalog answer may take. A create or an update is one row. */
const ASK_TIMEOUT_MS = 30_000;

/**
 * The harvester's one off command of backend plan 0244 section 7, INSIDE the
 * image.
 *
 * `webpack.config.js` emits it as `kilo-pieces.js` beside `main.js`, and
 * release task 0006 runs it with `kubectl exec deploy/luna-shopper-backend-harvester
 * -- node kilo-pieces.js`. It reads the harvester's own database with raw
 * SELECTs on a plain `DataSource`, the way `migrate.ts` connects, and speaks to
 * catalog over NATS as the harvester's service actor, the way `CatalogClient`
 * does, without booting the Nest app.
 *
 *   node kilo-pieces.js --count
 *       prints `kilo <n>` (7.1), `piece <n>` (7.2, with `piece-mercadona` and
 *       `piece-lidl`), `split <n>` (7.4), `rows <n>` (pieces of 7.2 whose
 *       product an earlier run converted and whose queue row it did not
 *       write), `unweighed <n>` (7.3), and a
 *       `held <product>: <reason>` line for each product a selection matched
 *       that the task leaves to a person. Writes nothing.
 *
 *   node kilo-pieces.js --max-kilo 200 --max-piece 20 --max-split 10
 *       prints the same counts, refuses before any write when a count is above
 *       its ceiling, then writes. One line per product: `kilo`, `piece-mercadona`
 *       or `piece-lidl` with the external id, the product and its weight,
 *       `resumed`, `created` or `adopted` for a split, `ean-stays` when a
 *       moving row's barcode is held by a product, `failed <what>: <reason>`,
 *       and last `failures <n>`. Exits 1 when any product failed.
 *
 * It needs HARVESTER_DB_URL, NATS_URL and HARVESTER_ACTOR_ID, which the pod
 * already has. Catalog knows that actor as a service (`SERVICE_ACTOR_IDS`).
 */
async function run() {
  const options = parseKiloPiecesArgs(process.argv.slice(2));
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
    create: (input) => send(ITEM_PATTERNS.create, { userId: actor, ...input }),
    findCreatedFromEntry: async (createdFromEntry) =>
      (
        await send<FindItemCreatedFromEntryResult>(
          ITEM_PATTERNS.findCreatedFromEntry,
          { userId: actor, createdFromEntry }
        )
      ).item,
    findItemByEan: async (ean) =>
      (
        await send<FindItemByEanResult>(ITEM_PATTERNS.findByEan, {
          userId: actor,
          ean,
        })
      ).item,
    linkImages: (entries) =>
      send(ITEM_LINKED_IMAGE_PATTERNS.linkBatch, { userId: actor, entries }),
  };

  try {
    await client.connect();
    const failures = await runKiloPieces(
      {
        harvester: { query: (sql, params) => dataSource.query(sql, params) },
        catalog,
        log: (line) => console.log(line),
      },
      options
    );
    return failures;
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
