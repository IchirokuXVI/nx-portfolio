import { Module } from '@nestjs/common';
import { AccountDeletionConsumer } from './account-deletion.consumer';
import { AccountDeletionService } from './account-deletion.service';

/**
 * What catalog does when an account is deleted (plan 0232, section 6): the
 * durable consumer of the deletion stream and the rewrite of the shop walks it
 * hands each id to. The consumer is started by `main.ts`, so the one off
 * `reconcile-deletions.ts` never pulls from the stream.
 */
@Module({
  providers: [AccountDeletionService, AccountDeletionConsumer],
  exports: [AccountDeletionService],
})
export class AccountModule {}
