import type {
  StreamName,
  WalkFile,
  WalkMark,
} from '@portfolio/luna-shopper/shop-map/recorder';

/** What a walk is before its first row: everything the host knows at Start. */
export type WalkHeader = Omit<
  WalkFile,
  'durationMs' | 'streams' | 'marks' | 'events' | 'origin'
>;

/** A walk event, section 2's `events` entry. */
export type WalkEvent = WalkFile['events'][number];

/**
 * The rows added since the previous chunk. Saved to IndexedDB every few seconds, so
 * a closed tab or a crash loses at most one chunk of a walk.
 */
export interface WalkChunk {
  walkId: string;
  seq: number;
  streams: WalkFile['streams'];
  marks: WalkMark[];
  events: WalkEvent[];
  origin?: WalkFile['origin'];
  durationMs: number;
}

/**
 * The walk file being written, row by row.
 *
 * Framework free and blind to the browser: the capture service turns events into
 * rows and hands them here, so what a walk contains can be tested with no sensor.
 * Rows are appended in arrival order, and every source stamps them from one
 * monotonic clock, which is what keeps each stream in `t` order (section 2).
 */
export class WalkBuilder {
  private readonly _streams: WalkFile['streams'] = {};
  private readonly _marks: WalkMark[] = [];
  private readonly _events: WalkEvent[] = [];
  private _origin: WalkFile['origin'];
  private _durationMs = 0;

  /** How far each list has been handed out in chunks. */
  private readonly _drained = new Map<string, number>();
  private _seq = 0;

  constructor(readonly header: WalkHeader) {}

  get id(): string {
    return this.header.id;
  }

  get marks(): readonly WalkMark[] {
    return this._marks;
  }

  get events(): readonly WalkEvent[] {
    return this._events;
  }

  /** How many rows a stream holds, for the screen's own counters. */
  count(stream: StreamName): number {
    return this._streams[stream]?.length ?? 0;
  }

  push(stream: StreamName, row: number[] | number): void {
    if (stream === 'steps') {
      const list = (this._streams.steps ??= []);
      list.push(typeof row === 'number' ? row : row[0]);
      return;
    }

    if (typeof row === 'number') {
      return;
    }

    const list = (this._streams[stream] ??= []) as number[][];
    list.push(row);
  }

  mark(mark: WalkMark): void {
    this._marks.push(mark);
  }

  event(event: WalkEvent): void {
    this._events.push(event);
  }

  /** The first fix only: section 2 says the origin is the first location that arrived. */
  offerOrigin(origin: NonNullable<WalkFile['origin']>): void {
    if (this._origin === undefined) {
      this._origin = origin;
    }
  }

  get origin(): WalkFile['origin'] {
    return this._origin;
  }

  setDuration(ms: number): void {
    this._durationMs = Math.max(this._durationMs, Math.round(ms));
  }

  /** Everything added since the previous call, numbered. */
  drainChunk(): WalkChunk {
    const streams: WalkFile['streams'] = {};

    for (const key of Object.keys(this._streams) as StreamName[]) {
      const list = this._streams[key] as unknown[];
      const from = this._drained.get(key) ?? 0;
      if (list.length > from) {
        (streams as Record<string, unknown[]>)[key] = list.slice(from);
        this._drained.set(key, list.length);
      }
    }

    const marksFrom = this._drained.get('#marks') ?? 0;
    const eventsFrom = this._drained.get('#events') ?? 0;
    this._drained.set('#marks', this._marks.length);
    this._drained.set('#events', this._events.length);

    return {
      walkId: this.header.id,
      seq: this._seq++,
      streams,
      marks: this._marks.slice(marksFrom),
      events: this._events.slice(eventsFrom),
      origin: this._origin,
      durationMs: this._durationMs,
    };
  }

  /**
   * The walk file as it stands.
   *
   * `poseSource` names where the `pose` rows came from, so it is dropped when none
   * did: camera tracking that was asked for and never started leaves no claim behind.
   */
  toWalk(): WalkFile {
    const { poseSource, ...header } = this.header;
    const hasPose = (this._streams.pose?.length ?? 0) > 0;

    return {
      ...header,
      ...(hasPose && poseSource ? { poseSource } : {}),
      durationMs: this._durationMs,
      ...(this._origin ? { origin: this._origin } : {}),
      streams: this._streams,
      marks: [...this._marks],
      events: [...this._events],
    };
  }
}

/**
 * A walk put back together from its header and its chunks, which is how a walk
 * whose tab closed during recording is recovered.
 *
 * Chunks are applied in `seq` order whatever order they are given in, and a gap is
 * simply rows that never arrived.
 */
export function assembleWalk(
  header: WalkHeader,
  chunks: readonly WalkChunk[]
): WalkFile {
  const builder = new WalkBuilder(header);
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);

  for (const chunk of ordered) {
    for (const key of Object.keys(chunk.streams) as StreamName[]) {
      for (const row of chunk.streams[key] as (number[] | number)[]) {
        builder.push(key, row);
      }
    }
    chunk.marks.forEach((mark) => builder.mark(mark));
    chunk.events.forEach((event) => builder.event(event));
    if (chunk.origin) {
      builder.offerOrigin(chunk.origin);
    }
    builder.setDuration(chunk.durationMs);
  }

  return builder.toWalk();
}
