import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
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
  CORE_USER_IDS_SQL,
  parseReconcileArgs,
  reconcileDeletions,
} from './app/account/reconcile-deletions';
import { AppModule } from './app/app.module';

/** How long one `auth.existingUserIds` answer may take. */
const ASK_TIMEOUT_MS = 15_000;

/**
 * The one off command of plan 0232 section 7, INSIDE the image.
 *
 * `webpack.config.js` emits it as `reconcile-deletions.js` beside `main.js`, and
 * release task 0005 runs it with `kubectl exec deploy/luna-shopper-backend-core
 * -- node reconcile-deletions.js`. It collects every user id of the tables of
 * section 2, asks auth which of them still exist, and runs the deletion the
 * stream runs for each one auth does not know.
 *
 * It boots the whole app module as an application context, so the deletion is
 * the very service the consumer calls and not a copy of it. An application
 * context starts no NATS microservice and no HTTP port, and `main.ts` alone
 * starts the stream consumer, so this command never handles a message.
 *
 *   node reconcile-deletions.js --count       how many ids auth does not know
 *   node reconcile-deletions.js --max 2000    delete them, unless there are more
 */
async function run() {
  const options = parseReconcileArgs(process.argv.slice(2));
  const natsUrl = process.env['NATS_URL'];
  if (!natsUrl) {
    throw new Error(
      'NATS_URL is not set. Inside a pod it arrives from _env.tpl.'
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const auth = ClientProxyFactory.create({
    transport: Transport.NATS,
    options: { servers: [natsUrl] },
  });
  try {
    await auth.connect();
    const dataSource = app.get(DataSource);
    const deletions = app.get(AccountDeletionService);
    await reconcileDeletions(
      {
        candidates: async () =>
          ((await dataSource.query(CORE_USER_IDS_SQL)) as { id: string }[]).map(
            (row) => row.id
          ),
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
    await app.close();
  }
}

run().then(
  // Explicit, so a handle some module left open cannot hold `kubectl exec`.
  () => process.exit(0),
  (err) => {
    // The message, not the stack: the release task prints it as its refusal.
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
