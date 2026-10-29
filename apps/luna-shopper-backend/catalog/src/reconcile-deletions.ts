import 'reflect-metadata';

import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import {
  RECONCILIATION_PATTERNS,
  type ExistingUserIdsRequest,
  type ExistingUserIdsResponse,
} from '@portfolio/luna-shopper/contracts';
import { firstValueFrom, timeout } from 'rxjs';
import { DataSource } from 'typeorm';
import { AccountDeletionService } from './app/account/account-deletion.service';
import {
  CATALOG_USER_IDS_SQL,
  parseReconcileArgs,
  reconcileDeletions,
} from './app/account/reconcile-deletions';
import { CATALOG_ENTITIES } from './app/entities';

/** How long one `auth.existingUserIds` answer may take. */
const ASK_TIMEOUT_MS = 15_000;

/**
 * Catalog's one off command of plan 0232 section 7, INSIDE the image.
 *
 * `webpack.config.js` emits it as `reconcile-deletions.js` beside `main.js`, and
 * release task 0005 runs it with `kubectl exec deploy/luna-shopper-backend-catalog
 * -- node reconcile-deletions.js`. Catalog's deletion needs a data source and
 * nothing else, so this builds that service on a plain `DataSource`, the way
 * `migrate.ts` connects, rather than booting the whole module.
 *
 *   node reconcile-deletions.js --count       how many ids auth does not know
 *   node reconcile-deletions.js --max 2000    rewrite their walks, unless more
 */
async function run() {
  const options = parseReconcileArgs(process.argv.slice(2));
  const url = process.env['CATALOG_DB_URL'];
  const natsUrl = process.env['NATS_URL'];
  if (!url || !natsUrl) {
    throw new Error(
      'CATALOG_DB_URL and NATS_URL must both be set. Inside a pod they arrive ' +
        'from the luna-shopper-backend-secrets Secret through _env.tpl.'
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: CATALOG_ENTITIES,
    synchronize: false,
  });
  await dataSource.initialize();
  const auth = ClientProxyFactory.create({
    transport: Transport.NATS,
    options: { servers: [natsUrl] },
  });
  try {
    await auth.connect();
    const deletions = new AccountDeletionService(dataSource);
    await reconcileDeletions(
      {
        candidates: async () =>
          (
            (await dataSource.query(CATALOG_USER_IDS_SQL)) as { id: string }[]
          ).map((row) => row.id),
        existing: (userIds) =>
          firstValueFrom(
            auth
              .send<
                ExistingUserIdsResponse,
                ExistingUserIdsRequest
              >(RECONCILIATION_PATTERNS.existingUserIds, { userIds })
              .pipe(timeout(ASK_TIMEOUT_MS))
          ),
        delete: (userId) => deletions.handleUserDeleted(userId),
        log: (line) => console.log(line),
      },
      options
    );
  } finally {
    await auth.close();
    await dataSource.destroy();
  }
}

run().then(
  () => process.exit(0),
  (err) => {
    // The message, not the stack: the release task prints it as its refusal.
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
