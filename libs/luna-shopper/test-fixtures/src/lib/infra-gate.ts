/**
 * The single gate for infrastructure backed Jest suites (plan 0015, section 3).
 *
 * It replaces the two identical per service copies that used to live in
 * `apps/luna-shopper-backend/{auth,core}/src/test/infra-gate.ts`. One definition
 * is the point: a gate with several copies cannot be reasoned about, and this one
 * decides whether a missing stack is a green skip or a red failure.
 *
 * Two environment variables drive it:
 *
 * - `LUNA_INTEGRATION` says the caller has a stack up and wants the specs to run.
 * - `LUNA_REQUIRE_STACK` says a stack was brought up on purpose (both CI tiers
 *   set it, and nothing else does). Where it is set, an intended skip becomes a
 *   failure: a suite that quietly skipped in CI would be a green check proving
 *   nothing, which is the exact hole plan 0015 exists to close.
 *
 * There is deliberately no skip path for an unreachable database. A spec that
 * opens its `DataSource` in `beforeAll` fails loudly when Postgres does not
 * answer, which is the behaviour we want under both flags. Do not add one.
 *
 * This module reaches for Jest globals, so it is exported from the
 * `@portfolio/luna-shopper/test-fixtures/jest` entry point rather than the
 * package barrel, which the Playwright suite also imports.
 */

/** Whether the caller has a stack up and asked for the gated specs to run. */
export function integrationEnabled(): boolean {
  return !!process.env['LUNA_INTEGRATION'];
}

/** Whether a stack was brought up on purpose, so a skip would be a lie. */
export function stackRequired(): boolean {
  return !!process.env['LUNA_REQUIRE_STACK'];
}

/**
 * `describe` for a suite that needs real infrastructure.
 *
 * With `LUNA_INTEGRATION` it is a plain `describe`. Without it, it is
 * `describe.skip` for a developer who has no Docker running, and a failing suite
 * when `LUNA_REQUIRE_STACK` says CI meant to run it. That failure is reported as
 * a test rather than thrown at import time, so the run still produces a Jest
 * summary naming the suite that could not run.
 */
export const describeIntegration: (name: string, fn: () => void) => void = (
  name,
  fn
) => {
  if (integrationEnabled()) {
    describe(name, fn);
    return;
  }

  if (stackRequired()) {
    describe(name, () => {
      it('requires the integration stack that CI asked for', () => {
        throw new Error(
          'LUNA_REQUIRE_STACK is set but LUNA_INTEGRATION is not, so this suite ' +
            'would have skipped. CI brings the compose stack up on purpose, so a ' +
            'skip here reports a pass that tested nothing. Set LUNA_INTEGRATION=1 ' +
            'after `docker compose up --wait` and the per service `migration:run`.'
        );
      });
    });
    return;
  }

  describe.skip(name, fn);
};

/**
 * Read a variable an integration spec cannot run without, failing with the name
 * rather than letting the driver report a confusing "undefined connection".
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Integration specs read it from the service's .env, ` +
        "which Nx loads for that project's targets; run the slot script, or " +
        'export it, before `nx run <svc>:test-integration`.'
    );
  }
  return value;
}
