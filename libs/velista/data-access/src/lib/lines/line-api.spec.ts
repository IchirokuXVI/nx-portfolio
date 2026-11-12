import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { APP_API_CONFIG, APP_VERSION } from '@portfolio/velista/models';
import {
  AppUpdates,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { VELISTA_DATA_ACCESS_PROVIDERS } from '../data-access-providers';
import { gatewayInterceptor } from '../gateway-interceptor';
import { addLineOptionsRequest, LineApi } from './line-api';

/**
 * What a typed add says about a name the list holds, as the request carries it
 * (backend `0228`, velista `0170`, target 1). Each field only as itself: a `false`
 * or an empty id is never sent, so an absent field keeps the server's default.
 */
describe('addLineOptionsRequest', () => {
  it('sends nothing for no options', () => {
    expect(addLineOptionsRequest(undefined)).toEqual({});
    expect(addLineOptionsRequest({})).toEqual({});
  });

  it('asks when the caller can draw a question', () => {
    expect(addLineOptionsRequest({ askIfAmbiguous: true })).toEqual({
      askIfAmbiguous: true,
    });
  });

  it('sends the chosen line alone, or the new line alone', () => {
    expect(
      addLineOptionsRequest({ askIfAmbiguous: true, intoLineId: 'line-a' })
    ).toEqual({ intoLineId: 'line-a' });
    expect(
      addLineOptionsRequest({ askIfAmbiguous: true, newLine: true })
    ).toEqual({ newLine: true });
  });

  it('never sends an empty id', () => {
    expect(addLineOptionsRequest({ intoLineId: '' })).toEqual({});
  });
});

/**
 * Every write states what its number counts (velista `0182`, section 2, criterion
 * 7): an add of a product, an absolute update, a delta and a settle.
 */
describe('LineApi, the unit on every write (velista 0182)', () => {
  const GATEWAY = 'https://gateway.example';
  const LINE = {
    id: 'ln-1',
    listId: 'list-1',
    content: 'Plátanos',
    named: false,
    quantity: 750,
    unit: 'GRAM',
    itemIds: ['item-bananas'],
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    claimed: false,
    claimedByUserId: null,
    createdByUserId: 'u1',
    approvedByUserId: null,
    version: 2,
  };
  let api: LineApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([gatewayInterceptor])),
        provideHttpClientTesting(),
        provideFakeBrowserFacade(new Map<string, string>()),
        {
          provide: APP_API_CONFIG,
          useValue: {
            gatewayBaseUrl: GATEWAY,
            realtimeBaseUrl: 'https://realtime.example',
          },
        },
        { provide: RokuTranslatorService, useValue: { getLocale: () => 'en' } },
        { provide: APP_VERSION, useValue: '1.4.0' },
        { provide: AppUpdates, useValue: { checkNow: jest.fn() } },
        ...VELISTA_DATA_ACCESS_PROVIDERS,
        LineApi,
      ],
    });
    api = TestBed.inject(LineApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function next(): TestRequest {
    const [req] = httpMock.match(() => true);
    return req;
  }

  it('sends the unit of a product added by weight, and none for typed text', async () => {
    const weighed = api.addLineResult(
      'list-1',
      'Plátanos',
      1000,
      ['item-bananas'],
      false,
      undefined,
      'GRAM'
    );
    const req = next();
    expect(req.request.body).toMatchObject({ quantity: 1000, unit: 'GRAM' });
    req.flush({ line: LINE, merged: false });
    await weighed;

    const typed = api.addLineResult('list-1', 'Something for dinner', 1);
    const second = next();
    expect('unit' in second.request.body).toBe(false);
    second.flush({ line: { ...LINE, unit: 'UNIT' }, merged: false });
    await typed;
  });

  it('sends a typed name with neither amount nor unit, also as an answer to the question (velista 0185)', async () => {
    for (const options of [
      undefined,
      { askIfAmbiguous: true as const },
      { intoLineId: 'ln-1' },
      { newLine: true as const },
    ]) {
      const typed = api.addLineResult(
        'list-1',
        'Plátanos',
        undefined,
        undefined,
        undefined,
        options
      );
      const req = next();
      expect('quantity' in req.request.body).toBe(false);
      expect('unit' in req.request.body).toBe(false);
      req.flush({ line: LINE, merged: false });
      await typed;
    }
  });

  it('reads what the add did, and every line it met (backend 0260)', async () => {
    const met = api.addLineResult('list-1', 'Plátanos');
    next().flush({
      line: LINE,
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      alreadyOnList: [LINE, { ...LINE, id: 'ln-2' }, { broken: true }],
    });
    const answer = await met;
    expect(answer.outcome).toBe('alreadyOnList');
    expect(answer.merged).toBe(true);
    expect(answer.alreadyOnList.map((line) => line.id)).toEqual([
      'ln-1',
      'ln-2',
    ]);
    // The line is unchanged: the same amount and the same version.
    expect(answer.line).toEqual(
      expect.objectContaining({ quantity: 750, version: 2 })
    );

    const raised = api.addLineResult('list-1', 'Plátanos');
    next().flush({
      line: LINE,
      merged: true,
      outcome: 'RAISED',
      alreadyOnList: [LINE],
    });
    expect(await raised).toEqual(
      expect.objectContaining({ outcome: 'raised', alreadyOnList: [] })
    );
  });

  it('reads an answer with no outcome from merged, as before backend 0260', async () => {
    const merged = api.addLineResult('list-1', 'Plátanos');
    next().flush({ line: LINE, merged: true });
    expect((await merged).outcome).toBe('raised');

    const created = api.addLineResult('list-1', 'Plátanos');
    next().flush({ line: LINE, merged: false, outcome: 'SOMETHING_NEW' });
    expect(await created).toEqual(
      expect.objectContaining({ outcome: 'created', alreadyOnList: [] })
    );
  });

  it('names the first met line when no entry of the list maps', async () => {
    const met = api.addLineResult('list-1', 'Plátanos');
    next().flush({
      line: LINE,
      merged: true,
      outcome: 'ALREADY_ON_LIST',
      alreadyOnList: 'nope',
    });
    expect((await met).alreadyOnList.map((line) => line.id)).toEqual(['ln-1']);
  });

  it('sends the unit with the quantity of an absolute update, and never alone', async () => {
    const both = api.updateLine('ln-1', { quantity: 500, unit: 'GRAM' });
    const req = next();
    expect(req.request.body).toEqual({ quantity: 500, unit: 'GRAM' });
    req.flush(LINE);
    await both;

    const alone = api.updateLine('ln-1', { content: 'Bananas', unit: 'GRAM' });
    const second = next();
    expect(second.request.body).toEqual({ content: 'Bananas' });
    second.flush(LINE);
    await alone;
  });

  it('sends the unit on a delta', async () => {
    const done = api.addQuantity('ln-1', -250, 'GRAM');
    const req = next();
    expect(req.request.url).toBe(`${GATEWAY}/v1/lines/ln-1/quantity`);
    expect(req.request.body).toEqual({ delta: -250, unit: 'GRAM' });
    req.flush(LINE);
    expect((await done).unit).toBe('GRAM');
  });

  it('sends the unit on a settle, with a quantity in it', async () => {
    const done = api.settle('ln-1', 'BOUGHT', { quantity: 250, unit: 'GRAM' });
    const req = next();
    expect(req.request.body).toEqual({
      outcome: 'BOUGHT',
      quantity: 250,
      unit: 'GRAM',
    });
    req.flush({
      line: { ...LINE, quantity: 500 },
      settlement: {
        id: 'st-1',
        lineId: 'ln-1',
        listId: 'list-1',
        itemId: 'item-bananas',
        outcome: 'BOUGHT',
        quantity: 250,
        unit: 'GRAM',
        estimated: true,
        settledByUserId: 'u1',
        settledAt: '2026-11-09T10:00:00.000Z',
        revertedAt: null,
        pricePaidCents: null,
        pricePaidCurrency: null,
      },
    });
    expect((await done).settlement).toMatchObject({
      unit: 'GRAM',
      estimated: true,
    });
  });
});
