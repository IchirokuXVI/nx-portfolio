import { PageQueryDto } from '@portfolio/luna-shopper/platform';

/**
 * The query of the two history reads (plan 0142, sections 3 and 4).
 *
 * Both carry a cursor and a limit and nothing else, and they are two classes
 * rather than one alias so the OpenAPI document names the query of each route
 * after the route. The account is the token's and is never a query value.
 *
 * Every `@Query()` value lives on the DTO: a `@Query('x')` beside a `@Query()`
 * DTO makes the route refuse every request (memory note on Nest query DTOs).
 */
export class ListPurchaseSessionsQueryDto extends PageQueryDto {}

export class ListPurchaseSessionRowsQueryDto extends PageQueryDto {}
