import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { runAdminCli } from './app/admin/cli/run';
import { AUTH_ENTITIES } from './app/entities';

/**
 * The operator commands, INSIDE the image (plan 0071, section 6).
 *
 * Section 6 says an admin is created by the person who has the server, and this
 * is what makes that true of a cluster rather than only of a developer machine:
 * `webpack.config.js` emits it as `admin-cli.js` beside `main.js` and
 * `migrate.js`, so creating the first operator on a fresh deployment is
 * `kubectl exec -it deploy/luna-shopper-backend-auth -- node admin-cli.js create
 * <username>` and needs nothing checked out anywhere.
 *
 * It deliberately does NOT reuse `app/db/data-source.ts`, for exactly the reason
 * `migrate.ts` gives: that file is the TypeORM CLI's and needs ts-node, the
 * workspace tsconfig, the `@portfolio/*` path aliases and the git ignored `.env`
 * files, none of which a runtime image has or should have. The entity list is
 * shared, which is what keeps the two from disagreeing.
 *
 * There is no host guard here, and that is the difference from `tools/db`. Those
 * scripts refuse a non local database because seeding production is never right;
 * this one exists to be run against production, by hand, by somebody who is
 * already on the server.
 */
async function run() {
  const url = process.env['AUTH_DB_URL'];
  if (!url) {
    throw new Error(
      'AUTH_DB_URL is not set. Inside a pod it arrives from the ' +
        'luna-shopper-backend-secrets Secret through _env.tpl; run ' +
        'k8s/bootstrap/provision-release.sh --check to see which key is missing.'
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: AUTH_ENTITIES,
    synchronize: false,
  });

  await runAdminCli(dataSource, process.argv.slice(2));
}

run().catch((err) => {
  // The message, not the stack: every failure this command produces is something
  // the operator typed, and a stack trace hides it.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
