import { Module } from '@nestjs/common';
import { RetentionSweepService } from './retention-sweep.service';

/**
 * The retention sweep (plan 0233). It imports nothing: the sweep reads the
 * global `DataSource`, `ConfigService` and logger, and writes raw statements.
 */
@Module({
  providers: [RetentionSweepService],
})
export class RetentionModule {}
