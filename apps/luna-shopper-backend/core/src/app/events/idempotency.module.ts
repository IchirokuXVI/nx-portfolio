import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProcessedEvent } from '../entities';
import { ProcessedEventStore } from './idempotency.store';

/**
 * The `processed_events` inbox, on its own so more than one slice can consume
 * another service's events idempotently.
 *
 * It used to be a provider of `AccountModule`, which was true while the only
 * consumers were the identity sagas (plans 0011 and 0018). Plan 0070 adds a
 * second: `ProductGroupSyncService` in `ListsModule` reconciles catalog's group
 * membership into a household's lines, and it needs exactly the same at least
 * once protection. `ListsModule` cannot import `AccountModule` to get it, because
 * that module imports `GeneratedListsModule`, which imports `ListsModule`, so
 * lifting the store into a module of its own is what breaks the cycle rather than
 * a second copy of the store.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ProcessedEvent])],
  providers: [ProcessedEventStore],
  exports: [ProcessedEventStore],
})
export class IdempotencyModule {}
