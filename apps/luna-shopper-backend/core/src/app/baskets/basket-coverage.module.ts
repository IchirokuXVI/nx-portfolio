import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BasketSource, GeneratedList } from '../entities';
import { BasketCoverageService } from './basket-coverage.service';

/**
 * What a basket covers, in a module of its own (plan 0133, section 5).
 *
 * It stands alone for the reason `LineClaimModule` does, and for the same shape
 * of problem: `GeneratedListsModule` needs it now, `ListsModule` needs it in plan
 * 0139, and those two already point one way, so a module either of them owned
 * could not be reached from the other.
 *
 * It registers `GeneratedList` and `BasketSource` and nothing else. Both of its
 * queries are raw SQL over the whole join, so the repository is a connection
 * rather than a mapper, and nothing here writes.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GeneratedList, BasketSource])],
  providers: [BasketCoverageService],
  exports: [BasketCoverageService],
})
export class BasketCoverageModule {}
