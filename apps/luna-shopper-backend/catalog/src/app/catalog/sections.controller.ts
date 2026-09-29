import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  SECTION_PATTERNS,
  type CreateSupermarketSectionRequest,
  type ItemSectionPinsPage,
  type ItemSectionPinsView,
  type ItemSectionsAtLocationRequest,
  type ItemSectionsAtLocationView,
  type ListItemSectionPinsRequest,
  type ListSupermarketSectionsRequest,
  type LocationSectionsRequest,
  type LocationSectionsView,
  type SetItemSectionPinsRequest,
  type SetLocationSectionsRequest,
  type SupermarketSectionIdRequest,
  type SupermarketSectionPage,
  type SupermarketSectionView,
  type UpdateSupermarketSectionRequest,
} from '@portfolio/luna-shopper/contracts';
import { SectionService } from './section.service';

/**
 * Shop sections over NATS (plan 0167, sections 1 to 3).
 *
 * A controller of its own, for the reason `CategoriesController` gives. The
 * two reads of a shop carry no `userId`: a guest reading a shared basket at a
 * shop is who asks.
 */
@Controller()
export class SectionsController {
  constructor(private readonly sections: SectionService) {}

  @MessagePattern(SECTION_PATTERNS.create)
  create(
    @Payload() req: CreateSupermarketSectionRequest
  ): Promise<SupermarketSectionView> {
    return this.sections.create(req);
  }

  @MessagePattern(SECTION_PATTERNS.list)
  list(
    @Payload() req: ListSupermarketSectionsRequest
  ): Promise<SupermarketSectionPage> {
    return this.sections.list(req);
  }

  @MessagePattern(SECTION_PATTERNS.get)
  get(
    @Payload() req: SupermarketSectionIdRequest
  ): Promise<SupermarketSectionView> {
    return this.sections.get(req);
  }

  @MessagePattern(SECTION_PATTERNS.update)
  update(
    @Payload() req: UpdateSupermarketSectionRequest
  ): Promise<SupermarketSectionView> {
    return this.sections.update(req);
  }

  @MessagePattern(SECTION_PATTERNS.delete)
  delete(@Payload() req: SupermarketSectionIdRequest): Promise<{ id: string }> {
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

  @MessagePattern(SECTION_PATTERNS.listPins)
  listPins(
    @Payload() req: ListItemSectionPinsRequest
  ): Promise<ItemSectionPinsPage> {
    return this.sections.listPins(req);
  }

  @MessagePattern(SECTION_PATTERNS.setPins)
  setPins(
    @Payload() req: SetItemSectionPinsRequest
  ): Promise<ItemSectionPinsView> {
    return this.sections.setPins(req);
  }

  /** The rule of section 3, for the basket read at a shop and the preview. */
  @MessagePattern(SECTION_PATTERNS.itemsAtLocation)
  itemsAtLocation(
    @Payload() req: ItemSectionsAtLocationRequest
  ): Promise<ItemSectionsAtLocationView> {
    return this.sections.itemsAtLocation(req);
  }
}
