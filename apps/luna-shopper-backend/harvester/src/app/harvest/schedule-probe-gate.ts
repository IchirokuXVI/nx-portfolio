import {
  HarvestRunMode,
  SourceProbeStatus,
  adapterCapabilities,
} from '@portfolio/luna-shopper/contracts';
import {
  PROBE_REAP_AFTER_MS,
  PROBE_TICK_MS,
} from './probes/source-probe.constants';

/**
 * Whether a scheduled run may start, by the newest probe of its chain (plan
 * 0247, section 2). Pure: no Nest, no database and no clock. The worker reads
 * the probes and runs or waits for one around these functions.
 *
 * The owner's rule of 2026-11-06: a scheduled run of a chain starts only after
 * a probe of the chain passed inside the last 15 minutes. A `PASSED` probe
 * that started inside that window lets the slot start at once. Else the slot
 * runs a probe first and is skipped when that probe is not `PASSED`, `ERROR`
 * included. A manual start is never gated.
 */

/** How long a `PASSED` probe lets a scheduled run start, from the probe's start. */
export const PROBE_VALID_MS = 15 * 60_000;

/**
 * How long the gate waits for a probe that is `RUNNING`, from that probe's
 * start: the reaper's ten minutes and one tick of the probe worker. A pod
 * killed during a probe leaves its row `RUNNING`, and the unique index lets
 * no new probe of the chain start until the reaper marks it. A wait that ran
 * out first would skip every slot of the chain in between. Derived from the
 * reaper's constant so the two cannot drift.
 */
export const PROBE_WAIT_MS = PROBE_REAP_AFTER_MS + PROBE_TICK_MS;

/** How often the gate reads a `RUNNING` probe while it waits. */
export const PROBE_POLL_MS = 5_000;

/** The note of a slot whose probe was still `RUNNING` after the wait. */
export const PROBE_DID_NOT_FINISH = 'a probe of the chain did not finish';

/** One probe as the gate reads it. */
export interface GateProbe {
  id: string;
  status: SourceProbeStatus;
  startedAt: Date;
  error: string | null;
}

/**
 * What the gate decides for a slot.
 *
 * `INTERRUPTED` is neither a start nor a skip: the probe the slot ran or
 * waited for ended `ABORTED`, or the harvester is stopping. An abort is not a
 * failure of the chain, so the worker writes no outcome and no alert, and the
 * retry after the restart decides the slot one time (plan 0206, section 7).
 */
export type ProbeGateDecision =
  | { action: 'START' }
  | { action: 'PROBE' }
  | { action: 'WAIT'; probe: GateProbe }
  | { action: 'SKIP'; note: string }
  | { action: 'INTERRUPTED'; note: string };

/**
 * Whether a run of this mode reads the chain's storefront (section 2, step 3).
 * A catalog discovery always does. A store discovery does when the adapter
 * publishes its own shop list, and is a radius over OpenStreetMap otherwise.
 * A file import reads nothing.
 */
export function runFetchesChain(
  mode: HarvestRunMode,
  adapterKey: string
): boolean {
  if (mode === HarvestRunMode.CATALOG_DISCOVERY) {
    return true;
  }
  if (mode === HarvestRunMode.STORE_DISCOVERY) {
    return adapterCapabilities(adapterKey).listsItsOwnStores;
  }
  return false;
}

/**
 * The decision before any probe runs (section 2, steps 3 to 5).
 *
 * `probes` are the probes of the source that are `RUNNING` or started inside
 * the window, newest first. `ABORTED` probes are read past: an abort says
 * nothing about the chain. `probed` says whether the adapter has a probe at
 * all; one with none cannot be gated.
 */
export function decideProbeGate(input: {
  mode: HarvestRunMode;
  adapterKey: string;
  probed: boolean;
  probes: readonly GateProbe[];
  now: Date;
}): ProbeGateDecision {
  if (!input.probed || !runFetchesChain(input.mode, input.adapterKey)) {
    return { action: 'START' };
  }
  const validFrom = input.now.getTime() - PROBE_VALID_MS;
  const finished = input.probes.find(
    (probe) =>
      probe.status !== SourceProbeStatus.RUNNING &&
      probe.status !== SourceProbeStatus.ABORTED
  );
  if (
    finished &&
    finished.status === SourceProbeStatus.PASSED &&
    new Date(finished.startedAt).getTime() >= validFrom
  ) {
    return { action: 'START' };
  }
  const running = input.probes.find(
    (probe) => probe.status === SourceProbeStatus.RUNNING
  );
  if (running) {
    return { action: 'WAIT', probe: running };
  }
  return { action: 'PROBE' };
}

/**
 * The decision after the slot ran a probe or waited for one (section 2,
 * steps 5 and 7). `PASSED` starts the run. A probe still `RUNNING` after the
 * wait is left to the reaper and skips the slot. An `ABORTED` probe says
 * nothing about the chain and answers `INTERRUPTED`. Every other status skips
 * the slot with the probe and its sentence in the note.
 */
export function judgeGateProbe(probe: GateProbe): ProbeGateDecision {
  if (probe.status === SourceProbeStatus.PASSED) {
    return { action: 'START' };
  }
  if (probe.status === SourceProbeStatus.ABORTED) {
    return { action: 'INTERRUPTED', note: `probe ${probe.id} was aborted` };
  }
  if (probe.status === SourceProbeStatus.RUNNING) {
    return {
      action: 'SKIP',
      note: `${PROBE_DID_NOT_FINISH} (probe ${probe.id})`,
    };
  }
  return { action: 'SKIP', note: gateNote(probe) };
}

/** Whether the gate stops waiting for a `RUNNING` probe at `now`. */
export function waitIsOver(probe: GateProbe, now: Date): boolean {
  return (
    probe.status !== SourceProbeStatus.RUNNING ||
    now.getTime() >= new Date(probe.startedAt).getTime() + PROBE_WAIT_MS
  );
}

/** `probe <id> <status>: <sentence>`, the note of a skipped slot. */
export function gateNote(probe: GateProbe): string {
  return `probe ${probe.id} ${probe.status}: ${
    probe.error ?? 'no sentence was recorded'
  }`;
}

/** What a gate note says, read back, or null for a note of another shape. */
export interface GateNoteFacts {
  probeId: string;
  status: string;
  error: string;
}

const GATE_NOTE = /^probe (\S+) ([A-Z_]+): ([\s\S]*)$/;

/** Read a note written by {@link gateNote}, or answer null. */
export function readGateNote(note: string | null): GateNoteFacts | null {
  const match = note ? GATE_NOTE.exec(note) : null;
  return match
    ? { probeId: match[1], status: match[2], error: match[3] }
    : null;
}
