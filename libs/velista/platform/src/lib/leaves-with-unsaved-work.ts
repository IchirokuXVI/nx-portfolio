/**
 * A page that asks before it is left with something unsent (velista `0123`):
 * the edit page now, and the recording screen of velista `0126`. Here and not in
 * either library, because the route guard in `feature-shell` and the pages in
 * `feature-shop-map` both name it, and neither may import the other.
 */
export interface LeavesWithUnsavedWork {
  /** True to leave. May save first, and may ask. */
  canLeave(): boolean | Promise<boolean>;
}
