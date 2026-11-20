import {
  HarvestRunMode,
  SourceProbeStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  PROBE_REAP_AFTER_MS,
  PROBE_TICK_MS,
} from './probes/source-probe.worker';
import {
  PROBE_DID_NOT_FINISH,
  PROBE_VALID_MS,
  PROBE_WAIT_MS,
  decideProbeGate,
  gateNote,
  judgeGateProbe,
  readGateNote,
  runFetchesChain,
  waitIsOver,
  type GateProbe,
} from './schedule-probe-gate';

/**
 * The decision of the probe gate (plan 0247, section 2), with the clock
 * passed in.
 */

const NOW = new Date('2026-11-06T03:00:00.000Z');
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000);

function probe(over: Partial<GateProbe> = {}): GateProbe {
  return {
    id: 'probe-1',
    status: SourceProbeStatus.PASSED,
    startedAt: minutesAgo(1),
    error: null,
    ...over,
  };
}

function decide(
  probes: GateProbe[],
  over: Partial<Parameters<typeof decideProbeGate>[0]> = {}
) {
  return decideProbeGate({
    mode: HarvestRunMode.CATALOG_DISCOVERY,
    adapterKey: 'mercadona-api',
    probed: true,
    probes,
    now: NOW,
    ...over,
  });
}

describe('runFetchesChain', () => {
  it('is true for a catalog discovery of every chain', () => {
    expect(runFetchesChain(HarvestRunMode.CATALOG_DISCOVERY, 'deza-web')).toBe(
      true
    );
  });

  it('is true for a store discovery of a chain that lists its own stores, and false over OpenStreetMap', () => {
    expect(runFetchesChain(HarvestRunMode.STORE_DISCOVERY, 'lidl-api')).toBe(
      true
    );
    expect(runFetchesChain(HarvestRunMode.STORE_DISCOVERY, 'deza-web')).toBe(
      true
    );
    expect(runFetchesChain(HarvestRunMode.STORE_DISCOVERY, 'osm-places')).toBe(
      false
    );
  });

  it('is false for a file import', () => {
    expect(runFetchesChain(HarvestRunMode.FILE_IMPORT, 'mercadona-api')).toBe(
      false
    );
  });
});

describe('decideProbeGate', () => {
  it('starts a file import and a store discovery over OpenStreetMap with no probe', () => {
    expect(decide([], { mode: HarvestRunMode.FILE_IMPORT })).toEqual({
      action: 'START',
    });
    expect(
      decide([], {
        mode: HarvestRunMode.STORE_DISCOVERY,
        adapterKey: 'osm-places',
        probed: false,
      })
    ).toEqual({ action: 'START' });
  });

  it('starts an adapter that has no probe at all', () => {
    expect(decide([], { adapterKey: 'manual', probed: false })).toEqual({
      action: 'START',
    });
  });

  it('starts with a PASSED probe 14 minutes old and probes first with one 16 minutes old', () => {
    expect(decide([probe({ startedAt: minutesAgo(14) })])).toEqual({
      action: 'START',
    });
    expect(decide([probe({ startedAt: minutesAgo(16) })])).toEqual({
      action: 'PROBE',
    });
  });

  it('counts the window from the start of the probe, inclusive', () => {
    expect(
      decide([probe({ startedAt: new Date(NOW.getTime() - PROBE_VALID_MS) })])
    ).toEqual({ action: 'START' });
  });

  it('reads past an ABORTED probe, also the newest over an older PASSED', () => {
    expect(
      decide([
        probe({ id: 'aborted', status: SourceProbeStatus.ABORTED }),
        probe({ id: 'passed', startedAt: minutesAgo(5) }),
      ])
    ).toEqual({ action: 'START' });
    expect(decide([probe({ status: SourceProbeStatus.ABORTED })])).toEqual({
      action: 'PROBE',
    });
  });

  it('does not start when the newest finished probe is red, even with a PASSED one behind it', () => {
    expect(
      decide([
        probe({ id: 'red', status: SourceProbeStatus.BLOCKED }),
        probe({ id: 'green', startedAt: minutesAgo(5) }),
      ])
    ).toEqual({ action: 'PROBE' });
  });

  it('waits for a RUNNING probe', () => {
    const running = probe({
      id: 'running',
      status: SourceProbeStatus.RUNNING,
      startedAt: minutesAgo(1),
    });
    expect(decide([running])).toEqual({ action: 'WAIT', probe: running });
  });

  it('gates a store discovery of a chain that lists its own stores', () => {
    expect(
      decide([], {
        mode: HarvestRunMode.STORE_DISCOVERY,
        adapterKey: 'deza-web',
      })
    ).toEqual({ action: 'PROBE' });
  });
});

describe('judgeGateProbe', () => {
  it('starts on PASSED', () => {
    expect(judgeGateProbe(probe())).toEqual({ action: 'START' });
  });

  it.each([
    SourceProbeStatus.SHAPE_CHANGED,
    SourceProbeStatus.BLOCKED,
    SourceProbeStatus.UNREACHABLE,
    SourceProbeStatus.ERROR,
  ])('skips on %s with the probe and its status in the note', (status) => {
    expect(
      judgeGateProbe(probe({ id: 'p-9', status, error: 'listing: HTTP 403' }))
    ).toEqual({
      action: 'SKIP',
      note: `probe p-9 ${status}: listing: HTTP 403`,
    });
  });

  it('answers INTERRUPTED, not a skip, for an ABORTED probe', () => {
    expect(
      judgeGateProbe(
        probe({
          id: 'p-9',
          status: SourceProbeStatus.ABORTED,
          error: 'The harvester stopped during the probe.',
        })
      )
    ).toEqual({ action: 'INTERRUPTED', note: 'probe p-9 was aborted' });
  });

  it('skips a probe still RUNNING after the wait with the note of the plan', () => {
    const decision = judgeGateProbe(
      probe({ id: 'slow', status: SourceProbeStatus.RUNNING })
    );
    expect(decision).toEqual({
      action: 'SKIP',
      note: `${PROBE_DID_NOT_FINISH} (probe slow)`,
    });
  });
});

describe('waitIsOver', () => {
  it('outlasts the reaper by one tick of the probe worker', () => {
    expect(PROBE_WAIT_MS).toBe(PROBE_REAP_AFTER_MS + PROBE_TICK_MS);
    expect(PROBE_WAIT_MS).toBe(11 * 60_000);
  });

  it('ends at eleven minutes after the probe started, or when it finished', () => {
    const running = probe({
      status: SourceProbeStatus.RUNNING,
      startedAt: minutesAgo(5),
    });
    expect(waitIsOver(running, NOW)).toBe(false);
    // Past the reaper's ten minutes and inside its next tick: still waiting.
    expect(
      waitIsOver(
        running,
        new Date(minutesAgo(5).getTime() + PROBE_REAP_AFTER_MS + 30_000)
      )
    ).toBe(false);
    expect(
      waitIsOver(running, new Date(minutesAgo(5).getTime() + PROBE_WAIT_MS))
    ).toBe(true);
    expect(waitIsOver(probe(), NOW)).toBe(true);
  });
});

describe('gate notes', () => {
  it('reads back the probe, the status and the sentence', () => {
    const note = gateNote(
      probe({
        id: 'p-1',
        status: SourceProbeStatus.SHAPE_CHANGED,
        error: 'listing: 2 of 40 rows: price',
      })
    );
    expect(readGateNote(note)).toEqual({
      probeId: 'p-1',
      status: 'SHAPE_CHANGED',
      error: 'listing: 2 of 40 rows: price',
    });
  });

  it('reads no facts out of another note', () => {
    expect(readGateNote(`${PROBE_DID_NOT_FINISH} (probe x)`)).toBeNull();
    expect(readGateNote(null)).toBeNull();
  });

  it('says so when the probe recorded no sentence', () => {
    expect(
      gateNote(probe({ id: 'p', status: SourceProbeStatus.ERROR, error: null }))
    ).toBe('probe p ERROR: no sentence was recorded');
  });
});
