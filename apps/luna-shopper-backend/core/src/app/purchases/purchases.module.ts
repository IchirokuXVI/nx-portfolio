import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

/**
 * One person's history of purchases (plan 0142).
 *
 * A module of its own rather than a corner of `ListsModule`, because the
 * resource is different: the lists slice answers questions about **a list**,
 * for anybody who can read it, and this answers "what did I buy" across every
 * list and every basket, for one account.
 *
 * It registers no repository and imports nothing. Both reads are raw statements
 * on the injected `DataSource`, and the authorization is the statement itself:
 * `PERSON_PURCHASES_CTE` selects the caller's own purchases and nothing else,
 * so there is no access service to reach for.
 */
@Module({
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
