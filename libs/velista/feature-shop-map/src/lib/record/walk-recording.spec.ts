import type { WalkEvent } from '@portfolio/luna-shopper/shop-map/model';
import {
  applyRigid,
  type RigidTransform,
} from '@portfolio/luna-shopper/shop-map/recorder';
import type { WalkEntryDraft } from '@portfolio/velista/data-access';
import type { ShopWalkEntryKind } from '@portfolio/velista/models';
import { compassAt, uprightPose } from '../shop-map.testing';
import { WalkRecording, type RecordingOutput } from './walk-recording';

/** Compass minus camera heading in the walk's frame. */
const OFFSET = 300;

interface Output extends RecordingOutput {
  readonly adds: { events: readonly WalkEvent[]; logTo: number }[];
  readonly pushes: WalkEntryDraft[];
  readonly opened: ShopWalkEntryKind[];
  readonly tones: string[];
  readonly baselines: number[];
  saves: number;
}

function output(): Output {
  let end = 0;
  // As `WalkEntrySaver` answers: the entry `openNext` named waits until
  // something is added.
  let waits = false;
  const out: Output = {
    adds: [],
    pushes: [],
    opened: [],
    tones: [],
    baselines: [],
    saves: 0,
    add(events, logTo) {
      out.adds.push({ events, logTo });
      end = Math.max(end, logTo);
      waits = false;
    },
    push(draft) {
      out.pushes.push(draft);
      end = Math.max(end, draft.logTo ?? end);
    },
    openNext: (kind) => {
      out.opened.push(kind);
      waits = true;
    },
    logEnd: () => end,
    sessionOpened: () => !waits,
    forgetNext: () => {
      waits = false;
    },
    save: () => (out.saves += 1),
    tone: (kind) => out.tones.push(kind),
    baseline: (degrees) => out.baselines.push(degrees),
  };
  return out;
}

function recording(out: Output, baseline: number | null = null) {
  let n = 0;
  return new WalkRecording({
    document: { version: 2, areas: [], marks: [], path: [] },
    settings: { idPrefix: 'live-' },
    baseline,
    output: out,
    createId: () => `id-${++n}`,
  });
}

const IDENTITY: RigidTransform = { rotation: 0, x: 0, y: 0 };

/**
 * Walks along +y at 1 m/s from `from` to `to` (milliseconds), facing the way
 * walked, ten poses a second, in the camera frame `frame` (the walk's own by
 * default), with the compass true to the walk's frame.
 */
function walk(
  rec: WalkRecording,
  from: number,
  to: number,
  options: {
    frame?: RigidTransform;
    startY?: number;
    heading?: number;
    still?: boolean;
    each?: (t: number) => void;
  } = {}
): void {
  const frame = options.frame ?? IDENTITY;
  const heading = options.heading ?? 0;
  for (let t = from; t < to; t += 100) {
    const y = options.still
      ? (options.startY ?? 0)
      : (options.startY ?? 0) + (t - from) / 1000;
    const raw = applyRigid(frame, { x: 0, y });
    rec.compass(compassAt(t, heading + OFFSET));
    rec.pose(uprightPose(t, raw.x, raw.y, heading + frame.rotation));
    options.each?.(t);
  }
}

function lose(rec: WalkRecording, from: number, to: number): void {
  for (let t = from; t < to; t += 100) {
    rec.compass(compassAt(t, OFFSET));
    rec.pose({
      t,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      tracked: false,
    });
  }
}

const paths = (out: Output) =>
  out.adds.flatMap(({ events }) =>
    events.flatMap((event) => (event.type === 'path' ? event.points : []))
  );

/** Velista `0129`, target 9: a session that adds nothing sends nothing. */
describe('WalkRecording, a visit with no change', () => {
  it('sends no entry for a first session stopped before it moved', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    // Three seconds standing: a point is kept every second.
    walk(rec, 0, 3_000, { still: true });
    rec.flush(false);
    rec.stopWalk('button');

    expect(rec.phase).toBe('stopped');
    expect(out.adds).toEqual([]);
    expect(out.pushes).toEqual([]);
  });

  it('sends no resumed and no stopped for a resume stopped at once', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 10_000);
    rec.stopWalk('button');
    const adds = out.adds.length;
    expect(out.pushes.map((draft) => draft.kind)).toEqual(['stopped']);

    rec.startProbe();
    walk(rec, 20_000, 22_000, { still: true, startY: 9.9 });
    expect(rec.resumeAt({ x: 0, y: 9.9, heading: 0 })).toBe(true);
    walk(rec, 22_000, 24_000, { still: true, startY: 9.9 });
    rec.stopWalk('button');

    expect(out.opened).toEqual(['started', 'resumed']);
    expect(out.adds).toHaveLength(adds);
    expect(out.pushes.map((draft) => draft.kind)).toEqual(['stopped']);
  });

  it('sends no entry when leaving the page ends a session that added nothing', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 1_000, { still: true });
    rec.stopWalk('left-page');

    expect(out.adds).toEqual([]);
    expect(out.pushes).toEqual([]);
  });

  it('holds the standing points until the session moves, then sends them all', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 2_000, { still: true });
    rec.flush();
    expect(out.adds).toEqual([]);

    walk(rec, 2_000, 4_000);
    rec.flush();
    const points = paths(out);
    expect(points[0]).toEqual([0, 0, 0]);
    expect(points.length).toBeGreaterThan(3);

    rec.stopWalk('button');
    expect(out.pushes.map((draft) => draft.kind)).toEqual(['stopped']);
  });

  it('sends a mark made while standing, with the point it was made at, and the stop', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 1_000, { still: true });
    rec.mark('note', 'Door');
    rec.stopWalk('button');

    const events = out.adds.flatMap((one) => one.events);
    expect(events.map((event) => event.type)).toEqual(['path', 'mark-put']);
    expect(out.pushes.map((draft) => draft.kind)).toEqual(['stopped']);
  });

  it('sends the stop of a session whose entry an edit on the page opened', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 1_000, { still: true });
    // The page adds an edit straight to the saver, which opens the entry.
    out.add([{ type: 'area-removed', id: 'a-1' }], 0);
    rec.stopWalk('button');

    expect(out.pushes.map((draft) => draft.kind)).toEqual(['stopped']);
  });

  it('forgets the kind of the session that ended, so a later edit is no resume', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    expect(out.sessionOpened()).toBe(false);
    rec.stopWalk('button');

    expect(out.sessionOpened()).toBe(true);
  });
});

describe('WalkRecording, a camera that has not found its place yet', () => {
  it('does not stop a first session over the untracked poses a camera opens with', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    // Five seconds before the first tracked pose: longer than a loss may last.
    lose(rec, 0, 5_000);

    expect(rec.phase).toBe('walking');
    expect(out.tones).toEqual([]);

    walk(rec, 5_000, 10_000);
    rec.stopWalk('button');

    expect(out.tones).toEqual([]);
    expect(out.pushes).toEqual([
      { kind: 'stopped', reason: 'button', logTo: 4_900 },
    ]);
    // Log time counts from the first tracked pose.
    expect(paths(out)[0]).toEqual([0, 0, 0]);
  });

  it('still stops a session that loses tracking after it had it', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    lose(rec, 0, 5_000);
    walk(rec, 5_000, 10_000);
    lose(rec, 10_000, 14_000);

    expect(rec.phase).toBe('stopped');
    expect(rec.stop).toBe('tracking-lost');
  });
});

describe('WalkRecording (velista 0126)', () => {
  it('keeps path points while tracking is good and learns the baseline', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 65_000, { each: () => undefined });
    rec.flush();

    expect(out.opened).toEqual(['started']);
    expect(rec.phase).toBe('walking');
    expect(out.baselines[0]).toBeCloseTo(OFFSET, 1);
    const points = paths(out);
    // A point once 0.25 m are walked: every third pose at 1 m/s.
    expect(points.length).toBeGreaterThan(200);
    expect(points[0]).toEqual([0, 0, 0]);
    expect(points[points.length - 1][2]).toBeCloseTo(64.9, 0);
    expect(out.adds[out.adds.length - 1].logTo).toBe(64_900);
  });

  it('puts a mark where the phone is, the way it points, at that moment', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 5_000, { heading: 90 });
    const mark = rec.mark('section', 'Lácteos');
    const snapshot = rec.flush();

    expect(mark).toMatchObject({
      kind: 'section',
      text: 'Lácteos',
      logMs: 4_900,
    });
    expect(mark?.heading).toBeCloseTo(90, 1);
    // Walking along +y and facing heading 90 (-x) is facing your right.
    expect(rec.pointing()).toBe('right');
    expect(
      out.adds.flatMap((one) => one.events).some((e) => e.type === 'mark-put')
    ).toBe(true);
    expect(snapshot.events.some((e) => e.type === 'mark-put')).toBe(true);
  });

  it('draws the purple path after an automatic resume and keeps it on yes', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 10_000);
    rec.flush();
    lose(rec, 10_000, 11_500);
    expect(rec.phase).toBe('lost');
    expect(out.tones).toEqual(['stopped']);
    expect(out.saves).toBe(1);

    walk(rec, 11_500, 15_000, { startY: 11.5 });
    expect(rec.phase).toBe('unconfirmed');
    expect(out.tones).toEqual(['stopped', 'resumed']);
    const before = paths(out).length;
    rec.flush();
    expect(paths(out).length).toBe(before);
    expect(rec.purple().length).toBeGreaterThan(10);
    expect(rec.person()).toBeNull();

    rec.confirm();

    expect(rec.phase).toBe('walking');
    expect(paths(out).length).toBeGreaterThan(before + 10);
    expect(out.pushes.map((one) => one.kind)).toEqual(['confirmed']);
    expect(out.opened).toEqual(['started', 'resumed']);
    expect(rec.purple()).toEqual([]);
  });

  it('stops at the problem on no, and saves nothing of the purple path', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 10_000);
    rec.flush();
    const saved = paths(out).length;
    lose(rec, 10_000, 11_500);
    walk(rec, 11_500, 15_000, { startY: 11.5 });

    rec.discard();

    expect(rec.phase).toBe('stopped');
    expect(rec.stop).toBe('discarded');
    expect(paths(out).length).toBe(saved);
    const [stopped, discarded] = out.pushes;
    expect(stopped).toMatchObject({ kind: 'stopped', reason: 'tracking-lost' });
    expect(discarded).toMatchObject({ kind: 'discarded' });
    // Kept up to the loss, and after every point kept before it.
    const last = paths(out)[saved - 1][0];
    expect(stopped.logTo).toBeGreaterThan(last);
    expect(stopped.logTo).toBeLessThan(10_600);
    expect(discarded.logTo).toBe(stopped.logTo);
  });

  it('stops the walk once tracking has been lost for 3 s, with one sound', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 10_000);
    lose(rec, 10_000, 14_000);

    expect(rec.phase).toBe('stopped');
    expect(rec.stop).toBe('tracking-lost');
    expect(out.tones).toEqual(['stopped']);
    expect(out.pushes).toEqual([
      expect.objectContaining({ kind: 'stopped', reason: 'tracking-lost' }),
    ]);
    expect(out.pushes[0].logTo).toBeLessThan(10_600);
  });

  it('resumes at a mark in a camera frame that turned, by the compass', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 65_000);
    walk(rec, 65_000, 67_000, { still: true, startY: 65, heading: 90 });
    const mark = rec.mark('section', 'Lácteos');
    lose(rec, 67_000, 71_000);
    expect(rec.phase).toBe('stopped');

    // The camera comes back turned 150 degrees and moved; the person stands
    // half a metre behind the mark, facing its arrow.
    const frame: RigidTransform = { rotation: 150, x: 7, y: -3 };
    rec.startProbe();
    walk(rec, 71_000, 78_000, {
      frame,
      still: true,
      startY: 65,
      heading: 90,
    });
    if (mark === null) {
      throw new Error('no mark');
    }
    expect(rec.resumeAt(mark)).toBe(true);
    walk(rec, 78_000, 79_000, { frame, still: true, startY: 65, heading: 90 });

    expect(rec.phase).toBe('walking');
    expect(out.opened).toEqual(['started', 'resumed']);
    const person = rec.person();
    // Half a metre behind the mark along its heading, facing the same way.
    expect(person?.heading).toBeCloseTo(90, 0);
    expect(person?.x).toBeCloseTo(mark.x + 0.5, 1);
    expect(person?.y).toBeCloseTo(mark.y, 1);
  });

  it('lines up by where the phone points when no baseline is known', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 3_000, { heading: 45 });
    const mark = rec.mark('counter', 'Horno');
    if (mark === null) {
      throw new Error('no mark');
    }
    rec.stopWalk('button');
    expect(out.pushes[0]).toMatchObject({ kind: 'stopped', reason: 'button' });

    rec.startProbe();
    const frame: RigidTransform = { rotation: -60, x: 2, y: 2 };
    walk(rec, 3_000, 4_000, { frame, still: true, startY: 2.9, heading: 45 });
    expect(rec.resumeAt(mark)).toBe(true);
    walk(rec, 4_000, 4_500, { frame, still: true, startY: 2.9, heading: 45 });

    expect(rec.person()?.heading).toBeCloseTo(45, 0);
  });

  it('keeps nothing of the purple path when the person stops meanwhile', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 10_000);
    lose(rec, 10_000, 11_500);
    walk(rec, 11_500, 15_000, { startY: 11.5 });

    rec.stopWalk('button');

    expect(out.pushes[0]).toMatchObject({ kind: 'stopped', reason: 'button' });
    expect(out.pushes[0].logTo).toBeLessThan(10_600);
    expect(paths(out).every(([logMs]) => logMs < 10_600)).toBe(true);
  });

  it('asks for nothing before a session starts and does nothing twice', () => {
    const out = output();
    const rec = recording(out);
    rec.stopWalk('left-page');
    expect(out.pushes).toEqual([]);
    rec.beginFirst();
    // Walked, so the session has an entry to stop (velista 0129, target 9).
    walk(rec, 0, 2_000);
    rec.stopWalk('left-page');
    rec.stopWalk('button');
    expect(out.pushes.map((one) => one.reason)).toEqual(['left-page']);
  });

  // Review of #576, item 1.
  it('turns a resume from the history by the stored baseline, not by pointing', () => {
    const out = output();
    const rec = recording(out, OFFSET);
    const mark = { x: 0, y: 10, heading: 90 };
    rec.startProbe();

    // The camera tracks, but the compass has said nothing yet: wait for it.
    const frame: RigidTransform = { rotation: 150, x: 7, y: -3 };
    const at = applyRigid(frame, { x: 0, y: 10 });
    rec.pose(uprightPose(0, at.x, at.y, 110 + frame.rotation));
    expect(rec.canResume).toBe(true);
    expect(rec.readyToResume).toBe(false);
    // One compass reading is not enough: the offset rests on a second of them.
    rec.compass(compassAt(50, 110 + OFFSET));
    rec.pose(uprightPose(60, at.x, at.y, 110 + frame.rotation));
    expect(rec.readyToResume).toBe(false);

    // The phone faces 110, not the mark's 90: pointing would be 20 degrees off.
    walk(rec, 100, 2_000, { frame, still: true, startY: 10, heading: 110 });
    expect(rec.readyToResume).toBe(true);
    expect(rec.resumeAt(mark)).toBe(true);
    walk(rec, 2_000, 2_500, { frame, still: true, startY: 10, heading: 110 });

    expect(out.opened).toEqual(['resumed']);
    expect(rec.person()?.heading).toBeCloseTo(110, 0);
  });

  // Review of #576, item 2.
  it('cannot resume on a pose from before the camera lost its place', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 3_000);
    lose(rec, 3_000, 7_000);

    expect(rec.phase).toBe('stopped');
    expect(rec.canResume).toBe(false);
    rec.startProbe();
    expect(rec.resumeAt({ x: 0, y: 1, heading: 0 })).toBe(false);
  });

  // Review of #576, item 3.
  it('stops a loss still waiting before a resume, so the resume follows a stop', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 5_000);
    lose(rec, 5_000, 6_000);
    expect(rec.phase).toBe('lost');

    rec.endSession();
    expect(rec.phase).toBe('stopped');
    expect(out.pushes).toEqual([
      expect.objectContaining({ kind: 'stopped', reason: 'tracking-lost' }),
    ]);
    expect(out.pushes[0].logTo).toBeLessThan(5_600);
  });

  it('discards an unconfirmed path before a resume, as "No, stop here" would', () => {
    const out = output();
    const rec = recording(out);
    rec.beginFirst();
    walk(rec, 0, 5_000);
    lose(rec, 5_000, 6_500);
    walk(rec, 6_500, 9_000, { startY: 6.5 });
    expect(rec.phase).toBe('unconfirmed');

    rec.startProbe();
    expect(rec.resumeAt({ x: 0, y: 9, heading: 0 })).toBe(true);

    expect(out.pushes.map((one) => [one.kind, one.reason])).toEqual([
      ['stopped', 'tracking-lost'],
      ['discarded', undefined],
    ]);
    expect(out.opened).toEqual(['started', 'resumed']);
  });
});
