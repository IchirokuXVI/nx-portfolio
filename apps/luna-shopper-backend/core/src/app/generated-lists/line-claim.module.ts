import { Module } from '@nestjs/common';
import { ZonesModule } from '../zones/zones.module';
import { LineClaimService } from './line-claim.service';

/**
 * The line claim, in a module of its own (plan 0052).
 *
 * It is asked by both slices: `ListsModule` reads it on every line it answers
 * with, and `GeneratedListsModule` announces it on every transition that starts
 * or ends one. `ListsModule` cannot import `GeneratedListsModule`, which imports
 * it, so a module neither owns is the way both reach it. `SharedListGrantModule`
 * exists for exactly this reason and says so.
 *
 * `ZonesModule` is imported for the event publisher alone, which is where that
 * provider is declared and exported.
 */
@Module({
  imports: [ZonesModule],
  providers: [LineClaimService],
  exports: [LineClaimService],
})
export class LineClaimModule {}
