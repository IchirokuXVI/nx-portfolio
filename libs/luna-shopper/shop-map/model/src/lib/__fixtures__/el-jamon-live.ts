import { createLiveMap } from '../v2/live-map';
import type { LiveSnapshot } from '../v2/live-types';
import type { ShopMapDocumentV2, WalkEvent } from '../v2/types';
import { foldWalk } from '../v2/walk-log';
import { elJamonLog } from './el-jamon';
import expectedLive from './el-jamon/expected-live.json';

/** When the replay taps every suggestion: 450 s into the first session. */
export const TAP_AT_MS = 450_000;

/** What replaying the El Jamón walk through the live map answers. */
export interface ElJamonLive {
  /** At {@link TAP_AT_MS} into the first session, before any suggestion is tapped. */
  atTap: {
    walkedCells: number;
    suggestions: LiveSnapshot['suggestions'];
  };
  /** The suggestions tapped then: every one of them, so the rest of the walk crosses some. */
  accepted: string[];
  /** After the manual resume to the end of the walk. */
  end: {
    walkedCells: number;
    suggestions: LiveSnapshot['suggestions'];
    sectionRun: LiveSnapshot['sectionRun'];
  };
  /** Every area and mark the events made, folded. */
  map: Pick<ShopMapDocumentV2, 'areas' | 'marks'>;
  /** How many events of each type. */
  eventCounts: Record<string, number>;
}

/**
 * Replays the recorded part of the El Jamón log (entries 1 to 5) through
 * `createLiveMap`, the way the recording screen would feed it: tracking is
 * `good` in both sessions, `lost` at the stop and `suspect` over the turned
 * frame of the automatic resume, which is then discarded. After the first
 * 450 s every suggestion is tapped, so the rest of the walk crosses some.
 */
export function replayElJamon(): ElJamonLive {
  const live = createLiveMap({
    document: { version: 2, areas: [], marks: [], path: [] },
    settings: { idPrefix: 'live-', idSeed: 1 },
  });
  const events: WalkEvent[] = [];
  let result: Partial<ElJamonLive> = {};
  const tap = () => {
    const s = live.snapshot();
    events.push(...s.events);
    result = {
      atTap: { walkedCells: s.walkedCells.length, suggestions: s.suggestions },
      accepted: s.suggestions.map((x) => x.id),
    };
    for (const id of result.accepted ?? []) live.acceptSuggestion(id);
    events.push(...live.snapshot().events);
  };
  for (const entry of elJamonLog.slice(0, 5)) {
    if (entry.kind === 'stopped') live.setTracking('lost');
    if (entry.kind === 'resumed') {
      live.setTracking(entry.seq === 3 ? 'suspect' : 'good');
    }
    for (const ev of entry.events) {
      if (ev.type === 'path') {
        for (const [logMs, x, y] of ev.points) {
          if (!result.atTap && logMs >= TAP_AT_MS) tap();
          live.push({ logMs, x, y });
        }
      } else if (ev.type === 'mark-put') {
        live.mark(ev.mark);
      } else if (ev.type === 'section-left') {
        live.sectionLeft();
      }
    }
    // Entry 3 is discarded: the host drops what the unconfirmed segment made.
    const drained = live.snapshot().events;
    if (entry.seq !== 3) events.push(...drained);
  }
  const s = live.snapshot();
  events.push(...s.events);
  const folded = foldWalk([
    {
      id: 'replay',
      seq: 1,
      kind: 'edited',
      at: '2026-09-29T10:42:42.258Z',
      logFrom: 0,
      logTo: 0,
      events,
    },
  ]);
  const eventCounts: Record<string, number> = {};
  for (const ev of events)
    eventCounts[ev.type] = (eventCounts[ev.type] ?? 0) + 1;
  return {
    ...(result as Pick<ElJamonLive, 'atTap' | 'accepted'>),
    end: {
      walkedCells: s.walkedCells.length,
      suggestions: s.suggestions,
      sectionRun: s.sectionRun,
    },
    map: { areas: folded.areas, marks: folded.marks },
    eventCounts,
  };
}

/** The answers checked on the plot and committed. */
export const elJamonLive = expectedLive as ElJamonLive;
