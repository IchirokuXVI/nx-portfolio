import { HarvestAlertKind } from '../../lib/enums/harvest-alert.enums';
import { HARVEST_ALERT_PATTERNS } from '../../lib/messages/harvest-alert.messages';
import {
  createContractsAjv,
  messageContracts,
  validateMessageRequest,
  validateMessageResponse,
} from '../index';
import { messageRequestSchemaId, messageResponseSchemaId } from '../registry';
import { HARVEST_ALERT_SCHEMA_IDS } from './harvest-alert.schemas';

/**
 * The harvester's test alert subject (plan 0218, section 7): registered, and
 * holding the shape the gateway documents.
 */
describe('harvest alert contracts', () => {
  it('registers a request and a response schema for every subject', () => {
    const ajv = createContractsAjv();
    for (const subject of Object.values(HARVEST_ALERT_PATTERNS)) {
      expect(messageContracts[subject]).toBeDefined();
      expect(ajv.getSchema(messageRequestSchemaId(subject))).toBeDefined();
      expect(ajv.getSchema(messageResponseSchemaId(subject))).toBeDefined();
    }
  });

  it('takes the credential as the whole request', () => {
    expect(
      validateMessageRequest(HARVEST_ALERT_PATTERNS.sendTest, {
        userId: 'admin-1',
        adminToken: 'token',
      }).valid
    ).toBe(true);
    expect(
      validateMessageRequest(HARVEST_ALERT_PATTERNS.sendTest, {
        adminToken: 'token',
      }).valid
    ).toBe(false);
  });

  it('answers the queued row and the two flags, and nothing else', () => {
    const view = {
      id: '02180218-0000-4000-8000-000000000001',
      queuedAt: '2026-11-05T10:00:00.000Z',
      recipientConfigured: false,
      smtpConfigured: true,
    };
    expect(
      validateMessageResponse(HARVEST_ALERT_PATTERNS.sendTest, view).valid
    ).toBe(true);
    expect(
      validateMessageResponse(HARVEST_ALERT_PATTERNS.sendTest, {
        ...view,
        recipient: 'someone',
      }).valid
    ).toBe(false);
  });

  it('publishes the six kinds', () => {
    const ajv = createContractsAjv();
    const kind = ajv.getSchema(HARVEST_ALERT_SCHEMA_IDS.harvestAlertKind);
    for (const value of Object.values(HarvestAlertKind)) {
      expect(kind?.(value)).toBe(true);
    }
    expect(Object.values(HarvestAlertKind)).toHaveLength(8);
    expect(kind?.('ABORTED')).toBe(false);
  });
});
