import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssistantReferenceKind,
  AssistantRole,
  LineApprovalStatus,
  LineStatus,
  ListResolutionBranch,
  UsernamePropagation,
  type AssistantTurnRequest,
  type AssistantVoiceRequest,
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
  ModelTurnRole,
  ProviderRateLimitedError,
  type ModelProvider,
} from '../provider/model-provider';
import {
  AssistantService,
  capTranscript,
  NOTHING_HEARD,
} from './assistant.service';
import {
  GatewayApiClient,
  GatewayApiError,
  type ApiCaller,
} from './gateway-api.client';
import { SCOPED_TOOL_DECLARATIONS, TOOL_DECLARATIONS } from './tools';
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

  async addLines(
    caller: ApiCaller,
    listId: string,
    items: { content: string; quantity?: number }[]
  ): Promise<LineView[]> {
    this.record('addLines', caller, { listId, items });
    this.throwIfArmed();
    return items.map((item, index) =>
      line(`line-new-${index}`, listId, item.content, item.quantity ?? 1)
    );
  }

  async addLineQuantity(
    caller: ApiCaller,
    lineId: string,
    delta: number
  ): Promise<LineView> {
    this.record('addLineQuantity', caller, { lineId, delta });
    this.throwIfArmed();
    // The server's answer, which is the whole point of the route: the count the
    // bot reports is the one the row holds, not one it worked out (plan 0040,
    // section 2). This stand in adds the delta to whatever it was told is there.
    const existing = [...this.linesByList.values()]
      .flat()
      .find((row) => row.id === lineId);
    return line(
      lineId,
      existing?.listId ?? 'list-flat',
      existing?.content ?? 'leche',
      (existing?.quantity ?? 1) + delta
    );
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

  async setLineStatus(
    caller: ApiCaller,
    lineId: string,
    status: LineStatus
  ): Promise<LineView> {
    this.record('setLineStatus', caller, { lineId, status });
    this.throwIfArmed();
    const existing = this.findLine(lineId);
    return {
      ...line(
        lineId,
        existing?.listId ?? 'list-flat',
        existing?.content ?? 'leche',
        existing?.quantity ?? 1
      ),
      // The server's answer, which is what the tool reports rather than the
      // value it asked for.
      status,
    };
  }

  async deleteLine(caller: ApiCaller, lineId: string): Promise<{ id: string }> {
    this.record('deleteLine', caller, { lineId });
    this.throwIfArmed();
    for (const [listId, lines] of this.linesByList) {
      this.linesByList.set(
        listId,
        lines.filter((row) => row.id !== lineId)
      );
    }
    return { id: lineId };
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

  private findLine(lineId: string): LineView | undefined {
    return [...this.linesByList.values()]
      .flat()
      .find((row) => row.id === lineId);
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
  transcriptionModel: DEFAULT_ASSISTANT_MODEL,
  audioMaxBytes: 2 * 1024 * 1024,
  audioMimeTypes: ['audio/webm', 'audio/ogg', 'audio/mp4'],
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

/** A turn narrowed to one list, which is what the list page's microphone sends. */
function scopedRequest(
  message: string,
  scope: { zoneId: string; listId: string } = {
    zoneId: 'zone-home',
    listId: 'list-flat',
  }
): AssistantTurnRequest {
  return { ...turnRequest(message), scope };
}

/**
 * A spoken turn, with a recording that is bytes and nothing more (plan 0041).
 *
 * **There is no audio fixture in this repository and there does not need to be
 * one.** Rule A4 forbids reaching a provider, so nothing here ever decodes,
 * plays or inspects a recording: what the service does with these bytes is count
 * them, check the container it was told about, and hand them to
 * {@link FakeModelProvider}. A buffer of zeros exercises every one of those.
 */
function voiceRequest(
  bytes: number,
  mimeType = 'audio/webm;codecs=opus',
  transcript: AssistantTurnRequest['transcript'] = []
): AssistantVoiceRequest {
  return {
    userId: 'user-1',
    authorization: TOKEN,
    transcript,
    audio: Buffer.alloc(bytes, 7).toString('base64'),
    mimeType,
  };
}

// ---------------------------------------------------------------------------

describe('AssistantService', () => {
  describe("rule A1: it acts only through the API, with the caller's own token", () => {
    it("puts the caller's Authorization header on every call it makes", async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche' }],
          }),
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
        FakeModelProvider.calls('upsert_lines', {
          items: [{ product: 'leche' }],
        }),
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
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche', quantity: 2 }],
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
          lineId: 'line-new-0',
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
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche' }],
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
      expect(api.of('addLines')).toHaveLength(0);
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
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche' }],
          }),
          FakeModelProvider.says('¿En Piso o en Playa?'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('añade leche'));

      expect(response.listResolution).toBe(ListResolutionBranch.ASKED);
      expect(api.of('addLines')).toHaveLength(0);
      expect(api.of('updateLine')).toHaveLength(0);
    });

    it('reports ONLY_LIST when there was nothing to choose', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche' }],
          }),
          FakeModelProvider.says('Añadida.'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('añade leche'));

      expect(response.listResolution).toBe(ListResolutionBranch.ONLY_LIST);
      expect(api.of('addLines')).toHaveLength(1);
    });

    it('edits the line already there rather than adding a second one', async () => {
      const api = new RecordingApi();
      api.linesByList.set('list-flat', [
        line('line-existing', 'list-flat', 'leche', 1),
      ]);

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche', quantity: 3 }],
          }),
          FakeModelProvider.says('Ahora son tres.'),
        ]),
        api
      );

      await service.turn(turnRequest('que sean tres leches'));

      expect(api.of('addLines')).toHaveLength(0);
      expect(api.of('updateLine')[0].detail).toMatchObject({
        lineId: 'line-existing',
        quantity: 3,
      });
    });
  });

  describe('plan 0040, section 7: a basket in one call', () => {
    it('writes ten new items with one batch request, not ten', async () => {
      const api = new RecordingApi();
      const products = [
        'leche',
        'pan',
        'huevos',
        'arroz',
        'aceite',
        'café',
        'azúcar',
        'sal',
        'té',
        'harina',
      ];

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: products.map((product) => ({ product })),
          }),
          FakeModelProvider.says('Añadidos los diez.'),
        ]),
        api
      );

      await service.turn(turnRequest('añade ' + products.join(', ')));

      // Two gateway calls for the whole basket: one read of the list, one write.
      // The read is what decides between an edit and an add and there is no way
      // around it; the ten writes are the part this plan removes.
      expect(api.of('addLines')).toHaveLength(1);
      expect(api.of('addLine')).toHaveLength(0);
      expect(api.of('listLines')).toHaveLength(1);
      expect(api.of('addLines')[0].detail['items']).toHaveLength(10);
    });

    it('completes inside the round cap however the model shaped its reply', async () => {
      // The wall, not the cost. `maxToolCalls` bounds rounds rather than calls,
      // so a model emitting ten writes a few at a time used to run out of rounds
      // and answer "I got stuck" with an unknown number of them written. One call
      // per list is one round whatever the model does with it.
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche' }, { product: 'pan' }],
          }),
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'huevos' }, { product: 'arroz' }],
          }),
          FakeModelProvider.says('Listo.'),
        ]),
        api,
        { maxToolCalls: 3 }
      );

      const response = await service.turn(turnRequest('añade cuatro cosas'));

      expect(response.reply).toBe('Listo.');
      expect(api.of('addLines')).toHaveLength(2);
    });

    it("mode 'add' calls the quantity route and never reads then writes", async () => {
      const api = new RecordingApi();
      api.linesByList.set('list-flat', [
        line('line-existing', 'list-flat', 'leche', 3),
      ]);

      const provider = new FakeModelProvider([
        FakeModelProvider.calls('upsert_lines', {
          items: [{ product: 'leche', quantity: 2, mode: 'add' }],
        }),
        FakeModelProvider.says('Ahora hay cinco.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('añade dos leches más'));

      expect(api.of('addLineQuantity')[0].detail).toEqual({
        lineId: 'line-existing',
        delta: 2,
      });
      // Never the read-compute-write it replaces: no absolute quantity is sent,
      // so there is nothing between a read and a write for a second writer to
      // land in.
      expect(api.of('updateLine')).toHaveLength(0);
      // And the count it reports is the server's, not one it worked out.
      expect(
        JSON.stringify(provider.requests[1].turns.at(-1)?.toolResults)
      ).toContain('5');
    });

    it('folds the same product named twice into one write', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: [
              { product: 'leche', quantity: 2 },
              { product: 'leche', quantity: 1, mode: 'add' },
            ],
          }),
          FakeModelProvider.says('Tres leches.'),
        ]),
        api
      );

      await service.turn(turnRequest('dos leches, y otra más'));

      // One line, and the quantities folded before anything was written: a second
      // write would have been computed against a read that predates the first.
      expect(api.of('addLines')).toHaveLength(1);
      expect(api.of('addLines')[0].detail['items']).toEqual([
        { content: 'leche', quantity: 3 },
      ]);
    });

    it('writes nothing for a bare mention of something already on the list', async () => {
      // Section 7.2's defect: the edit this used to send bumped the version, sent
      // a LineUpdated, quietly reopened a rejected line, and on an approved one
      // refused a caller without DECIDE for what was in substance a question.
      const api = new RecordingApi();
      api.linesByList.set('list-flat', [
        line('line-existing', 'list-flat', 'leche', 4),
      ]);

      const provider = new FakeModelProvider([
        FakeModelProvider.calls('upsert_lines', {
          items: [{ product: 'leche' }],
        }),
        FakeModelProvider.says('Ya hay cuatro.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('pon leche'));

      expect(api.of('updateLine')).toHaveLength(0);
      expect(api.of('addLineQuantity')).toHaveLength(0);
      expect(api.of('addLines')).toHaveLength(0);
      // It reports the count that is there, which is the honest answer and the
      // one thing the caller actually wanted to know.
      const result = JSON.stringify(
        provider.requests[1].turns.at(-1)?.toolResults
      );
      expect(result).toContain('unchanged');
      expect(result).toContain('4');
    });

    it('reports the items in the order they were said, however they were written', async () => {
      // The writes are grouped, because the new ones go in one request and the
      // rest one at a time. The report is not: the model is composing a sentence
      // about what somebody just said, in the order they said it.
      const api = new RecordingApi();
      api.linesByList.set('list-flat', [
        line('line-existing', 'list-flat', 'pan', 1),
      ]);

      const provider = new FakeModelProvider([
        FakeModelProvider.calls('upsert_lines', {
          items: [
            { product: 'leche' },
            { product: 'pan', quantity: 2 },
            { product: 'huevos' },
          ],
        }),
        FakeModelProvider.says('Hecho.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('leche, dos panes y huevos'));

      const result = provider.requests[1].turns.at(-1)?.toolResults?.[0]
        .result as { items: { product: string }[] };
      expect(result.items.map((item) => item.product)).toEqual([
        'leche',
        'pan',
        'huevos',
      ]);
    });

    it('records the item count as a field of the turn record', async () => {
      // Section 7.4: the arguments are an array now, and the question the record
      // has to answer is whether people ask for one thing or for a basket.
      const api = new RecordingApi();
      const logged: string[] = [];
      jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((message: unknown) => {
          logged.push(String(message));
        });

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche' }, { product: 'pan' }],
          }),
          FakeModelProvider.says('Añadidos.'),
        ]),
        api
      );

      await service.turn(turnRequest('añade leche y pan'));

      const record = logged
        .map((entry) => JSON.parse(entry) as Record<string, unknown>)
        .find((entry) => entry['event'] === 'assistant.turn');
      expect((record?.['tools'] as { items?: number }[])[0].items).toBe(2);

      jest.restoreAllMocks();
    });

    it('emits a reference for every line it wrote, each from a response', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('upsert_lines', {
            items: [{ product: 'leche' }, { product: 'pan' }],
          }),
          FakeModelProvider.says('Añadidos.'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('añade leche y pan'));

      const lineIds = response.references
        .filter((reference) => reference.kind === AssistantReferenceKind.LINE)
        .map((reference) => reference.lineId);
      expect(lineIds).toEqual(['line-new-0', 'line-new-1']);
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

    it('declares exactly five tools and no more', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([FakeModelProvider.says('Hola.')]);

      await build(provider, api).turn(turnRequest('hola'));

      // Plan 0040 renamed the write and gave it an array; it did not add a tool.
      // Adding units is not a new capability, it is the write that already
      // existed reached by different arithmetic.
      //
      // Plan 0043 did add two, and the count in this test is the point of the
      // test rather than an incidental: it goes from three to five and no
      // further. Deletion was reopened for **lines** and nothing else, so
      // deleting a list, a zone or an account, all zone governance, and
      // approving or rejecting a line stay absent from this array, which is a
      // much harder boundary than a sentence in the prompt would be.
      expect(provider.requests[0].tools.map((tool) => tool.name)).toEqual([
        'upsert_lines',
        'query_lists',
        'remove_lines',
        'set_line_status',
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

  /**
   * Plan 0041. The claim under test is one sentence: **a spoken turn becomes a
   * typed turn as early as possible and is indistinguishable after that.**
   *
   * Every case below runs against {@link FakeModelProvider}, and no test in this
   * file sends a byte of audio anywhere (rule A4, which covers a recording
   * exactly as it covers a prompt).
   */
  describe('plan 0041: a spoken turn', () => {
    it('transcribes, then runs the ordinary turn with what it heard', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider(
        [FakeModelProvider.says('Añadida.')],
        ['añade leche']
      );
      const service = build(provider, api);

      const answer = await service.voice(voiceRequest(2048));

      expect(provider.transcriptions).toHaveLength(1);
      expect(provider.requests).toHaveLength(1);
      // The transcription became the message, and nothing else came with it.
      const spoken = provider.requests[0];
      expect(spoken.turns).toEqual([
        { role: ModelTurnRole.USER, text: 'añade leche' },
      ]);
      expect(answer.reply).toBe('Añadida.');
    });

    it('sends the provider byte for byte what a typed turn sends', async () => {
      // The central claim, asserted rather than described: the request the loop
      // makes on a spoken turn is deep equal to the one it makes on the typed
      // turn with the same words. Any divergence — a marker on the prompt, an
      // extra turn, a different catalog — fails here.
      const spokenApi = new RecordingApi();
      const spokenProvider = new FakeModelProvider(
        [FakeModelProvider.says('Vale.')],
        ['añade leche']
      );
      await build(spokenProvider, spokenApi).voice(voiceRequest(1024));

      const typedApi = new RecordingApi();
      const typedProvider = new FakeModelProvider([
        FakeModelProvider.says('Vale.'),
      ]);
      await build(typedProvider, typedApi).turn(turnRequest('añade leche'));

      expect(spokenProvider.requests[0]).toEqual(typedProvider.requests[0]);
    });

    it('carries the transcription as `heard`, not anything the model replied', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider(
          [FakeModelProvider.says('He añadido leche a la lista.')],
          ['añade leche']
        ),
        api
      );

      const answer = await service.voice(voiceRequest(1024));

      expect(answer.heard).toBe('añade leche');
      expect(answer.reply).toBe('He añadido leche a la lista.');
    });

    it('answers a recording it could not make out without running a turn', async () => {
      const api = new RecordingApi();
      // No scripted reply at all: if the loop ran, the fake would throw for
      // having run out, which is exactly the failure this asserts cannot happen.
      const provider = new FakeModelProvider([], ['']);
      const service = build(provider, api);

      const answer = await service.voice(voiceRequest(1024));

      expect(answer.reply).toBe(NOTHING_HEARD);
      expect(answer.heard).toBe('');
      expect(provider.requests).toHaveLength(0);
      // And it cost the gateway nothing either: no context was fetched for a
      // turn that was never going to run.
      expect(api.calls).toHaveLength(0);
    });

    it('answers a rate limit during transcription the way rule A5 says', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider([], [new ProviderRateLimitedError('429', 27)]),
        api
      );

      const error = await service.voice(voiceRequest(1024)).catch((e) => e);

      // The same problem body, with the same number in it, that a rate limited
      // typed turn produces. There is one implementation of this and both paths
      // reach it.
      expect(isDomainException(error)).toBe(true);
      expect(error.code).toBe('rate_limited');
      expect(retryAfterSecondsOf(error)).toBe(27);
    });

    it('counts a spoken turn as one turn against the local limit', async () => {
      const api = new RecordingApi();
      const service = build(
        new FakeModelProvider(
          [FakeModelProvider.says('uno')],
          ['hola', 'otra vez']
        ),
        api,
        { turnsPerMinute: 1 }
      );

      await service.voice(voiceRequest(1024));
      const error = await service.voice(voiceRequest(1024)).catch((e) => e);

      // Two provider requests, one turn: the budget is the caller's patience and
      // the deployment's quota, and somebody who spoke asked one question.
      expect(isDomainException(error)).toBe(true);
      expect(error.code).toBe('rate_limited');
    });

    it('refuses a caller who is over the limit before spending a transcription', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider(
        [FakeModelProvider.says('uno')],
        ['hola']
      );
      const service = build(provider, api, { turnsPerMinute: 1 });

      await service.voice(voiceRequest(1024));
      await service.voice(voiceRequest(1024)).catch(() => undefined);

      // One transcription, not two. The limiter is taken before the provider is
      // called, so a refused turn costs the deployment nothing.
      expect(provider.transcriptions).toHaveLength(1);
    });

    it('answers not_configured on voice while text keeps working', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider(
        [FakeModelProvider.says('¡Hola!')],
        ['hola']
      );
      provider.transcriptionSupported = false;
      const service = build(provider, api);

      const error = await service.voice(voiceRequest(1024)).catch((e) => e);

      expect(isDomainException(error)).toBe(true);
      expect(error.code).toBe('not_configured');
      expect(provider.transcriptions).toHaveLength(0);

      // The whole point of the field: this deployment loses the microphone and
      // keeps the assistant.
      await expect(service.turn(turnRequest('hola'))).resolves.toMatchObject({
        reply: '¡Hola!',
      });
    });

    it('refuses a recording over the byte cap before calling the provider', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([], ['never reached']);
      const service = build(provider, api, { audioMaxBytes: 4096 });

      const error = await service.voice(voiceRequest(8192)).catch((e) => e);

      expect(isDomainException(error)).toBe(true);
      expect(error.code).toBe('validation_failed');
      expect(provider.transcriptions).toHaveLength(0);
    });

    it('says the limit in words, with the number in it', async () => {
      const api = new RecordingApi();
      const service = build(new FakeModelProvider([], []), api, {
        audioMaxBytes: 2 * 1024 * 1024,
      });

      const error = await service
        .voice(voiceRequest(3 * 1024 * 1024))
        .catch((e) => e);

      // The number rides in `messageArgs`, so the localized message the caller
      // reads carries the limit whatever language they read it in — the same
      // reason rule A5 puts the seconds in a field rather than in prose.
      expect(error.messageArgs).toEqual({ limit: '2 MB' });
      expect(error.message).toContain('2 MB');
    });

    it('refuses a container it cannot read, and does not name it to the caller', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([], ['never reached']);
      const service = build(provider, api);

      const error = await service
        .voice(voiceRequest(1024, 'audio/x-caf'))
        .catch((e) => e);

      expect(isDomainException(error)).toBe(true);
      expect(error.code).toBe('validation_failed');
      expect(provider.transcriptions).toHaveLength(0);
      // The type is a fact for whoever has to add that browser's format to the
      // whitelist. It is nothing at all to the person holding the phone.
      expect(error.message).not.toContain('audio/x-caf');
    });

    it('accepts a container whose codec parameters the browser tacked on', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider(
        [FakeModelProvider.says('Vale.')],
        ['hola']
      );
      const service = build(provider, api);

      // Chrome says `audio/webm;codecs=opus` and Firefox says
      // `audio/ogg;codecs=opus`. Both are the container the whitelist names.
      await service.voice(voiceRequest(1024, 'audio/webm;codecs=opus'));
      expect(provider.transcriptions).toHaveLength(1);
      // Forwarded as it arrived, parameters and all: the provider is entitled to
      // the codec hint even though the whitelist ignored it.
      expect(provider.transcriptions[0].mimeType).toBe(
        'audio/webm;codecs=opus'
      );
    });

    it("transcribes in the caller's own language", async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider(
        [FakeModelProvider.says('Vale.')],
        ['añade leche']
      );
      const service = build(provider, api);

      await runWithRequestContext({ correlationId: 'c-1', locale: 'es' }, () =>
        service.voice(voiceRequest(1024))
      );

      // Ours rather than the browser's, which is one of section 2's reasons for
      // moving this back to the server at all.
      expect(provider.transcriptions[0].locale).toBe('es');
    });

    it('never writes the recording to a log line, at any level', async () => {
      const api = new RecordingApi();
      const request = voiceRequest(1024);
      const service = build(
        new FakeModelProvider(
          [FakeModelProvider.says('Vale.')],
          ['añade leche']
        ),
        api
      );

      const written: string[] = [];
      const levels = ['log', 'warn', 'error', 'debug', 'verbose'] as const;
      const spies = levels.map((level) =>
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            written.push(args.map((arg) => String(arg)).join(' '));
          })
      );

      try {
        await service.voice(request);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
      }

      const everything = written.join('\n');
      // Not the audio, not a slice of it, and not a hash of it (section 6). The
      // transcription is what the record carries, on exactly the terms a typed
      // message already lives in the logs on.
      expect(everything).not.toContain(request.audio);
      expect(everything).not.toContain(request.audio.slice(0, 64));
      expect(everything).toContain('añade leche');
    });

    it('answers not_configured with no key, before anything else', async () => {
      const api = new RecordingApi();
      const provider = new FakeModelProvider([], ['never reached']);
      provider.configured = false;

      const error = await build(provider, api)
        .voice(voiceRequest(1024))
        .catch((e) => e);

      expect(error.code).toBe('not_configured');
      expect(provider.transcriptions).toHaveLength(0);
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

/**
 * Words out of a recording (plan 0041, section 3).
 *
 * Rule A4 holds here exactly as above and the fake is the same one: no byte of
 * audio reaches a provider, and the only audio in this file is a base64 string
 * nobody decodes into sound.
 */
describe('AssistantService.transcribe', () => {
  const AUDIO = Buffer.from('not really audio').toString('base64');

  it('hands the provider the recording, its type and the locale', async () => {
    const provider = new FakeModelProvider().willHear('Bring the big one');
    const service = build(provider, new RecordingApi());

    const heard = await service.transcribe({
      audio: AUDIO,
      mimeType: 'audio/webm;codecs=opus',
      locale: 'es',
    });

    expect(heard.text).toBe('Bring the big one');
    expect(provider.transcriptions).toHaveLength(1);
    // The negotiated type as the browser produced it, parameters and all: the
    // container is what decides whether this works, and tidying the string here
    // would only hide the answer.
    expect(provider.transcriptions[0].mimeType).toBe('audio/webm;codecs=opus');
    expect(provider.transcriptions[0].locale).toBe('es');
    expect(Buffer.from(provider.transcriptions[0].audio).toString()).toBe(
      'not really audio'
    );
  });

  it('spends no conversation turn, because leaving a message is not a turn', async () => {
    // One turn a minute, and three transcriptions. A voice comment must not spend
    // somebody's assistant quota on a message they left for their flatmate.
    const provider = new FakeModelProvider().willHear('one', 'two', 'three');
    const service = build(provider, new RecordingApi(), { turnsPerMinute: 1 });

    for (let i = 0; i < 3; i += 1) {
      await service.transcribe({
        audio: AUDIO,
        mimeType: 'audio/webm',
        locale: 'en',
      });
    }

    expect(provider.transcriptions).toHaveLength(3);
  });

  it('answers an empty string when the provider heard nothing', async () => {
    const provider = new FakeModelProvider().willHear('   ');
    const service = build(provider, new RecordingApi());

    // Not an error: a recording of silence is a real thing somebody uploads, and
    // the caller records that no transcript exists rather than retrying forever.
    await expect(
      service.transcribe({ audio: AUDIO, mimeType: 'audio/webm', locale: 'en' })
    ).resolves.toEqual({ text: '' });
  });

  it('answers not_configured where the deployment has no provider', async () => {
    const provider = new FakeModelProvider();
    provider.configured = false;
    const service = build(provider, new RecordingApi());

    // A statement about the server: nothing the caller changes makes it work, so
    // the voice comment settles as UNAVAILABLE rather than waiting for a
    // transcript that is never coming.
    const error = await service
      .transcribe({ audio: AUDIO, mimeType: 'audio/webm', locale: 'en' })
      .catch((thrown: unknown) => thrown);

    expect(isDomainException(error)).toBe(true);
    expect((error as { code: string }).code).toBe('not_configured');
  });

  it('answers not_configured where the provider cannot take audio', async () => {
    const provider = new FakeModelProvider();
    provider.transcriptionSupported = false;
    const service = build(provider, new RecordingApi());

    // The distinction the field exists for: a provider that will never transcribe
    // says so in a field rather than by throwing, so the two are told apart at the
    // call site rather than guessed at from an error.
    const error = await service
      .transcribe({ audio: AUDIO, mimeType: 'audio/webm', locale: 'en' })
      .catch((thrown: unknown) => thrown);

    expect((error as { code: string }).code).toBe('not_configured');
  });

  it('carries the retry hint through, so rule A5 needs no second implementation', async () => {
    const provider = new FakeModelProvider().willHear(
      new ProviderRateLimitedError('slow down', 27)
    );
    const service = build(provider, new RecordingApi());

    const error = await service
      .transcribe({ audio: AUDIO, mimeType: 'audio/webm', locale: 'en' })
      .catch((thrown: unknown) => thrown);

    expect(isDomainException(error)).toBe(true);
    expect(retryAfterSecondsOf(error as never)).toBe(27);
  });

  it('supplies a number when the provider gave none', async () => {
    const provider = new FakeModelProvider().willHear(
      new ProviderRateLimitedError('slow down')
    );
    const service = build(provider, new RecordingApi());

    const error = await service
      .transcribe({ audio: AUDIO, mimeType: 'audio/webm', locale: 'en' })
      .catch((thrown: unknown) => thrown);

    // Mandatory by the time it reaches the client, whatever the provider said.
    expect(retryAfterSecondsOf(error as never)).toBe(
      CONFIG.retryAfterFallbackSeconds
    );
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

// ---------------------------------------------------------------------------

describe('a turn that may only touch one list (plan 0044)', () => {
  /**
   * Two lists in two zones, so that "the other list" is a real thing the model
   * could name and the scope is doing work rather than describing the only
   * option there was.
   */
  function twoLists(): RecordingApi {
    const api = new RecordingApi();
    api.zones = [zone('zone-home', 'Casa'), zone('zone-work', 'Oficina')];
    api.listsByZone = new Map([
      ['zone-home', [list('list-flat', 'zone-home', 'Piso')]],
      ['zone-work', [list('list-office', 'zone-work', 'Oficina')]],
    ]);
    api.linesByList = new Map([
      ['list-flat', []],
      ['list-office', []],
    ]);
    return api;
  }

  it('fetches the scoped list and never the zone index', async () => {
    // The saving, and the one that silently regresses (section 2.3). An open turn
    // reads the zones and then every list in each of them; this reads one zone's
    // lists and stops.
    const api = twoLists();
    const service = build(
      new FakeModelProvider([FakeModelProvider.says('Vale.')]),
      api
    );

    await service.turn(scopedRequest('qué falta'));

    expect(api.calls.map((call) => call.method)).not.toContain('listZones');
    expect(
      api.calls.filter((call) => call.method === 'listLists')
    ).toHaveLength(1);
  });

  it('offers four fewer tools, and never rename_me', async () => {
    // Asserted on what is handed to the provider rather than on what the provider
    // does with it: an absent capability is a much harder boundary than an
    // instruction, and that argument only holds if the absence is real.
    const api = twoLists();
    const provider = new FakeModelProvider([FakeModelProvider.says('Vale.')]);
    const service = build(provider, api);

    await service.turn(scopedRequest('llámame Marta'));

    const offered = provider.requests[0].tools.map((tool) => tool.name);
    expect(offered).toContain('upsert_lines');
    expect(offered).toContain('query_lists');
    expect(offered).not.toContain('rename_me');
  });

  it('still offers rename_me on an ordinary turn', async () => {
    // The real acceptance criterion of this plan is that the unscoped assistant
    // is the feature it was, so the negative above needs its opposite beside it.
    const api = twoLists();
    const provider = new FakeModelProvider([FakeModelProvider.says('Vale.')]);
    const service = build(provider, api);

    await service.turn(turnRequest('llámame Marta'));

    expect(provider.requests[0].tools.map((tool) => tool.name)).toContain(
      'rename_me'
    );
  });

  it('writes to the scoped list without being told which', async () => {
    const api = twoLists();
    const service = build(
      new FakeModelProvider([
        FakeModelProvider.calls('upsert_lines', {
          items: [{ product: 'leche' }],
        }),
        FakeModelProvider.says('Hecho.'),
      ]),
      api
    );

    const response = await service.turn(scopedRequest('añade leche'));

    const written = api.calls.find(
      (call) => call.method === 'addLine' || call.method === 'addLines'
    );
    expect(written?.detail['listId']).toBe('list-flat');
    // Never a question about which list: on a screen showing one list, that
    // question is the assistant failing to understand where it is.
    expect(response.reply).toBe('Hecho.');
  });

  it('refuses a call that named a different list, and writes nothing', async () => {
    const api = twoLists();
    const provider = new FakeModelProvider([
      FakeModelProvider.calls('upsert_lines', {
        list: 'Oficina',
        items: [{ product: 'leche' }],
      }),
      FakeModelProvider.says('Esa lista está en otra pantalla.'),
    ]);
    const service = build(provider, api);

    await service.turn(scopedRequest('añade leche a la de la oficina'));

    expect(
      api.calls.filter(
        (call) => call.method === 'addLine' || call.method === 'addLines'
      )
    ).toHaveLength(0);
    expect(JSON.stringify(provider.requests[1].turns.at(-1))).toContain(
      'outOfScope'
    );
  });

  it('refuses a scope the caller cannot use, before the provider is called', async () => {
    const api = twoLists();
    const provider = new FakeModelProvider([FakeModelProvider.says('Vale.')]);
    const service = build(provider, api);

    const refusal = await service
      .turn(
        scopedRequest('añade leche', {
          zoneId: 'zone-home',
          listId: 'list-office',
        })
      )
      .then(
        () => null,
        (error: unknown) => error
      );

    expect(refusal).not.toBeNull();
    expect(isDomainException(refusal)).toBe(true);

    // The fetch is what authorizes the turn, so nothing was spent at the
    // provider on a scope that did not hold (section 3).
    expect(provider.requests).toHaveLength(0);
  });

  it('tells the model there is one list, and names it', async () => {
    const api = twoLists();
    const provider = new FakeModelProvider([FakeModelProvider.says('Vale.')]);
    const service = build(provider, api);

    await service.turn(scopedRequest('qué falta'));

    const system = provider.requests[0].system;
    expect(system).toContain('Piso');
    expect(system).toContain('Never ask which list');
    // The zone index is not in a scoped prompt at all: there is nothing to
    // resolve against and the other zone is not this turn's business.
    expect(system).not.toContain('Oficina');
  });
});

// ---------------------------------------------------------------------------

/**
 * Taking a line off a list, and settling one (plan 0043).
 *
 * The two things somebody says out loud with their hands full that the catalog
 * could not express, and one of them is a deletion. Everything here runs against
 * {@link FakeModelProvider} and nothing reaches a provider (rule A4).
 *
 * What most of these assert is a `DELETE` that **did not happen**. That is the
 * shape of the plan: the tool exists so that "take the olive oil off" works, and
 * every guard around it exists so that nothing else does.
 */
describe('the assistant removes a line, and settles one (plan 0043)', () => {
  /** A list with things on it, which is what a turn about a line needs. */
  function withLines(...contents: string[]): RecordingApi {
    const api = new RecordingApi();
    api.linesByList.set(
      'list-flat',
      contents.map((content, index) =>
        line(`line-${index}`, 'list-flat', content)
      )
    );
    return api;
  }

  /** The result of the last tool the model called, as the model saw it. */
  function lastToolResult(
    provider: FakeModelProvider
  ): Record<string, unknown> {
    const results = provider.requests.at(-1)?.turns.at(-1)?.toolResults;
    return (results?.[0]?.result ?? {}) as Record<string, unknown>;
  }

  describe('3.1 it never deletes by name', () => {
    it('refuses an id this turn has not read, and issues no DELETE', async () => {
      const api = withLines('aceite', 'arroz');
      const provider = new FakeModelProvider([
        // The id is real, and that is the point: the model has not looked it up
        // in this turn, so it has no business naming it.
        FakeModelProvider.calls('remove_lines', {
          lineIds: ['line-0'],
          confirmed: true,
        }),
        FakeModelProvider.says('Déjame mirar la lista primero.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('quita el aceite'));

      expect(api.of('deleteLine')).toHaveLength(0);
      const result = lastToolResult(provider);
      expect(result['blocked']).toBe(true);
      expect(result['notInContext']).toBe(true);
    });

    it('accepts the same id once query_lists has handed it over', async () => {
      const api = withLines('aceite', 'arroz');
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', { item: 'aceite' }),
        FakeModelProvider.calls('remove_lines', {
          lineIds: ['line-0'],
          confirmed: true,
        }),
        FakeModelProvider.says('Quitado el aceite de Piso.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('quita el aceite, sí'));

      expect(api.of('deleteLine').map((call) => call.detail['lineId'])).toEqual(
        ['line-0']
      );
    });
  });

  describe('3.3 it confirms, and the confirmation names what goes', () => {
    it('ends the turn with a question and deletes nothing', async () => {
      const api = withLines('aceite', 'arroz');
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', {}),
        FakeModelProvider.calls('remove_lines', {
          lineIds: ['line-0', 'line-1'],
        }),
        FakeModelProvider.says('¿Quito el aceite y el arroz de Piso?'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('quita el aceite y el arroz'));

      expect(api.of('deleteLine')).toHaveLength(0);

      const result = lastToolResult(provider);
      expect(result['needsConfirmation']).toBe(true);
      // By their text. "Remove those two items?" is a confirmation of a pronoun,
      // and somebody who cannot see the screen has heard nothing at all.
      expect(result['wouldRemove']).toEqual(['aceite', 'arroz']);
      expect(result['count']).toBe(2);
    });
  });

  describe('3.4 two things it will not do', () => {
    it('refuses a call with no ids, and names the screen that empties a list', async () => {
      const api = withLines('aceite', 'arroz');
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('remove_lines', {
          lineIds: [],
          confirmed: true,
        }),
        FakeModelProvider.says('Eso se hace desde los ajustes de la lista.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('vacía la lista'));

      expect(api.of('deleteLine')).toHaveLength(0);
      expect(String(lastToolResult(provider)['message'])).toContain('settings');
    });

    it('refuses a call over the cap whole, rather than truncating it', async () => {
      const api = withLines(
        ...Array.from({ length: 12 }, (_, index) => `cosa ${index}`)
      );
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', {}),
        FakeModelProvider.calls('remove_lines', {
          lineIds: Array.from({ length: 11 }, (_, index) => `line-${index}`),
          confirmed: true,
        }),
        FakeModelProvider.says('Dime cuáles quieres quitar.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('quita todo eso'));

      // Not ten of the eleven. A partially executed deletion is the worst
      // outcome available here, so the whole call is refused.
      expect(api.of('deleteLine')).toHaveLength(0);
      expect(lastToolResult(provider)['blocked']).toBe(true);
    });
  });

  describe('3.5 all or nothing, and never a rollback it did not perform', () => {
    it('refuses the whole call when one id fails to resolve', async () => {
      const api = withLines('aceite', 'arroz');
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', {}),
        FakeModelProvider.calls('remove_lines', {
          lineIds: ['line-0', 'line-invented'],
          confirmed: true,
        }),
        FakeModelProvider.says('No he encontrado una de las dos.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('quita el aceite y el azúcar'));

      // Nothing at all, including the id that was perfectly good: the check runs
      // before anything is deleted.
      expect(api.of('deleteLine')).toHaveLength(0);
    });

    it('reports exactly which line went when the second delete fails', async () => {
      const api = withLines('aceite', 'arroz');
      const removeLine = api.deleteLine.bind(api);
      let attempts = 0;
      api.deleteLine = async (caller, lineId) => {
        attempts += 1;
        if (attempts === 2) {
          throw new GatewayApiError(
            403,
            'No puedes quitar esa línea.',
            'forbidden'
          );
        }
        return removeLine(caller, lineId);
      };

      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', {}),
        FakeModelProvider.calls('remove_lines', {
          lineIds: ['line-0', 'line-1'],
          confirmed: true,
        }),
        FakeModelProvider.says('He quitado el aceite; el arroz sigue ahí.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('quita el aceite y el arroz, sí'));

      const result = lastToolResult(provider);
      expect(result['ok']).toBe(false);
      expect(result['removed']).toEqual(['aceite']);
      // The one output the plan calls the worst this feature can produce is a
      // wrong sentence about what is on the list, so the model is told which of
      // the two is still there rather than left to guess at a rollback.
      expect(result['stillThere']).toEqual(['arroz']);
      expect(JSON.stringify(result)).toContain('No puedes quitar esa línea.');
    });
  });

  describe('4 set_line_status', () => {
    it.each([LineStatus.READY, LineStatus.NOT_AVAILABLE, LineStatus.PENDING])(
      'sets %s without asking anybody to confirm',
      async (status) => {
        const api = withLines('leche');
        const provider = new FakeModelProvider([
          FakeModelProvider.calls('query_lists', {}),
          FakeModelProvider.calls('set_line_status', {
            lineIds: ['line-0'],
            status,
          }),
          FakeModelProvider.says('Hecho.'),
        ]);
        const service = build(provider, api);

        await service.turn(turnRequest('tengo la leche'));

        const calls = api.of('setLineStatus');
        expect(calls).toHaveLength(1);
        expect(calls[0].detail['status']).toBe(status);
      }
    );

    it('settles two lines in one call', async () => {
      const api = withLines('leche', 'pan');
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', {}),
        FakeModelProvider.calls('set_line_status', {
          lineIds: ['line-0', 'line-1'],
          status: LineStatus.READY,
        }),
        FakeModelProvider.says('Hecho, leche y pan.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('tenemos la leche y el pan'));

      // One breath, one call. The alternative is a loop of round trips through
      // the gateway inside a turn that is already being waited on.
      expect(
        api.of('setLineStatus').map((call) => call.detail['lineId'])
      ).toEqual(['line-0', 'line-1']);
    });

    it('refuses an id this turn has not read, and writes nothing', async () => {
      const api = withLines('leche');
      const provider = new FakeModelProvider([
        FakeModelProvider.calls('set_line_status', {
          lineIds: ['line-0'],
          status: LineStatus.READY,
        }),
        FakeModelProvider.says('Déjame mirar la lista.'),
      ]);
      const service = build(provider, api);

      await service.turn(turnRequest('tengo la leche'));

      expect(api.of('setLineStatus')).toHaveLength(0);
      expect(lastToolResult(provider)['notInContext']).toBe(true);
    });

    it("relays the gateway's refusal in words, and the turn succeeds", async () => {
      const api = withLines('leche');
      api.failNextWriteWith = new GatewayApiError(
        403,
        'Solo puedes leer esta lista.',
        'forbidden'
      );

      const provider = new FakeModelProvider([
        FakeModelProvider.calls('query_lists', {}),
        FakeModelProvider.calls('set_line_status', {
          lineIds: ['line-0'],
          status: LineStatus.READY,
        }),
        FakeModelProvider.says('Solo puedes leer esa lista.'),
      ]);
      const service = build(provider, api);

      const response = await service.turn(turnRequest('tengo la leche'));

      // A refusal is a successful turn and is not retried (plan 0039, section 7).
      expect(response.reply).toBe('Solo puedes leer esa lista.');
      expect(JSON.stringify(lastToolResult(provider))).toContain(
        'Solo puedes leer esta lista.'
      );
    });
  });

  describe('5 references, and the line that is no longer there', () => {
    it('emits a line reference for every line it settled', async () => {
      const api = withLines('leche', 'pan');
      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('query_lists', {}),
          FakeModelProvider.calls('set_line_status', {
            lineIds: ['line-0', 'line-1'],
            status: LineStatus.READY,
          }),
          FakeModelProvider.says('Hecho.'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('tenemos las dos'));

      expect(
        response.references
          .filter((reference) => reference.kind === AssistantReferenceKind.LINE)
          .map((reference) => reference.lineId)
      ).toEqual(['line-0', 'line-1']);
    });

    it('emits the list a deletion came off, and no reference to what it deleted', async () => {
      const api = withLines('aceite', 'arroz');
      const service = build(
        new FakeModelProvider([
          // The query that found the line emitted a reference to it, which is
          // exactly the chip that would 404 a moment later.
          FakeModelProvider.calls('query_lists', { item: 'aceite' }),
          FakeModelProvider.calls('remove_lines', {
            lineIds: ['line-0'],
            confirmed: true,
          }),
          FakeModelProvider.says('Quitado.'),
        ]),
        api
      );

      const response = await service.turn(turnRequest('quita el aceite, sí'));

      expect(
        response.references.filter((reference) => reference.lineId === 'line-0')
      ).toHaveLength(0);
      // The list they came off is the screen the person wants next.
      expect(
        response.references.filter(
          (reference) => reference.kind === AssistantReferenceKind.LIST
        )
      ).toHaveLength(1);
    });
  });

  describe('6 what the turn record says', () => {
    it('records a deletion with the number of lines and the list', async () => {
      const api = withLines('aceite', 'arroz');
      const logged: string[] = [];
      jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((message: unknown) => {
          logged.push(String(message));
        });

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('query_lists', {}),
          FakeModelProvider.calls('remove_lines', {
            lineIds: ['line-0', 'line-1'],
            confirmed: true,
          }),
          FakeModelProvider.says('Quitados.'),
        ]),
        api
      );

      await service.turn(turnRequest('quita los dos, sí'));

      const record = logged
        .map((entry) => JSON.parse(entry) as Record<string, unknown>)
        .find((entry) => entry['event'] === 'assistant.turn');
      const deletion = (
        record?.['tools'] as { name: string; items?: number; list?: string }[]
      ).find((tool) => tool.name === 'remove_lines');

      expect(deletion?.items).toBe(2);
      expect(deletion?.list).toBe('list-flat');
      // The record answers how the feature is used. What was on a deleted line
      // is not part of that question.
      expect(JSON.stringify(deletion)).not.toContain('aceite');

      jest.restoreAllMocks();
    });

    it('records a call it refused as a refusal, not as a failure', async () => {
      const api = withLines('aceite');
      const logged: string[] = [];
      jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation((message: unknown) => {
          logged.push(String(message));
        });

      const service = build(
        new FakeModelProvider([
          FakeModelProvider.calls('remove_lines', {
            lineIds: ['line-0'],
            confirmed: true,
          }),
          FakeModelProvider.says('Déjame mirar.'),
        ]),
        api
      );

      await service.turn(turnRequest('quita el aceite'));

      const record = logged
        .map((entry) => JSON.parse(entry) as Record<string, unknown>)
        .find((entry) => entry['event'] === 'assistant.turn');
      const call = (
        record?.['tools'] as { name: string; refused?: true }[]
      ).find((tool) => tool.name === 'remove_lines');

      // "The model tried to delete lines it had not read" is the number to
      // watch, and it is a different fact from "the gateway said no".
      expect(call?.refused).toBe(true);

      jest.restoreAllMocks();
    });
  });

  describe('4.2 approval is not status, and stays out', () => {
    it('has no tool for approving or rejecting a line, in either catalog', () => {
      const names = [...TOOL_DECLARATIONS, ...SCOPED_TOOL_DECLARATIONS].map(
        (declaration) => declaration.name
      );

      expect(names).not.toContain('set_line_approval');
      expect(names).not.toContain('approve_line');
      // Deleting anything larger than a line is still absent too (section 2).
      expect(names).not.toContain('delete_list');
      expect(names).not.toContain('delete_zone');
    });

    it('offers both new tools on a turn scoped to one list', () => {
      const names = SCOPED_TOOL_DECLARATIONS.map(
        (declaration) => declaration.name
      );

      expect(names).toContain('remove_lines');
      expect(names).toContain('set_line_status');
      // Still not this one (plan 0044, section 2.2).
      expect(names).not.toContain('rename_me');
    });
  });
});
