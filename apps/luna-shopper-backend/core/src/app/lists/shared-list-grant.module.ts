import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListAccess, ShoppingList, ZoneMembership } from '../entities';
import { SharedListGrantService } from './shared-list-grant.service';

/**
 * The one rule about who a shared list is shared with, as its own module (plan
 * 0042).
 *
 * It is this small because of the module graph rather than because the service
 * is: `ListsModule` imports `ZonesModule`, so `ZonesModule` cannot import
 * `ListsModule` back, and membership approval needs the grant that list creation
 * needs. A module depending on neither is the only shape both can import.
 *
 * It registers the three entities the grant reads and writes and provides
 * nothing else, so importing it never drags a controller or an events client
 * along with it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ShoppingList, ListAccess, ZoneMembership]),
  ],
  providers: [SharedListGrantService],
  exports: [SharedListGrantService],
})
export class SharedListGrantModule {}
