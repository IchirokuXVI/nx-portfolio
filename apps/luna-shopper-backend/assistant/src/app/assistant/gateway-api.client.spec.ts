import type { ConfigService } from '@nestjs/config';
import { MAX_PAGE_SIZE } from '@portfolio/luna-shopper/platform';
import { GatewayApiClient, GatewayApiError } from './gateway-api.client';

/**
 * The URLs this client actually builds.
 *
 * Everything above it is tested against a fake `GatewayApiClient`, which is right
 * for the turn loop and is also why nothing noticed that `listLines` asked for a
 * page of 200 against a cap of 100. The gateway answered 400, both tools that
 * read lines failed, and the reply said it could not do it — with no test in the
 * repository able to see the request that caused it. This file is the seam that
 * was missing: the request goes on the wire, and the wire is a stub.
 */
const CALLER = { authorization: 'Bearer caller-token', locale: 'es' } as const;

function build(): {
  api: GatewayApiClient;
  calls: { url: string; init: RequestInit }[];
  reply(body: unknown, status?: number): void;
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const replies: { body: unknown; status: number }[] = [];

  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift() ?? { body: { items: [] }, status: 200 };

    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
    };
  }) as unknown as typeof fetch;

  const config = {
    getOrThrow: () => ({ gatewayInternalUrl: 'http://gateway:3000' }),
  } as unknown as ConfigService;

  return {
    api: new GatewayApiClient(config),
    calls,
    reply: (body, status = 200) => void replies.push({ body, status }),
  };
}

const query = (url: string) => new URL(url).searchParams;

describe('GatewayApiClient', () => {
  it('never asks for more lines than a page may hold', async () => {
    // The defect, as a number. 200 was over `MAX_PAGE_SIZE` and every line read
    // came back 400, which `upsert_line` hits before it writes anything because
    // it reads the list to decide between an edit and an add.
    const { api, calls, reply } = build();
    reply({ items: [{ id: 'line-1' }], nextCursor: null });

    await api.listLines(CALLER, 'list-1');

    const limit = Number(query(calls[0].url).get('limit'));
    expect(limit).toBe(MAX_PAGE_SIZE);
    expect(limit).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it('follows the cursor, because a page boundary is not an answer', async () => {
    // What the tools report is on a list has to be what is on it, not what fitted
    // in one page.
    const { api, calls, reply } = build();
    reply({ items: [{ id: 'line-1' }], nextCursor: 'page-2' });
    reply({ items: [{ id: 'line-2' }], nextCursor: null });

    const lines = await api.listLines(CALLER, 'list-1');

    expect(lines.map((line) => line.id)).toEqual(['line-1', 'line-2']);
    expect(query(calls[0].url).get('cursor')).toBeNull();
    expect(query(calls[1].url).get('cursor')).toBe('page-2');
  });

  it('stops walking rather than following a cursor that never ends', async () => {
    const { api, calls, reply } = build();
    for (let page = 0; page < 20; page += 1) {
      reply({ items: [{ id: `line-${page}` }], nextCursor: 'more' });
    }

    await api.listLines(CALLER, 'list-1');

    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it('puts the caller own token on every request, verbatim (rule A1)', async () => {
    const { api, calls, reply } = build();
    reply({ items: [], nextCursor: null });
    reply({ id: 'line-1', content: 'pan' });

    await api.listLines(CALLER, 'list-1');
    await api.addLine(CALLER, 'list-1', { content: 'pan' });

    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer caller-token');
      expect(headers['accept-language']).toBe('es');
    }
  });

  it('lifts the status and the API own sentence off a refusal', async () => {
    // The bot relays what the platform already said, in the caller's language,
    // rather than inventing a second translation of the same fact.
    const { api, reply } = build();
    reply(
      { message: 'No puedes escribir en esta lista.', code: 'forbidden' },
      403
    );

    await expect(
      api.addLine(CALLER, 'list-1', { content: 'pan' })
    ).rejects.toMatchObject({
      status: 403,
      apiMessage: 'No puedes escribir en esta lista.',
      code: 'forbidden',
    });
  });

  it('still reports the status when nothing in front of the gateway sent JSON', async () => {
    const { api, reply } = build();
    reply(undefined, 502);
    (global.fetch as jest.Mock).mockImplementationOnce(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    }));

    const failure = await api
      .listZones(CALLER)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GatewayApiError);
    expect((failure as GatewayApiError).status).toBe(502);
  });
});
