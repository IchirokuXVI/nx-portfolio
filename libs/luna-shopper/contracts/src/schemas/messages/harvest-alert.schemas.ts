import {
  HarvestAlertKind,
  HarvestAlertStatus,
} from '../../lib/enums/harvest-alert.enums';
import { HARVEST_ALERT_PATTERNS } from '../../lib/messages/harvest-alert.messages';
import {
  boolean,
  enumOf,
  JsonSchema,
  nonEmptyString,
  object,
  schemaId,
} from '../builders';
import { adminCredentialProperties } from '../common.schemas';

/**
 * The harvester's alerts to the owner (plan 0218, section 7): the kind and
 * status of a row, and the one test subject.
 */
export const HARVEST_ALERT_SCHEMA_IDS = {
  harvestAlertKind: schemaId('enums/HarvestAlertKind'),
  harvestAlertStatus: schemaId('enums/HarvestAlertStatus'),
  sendTestRequest: schemaId('msg/harvestAlert.sendTest/request'),
  harvestTestAlertView: schemaId('harvest/HarvestTestAlertView'),
} as const;

const sendTestRequest = object(
  HARVEST_ALERT_SCHEMA_IDS.sendTestRequest,
  { ...adminCredentialProperties },
  ['userId']
);

const harvestTestAlertView = object(
  HARVEST_ALERT_SCHEMA_IDS.harvestTestAlertView,
  {
    id: nonEmptyString(),
    queuedAt: nonEmptyString({ format: 'date-time' }),
    recipientConfigured: boolean(),
    smtpConfigured: boolean(),
  },
  ['id', 'queuedAt', 'recipientConfigured', 'smtpConfigured']
);

export const harvestAlertSchemas: JsonSchema[] = [
  enumOf(
    HARVEST_ALERT_SCHEMA_IDS.harvestAlertKind,
    Object.values(HarvestAlertKind)
  ),
  enumOf(
    HARVEST_ALERT_SCHEMA_IDS.harvestAlertStatus,
    Object.values(HarvestAlertStatus)
  ),
  sendTestRequest,
  harvestTestAlertView,
];

export const harvestAlertMessageContracts = {
  // 201 at the gateway, with the row that was queued, as every POST there.
  [HARVEST_ALERT_PATTERNS.sendTest]: {
    request: HARVEST_ALERT_SCHEMA_IDS.sendTestRequest,
    response: HARVEST_ALERT_SCHEMA_IDS.harvestTestAlertView,
  },
};
