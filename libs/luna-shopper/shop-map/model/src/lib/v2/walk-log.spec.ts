import {
  elJamonDocument,
  elJamonLog,
  elJamonStop,
} from '../__fixtures__/el-jamon';
import { area, entry, mark, path } from './testing';
import type { ShopMapDocumentV2, WalkEntry, WalkEvent } from './types';
import { validateShopMapV2 } from './validate';
import { foldWalk, stateAt, walkTimeline } from './walk-log';

const texts = (d: ShopMapDocumentV2) => d.marks.map((m) => m.text).sort();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe('foldWalk', () => {
  it('folds an empty log to an empty document', () => {
    expect(foldWalk([])).toEqual({
      version: 2,
      areas: [],
      marks: [],
      path: [],
    });
  });

  it('starts a polyline with every started or resumed entry, and a stopped entry continues it', () => {
    const d = foldWalk([
      entry(1, 'started', 0, 2000, [path([0, 0, 0], [1000, 1, 0])]),
      entry(2, 'stopped', 2000, 3000, [path([2000, 2, 0])], {
        reason: 'button',
      }),
      entry(3, 'resumed', 3000, 5000, [path([3000, 5, 5]), path([4000, 6, 5])]),
    ]);
    expect(d.path).toEqual([
      {
        points: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      },
      {
        points: [
          [5, 5],
          [6, 5],
        ],
      },
    ]);
  });

  it('applies entries in seq order, whatever order they come in', () => {
    const log = [
      entry(2, 'edited', 1000, 1000, [
        { type: 'mark-put', mark: mark('a', 500, { text: 'moved', x: 3 }) },
      ]),
      entry(1, 'started', 0, 1000, [
        { type: 'mark-put', mark: mark('a', 500) },
      ]),
    ];
    expect(foldWalk(log).marks[0].text).toBe('moved');
  });

  it('puts, replaces and removes marks and areas by id', () => {
    const d = foldWalk([
      entry(1, 'started', 0, 1000, [
        { type: 'mark-put', mark: mark('m1', 100) },
        { type: 'mark-put', mark: mark('m2', 200) },
        { type: 'area-put', area: area('a1') },
        { type: 'area-put', area: area('a2') },
      ]),
      entry(2, 'edited', 1000, 1000, [
        { type: 'mark-removed', id: 'm1' },
        { type: 'area-put', area: area('a2', { w: 2 }) },
        { type: 'area-removed', id: 'a1' },
        { type: 'section-left', logMs: 1000 },
      ]),
    ]);
    expect(d.marks.map((m) => m.id)).toEqual(['m2']);
    expect(d.areas).toEqual([area('a2', { w: 2 })]);
  });

  it('never changes the entries it is given', () => {
    const log = deepFreeze(structuredClone(elJamonLog));
    expect(() => foldWalk(log)).not.toThrow();
    expect(log).toEqual(elJamonLog);
  });

  it('folds from a starting document the same as from the start', () => {
    for (const k of [1, 2, 6, 8]) {
      const head = foldWalk(elJamonLog.slice(0, k));
      expect(foldWalk(elJamonLog.slice(k), head)).toEqual(elJamonDocument);
    }
  });

  it('refuses a rewind or a discard that reaches before the starting document', () => {
    const head = foldWalk(elJamonLog.slice(0, 5));
    expect(() => foldWalk(elJamonLog.slice(5), head)).toThrow(
      /earlier snapshot/
    );
    const beforeDiscard = foldWalk(elJamonLog.slice(0, 3));
    expect(() => foldWalk(elJamonLog.slice(3), beforeDiscard)).toThrow(
      /earlier snapshot/
    );
  });
});

describe('stateAt', () => {
  const log: WalkEntry[] = [
    entry(1, 'started', 0, 3000, [
      path([0, 0, 0], [1000, 1, 0]),
      { type: 'mark-put', mark: mark('m1', 1000) },
      { type: 'area-put', area: area('suggested', { origin: 'suggested' }) },
      path([2000, 2, 0], [3000, 3, 0]),
      { type: 'mark-put', mark: mark('m2', 3000) },
    ]),
    entry(2, 'edited', 3000, 3000, [
      { type: 'area-put', area: area('drawn', { x: 5 }) },
      { type: 'mark-put', mark: mark('m1', 1000, { x: 9 }) },
    ]),
    entry(3, 'resumed', 3000, 5000, [path([3000, 10, 0], [5000, 12, 0])]),
  ];

  it('folds the events up to a log time', () => {
    const d = stateAt(log, 1500);
    expect(d.path).toEqual([
      {
        points: [
          [0, 0],
          [1, 0],
        ],
      },
    ]);
    expect(d.marks.map((m) => m.id)).toEqual(['m1']);
  });

  it('gives an event with no log time the time of the event before it', () => {
    expect(stateAt(log, 999).areas).toEqual([]);
    expect(stateAt(log, 1000).areas.map((a) => a.id)).toEqual(['suggested']);
  });

  it('folds an edit only once its logTo is reached', () => {
    expect(stateAt(log, 2999).marks[0].x).toBe(0);
    const at = stateAt(log, 3000);
    expect(at.marks.find((m) => m.id === 'm1')?.x).toBe(9);
    expect(at.areas.map((a) => a.id)).toEqual(['drawn', 'suggested']);
    expect(at.path).toHaveLength(2);
  });

  it('answers the whole fold past the end of the log', () => {
    expect(stateAt(log, Infinity)).toEqual(foldWalk(log));
    expect(stateAt(log, 5000)).toEqual(foldWalk(log));
  });
});

describe('rewinds', () => {
  const walked: WalkEntry[] = [
    entry(1, 'started', 0, 4000, [
      path([0, 0, 0], [1000, 1, 0], [2000, 2, 0], [3000, 3, 0], [4000, 4, 0]),
      { type: 'mark-put', mark: mark('early', 1000) },
      { type: 'mark-put', mark: mark('late', 3500) },
    ]),
  ];

  it('returns the map to a point of the log and continues from there', () => {
    const log = [
      ...walked,
      entry(2, 'rewound', 4000, 4000, [], { rewoundTo: 2000 }),
      entry(3, 'resumed', 4000, 6000, [path([4000, 2, 1], [6000, 2, 3])]),
    ];
    const d = foldWalk(log);
    expect(texts(d)).toEqual(['early']);
    expect(d.path).toEqual([
      {
        points: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      },
      {
        points: [
          [2, 1],
          [2, 3],
        ],
      },
    ]);
    // The history before the rewind is still there to slide over.
    expect(texts(stateAt(log, 3999))).toEqual(['early', 'late']);
  });

  it('rewinds past a rewind to the state that rewind produced', () => {
    const log = [
      ...walked,
      entry(2, 'rewound', 4000, 4000, [], { rewoundTo: 2000 }),
      entry(3, 'resumed', 4000, 6000, [
        path([4000, 2, 1], [5000, 2, 2], [6000, 2, 3]),
        { type: 'mark-put', mark: mark('after', 5500) },
      ]),
      entry(4, 'rewound', 6000, 6000, [], { rewoundTo: 5000 }),
    ];
    const d = foldWalk(log);
    expect(d).toEqual(stateAt(log.slice(0, 3), 5000));
    expect(texts(d)).toEqual(['early']);
    expect(d.path[1].points).toEqual([
      [2, 1],
      [2, 2],
    ]);
  });

  it('rewinds before an earlier rewind to the original history', () => {
    const log = [
      ...walked,
      entry(2, 'rewound', 4000, 4000, [], { rewoundTo: 2000 }),
      entry(3, 'rewound', 4000, 4000, [], { rewoundTo: 3600 }),
    ];
    // 3600 is before the first rewind's own log time, so it reads the walk.
    expect(texts(foldWalk(log))).toEqual(['early', 'late']);
  });
});

describe('discarded and confirmed', () => {
  const log = (last: 'discarded' | 'confirmed'): WalkEntry[] => [
    entry(1, 'started', 0, 2000, [
      path([0, 0, 0], [2000, 2, 0]),
      { type: 'area-put', area: area('kept') },
    ]),
    entry(2, 'stopped', 2000, 2000, [], { reason: 'tracking-lost' }),
    entry(3, 'resumed', 2000, 4000, [
      path([2000, 9, 9], [3000, 10, 9]),
      { type: 'mark-put', mark: mark('bad', 3000) },
      { type: 'area-put', area: area('kept', { w: 5 }) },
      { type: 'area-put', area: area('new') },
      { type: 'area-removed', id: 'gone' },
      path([4000, 11, 9]),
    ]),
    entry(4, last, 2000, 4000),
  ];

  it('discards the path, marks and areas of the unconfirmed segment', () => {
    const d = foldWalk(log('discarded'));
    expect(d.path).toEqual([
      {
        points: [
          [0, 0],
          [2, 0],
        ],
      },
    ]);
    expect(d.marks).toEqual([]);
    expect(d.areas).toEqual([area('kept')]);
  });

  it('keeps the segment in the history before the discard', () => {
    const d = stateAt(log('discarded'), 3999);
    expect(d.path).toHaveLength(2);
    expect(texts(d)).toEqual(['bad']);
  });

  it('keeps the segment when it is confirmed', () => {
    const d = foldWalk(log('confirmed'));
    expect(d.path).toHaveLength(2);
    expect(d.areas.map((a) => [a.id, a.w])).toEqual([
      ['kept', 5],
      ['new', 1],
    ]);
  });

  it('discards only what came at or after the automatic resume', () => {
    const entries = log('discarded');
    entries[3] = entry(4, 'discarded', 3000, 4000);
    const d = foldWalk(entries);
    expect(d.path[1].points).toEqual([[9, 9]]);
    expect(d.marks).toEqual([]);
  });
});

/** The log time of the last timed event of a list, for splitting an entry. */
function lastTime(events: WalkEvent[], fallback: number): number {
  let t = fallback;
  for (const ev of events) {
    if (ev.type === 'path' && ev.points.length > 0) {
      t = ev.points[ev.points.length - 1][0];
    } else if (ev.type === 'mark-put') t = ev.mark.logMs;
    else if (ev.type === 'section-left') t = ev.logMs;
  }
  return t;
}

/**
 * Splits the recording entries named by seq into `parts` saves each: the
 * first keeps its kind and every later one is `continued`. Seqs are renumbered.
 */
function splitSessions(
  log: WalkEntry[],
  seqs: number[],
  parts: number
): WalkEntry[] {
  const out: WalkEntry[] = [];
  for (const e of log) {
    if (!seqs.includes(e.seq)) {
      out.push({ ...e });
      continue;
    }
    const size = Math.ceil(e.events.length / parts);
    let from = e.logFrom;
    for (let k = 0; k < parts; k++) {
      const events = e.events.slice(k * size, (k + 1) * size);
      const to = k === parts - 1 ? e.logTo : lastTime(events, from);
      out.push({
        ...e,
        id: k === 0 ? e.id : `${e.id}-${k}`,
        kind: k === 0 ? e.kind : 'continued',
        logFrom: from,
        logTo: to,
        events,
      });
      from = to;
    }
  }
  return out.map((e, k) => ({ ...e, seq: k + 1 }));
}

describe('continued saves', () => {
  it('extend the polyline the session opened', () => {
    const d = foldWalk([
      entry(1, 'started', 0, 1000, [path([0, 0, 0], [1000, 1, 0])]),
      entry(2, 'continued', 1000, 2000, [path([2000, 2, 0])]),
      entry(3, 'continued', 2000, 3000, [path([3000, 3, 0])]),
      entry(4, 'stopped', 3000, 3000, [], { reason: 'button' }),
      entry(5, 'resumed', 3000, 4000, [path([3000, 9, 9])]),
      entry(6, 'continued', 4000, 5000, [path([5000, 10, 9])]),
    ]);
    expect(d.path.map((l) => l.points.length)).toEqual([4, 2]);
  });

  it('give their events their own log time', () => {
    const log = [
      entry(1, 'started', 0, 1000, [path([0, 0, 0])]),
      entry(2, 'continued', 1000, 3000, [
        { type: 'mark-put', mark: mark('m', 2000) },
        { type: 'area-put', area: area('a') },
      ]),
    ];
    expect(stateAt(log, 1999).marks).toEqual([]);
    expect(stateAt(log, 2000).areas.map((a) => a.id)).toEqual(['a']);
  });

  it('are discarded with the automatic resume they continue', () => {
    const d = foldWalk([
      entry(1, 'started', 0, 2000, [path([0, 0, 0], [2000, 2, 0])]),
      entry(2, 'stopped', 2000, 2000, [], { reason: 'tracking-lost' }),
      entry(3, 'resumed', 2000, 3000, [path([2000, 9, 9], [3000, 10, 9])]),
      entry(4, 'continued', 3000, 4000, [
        path([4000, 11, 9]),
        { type: 'mark-put', mark: mark('bad', 3500) },
        { type: 'area-put', area: area('bad') },
      ]),
      entry(5, 'continued', 4000, 5000, [path([5000, 12, 9])]),
      entry(6, 'discarded', 2000, 5000),
    ]);
    expect(d.path).toEqual([
      {
        points: [
          [0, 0],
          [2, 0],
        ],
      },
    ]);
    expect(d.marks).toEqual([]);
    expect(d.areas).toEqual([]);
  });

  it('carry a discard back to the entry that opened the session', () => {
    const d = foldWalk([
      entry(1, 'started', 0, 2000, [
        path([0, 0, 0]),
        { type: 'mark-put', mark: mark('kept', 1500) },
      ]),
      entry(2, 'continued', 2000, 3000, [path([3000, 3, 0])]),
      entry(3, 'discarded', 1000, 3000),
    ]);
    // The session opened at entry 1, so entry 1 is inside the segment too,
    // and the discard drops from its logFrom on.
    expect(d.marks).toEqual([]);
    expect(d.path).toEqual([{ points: [[0, 0]] }]);
  });

  it('sit on the timeline at their logTo', () => {
    const [, continued] = walkTimeline([
      entry(1, 'started', 0, 1000),
      entry(2, 'continued', 1000, 2000),
    ]);
    expect(continued).toMatchObject({ kind: 'continued', logMs: 2000 });
  });

  describe('the El Jamón walk saved every few minutes', () => {
    // Session 1, the automatic resume and the replayed tail, each as three saves.
    const split = splitSessions(elJamonLog, [1, 3, 7], 3);

    it('is the same log in more entries', () => {
      expect(split).toHaveLength(elJamonLog.length + 6);
      expect(split.filter((e) => e.kind === 'continued')).toHaveLength(6);
      const times = walkTimeline(split).map((m) => m.logMs);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('folds to the same map, the discard spanning three saves', () => {
      expect(foldWalk(split)).toEqual(elJamonDocument);
    });

    it('answers the same state at every point', () => {
      const points = [
        300_000, 900_000, 960_000, 1_011_924, 1_050_000, 1_095_000, 1_110_000,
        1_129_893,
      ];
      for (const t of points) {
        expect(stateAt(split, t)).toEqual(stateAt(elJamonLog, t));
      }
    });

    it('folds from a snapshot taken between two saves of a session', () => {
      expect(foldWalk(split.slice(2), foldWalk(split.slice(0, 2)))).toEqual(
        elJamonDocument
      );
    });

    it('refuses a discard whose session opened before the snapshot', () => {
      // Entries 5 to 7 are the automatic resume and its two saves.
      expect(split[4].kind).toBe('resumed');
      expect(() =>
        foldWalk(split.slice(5), foldWalk(split.slice(0, 5)))
      ).toThrow(/earlier snapshot/);
    });
  });
});

describe('walkTimeline', () => {
  it('answers one marker per entry in seq order', () => {
    const markers = walkTimeline(elJamonLog);
    expect(markers.map((m) => m.kind)).toEqual([
      'started',
      'stopped',
      'resumed',
      'discarded',
      'resumed',
      'rewound',
      'resumed',
      'rewound',
      'edited',
    ]);
    expect(markers[0]).toEqual({
      id: elJamonLog[0].id,
      seq: 1,
      kind: 'started',
      at: elJamonLog[0].at,
      logMs: 0,
      logFrom: 0,
      logTo: elJamonLog[0].logTo,
    });
    expect(markers[1].reason).toBe('tracking-lost');
    expect(markers[5].rewoundTo).toBe(elJamonLog[5].rewoundTo);
    const times = markers.map((m) => m.logMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('the El Jamón walk', () => {
  const log = elJamonLog;
  const byKind = (kind: WalkEntry['kind']) =>
    log.filter((e) => e.kind === kind);
  const markPuts = (entries: WalkEntry[]) =>
    entries.flatMap((e) => e.events).filter((e) => e.type === 'mark-put');

  it('is a log of about 100 KB with the walk path at one point per second', () => {
    expect(JSON.stringify(log).length).toBeLessThan(100_000);
    for (const e of log) {
      const times = e.events.flatMap((ev) =>
        ev.type === 'path' ? ev.points.map((p) => p[0]) : []
      );
      for (let k = 1; k < times.length - 1; k++) {
        expect(times[k] - times[k - 1]).toBeGreaterThanOrEqual(1000);
      }
    }
  });

  it('holds the 57 marks of the walk, one stop, one edit and two rewinds', () => {
    expect(markPuts(log.slice(0, 5))).toHaveLength(57);
    expect(byKind('stopped').map((e) => e.reason)).toEqual(['tracking-lost']);
    expect(byKind('edited')).toHaveLength(1);
    expect(byKind('rewound')).toHaveLength(2);
    expect(byKind('discarded')).toHaveLength(1);
    expect(log[1].logTo).toBe(Math.round(elJamonStop.wallMs));
  });

  it('folds to the expected document, which is valid', () => {
    const d = foldWalk(log);
    expect(d).toEqual(elJamonDocument);
    expect(JSON.stringify(foldWalk([...log].reverse()))).toBe(
      JSON.stringify(d)
    );
    expect(validateShopMapV2(d)).toEqual([]);
  });

  it('answers the map before the stop', () => {
    const d = stateAt(log, 900_000);
    expect(d.path).toHaveLength(1);
    expect(d.areas).toEqual([]);
    expect(d.marks.every((m) => m.logMs <= 900_000)).toBe(true);
    expect(texts(d)).not.toContain('Pastas');
    expect(d.marks).toHaveLength(
      markPuts([log[0]]).filter(
        (e) => e.type === 'mark-put' && e.mark.logMs <= 900_000
      ).length
    );
  });

  it('answers the turned segment inside it, and not after the discard', () => {
    const inside = stateAt(log, 960_000);
    expect(inside.path).toHaveLength(2);
    expect(texts(inside)).toContain('Pastas');
    const afterDiscard = stateAt(log.slice(0, 4), log[3].logTo);
    expect(afterDiscard.path).toEqual(
      stateAt(log.slice(0, 2), log[1].logTo).path
    );
    expect(texts(afterDiscard)).not.toContain('Pastas');
  });

  it('answers the state of each rewind after it', () => {
    const rewind1 = log[5];
    const rewind2 = log[7];
    // An entry that resumes at the rewind's log time starts in the same
    // millisecond, so "just after the rewind" is the log up to the rewind.
    const afterFirst = stateAt(log.slice(0, 6), rewind1.logTo);
    expect(afterFirst).toEqual(
      stateAt(log.slice(0, 5), rewind1.rewoundTo as number)
    );
    expect(afterFirst.path).toHaveLength(2);

    // Inside the replayed tail, past the first rewind and before the second.
    const between = stateAt(log, (rewind1.logTo + rewind2.logTo) / 2);
    expect(between.path).toHaveLength(3);
    const lacteos = (d: ShopMapDocumentV2) =>
      d.marks.filter((m) => m.text === 'Lácteos').length;
    expect(lacteos(between)).toBe(lacteos(afterFirst) + 1);

    const afterSecond = stateAt(log.slice(0, 8), rewind2.logTo);
    expect(afterSecond).toEqual(
      stateAt(log.slice(0, 7), rewind2.rewoundTo as number)
    );
    expect(lacteos(afterSecond)).toBe(lacteos(afterFirst));
    expect(afterSecond.areas).toEqual([]);
    expect(stateAt(log, rewind2.logTo)).toEqual(elJamonDocument);
  });
});
