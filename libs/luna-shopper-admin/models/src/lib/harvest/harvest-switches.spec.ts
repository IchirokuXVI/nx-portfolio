import type { HarvestRun } from './harvest-run';
import {
  harvesterDeployed,
  harvestSwitches,
  type HarvestEvidence,
} from './harvest-switches';

function run(over: Partial<HarvestRun> = {}): HarvestRun {
  return {
    id: 'run-1',
    supermarketId: null,
    sourceId: null,
    mode: 'CATALOG_DISCOVERY',
    trigger: 'MANUAL',
    status: 'COMPLETED',
    requestedAt: '2026-09-03T09:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    totalPlanned: null,
    processed: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    notFound: 0,
    failed: 0,
    stage: null,
    stageLabel: null,
    abortRequestedAt: null,
    error: null,
    correlationId: null,
    requestedByUserId: null,
    ...over,
  };
}

const evidence = (over: Partial<HarvestEvidence> = {}): HarvestEvidence => ({
  deployment: 'development',
  reachable: null,
  spawnRefusal: null,
  recentRuns: [],
  ...over,
});

const stateOf = (given: HarvestEvidence, name: string) =>
  harvestSwitches(given).find((item) => item.name === name)?.state;

describe('harvesterDeployed', () => {
  /**
   * From the chart, which switches the harvester off in both clusters
   * deliberately. This is what lets an empty screen in production say "not
   * deployed here" rather than "there have been no runs".
   */
  it.each(['production', 'staging'] as const)(
    'is false in %s, where the chart renders nothing',
    (deployment) => {
      expect(harvesterDeployed(deployment)).toBe(false);
    }
  );

  it('is true in development, where the compose stack runs it', () => {
    expect(harvesterDeployed('development')).toBe(true);
  });

  /**
   * Both directions of not knowing answer the same way, and the direction is
   * the point. Claiming an absence about an environment this app cannot name
   * would explain away a real outage as expected.
   */
  it.each([null, undefined])('is true when the deployment is %p', (value) => {
    expect(harvesterDeployed(value)).toBe(true);
  });
});

describe('harvestSwitches', () => {
  it('names the three switches, in order', () => {
    expect(harvestSwitches(evidence()).map((item) => item.name)).toEqual([
      'deployed',
      'harvestEnabled',
      'mercadonaEnabled',
    ]);
  });

  /**
   * Nothing reports `HARVEST_ENABLED` or `MERCADONA_ENABLED`, so before anything
   * has been attempted the honest answer is that this app does not know. Both
   * default to false, so a guess of `off` would be right most of the time and
   * wrong exactly when somebody is working out why their run did nothing.
   */
  it('says it does not know the two it cannot read', () => {
    const given = evidence();

    expect(stateOf(given, 'harvestEnabled')).toBe('unknown');
    expect(stateOf(given, 'mercadonaEnabled')).toBe('unknown');
  });

  it('reads the harvester as off in a cluster the chart excludes it from', () => {
    expect(stateOf(evidence({ deployment: 'production' }), 'deployed')).toBe(
      'off'
    );
  });

  /** A reply outranks the chart: something is listening, whatever was rendered. */
  it('reads the harvester as on once anything has answered', () => {
    const given = evidence({ deployment: 'production', reachable: true });

    expect(stateOf(given, 'deployed')).toBe('on');
  });

  it('reads the harvester as off when nothing answered where it should have', () => {
    const given = evidence({ deployment: 'development', reachable: false });

    expect(stateOf(given, 'deployed')).toBe('off');
  });

  it('reads HARVEST_ENABLED as off from a refused spawn', () => {
    const given = evidence({ spawnRefusal: 'service-off' });

    expect(stateOf(given, 'harvestEnabled')).toBe('off');
  });

  /**
   * A run that started had to pass the same gate that answers 501 when the
   * switch is off, so its existence is the proof.
   */
  it('reads HARVEST_ENABLED as on from a run that started', () => {
    const given = evidence({
      recentRuns: [run({ startedAt: '2026-09-03T09:00:01.000Z' })],
    });

    expect(stateOf(given, 'harvestEnabled')).toBe('on');
  });

  /**
   * The storefront switch does not refuse the spawn. The run starts and the
   * runner refuses on its first step, so the evidence is on the finished run.
   */
  it('reads MERCADONA_ENABLED as off from a run that failed naming it', () => {
    const given = evidence({
      recentRuns: [
        run({
          status: 'FAILED',
          error:
            'MERCADONA_ENABLED is false, so this deployment does not fetch.',
        }),
      ],
    });

    expect(stateOf(given, 'mercadonaEnabled')).toBe('off');
  });

  it('reads MERCADONA_ENABLED as on from a run that fetched anything', () => {
    const given = evidence({
      recentRuns: [run({ mode: 'CATALOG_DISCOVERY', processed: 12 })],
    });

    expect(stateOf(given, 'mercadonaEnabled')).toBe('on');
  });

  /**
   * A store discovery reads OpenStreetMap and never touches the storefront, so
   * it says nothing at all about that switch.
   */
  it('learns nothing about MERCADONA_ENABLED from a store discovery', () => {
    const given = evidence({
      recentRuns: [run({ mode: 'STORE_DISCOVERY', processed: 340 })],
    });

    expect(stateOf(given, 'mercadonaEnabled')).toBe('unknown');
  });

  it('says where every state came from', () => {
    for (const item of harvestSwitches(evidence())) {
      expect(item.source).toMatch(/^harvest\.switch\.from\./);
    }
  });
});
