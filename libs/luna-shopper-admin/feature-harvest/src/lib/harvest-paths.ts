/**
 * Where the harvester screens live, under the app root.
 *
 * In a module of its own rather than in `routes.ts`, because a screen that
 * links to another screen needs it and `routes.ts` imports every screen. The
 * cycle would resolve at runtime, since nothing reads the constant while a
 * module is still evaluating, but it would be a cycle nobody chose and the fix
 * is one line.
 */
export const HARVEST_SEGMENT = 'harvest';
