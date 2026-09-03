import { InitialAuthSchema1756000000000 } from './1756000000000-InitialAuthSchema';
import { AdminUsers1772400000000 } from './1772400000000-AdminUsers';

/**
 * Every auth migration, in the order TypeORM must apply them (plan 0027,
 * section 2.1).
 *
 * An explicit array rather than the filesystem glob `data-source.ts` used to
 * carry, because the glob is resolved at runtime by the CLI and **webpack cannot
 * follow it**. The deploy Job runs a bundled `migrate.js` inside the service
 * image, and a bundled build with a glob would find zero migrations, run
 * cleanly, apply nothing, and report success — the worst available failure for a
 * pre-upgrade hook, because the pods then roll against a schema that was never
 * created.
 *
 * Both the CLI data source and `src/migrate.ts` import this one array, so they
 * can never disagree about which migrations exist. `migrations.spec.ts` asserts
 * it is sorted by timestamp and matches the files in this directory, so adding a
 * migration and forgetting this list fails the suite rather than the deploy.
 */
export const AUTH_MIGRATIONS = [
  InitialAuthSchema1756000000000,
  AdminUsers1772400000000,
];
