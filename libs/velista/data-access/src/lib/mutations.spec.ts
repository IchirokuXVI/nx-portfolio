import { TestBed } from '@angular/core/testing';
import { Mutations, overlayKey, type Overlay } from './mutations';

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
