import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  SECTION_PATTERNS,
  type CreateShopSectionRequest,
  type ItemSectionsAtLocationRequest,
  type ItemSectionsAtLocationView,
  type LocationSectionNamesRequest,
  type LocationSectionNamesView,
  type LocationSectionsRequest,
  type LocationSectionsView,
  type SetLocationSectionsRequest,
  type ShopSectionIdRequest,
  type ShopSectionView,
  type UpdateShopSectionRequest,
} from '@portfolio/luna-shopper/contracts';
import { SectionService } from './section.service';

/**
 * The sections of a shop over NATS (plan 0167, as plan 0200 left it).
 *
 * A controller of its own, for the reason `CategoriesController` gives. The
 * two reads of a shop carry no `userId`: a guest reading a shared basket at a
 * shop is who asks.
 */
@Controller()
export class SectionsController {
  constructor(private readonly sections: SectionService) {}

  @MessagePattern(SECTION_PATTERNS.create)
  create(@Payload() req: CreateShopSectionRequest): Promise<ShopSectionView> {
    return this.sections.create(req);
  }

  @MessagePattern(SECTION_PATTERNS.get)
  get(@Payload() req: ShopSectionIdRequest): Promise<ShopSectionView> {
    return this.sections.get(req);
  }

  @MessagePattern(SECTION_PATTERNS.update)
  update(@Payload() req: UpdateShopSectionRequest): Promise<ShopSectionView> {
    return this.sections.update(req);
  }

  @MessagePattern(SECTION_PATTERNS.delete)
  delete(@Payload() req: ShopSectionIdRequest): Promise<{ id: string }> {
    return this.sections.delete(req);
  }

  @MessagePattern(SECTION_PATTERNS.forLocation)
  forLocation(
    @Payload() req: LocationSectionsRequest
  ): Promise<LocationSectionsView> {
    return this.sections.forLocation(req);
  }

  @MessagePattern(SECTION_PATTERNS.setForLocation)
  setForLocation(
    @Payload() req: SetLocationSectionsRequest
  ): Promise<LocationSectionsView> {
    return this.sections.setForLocation(req);
  }

  /** For the basket read at a shop and the back office's preview. */
  @MessagePattern(SECTION_PATTERNS.itemsAtLocation)
  itemsAtLocation(
    @Payload() req: ItemSectionsAtLocationRequest
  ): Promise<ItemSectionsAtLocationView> {
    return this.sections.itemsAtLocation(req);
  }

  /** Several shops' section names in one statement (plan 0170). */
  @MessagePattern(SECTION_PATTERNS.namesForLocations)
  namesForLocations(
    @Payload() req: LocationSectionNamesRequest
  ): Promise<LocationSectionNamesView> {
    return this.sections.namesForLocations(req);
  }
}
