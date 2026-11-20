import {
  PriceRefreshRefusal,
  PriceRefreshStatus,
} from '../../lib/enums/price-refresh.enums';
import { PRICE_REFRESH_PATTERNS } from '../../lib/messages/price-refresh.messages';
import {
  createContractsAjv,
  messageContracts,
  validateMessageRequest,
  validateMessageResponse,
} from '../index';
import { messageRequestSchemaId, messageResponseSchemaId } from '../registry';
import { PRICE_REFRESH_SCHEMA_IDS } from './price-refresh.schemas';

const ITEM = '02160216-0000-4000-8000-000000000001';
const SCOPE = '02160216-0000-4000-8000-000000000002';
const REFRESH = '02160216-0000-4000-8000-000000000003';

/**
 * The three subjects a shopper reaches on the harvester (plan 0216, section
 * 7): registered, carrying no operator credential, and holding the shapes the
 * gateway documents.
 */
describe('price refresh contracts', () => {
  it('registers a request and a response schema for every subject', () => {
    const ajv = createContractsAjv();
    for (const subject of Object.values(PRICE_REFRESH_PATTERNS)) {
      expect(messageContracts[subject]).toBeDefined();
      expect(ajv.getSchema(messageRequestSchemaId(subject))).toBeDefined();
      expect(ajv.getSchema(messageResponseSchemaId(subject))).toBeDefined();
    }
  });

  it('takes the user, the product and the scope, and no operator token', () => {
    const request = { userId: 'user-1', itemId: ITEM, priceScopeId: SCOPE };
    for (const subject of [
      PRICE_REFRESH_PATTERNS.request,
      PRICE_REFRESH_PATTERNS.check,
    ]) {
      expect(validateMessageRequest(subject, request).valid).toBe(true);
      expect(
        validateMessageRequest(subject, { ...request, adminToken: 't' }).valid
      ).toBe(false);
      expect(
        validateMessageRequest(subject, { userId: 'user-1', itemId: ITEM })
          .valid
      ).toBe(false);
    }
    expect(
      validateMessageRequest(PRICE_REFRESH_PATTERNS.get, {
        userId: 'user-1',
        refreshId: REFRESH,
      }).valid
    ).toBe(true);
  });

  it('answers a FRESH view with no id, and a PENDING one with its row', () => {
    const fresh = {
      id: null,
      itemId: ITEM,
      priceScopeId: SCOPE,
      status: PriceRefreshStatus.FRESH,
      observedAt: '2026-11-06T10:00:00.000Z',
      requestedAt: null,
      finishedAt: null,
    };
    expect(
      validateMessageResponse(PRICE_REFRESH_PATTERNS.request, fresh).valid
    ).toBe(true);
    expect(
      validateMessageResponse(PRICE_REFRESH_PATTERNS.get, {
        ...fresh,
        id: REFRESH,
        status: PriceRefreshStatus.PENDING,
        requestedAt: '2026-11-06T10:30:00.000Z',
      }).valid
    ).toBe(true);
    expect(
      validateMessageResponse(PRICE_REFRESH_PATTERNS.get, {
        ...fresh,
        status: 'QUEUED',
      }).valid
    ).toBe(false);
  });

  it('answers a check with a reason, or none when refreshable', () => {
    const check = {
      refreshable: true,
      reason: null,
      retryAfterSeconds: 0,
      pendingRefreshId: null,
      observedAt: null,
    };
    expect(
      validateMessageResponse(PRICE_REFRESH_PATTERNS.check, check).valid
    ).toBe(true);
    expect(
      validateMessageResponse(PRICE_REFRESH_PATTERNS.check, {
        ...check,
        refreshable: false,
        reason: PriceRefreshRefusal.FRESH,
        retryAfterSeconds: 1200,
      }).valid
    ).toBe(true);
    expect(
      validateMessageResponse(PRICE_REFRESH_PATTERNS.check, {
        ...check,
        retryAfterSeconds: -1,
      }).valid
    ).toBe(false);
  });

  it('publishes every refusal and every status', () => {
    const ajv = createContractsAjv();
    const refusal = ajv.getSchema(PRICE_REFRESH_SCHEMA_IDS.priceRefreshRefusal);
    for (const value of Object.values(PriceRefreshRefusal)) {
      expect(refusal?.(value)).toBe(true);
    }
    const status = ajv.getSchema(PRICE_REFRESH_SCHEMA_IDS.priceRefreshStatus);
    for (const value of Object.values(PriceRefreshStatus)) {
      expect(status?.(value)).toBe(true);
    }
    expect(status?.('RUNNING')).toBe(false);
  });
});
