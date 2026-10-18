import { fakeLineStore, GatewayError } from '@portfolio/velista/data-access';
import type { Line } from '@portfolio/velista/models';
import { linePageStatus } from './line-context';

/**
 * Where a page about one line stands (velista 0156). The line page and the history
 * page both draw from this, so the states are asserted once, here, from the store.
 */

const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';

function line(id: string): Line {
  return { id, listId: LIST_ID, content: 'Milk' } as Line;
}

type Store = Parameters<typeof linePageStatus>[0];

function statusOf(
  options: Parameters<typeof fakeLineStore>[0],
  lineId = 'ln-1'
) {
  return linePageStatus(
    fakeLineStore(options) as unknown as Store,
    LIST_ID,
    lineId
  );
}

describe('linePageStatus', () => {
  it('is ready while the line is held', () => {
    expect(statusOf({ lines: [line('ln-1')] })).toBe('ready');
  });

  it('is loading until the list is read to its end', () => {
    expect(statusOf({ lines: [], state: 'loading' })).toBe('loading');
    expect(statusOf({ lines: [], complete: false })).toBe('loading');
  });

  it('is missing when the list is read to its end without the line', () => {
    // A deleted line and a line of another list both land here: only a backend
    // read could tell them apart.
    expect(statusOf({ lines: [line('ln-2')] })).toBe('missing');
  });

  it('is gone when the read of the lines was refused, or the list does not exist', () => {
    for (const [code, status] of [
      ['forbidden', 403],
      ['not_found', 404],
    ] as const) {
      expect(
        statusOf({
          lines: [],
          state: 'failed',
          error: new GatewayError({ code, status, correlationId: 'cid' }),
        })
      ).toBe('gone');
    }
  });

  it('is failed when the read did not answer, so a retry can help', () => {
    expect(
      statusOf({ lines: [], state: 'failed', error: new Error('offline') })
    ).toBe('failed');
    expect(
      statusOf({
        lines: [],
        state: 'failed',
        error: new GatewayError({
          code: 'internal',
          status: 500,
          correlationId: 'cid',
        }),
      })
    ).toBe('failed');
  });
});
