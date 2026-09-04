import { Global, Module } from '@nestjs/common';
import { AuthAuditService } from './auth-audit.service';

/**
 * The audit trail, available to every provider that writes on an operator's
 * behalf (plan 0077, section 8).
 *
 * `@Global()` because the alternative is worse rather than because it is tidy.
 * The writes that must be audited live in `IdentityService`, which is also the
 * class every user facing route goes through, so the trail has to be reachable
 * from a service that mostly has nothing to do with operators. A module that
 * imported this and did not use it would read as though it writes an audit
 * trail, which is not true of most of auth.
 *
 * It provides one service and no repository binding. `AuthAuditService` reaches
 * the trail's own table through the injected `DataSource`, because it writes
 * through the caller's transaction rather than through a repository of its own.
 */
@Global()
@Module({
  providers: [AuthAuditService],
  exports: [AuthAuditService],
})
export class AuditModule {}
