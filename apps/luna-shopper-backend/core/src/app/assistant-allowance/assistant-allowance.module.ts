import { Module } from '@nestjs/common';
import { AssistantAllowanceSweepService } from './assistant-allowance-sweep.service';
import { AssistantAllowanceController } from './assistant-allowance.controller';
import { AssistantAllowanceService } from './assistant-allowance.service';

/**
 * Each person's assistant allowance (plan 0234).
 *
 * It registers no repository and imports nothing: every operation is raw SQL
 * on the injected `DataSource` (`assistant-allowance.sql.ts`), because every
 * rule here is a rule about what the database does under two callers at once.
 */
@Module({
  controllers: [AssistantAllowanceController],
  providers: [AssistantAllowanceService, AssistantAllowanceSweepService],
})
export class AssistantAllowanceModule {}
