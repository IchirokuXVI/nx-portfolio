/**
 * Semantic convention attribute names that are still incubating.
 *
 * `@opentelemetry/semantic-conventions` publishes the stable attributes from its
 * root and the incubating ones from an `/incubating` subpath. That subpath is an
 * `exports` map entry, which TypeScript only resolves under `node16`, `nodenext`
 * or `bundler` module resolution; the Luna services are built with `commonjs` and
 * `node` resolution (see the workspace tsconfigs), so importing it typechecks
 * nowhere even though it resolves fine at runtime.
 *
 * Rather than change every service's module resolution for four strings, they are
 * pinned here. They are wire format constants and would be a breaking change for
 * any collector to alter, and "incubating" means the package makes no stability
 * promise about them anyway, so a copy is not a promise being broken. If one is
 * renamed upstream, this file is the one place to update.
 */

/** The messaging system the span describes. */
export const ATTR_MESSAGING_SYSTEM = 'messaging.system';

/** The destination a message was sent to or received from; here, the subject. */
export const ATTR_MESSAGING_DESTINATION_NAME = 'messaging.destination.name';

/** `publish`, `process`, `receive`, and so on. */
export const ATTR_MESSAGING_OPERATION_TYPE = 'messaging.operation.type';

/** Resource attribute naming the deployment environment. */
export const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = 'deployment.environment.name';
