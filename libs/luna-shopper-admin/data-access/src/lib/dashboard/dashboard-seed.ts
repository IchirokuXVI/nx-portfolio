import { HARVEST_RUN_SEED } from '../harvest/harvest-seed';
import type { DashboardDocument } from './dashboard-service';

/** The instant the seeded numbers were taken. Fixed, so a spec can name it. */
export const SEED_MEASURED_AT = '2026-09-03T10:00:00.000Z';

/**
 * The document the dashboard draws with nothing listening.
 *
 * Built to exercise the states the screen exists for rather than to look tidy: a
 * run still going, queues with rows in them on two chains and none on a third,
 * join requests waiting, and a failed admin sign in in the last day. Every one of
 * those is a branch on the screen, and a seed of zeros would leave all of them
 * undrawn for anybody not sitting in front of the compose stack.
 *
 * The run in flight is `HARVEST_RUN_SEED`'s own running run, so the dashboard
 * and the runs screen agree about what is happening rather than describing two
 * different harvesters.
 */
export const DASHBOARD_SEED: DashboardDocument = {
  measuredAt: SEED_MEASURED_AT,
  harvest: {
    running: HARVEST_RUN_SEED.find((run) => run.status === 'RUNNING') ?? null,
  },
};
