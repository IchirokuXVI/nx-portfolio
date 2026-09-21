import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BasketSource, Basket } from '../entities';
import { CoreEventsModule } from '../events/core-events.module';
import { BasketAnnouncer } from './basket-announcer.service';
import { BasketCoverageService } from './basket-coverage.service';

/**
 * What a basket covers, in a module of its own (plan 0133, section 5).
 *
 * It stands alone for the reason `LineClaimModule` does, and for the same shape
 * of problem: `BasketsModule` needs it now, `ListsModule` needs it in plan
 * 0139, and those two already point one way, so a module either of them owned
 * could not be reached from the other.
 *
 * It registers `Basket` and `BasketSource` and nothing else. Every one of
 * its queries is raw SQL over the whole join, so the repository is a connection
 * rather than a mapper, and nothing here writes.
 *
 * Plan 0139 adds {@link BasketAnnouncer} beside the coverage, because telling a
 * basket that a write reached it is the same question read one step further on:
 * it needs the coverage and the event publisher and nothing else.
 *
 * The publisher comes from `CoreEventsModule` rather than from `ZonesModule`,
 * which is where it used to live. `ZonesModule` imports **this** module now, so
 * reaching back for the publisher would make the two need each other.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Basket, BasketSource]),
    CoreEventsModule,
  ],
  providers: [BasketCoverageService, BasketAnnouncer],
  exports: [BasketCoverageService, BasketAnnouncer],
})
export class BasketCoverageModule {}
