import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CATEGORY_PATTERNS,
  type CategoryIdRequest,
  type CategoryPage,
  type CategoryTreeRequest,
  type CategoryTreeView,
  type CategoryView,
  type CreateCategoryRequest,
  type ListCategoriesRequest,
  type UpdateCategoryRequest,
} from '@portfolio/luna-shopper/contracts';
import { CategoryService } from './category.service';

/**
 * The category tree over NATS (plan 0166, sections 1 to 3).
 *
 * A controller of its own rather than six more handlers on
 * `CatalogController`, for the reason `NearbyShopsController` gives. A
 * product's categories are not written here: they are `categoryIds` on the
 * item subjects, which `CatalogController` serves.
 */
@Controller()
export class CategoriesController {
  constructor(private readonly categories: CategoryService) {}

  /** The whole tree. Also the harvester's, which sends its own actor id. */
  @MessagePattern(CATEGORY_PATTERNS.tree)
  tree(@Payload() req: CategoryTreeRequest): Promise<CategoryTreeView> {
    return this.categories.tree(req);
  }

  @MessagePattern(CATEGORY_PATTERNS.list)
  list(@Payload() req: ListCategoriesRequest): Promise<CategoryPage> {
    return this.categories.list(req);
  }

  @MessagePattern(CATEGORY_PATTERNS.get)
  get(@Payload() req: CategoryIdRequest): Promise<CategoryView> {
    return this.categories.get(req);
  }

  @MessagePattern(CATEGORY_PATTERNS.create)
  create(@Payload() req: CreateCategoryRequest): Promise<CategoryView> {
    return this.categories.create(req);
  }

  @MessagePattern(CATEGORY_PATTERNS.update)
  update(@Payload() req: UpdateCategoryRequest): Promise<CategoryView> {
    return this.categories.update(req);
  }

  @MessagePattern(CATEGORY_PATTERNS.delete)
  delete(@Payload() req: CategoryIdRequest): Promise<{ id: string }> {
    return this.categories.delete(req);
  }
}
