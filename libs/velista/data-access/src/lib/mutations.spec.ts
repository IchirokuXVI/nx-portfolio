import { TestBed } from '@angular/core/testing';
import {
  provideFakeBrowserFacade,
  StorageKeys,
} from '@portfolio/velista/platform';
import { TimeoutError } from 'rxjs';
import { GatewayError, NetworkError } from './errors';
import {
  DROPPED_WRITES_KEPT,
  DroppedWrites,
  Mutations,
  overlayKey,
  type DroppedWriteDraft,
  type Overlay,
} from './mutations';

interface Line {
  id: string;
  content: string;
  version: number;
}

function contentOverlay(id: string, content: string): Overlay<unknown> {
  return {
    key: overlayKey(id, 'content'),
    fields: ['content'],
    apply: (current) => ({ ...(current as Line), content }),
  };
}

describe('Mutations', () => {
  let mutations: Mutations;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    mutations = TestBed.inject(Mutations);
  });

  it('reports success and drops the overlay', async () => {
    const overlay = contentOverlay('ln1', 'Oat milk');

    const outcome = await mutations.run(overlay, async () => ({
      id: 'ln1',
      content: 'Oat milk',
      version: 4,
    }));

    expect(outcome.state).toBe('succeeded');
    expect(mutations.claims(overlay.key)).toBe(false);
  });

  it('reports a failure rather than swallowing it, and drops the overlay', async () => {
    // `0003` requires a visible failure path on every mutation, and the component that
    // failed is often not the component that should show it.
    const overlay = contentOverlay('ln1', 'Oat milk');

    const outcome = await mutations.run(overlay, async () => {
      throw new Error('gateway said no');
    });

    expect(outcome.state).toBe('failed');
    expect(mutations.claims(overlay.key)).toBe(false);
  });

  it('reports overwritten when the version moved further than this write alone', async () => {
    // `0001` D6: the UI must show when a change was overwritten by someone else.
    const outcome = await mutations.run(
      contentOverlay('ln1', 'Oat milk'),
      async () => ({ id: 'ln1', content: 'Almond milk', version: 9 }),
      (line: Line) => line.version,
      4
    );

    expect(outcome.state).toBe('overwritten');
  });

  it('does not report overwritten for this write own version bump', async () => {
    const outcome = await mutations.run(
      contentOverlay('ln1', 'Oat milk'),
      async () => ({ id: 'ln1', content: 'Oat milk', version: 5 }),
      (line: Line) => line.version,
      4
    );

    expect(outcome.state).toBe('succeeded');
  });

  it('applies a pending overlay to a read', () => {
    const overlay = contentOverlay('ln1', 'Oat milk');
    void mutations.run(overlay, () => new Promise(() => undefined));

    const read = mutations.applyOverlays<Line>('ln1', {
      id: 'ln1',
      content: 'Milk',
      version: 4,
    });

    expect(read.content).toBe('Oat milk');
  });

  it('claims only the fields its overlay names, so an event can win elsewhere', () => {
    const overlay = contentOverlay('ln1', 'Oat milk');
    void mutations.run(overlay, () => new Promise(() => undefined));

    expect(mutations.claims(overlayKey('ln1', 'content'))).toBe(true);
    expect(mutations.claims(overlayKey('ln1', 'status'))).toBe(false);
  });

  it('tracks how many writes are in flight', async () => {
    expect(mutations.inFlight()).toBe(0);

    const pending = mutations.run(contentOverlay('ln1', 'a'), async () => 1);
    await pending;

    expect(mutations.inFlight()).toBe(0);
  });

  it('runs a write with no overlay at all', async () => {
    const outcome = await mutations.run(null, async () => 'ok');

    expect(outcome).toEqual({ state: 'succeeded', value: 'ok' });
  });
});

/**
 * The ledger of writes the network dropped (velista `0159`). A reload wipes the inline
 * note of a failed row, so the store writes what was lost where the next document of
 * this tab can read it.
 */
describe('a write the network dropped', () => {
  const PAGE = 'list:l1';

  function draft(
    overrides: Partial<DroppedWriteDraft> = {}
  ): DroppedWriteDraft {
    return {
      page: PAGE,
      subject: 'quantity:ln1',
      key: 'list.dropped.quantity',
      args: { name: 'Pan de pueblo', delta: '+1' },
      replay: { kind: 'line-quantity', lineId: 'ln1', delta: 1 },
      ...overrides,
    };
  }

  function build(online: boolean): {
    mutations: Mutations;
    ledger: DroppedWrites;
    session: Map<string, string>;
  } {
    TestBed.resetTestingModule();
    const session = new Map<string, string>();
    TestBed.configureTestingModule({
      providers: [
        provideFakeBrowserFacade(new Map(), {
          onLine: (() => online) as never,
          readSessionStorage: (key: string) => session.get(key) ?? null,
          writeSessionStorage: (key: string, value: string) =>
            void session.set(key, value),
          removeSessionStorage: (key: string) => void session.delete(key),
        }),
      ],
    });
    return {
      mutations: TestBed.inject(Mutations),
      ledger: TestBed.inject(DroppedWrites),
      session,
    };
  }

  it('keeps the replay of a write that failed before it was sent', async () => {
    // Offline when the request started: the browser refused it before it left, so
    // the server cannot have applied it and sending it again is safe.
    const { mutations, ledger } = build(false);

    const outcome = await mutations.run(
      null,
      async () => {
        throw new NetworkError('c1', 'lines.quantity');
      },
      undefined,
      undefined,
      draft()
    );

    expect(outcome.state).toBe('failed');
    const [entry] = ledger.take(PAGE);
    expect(entry).toMatchObject({
      key: 'list.dropped.quantity',
      args: { name: 'Pan de pueblo', delta: '+1' },
      replay: { kind: 'line-quantity', lineId: 'ln1', delta: 1 },
    });
  });

  it('keeps no replay when the request may have reached the server', async () => {
    // Online when it started, so the answer may have been lost on the way back. The
    // route has no idempotency key, and a second +1 would be a double increment.
    const { mutations, ledger } = build(true);

    await mutations.run(
      null,
      async () => {
        throw new NetworkError('c1', 'lines.quantity');
      },
      undefined,
      undefined,
      draft()
    );

    expect(ledger.take(PAGE)).toEqual([
      expect.objectContaining({ replay: null }),
    ]);
  });

  it('keeps no replay after a timeout', async () => {
    const { mutations, ledger } = build(false);

    await mutations.run(
      null,
      async () => {
        throw new TimeoutError();
      },
      undefined,
      undefined,
      draft()
    );

    expect(ledger.take(PAGE)).toEqual([
      expect.objectContaining({ replay: null }),
    ]);
  });

  it('writes nothing for a refusal the server answered', async () => {
    // A 4xx or a 5xx leaves no reload behind it, so the inline note on the row is
    // still there to say so.
    const { mutations, ledger, session } = build(false);

    await mutations.run(
      null,
      async () => {
        throw new GatewayError({
          code: 'internal',
          status: 500,
          correlationId: 'c1',
        });
      },
      undefined,
      undefined,
      draft()
    );

    expect(ledger.take(PAGE)).toEqual([]);
    expect(session.has(StorageKeys.droppedWrites)).toBe(false);
  });

  it('forgets a dropped write once the same change lands', async () => {
    const { mutations, ledger } = build(false);
    const fail = async (): Promise<never> => {
      throw new NetworkError('c1', 'lines.quantity');
    };
    await mutations.run(null, fail, undefined, undefined, draft());

    await mutations.run(null, async () => 'ok', undefined, undefined, draft());

    expect(ledger.take(PAGE)).toEqual([]);
  });

  it('clears what it read, and only for the page that read it', async () => {
    const { mutations, ledger } = build(false);
    const fail = async (): Promise<never> => {
      throw new NetworkError('c1', 'lines.quantity');
    };
    await mutations.run(null, fail, undefined, undefined, draft());
    await mutations.run(
      null,
      fail,
      undefined,
      undefined,
      draft({ page: 'list:l2', subject: 'quantity:ln2' })
    );

    expect(ledger.take(PAGE)).toHaveLength(1);
    expect(ledger.take(PAGE)).toEqual([]);
    expect(ledger.take('list:l2')).toHaveLength(1);
  });

  it('holds only the last few entries', async () => {
    const { mutations, ledger } = build(false);
    const fail = async (): Promise<never> => {
      throw new NetworkError('c1', 'lines.quantity');
    };
    for (let i = 0; i < DROPPED_WRITES_KEPT + 3; i++) {
      await mutations.run(
        null,
        fail,
        undefined,
        undefined,
        draft({
          subject: `quantity:ln${i}`,
          args: { name: `n${i}`, delta: '+1' },
        })
      );
    }

    const kept = ledger.take(PAGE);
    expect(kept).toHaveLength(DROPPED_WRITES_KEPT);
    expect(kept.at(-1)?.args['name']).toBe(`n${DROPPED_WRITES_KEPT + 2}`);
  });

  it('reads a ledger it cannot parse as empty', () => {
    const { ledger, session } = build(false);
    session.set(StorageKeys.droppedWrites, '{not json');

    expect(ledger.take(PAGE)).toEqual([]);
  });

  it('survives storage that refuses every call', async () => {
    TestBed.resetTestingModule();
    const refuse = (): never => {
      throw new Error('SecurityError');
    };
    TestBed.configureTestingModule({
      providers: [
        provideFakeBrowserFacade(new Map(), {
          onLine: (() => false) as never,
          readSessionStorage: refuse,
          writeSessionStorage: refuse,
          removeSessionStorage: refuse,
        }),
      ],
    });
    const mutations = TestBed.inject(Mutations);

    const outcome = await mutations.run(
      null,
      async () => {
        throw new NetworkError('c1', 'lines.quantity');
      },
      undefined,
      undefined,
      draft()
    );

    expect(outcome.state).toBe('failed');
    expect(TestBed.inject(DroppedWrites).take(PAGE)).toEqual([]);
  });
});
