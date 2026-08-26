import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ITEM_PATTERNS,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  type ItemPage,
  type ItemView,
  type SupermarketItemPage,
  type SupermarketItemView,
  type SupermarketLocationPage,
  type SupermarketLocationView,
  type SupermarketPage,
  type SupermarketView,
} from '@portfolio/luna-shopper/contracts';
import { AuthUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { CurrentUser } from '../auth/jwt.strategy';
import { ApiContractResponse, ApiProblemResponses } from '../docs';
import { NatsClient } from '../messaging/nats-client';
import {
  CatalogListQueryDto,
  CreateItemDto,
  CreateSupermarketDto,
  CreateSupermarketLocationDto,
  SearchItemsQueryDto,
  UpdateItemDto,
  UpdateSupermarketDto,
  UpdateSupermarketLocationDto,
  UpsertSupermarketItemDto,
} from './catalog.dto';

/**
 * The catalog REST surface (plan 0012), proxying to the catalog service over
 * NATS. Every route requires a valid token; write routes are additionally gated
 * to the platform-admin allowlist inside the catalog service (the app owner
 * alone), while read routes are open to any authenticated user.
 */
@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/supermarkets', version: '1' })
export class CatalogSupermarketsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(SUPERMARKET_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateSupermarketDto
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.create, {
      userId: user.userId,
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(SUPERMARKET_PATTERNS.list)
  list(
    @AuthUser() user: CurrentUser,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketPage> {
    return this.nats.send<SupermarketPage>(SUPERMARKET_PATTERNS.list, {
      userId: user.userId,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.get, {
      userId: user.userId,
      supermarketId: id,
    });
  }

  @Patch(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupermarketDto
  ): Promise<SupermarketView> {
    return this.nats.send<SupermarketView>(SUPERMARKET_PATTERNS.update, {
      userId: user.userId,
      supermarketId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_PATTERNS.delete, {
      userId: user.userId,
      supermarketId: id,
    });
  }

  @Post(':id/locations')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.create, {
    status: HttpStatus.CREATED,
  })
  @ApiProblemResponses({ body: true, conflict: true })
  createLocation(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: CreateSupermarketLocationDto
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.create,
      { userId: user.userId, supermarketId: id, ...dto }
    );
  }

  @Get(':id/locations')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.list)
  listLocations(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketLocationPage> {
    return this.nats.send<SupermarketLocationPage>(
      SUPERMARKET_LOCATION_PATTERNS.list,
      {
        userId: user.userId,
        supermarketId: id,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/locations', version: '1' })
export class CatalogLocationsController {
  constructor(private readonly nats: NatsClient) {}

  @Get(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.get,
      { userId: user.userId, supermarketLocationId: id }
    );
  }

  @Patch(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupermarketLocationDto
  ): Promise<SupermarketLocationView> {
    return this.nats.send<SupermarketLocationView>(
      SUPERMARKET_LOCATION_PATTERNS.update,
      { userId: user.userId, supermarketLocationId: id, ...dto }
    );
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_LOCATION_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_LOCATION_PATTERNS.delete, {
      userId: user.userId,
      supermarketLocationId: id,
    });
  }

  @Get(':id/offers')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.listByLocation)
  offers(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketItemPage> {
    return this.nats.send<SupermarketItemPage>(
      SUPERMARKET_ITEM_PATTERNS.listByLocation,
      {
        userId: user.userId,
        supermarketLocationId: id,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/items', version: '1' })
export class CatalogItemsController {
  constructor(private readonly nats: NatsClient) {}

  @Post()
  @ApiContractResponse(ITEM_PATTERNS.create, { status: HttpStatus.CREATED })
  @ApiProblemResponses({ body: true, conflict: true })
  create(
    @AuthUser() user: CurrentUser,
    @Body() dto: CreateItemDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.create, {
      userId: user.userId,
      ...dto,
    });
  }

  @Get()
  @ApiContractResponse(ITEM_PATTERNS.search)
  search(
    @AuthUser() user: CurrentUser,
    @Query() query: SearchItemsQueryDto
  ): Promise<ItemPage> {
    return this.nats.send<ItemPage>(ITEM_PATTERNS.search, {
      userId: user.userId,
      query: query.query,
      category: query.category,
      cursor: query.cursor,
      limit: query.limit,
      order: query.order,
    });
  }

  @Get(':id')
  @ApiContractResponse(ITEM_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.get, {
      userId: user.userId,
      itemId: id,
    });
  }

  @Patch(':id')
  @ApiContractResponse(ITEM_PATTERNS.update)
  @ApiProblemResponses({ body: true })
  update(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto
  ): Promise<ItemView> {
    return this.nats.send<ItemView>(ITEM_PATTERNS.update, {
      userId: user.userId,
      itemId: id,
      ...dto,
    });
  }

  @Delete(':id')
  @ApiContractResponse(ITEM_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(ITEM_PATTERNS.delete, {
      userId: user.userId,
      itemId: id,
    });
  }

  @Get(':id/offers')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.listByItem)
  offers(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: CatalogListQueryDto
  ): Promise<SupermarketItemPage> {
    return this.nats.send<SupermarketItemPage>(
      SUPERMARKET_ITEM_PATTERNS.listByItem,
      {
        userId: user.userId,
        itemId: id,
        cursor: query.cursor,
        limit: query.limit,
      }
    );
  }
}

@ApiTags('catalog')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@ApiProblemResponses({ auth: true, membership: true })
@Controller({ path: 'catalog/supermarket-items', version: '1' })
export class CatalogSupermarketItemsController {
  constructor(private readonly nats: NatsClient) {}

  @Put()
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.upsert)
  @ApiProblemResponses({ body: true })
  upsert(
    @AuthUser() user: CurrentUser,
    @Body() dto: UpsertSupermarketItemDto
  ): Promise<SupermarketItemView> {
    return this.nats.send<SupermarketItemView>(
      SUPERMARKET_ITEM_PATTERNS.upsert,
      { userId: user.userId, ...dto }
    );
  }

  @Get()
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.get)
  get(
    @AuthUser() user: CurrentUser,
    @Query('itemId') itemId: string,
    @Query('supermarketLocationId') supermarketLocationId: string
  ): Promise<SupermarketItemView> {
    return this.nats.send<SupermarketItemView>(SUPERMARKET_ITEM_PATTERNS.get, {
      userId: user.userId,
      itemId,
      supermarketLocationId,
    });
  }

  @Delete(':id')
  @ApiContractResponse(SUPERMARKET_ITEM_PATTERNS.delete)
  remove(
    @AuthUser() user: CurrentUser,
    @Param('id') id: string
  ): Promise<{ id: string }> {
    return this.nats.send(SUPERMARKET_ITEM_PATTERNS.delete, {
      userId: user.userId,
      supermarketItemId: id,
    });
  }
}
