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
    const answer = await done;
    expect(answer.line.unit).toBe('GRAM');
    // Absent is false (backend `0263`).
    expect(answer.deleted).toBe(false);
  });

  it('reads `deleted` beside the line a delta answers, only as a JSON true', async () => {
    const done = api.addQuantity('ln-1', -250, 'GRAM');
    next().flush({ ...LINE, quantity: 0, deleted: true });
    expect(await done).toMatchObject({
      line: { id: 'ln-1', quantity: 0 },
      deleted: true,
    });

    const odd = api.addQuantity('ln-1', -250, 'GRAM');
    next().flush({ ...LINE, quantity: 0, deleted: 'true' });
    expect((await odd).deleted).toBe(false);
  });

  it('reads `deleted` beside the line an edit answers', async () => {
    const done = api.updateLine('ln-1', { quantity: 0 });
    next().flush({ ...LINE, quantity: 0, deleted: true });
    expect(await done).toMatchObject({ deleted: true, absorbedLineId: null });

    const kept = api.updateLine('ln-1', { quantity: 0 });
    next().flush({ ...LINE, quantity: 0 });
    expect((await kept).deleted).toBe(false);
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
