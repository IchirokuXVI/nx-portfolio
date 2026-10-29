import { InitialAuthSchema1756000000000 } from './1756000000000-InitialAuthSchema';
import { AdminUsers1772400000000 } from './1772400000000-AdminUsers';
import { AuthAudit1772500000000 } from './1772500000000-AuthAudit';
import { UserRoles1772600000000 } from './1772600000000-UserRoles';
import { ImpersonationSessions1772700000000 } from './1772700000000-ImpersonationSessions';
import { RecoveryGrants1772800000000 } from './1772800000000-RecoveryGrants';
import { OAuthHandoffs1772900000000 } from './1772900000000-OAuthHandoffs';
import { RefreshTokenSuccessor1773000000000 } from './1773000000000-RefreshTokenSuccessor';
import { TermsAcceptances1773100000000 } from './1773100000000-TermsAcceptances';
import { AccountDeletions1773200000000 } from './1773200000000-AccountDeletions';

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
  // A new table that references nothing, and that nothing references, so it
  // follows everything and depends on none of it (plan 0077, section 8).
  AuthAudit1772500000000,
  // A column on `users` with a default, so every existing row starts with no
  // role (plan 0175).
  UserRoles1772600000000,
  // One new table and one nullable column on `refresh_tokens` (plan 0194).
  // It only adds, so no existing row changes.
  ImpersonationSessions1772700000000,
  // Three columns on `password_resets` (plan 0210). It only adds, and every
  // existing row reads as a self service grant.
  RecoveryGrants1772800000000,
  // One nullable column on `oauth_states` and one new table (plan 0230). It
  // only adds, and a state minted before it is refused at consume.
  OAuthHandoffs1772900000000,
  // Two nullable columns on `refresh_tokens` (plan 0229). It only adds, and
  // every existing revoked row reads as revoked with no successor.
  RefreshTokenSuccessor1773000000000,
  // One new table and a nullable column on each Google grant (plan 0231). It
  // only adds, and a grant from before it carries no version.
  TermsAcceptances1773100000000,
  // The outbox of `user.deleted` (plan 0232, section 5). One new table that
  // references nothing, so no existing row changes.
  AccountDeletions1773200000000,
];
