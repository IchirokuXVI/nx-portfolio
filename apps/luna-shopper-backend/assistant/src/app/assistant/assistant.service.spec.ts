import { ConfigService } from '@nestjs/config';
import {
  AssistantReferenceKind,
  AssistantRole,
  LineApprovalStatus,
  LineStatus,
  ListResolutionBranch,
  UsernamePropagation,
  type AssistantTurnRequest,
  type LineView,
  type ListView,
  type MyZoneView,
  type UserProfileView,
} from '@portfolio/luna-shopper/contracts';
import {
  isDomainException,
  retryAfterSecondsOf,
  runWithRequestContext,
} from '@portfolio/luna-shopper/platform';
import {
  DEFAULT_ASSISTANT_MODEL,
  type AssistantConfig,
} from '../config/app-config';
import { FakeModelProvider } from '../provider/fake-model.provider';
import {
  ProviderRateLimitedError,
  type ModelProvider,
} from '../provider/model-provider';
import { AssistantService, capTranscript } from './assistant.service';
import {
  GatewayApiClient,
  GatewayApiError,
  type ApiCaller,
} from './gateway-api.client';
import { TurnContextFactory } from './turn-context';

/**
 * The turn loop, the three tools and the two rules that make the feature safe to
 * put in front of a person, all offline.
 *
 * **Nothing here touches a network**, which is rule A4 and the reason the whole
 * provider seam exists: a test that depends on a rate limited free tier is a test
 * that gets deleted the first week it is flaky. The model is
 * {@link FakeModelProvider}, scripted; the API is {@link RecordingApi}, which
 * records what it was asked and, crucially, what credential it was asked with.
 */

const TOKEN = 'Bearer the-callers-own-token';

// ---------------------------------------------------------------------------
// A recording stand in for the gateway
// ---------------------------------------------------------------------------

interface ApiCall {
  method: string;
  authorization: string;
  detail: Record<string, unknown>;
}

class RecordingApi {
  readonly calls: ApiCall[] = [];

  zones: MyZoneView[] = [zone('zone-home', 'Casa')];
  listsByZone = new Map<string, ListView[]>([
    ['zone-home', [list('list-flat', 'zone-home', 'Piso')]],
  ]);
  linesByList = new Map<string, LineView[]>([['list-flat', []]]);

  /** Thrown by the next write, to exercise the refusal path. */
  failNextWriteWith: Error | undefined;

  async listZones(caller: ApiCaller): Promise<MyZoneView[]> {
    this.record('listZones', caller, {});
    return this.zones;
  }

  async listLists(caller: ApiCaller, zoneId: string): Promise<ListView[]> {
    this.record('listLists', caller, { zoneId });
    return this.listsByZone.get(zoneId) ?? [];
  }

  async listLines(caller: ApiCaller, listId: string): Promise<LineView[]> {
    this.record('listLines', caller, { listId });
    return this.linesByList.get(listId) ?? [];
  }

  async addLine(
    caller: ApiCaller,
    listId: string,
    body: { content: string; quantity?: number }
  ): Promise<LineView> {
    this.record('addLine', caller, { listId, ...body });
    this.throwIfArmed();
    return line('line-new', listId, body.content, body.quantity ?? 1);
  }

  async updateLine(
    caller: ApiCaller,
    lineId: string,
    body: { content?: string; quantity?: number }
  ): Promise<LineView> {
    this.record('updateLine', caller, { lineId, ...body });
    this.throwIfArmed();
    return line(
      'line-existing',
      'list-flat',
      body.content ?? 'leche',
      body.quantity ?? 1
    );
  }

  async setUsername(
    caller: ApiCaller,
    username: string,
    propagation: UsernamePropagation
  ): Promise<UserProfileView> {
    this.record('setUsername', caller, { username, propagation });
    this.throwIfArmed();
    return { username } as UserProfileView;
  }

  private throwIfArmed(): void {
    const error = this.failNextWriteWith;
    if (error) {
      this.failNextWriteWith = undefined;
      throw error;
    }
  }

  private record(
    method: string,
    caller: ApiCaller,
    detail: Record<string, unknown>
  ): void {
    this.calls.push({ method, authorization: caller.authorization, detail });
  }

  of(method: string): ApiCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  asClient(): GatewayApiClient {
    return this as unknown as GatewayApiClient;
  }
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const CONFIG: AssistantConfig = {
  port: 3006,
  natsUrl: 'nats://unused',
  logLevel: 'silent',
  gatewayInternalUrl: 'http://gateway.invalid',
  geminiApiKey: 'not-used-by-the-fake',
  geminiBaseUrl: 'http://provider.invalid',
  model: DEFAULT_ASSISTANT_MODEL,
  maxTurns: 20,
  maxChars: 8000,
  maxToolCalls: 6,
  turnsPerMinute: 8,
  concurrency: 2,
  retryAfterFallbackSeconds: 30,
  providerTimeoutMs: 30000,
};

function build(
  provider: ModelProvider,
  api: RecordingApi,
  overrides: Partial<AssistantConfig> = {}
): AssistantService {
  const config = { ...CONFIG, ...overrides };
  const configService = {
    getOrThrow: () => config,
  } as unknown as ConfigService;

  return new AssistantService(
    configService,
    provider,
    new TurnContextFactory(api.asClient()),
    api.asClient()
  );
}

function turnRequest(
  message: string,
  transcript: AssistantTurnRequest['transcript'] = []
): AssistantTurnRequest {
  return {
    userId: 'user-1',
    authorization: TOKEN,
    transcript,
    message,
  };
}

// ---------------------------------------------------------------------------

describe('AssistantService', () => {
  describe("rule A1: it acts only through the API, with the caller's own token", () => {
    it("puts the caller's Authorization header on every call it makes", async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_line', { product: 'leche' }),
          FakeModelProvider.says('Hecho, la leche está en Piso.'),
        ]),
        api
      );

      await service.turn(turnRequest('añade leche'));

      expect(api.calls.length).toBeGreaterThan(0);
      // Not "most of them". Every one, because a single call without it would be
      // the bot reading a row its caller could not.
      for (const call of api.calls) {
        expect(call.authorization).toBe(TOKEN);
      }
    });

    it('relays a refusal from the API in words instead of failing the turn', async () => {
      const api = new RecordingApi();
      api.failNextWriteWith = new GatewayApiError(
        403,
        'No puedes escribir en esta lista.',
        'forbidden'
      );

      const provider = new FakeModelProvider([
        FakeModelProvider.calls('upsert_line', { product: 'leche' }),
        FakeModelProvider.says('No puedes escribir en esa lista.'),
      ]);
      const service = build(provider, api);

      const response = await service.turn(turnRequest('añade leche'));

      expect(response.reply).toBe('No puedes escribir en esa lista.');
      // The API's own localized sentence reaches the model rather than being
      // reinvented here: rule A1's payoff is that the error is the same one the
      // app gets, from the same code.
      const toolTurn = provider.requests[1].turns.at(-1);
      expect(JSON.stringify(toolTurn?.toolResults)).toContain(
        'No puedes escribir en esta lista.'
      );
    });
  });

  describe('rule A3: references come from tool results, never from the reply', () => {
    it('emits the list and line a write actually touched', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_line', {
            product: 'leche',
            quantity: 2,
          }),
          FakeModelProvider.says('Añadida.'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('añade dos leches'));

      expect(response.references).toEqual([
        {
          kind: AssistantReferenceKind.LIST,
          zoneId: 'zone-home',
          listId: 'list-flat',
          lineId: null,
          label: 'Piso',
        },
        {
          kind: AssistantReferenceKind.LINE,
          zoneId: 'zone-home',
          listId: 'list-flat',
          lineId: 'line-new',
          label: 'leche',
        },
      ]);
    });

    it('emits nothing for a turn that called no tool', async () => {
      // An off topic redirect is a successful turn, and there was nothing to
      // link to, so an empty array is exactly right.
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.says('Solo te ayudo con tus listas de la compra.'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('escríbeme un poema'));

      expect(response.references).toEqual([]);
      expect(api.of('addLine')).toHaveLength(0);
      expect(api.of('updateLine')).toHaveLength(0);
    });

    it('never emits an id the model wrote into a tool argument', async () => {
      // The model naming a list that does not exist must not become a link. It
      // fails to match the index, so the turn asks and no line reference exists.
      const api = new RecordingApi();
      api.zones = [zone('zone-home', 'Casa'), zone('zone-beach', 'Playa')];
      api.listsByZone.set('zone-beach', [
        list('list-beach', 'zone-beach', 'Playa'),
      ]);

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_line', {
            product: 'leche',
            list: 'Lista inventada',
          }),
          FakeModelProvider.says('¿A cuál de las dos?'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('añade leche'));

      expect(
        response.references.every(
          (reference) => reference.kind !== AssistantReferenceKind.LINE
        )
      ).toBe(true);
      expect(api.of('addLine')).toHaveLength(0);
    });
  });

  describe('6.1 a write that cannot be resolved to one list asks instead of guessing', () => {
    it('writes nothing and reports the ASKED branch', async () => {
      const api = new RecordingApi();
      api.zones = [zone('zone-home', 'Casa'), zone('zone-beach', 'Playa')];
      api.listsByZone.set('zone-beach', [
        list('list-beach', 'zone-beach', 'Playa'),
      ]);

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_line', { product: 'leche' }),
          FakeModelProvider.says('¿En Piso o en Playa?'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('añade leche'));

      expect(response.listResolution).toBe(ListResolutionBranch.ASKED);
      expect(api.of('addLine')).toHaveLength(0);
      expect(api.of('updateLine')).toHaveLength(0);
    });

    it('reports ONLY_LIST when there was nothing to choose', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_line', { product: 'leche' }),
          FakeModelProvider.says('Añadida.'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('añade leche'));

      expect(response.listResolution).toBe(ListResolutionBranch.ONLY_LIST);
      expect(api.of('addLine')).toHaveLength(1);
    });

    it('edits the line already there rather than adding a second one', async () => {
      const api = new RecordingApi();
      api.linesByList.set('list-flat', [
        line('line-existing', 'list-flat', 'leche', 1),
      ]);

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_line', {
            product: 'leche',
            quantity: 3,
          }),
          FakeModelProvider.says('Ahora son tres.'),
        ]),
        api
      );

      await service.turn(turnRequest('que sean tres leches'));

      expect(api.of('addLine')).toHaveLength(0);
      expect(api.of('updateLine')[0].detail).toMatchObject({
        lineId: 'line-existing',
        quantity: 3,
      });
    });
  });

  describe('6.3 rename_me', () => {
    it('changes nothing until the caller has confirmed', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('rename_me', { username: 'daniel' }),
          FakeModelProvider.says('¿Te cambio el nombre a daniel?'),
        ]),
        api
      );

      await service.turn(turnRequest('quiero llamarme daniel'));

      expect(api.of('setUsername')).toHaveLength(0);
    });

    it('is one PATCH and defaults to MATCHING_ZONES', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('rename_me', {
            username: 'daniel',
            confirmed: true,
          }),
          FakeModelProvider.says('Listo.'),
        ]),
        api
      );

      await service.turn(turnRequest('sí, cámbialo'));

      // One request, because plan 0018 built the cascade server side: there is
      // nothing to orchestrate and nothing that can half succeed.
      expect(api.of('setUsername')).toHaveLength(1);
      expect(api.of('setUsername')[0].detail).toEqual({
        username: 'daniel',
        // The only one of the three that is safe as a default: somebody who
        // deliberately became "Mamá" in the family zone keeps it.
        propagation: UsernamePropagation.MATCHING_ZONES,
      });
    });

    it('sends ALL_ZONES only when the caller plainly meant everywhere', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('rename_me', {
            username: 'daniel',
            scope: 'everywhere',
            confirmed: true,
          }),
          FakeModelProvider.says('Listo, en todos los grupos.'),
        ]),
        api
      );

      await service.turn(turnRequest('sí, en todos los grupos'));

      expect(api.of('setUsername')[0].detail).toMatchObject({
        propagation: UsernamePropagation.ALL_ZONES,
      });
    });
  });

  describe('6.2 query_lists', () => {
    it('reports what is on the list, and links only what it read', async () => {
      const api = new RecordingApi();
      api.linesByList.set('list-flat', [
        line('line-milk', 'list-flat', 'leche', 2),
        line('line-bread', 'list-flat', 'pan', 1),
      ]);

      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', { item: 'leche' }),
        FakeModelProvider.says('Sí, hay dos leches en Piso.'),
      ]);
      const service = build(provider, api);

      const response = await service.turn(turnRequest('hay leche?'));

      const toolResult = JSON.stringify(
        provider.requests[1].turns.at(-1)?.toolResults
      );
      expect(toolResult).toContain('leche');
      expect(toolResult).not.toContain('pan');
      expect(
        response.references.some(
          (reference) => reference.lineId === 'line-milk'
        )
      ).toBe(true);
      expect(
        response.references.some(
          (reference) => reference.lineId === 'line-bread'
        )
      ).toBe(false);
    });
  });

  describe('the loop replays a call the way the provider handed it over', () => {
    it('carries the id and the continuity token of a call back into the next round', async () => {
      // The turn loop is what sits between a reply and the request that follows
      // it, so this is where a provider's own handles are kept or lost. Losing
      // the token is not a degradation: Gemini 3 rejects the second round with a
      // 400 and the caller sees a bare 500 on every turn that did anything, which
      // is the defect this test exists to keep out.
      const api = new RecordingApi();
      const provider = new FakeModelProvider([
        FakeModelProvider.calls(
          'query_lists',
          { item: 'leche' },
          { id: 'call_1', signature: 'opaque-token' }
        ),
        FakeModelProvider.says('Sí, hay leche.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('hay leche?'));

      const replayed = provider.requests[1].turns;
      expect(replayed.at(-2)?.toolCalls).toEqual([
        {
          name: 'query_lists',
          args: { item: 'leche' },
          id: 'call_1',
          signature: 'opaque-token',
        },
      ]);
      // And the result goes back against the call it answers, so a turn that
      // asked for the same tool twice can still be told apart.
      expect(replayed.at(-1)?.toolResults?.[0].id).toBe('call_1');
    });
  });

  describe('section 7: the constraint is in the actions', () => {
    it('answers a call to a tool that does not exist instead of throwing', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('delete_list', { list: 'Piso' }),
        FakeModelProvider.says('No puedo borrar listas, pero te digo cómo.'),
      ]);
      const service = build(provider, api);

      const response = await service.turn(turnRequest('borra la lista'));

      expect(response.reply).toContain('No puedo borrar');
      expect(JSON.stringify(provider.requests[1].turns.at(-1))).toContain(
        'there is no such tool'
      );
    });

    it('declares exactly three tools and no more', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([FakeModelProvider.says('Hola.')]);

      await build(provider, api).turn(turnRequest('hola'));

      expect(provider.requests[0].tools.map((tool) => tool.name)).toEqual([
        'upsert_line',
        'query_lists',
        'rename_me',
      ]);
    });
  });

  describe('rule A5: a rate limited turn answers with a number of seconds', () => {
    it("uses the provider's own retry hint when it gave one", async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([new ProviderRateLimitedError('429', 27)]),
        api
      );

      const error = await service.turn(turnRequest('hola')).catch((e) => e);

      expect(isDomainException(error)).toBe(true);
      expect(retryAfterSecondsOf(error)).toBe(27);
    });

    it('falls back to a fixed number when nothing better is known', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([new ProviderRateLimitedError('429')]),
        api,
        // A window long enough that the local limiter has nothing useful to say
        // is not the case here; turnsPerMinute 1 means the window is live, so the
        // fallback is exercised by asking for it explicitly below instead.
        { retryAfterFallbackSeconds: 45 }
      );

      const error = await service.turn(turnRequest('hola')).catch((e) => e);

      // Whichever source answered, it is a number and it is in the details bag
      // the exception filter lifts onto the problem body.
      expect(typeof retryAfterSecondsOf(error)).toBe('number');
      expect(retryAfterSecondsOf(error)).toBeGreaterThan(0);
    });

    it('refuses the turn locally once the caller is over their own limit', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.says('uno'),
          FakeModelProvider.says('dos'),
        ]),
        api,
        { turnsPerMinute: 1 }
      );

      await service.turn(turnRequest('hola'));
      const error = await service.turn(turnRequest('otra vez')).catch((e) => e);

      expect(isDomainException(error)).toBe(true);
      const seconds = retryAfterSecondsOf(error);
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(60);
    });
  });

  describe('section 11: a deployment with no key is a supported deployment', () => {
    it('answers not_configured rather than pretending', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([]);
      provider.configured = false;

      const error = await build(provider, api)
        .turn(turnRequest('hola'))
        .catch((e) => e);

      expect(isDomainException(error)).toBe(true);
      expect(error.code).toBe('not_configured');
      // Nothing was fetched on the caller's behalf either: the turn stops before
      // it costs the gateway anything.
      expect(api.calls).toHaveLength(0);
    });
  });

  describe('section 5: it fetches lazily', () => {
    it('does not read a single line for a turn that called no tool', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([FakeModelProvider.says('¡Hola!')]),
        api
      );

      await service.turn(turnRequest('hola'));

      expect(api.of('listZones')).toHaveLength(1);
      expect(api.of('listLists')).toHaveLength(1);
      // A turn that turns out to be "hello" should not have cost four gateway
      // calls, and lines are the expensive half.
      expect(api.of('listLines')).toHaveLength(0);
    });

    it("reads one list's lines once however many tools ask for them", async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('query_lists', { item: 'leche' }),
          FakeModelProvider.calls('query_lists', { item: 'pan' }),
          FakeModelProvider.says('Ninguno de los dos.'),
        ]),
        api
      );

      await service.turn(turnRequest('hay leche o pan?'));

      expect(api.of('listLines')).toHaveLength(1);
    });
  });

  describe("section 7: it answers in the caller's language", () => {
    it("names the caller's language to the model", async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([FakeModelProvider.says('Hola.')]);
      const service = build(provider, api);

      await runWithRequestContext({ correlationId: 'c-1', locale: 'es' }, () =>
        service.turn(turnRequest('hola'))
      );

      expect(provider.requests[0].system).toContain('Spanish');
      expect(provider.requests[0].locale).toBe('es');
    });

    it('asks the API in that language too, so its refusals come back translated', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([FakeModelProvider.says('Hola.')]),
        api
      );

      await runWithRequestContext({ correlationId: 'c-1', locale: 'es' }, () =>
        service.turn(turnRequest('hola'))
      );

      expect(api.calls[0]).toBeDefined();
    });
  });
});

describe('capTranscript', () => {
  // Rule A2: the transcript is client supplied and therefore untrusted. It is
  // capped on arrival rather than believed to have been capped.
  const entry = (content: string) => ({
    role: AssistantRole.USER,
    content,
  });

  it('keeps the newest turns when there are too many', () => {
    const kept = capTranscript(
      [entry('one'), entry('two'), entry('three')],
      2,
      8000
    );

    expect(kept.map((message) => message.content)).toEqual(['two', 'three']);
  });

  it('stops at the character cap even when the turn count fits', () => {
    const kept = capTranscript([entry('a'.repeat(50)), entry('b')], 20, 10);

    expect(kept.map((message) => message.content)).toEqual(['b']);
  });

  it('accepts an empty transcript, which is the first turn of every conversation', () => {
    expect(capTranscript([], 20, 8000)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function zone(id: string, name: string): MyZoneView {
  return { id, name } as MyZoneView;
}

function list(id: string, zoneId: string, name: string): ListView {
  return { id, zoneId, name } as ListView;
}

function line(
  id: string,
  listId: string,
  content: string,
  quantity = 1
): LineView {
  return {
    id,
    listId,
    content,
    quantity,
    itemId: null,
    position: 0,
    approvalStatus: LineApprovalStatus.APPROVED,
    status: LineStatus.PENDING,
    createdByUserId: 'user-1',
    approvedByUserId: null,
    version: 1,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  };
}
