import { Global, Module } from '@nestjs/common';
import { CoreAuditService } from './core-audit.service';

/**
 * The audit trail, available to every module that writes on an operator's behalf
 * (plan 0077, section 8).
 *
 * `@Global()` because the alternative is worse rather than because it is tidy.
 * The writes that must be audited are spread across `ZonesModule`, `ListsModule`
 * and `AdminModule`, and the first two are imported by several others; adding
 * this to each import list would mean a module that forgot it fails at boot with
 * a dependency error, which is fine, while a module that imports it and does not
 * use it reads as though it writes an audit trail, which is not.
 *
 * It provides one service and no repository binding. `CoreAuditService` reaches
 * the trail's own table through the injected `DataSource`, because it writes
 * through the caller's transaction rather than through a repository of its own.
 */
@Global()
@Module({
  providers: [CoreAuditService],
  exports: [CoreAuditService],
})
export class AuditModule {}
