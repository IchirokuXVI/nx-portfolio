/**
 * Where a resource is mounted, asked for by name (admin plan 0022, section 3).
 *
 * A resource lives under whichever section mounted it, so `items` is at
 * `/catalog/items` and `users` is at `/shoppers/users`. Nothing outside the
 * route table may work that out from a segment: a path built by hand out of
 * `descriptor.segment` was right until the sections arrived, and is a link to
 * the not found page after them.
 *
 * `ResourceRegistry.pathOf` is what answers it, because the registry is built
 * from the same sections that declare the routes, so a path it answers is a
 * path that exists. The type sits here rather than beside it so that a pure
 * function can take the resolver as an argument and stay pure. `activityTarget`
 * is the first of those.
 *
 * `null` for a resource this app did not mount, which a caller draws as text
 * rather than as a link that lands nowhere.
 */
export type PathOf = (name: string) => readonly string[] | null;
