import type { Deployment } from '../deployment';
import type { HarvestRun, RunBlockReason } from './harvest-run';
import { failureBlockReason } from './harvest-run';

/**
 * The three switches of plan 0006 section 3, and how much of each one this app
 * can honestly claim to know.
 *
 * They are three because they are three different decisions, and conflating
 * them in the UI would misrepresent what they mean. What the plan did not
 * account for is that only the first of the three is readable: the gateway
 * exposes no route reporting `HARVEST_ENABLED` or `MERCADONA_ENABLED`, and
 * section 1 of that plan says no backend change is needed. So this file states
 * the honest position for each, including where the answer is "not yet known",
 * and the screen renders that third state rather than a false `off`.
 *
 * Guessing `off` would be the worst available answer. Both default to false, so
 * a guess would be right most of the time and wrong exactly when an operator is
 * trying to work out why their run did nothing.
 */
export type SwitchState = 'on' | 'off' | 'unknown';

/** One switch, and the account of how its state was arrived at. */
export interface HarvestSwitch {
  /** Which of the three. Also the translation key suffix. */
  readonly name: 'deployed' | 'harvestEnabled' | 'mercadonaEnabled';
  readonly state: SwitchState;
  /** A translation key saying where the state came from. */
  readonly source: string;
}

/**
 * Whether the harvester exists in this deployment at all.
 *
 * Answered from the chart rather than from a probe, because the chart is where
 * the decision lives: `lunaShopperBackend.harvester.enabled` is false in both
 * `values.production.yaml` and `values.staging.yaml` on purpose, so nothing
 * renders in either cluster (plan 0006, section 4). That is a fixed property of
 * this repository, not a runtime accident, and it is the one of the three
 * switches this app can state without asking anybody.
 *
 * An unrecognised deployment answers `true`, and the direction matters. Saying
 * "not deployed" about an environment this app cannot name would explain away a
 * real outage as an expected absence, which is precisely the failure a screen
 * that degrades honestly exists to avoid.
 *
 * `undefined` is the environment read not having settled yet, and it answers
 * `true` for the same reason: a screen that drew "not deployed here" for the
 * fraction of a second before the gateway said which deployment it is would be
 * announcing an absence it had not yet checked.
 */
export function harvesterDeployed(
  deployment: Deployment | null | undefined
): boolean {
  return deployment !== 'production' && deployment !== 'staging';
}

/** What this app has learned about the switches, from what it has seen. */
export interface HarvestEvidence {
  /** `null` when the name is not one this app knows, `undefined` until it asks. */
  readonly deployment: Deployment | null | undefined;
  /** Whether any `admin/harvest` read has answered on this screen. */
  readonly reachable: boolean | null;
  /** A spawn that was refused, and what the refusal meant. */
  readonly spawnRefusal: RunBlockReason | null;
  /** The most recent finished runs, which is where a storefront refusal lands. */
  readonly recentRuns: readonly HarvestRun[];
}

/**
 * The three switches, in the order the screen shows them.
 *
 * Read the second and third from behaviour, because nothing reports them.
 * `HARVEST_ENABLED` false refuses a spawn with a 501, and `MERCADONA_ENABLED`
 * false lets the run start and fails it on its first step, so both leave a trace
 * that this app can read. Neither leaves one before anything has been tried,
 * and that case is `unknown`.
 */
export function harvestSwitches(
  evidence: HarvestEvidence
): readonly HarvestSwitch[] {
  return [
    deployedSwitch(evidence),
    harvestEnabledSwitch(evidence),
    mercadonaEnabledSwitch(evidence),
  ];
}

function deployedSwitch(evidence: HarvestEvidence): HarvestSwitch {
  // A read that answered outranks the chart. The chart says what a cluster
  // renders; a reply says what is actually listening, and on a development
  // machine those differ every time the compose stack is down.
  if (evidence.reachable === true) {
    return {
      name: 'deployed',
      state: 'on',
      source: 'harvest.switch.from.reply',
    };
  }
  if (!harvesterDeployed(evidence.deployment)) {
    return {
      name: 'deployed',
      state: 'off',
      source: 'harvest.switch.from.chart',
    };
  }
  if (evidence.reachable === false) {
    return {
      name: 'deployed',
      state: 'off',
      source: 'harvest.switch.from.silence',
    };
  }
  return {
    name: 'deployed',
    state: 'unknown',
    source: 'harvest.switch.from.nothing',
  };
}

function harvestEnabledSwitch(evidence: HarvestEvidence): HarvestSwitch {
  if (evidence.spawnRefusal === 'service-off') {
    return {
      name: 'harvestEnabled',
      state: 'off',
      source: 'harvest.switch.from.refusal',
    };
  }
  // A run that reached RUNNING is proof the switch was on when it started, and
  // it is the only proof available: the spawn that produced it had to pass the
  // same gate that answers 501 when the switch is off.
  if (evidence.recentRuns.some((run) => run.startedAt !== null)) {
    return {
      name: 'harvestEnabled',
      state: 'on',
      source: 'harvest.switch.from.run',
    };
  }
  if (
    evidence.recentRuns.some((run) => failureBlockReason(run) === 'service-off')
  ) {
    return {
      name: 'harvestEnabled',
      state: 'off',
      source: 'harvest.switch.from.failure',
    };
  }
  return {
    name: 'harvestEnabled',
    state: 'unknown',
    source: 'harvest.switch.from.nothing',
  };
}

function mercadonaEnabledSwitch(evidence: HarvestEvidence): HarvestSwitch {
  const catalogRuns = evidence.recentRuns.filter(
    (run) => run.mode === 'CATALOG_DISCOVERY' || run.mode === 'REFRESH'
  );

  if (catalogRuns.some((run) => failureBlockReason(run) === 'storefront-off')) {
    return {
      name: 'mercadonaEnabled',
      state: 'off',
      source: 'harvest.switch.from.failure',
    };
  }
  // Anything fetched at all is proof the storefront gate was open: the runner
  // refuses before its first request when the switch is off, so a run with a
  // processed count above zero could not have got there.
  if (catalogRuns.some((run) => run.processed > 0)) {
    return {
      name: 'mercadonaEnabled',
      state: 'on',
      source: 'harvest.switch.from.run',
    };
  }
  return {
    name: 'mercadonaEnabled',
    state: 'unknown',
    source: 'harvest.switch.from.nothing',
  };
}
