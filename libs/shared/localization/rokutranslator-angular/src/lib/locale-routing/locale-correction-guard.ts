import { localeGuard } from './locale-guard';

/**
 * **Transitional, deleted by the cleanup step of `apps/shell/plans/0003`.**
 *
 * The two guards merged into {@link localeGuard} (plan 0005 D6). This alias keeps the
 * apps that have not migrated yet compiling and behaving exactly as before, because
 * for a route under the shell's `:locale` the mount is empty and the merged guard's
 * locale slot is index 0, which is where the correction guard always looked.
 *
 * One behaviour does change for those apps, deliberately: a supported but non
 * canonical segment (`en-US`) is now rewritten to `en`. The guard this replaces
 * compared the *formatted* URL locale against the desired one, so the two were equal
 * and the region survived in the URL forever.
 *
 * @deprecated Install `localeGuard` with `mountPath` in the route `data` instead.
 */
export const localeCorrectionGuard = localeGuard;
