/**
 * The keys the resource screens read off their route.
 *
 * Constants rather than string literals typed twice, because a mistyped route
 * `data` key is not a compile error anywhere: the route would carry a property
 * nobody reads and the page would find `undefined` where a descriptor should be.
 */

/** Route `data` key holding the {@link ResourceDescriptor} for the screen. */
export const RESOURCE_DESCRIPTOR = 'descriptor';

/** Route `data` key holding `'create'` or `'edit'`. */
export const RESOURCE_FORM_MODE = 'mode';

/** Route parameter holding the row's id, on the edit route. */
export const RESOURCE_ID_PARAM = 'id';
