/**
 * Integration tests run against real infrastructure (a throwaway Postgres, a real
 * NATS/JetStream) from the dev compose stack (plan 0010, section 1). They are
 * gated on `LUNA_INTEGRATION` so a machine without that infra runs zero of them —
 * a clean green skip — while CI sets the flag after `docker compose up`.
 *
 * Use it as the describe: `describeIntegration('...', () => { ... })`.
 */
export const describeIntegration = process.env.LUNA_INTEGRATION
  ? describe
  : describe.skip;
