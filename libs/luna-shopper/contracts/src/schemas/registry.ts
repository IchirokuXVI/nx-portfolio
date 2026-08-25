import { JsonSchema } from './builders';
import { commonSchemas } from './common.schemas';
import { enumSchemas } from './enums.schemas';
import {
  identityEventContracts,
  identityEventSchemas,
} from './events/identity.schemas';
import {
  domainEventContracts,
  realtimeEventSchemas,
} from './events/realtime.schemas';
import {
  accountMessageContracts,
  accountSchemas,
} from './messages/account.schemas';
import { authMessageContracts, authSchemas } from './messages/auth.schemas';
import {
  catalogMessageContracts,
  catalogSchemas,
} from './messages/catalog.schemas';
import { listMessageContracts, listSchemas } from './messages/list.schemas';
import { mergeMessageContracts, mergeSchemas } from './messages/merge.schemas';
import {
  realtimeMessageContracts,
  realtimeSchemas,
} from './messages/realtime.schemas';
import { zoneMessageContracts, zoneSchemas } from './messages/zone.schemas';

export interface MessageContract {
  request: string;
  response: string;
}

/** subject -> { request schema id, response schema id } for every request/reply. */
export const messageContracts: Record<string, MessageContract> = {
  ...authMessageContracts,
  ...accountMessageContracts,
  ...zoneMessageContracts,
  ...listMessageContracts,
  ...mergeMessageContracts,
  ...realtimeMessageContracts,
  ...catalogMessageContracts,
};

/** event name -> payload schema id for every published event. */
export const eventContracts: Record<string, string> = {
  ...identityEventContracts,
  ...domainEventContracts,
};

/** Every schema, ready to hand to a single Ajv instance (`ajv.addSchema`). */
export const allSchemas: JsonSchema[] = [
  ...enumSchemas,
  ...commonSchemas,
  ...authSchemas,
  ...accountSchemas,
  ...zoneSchemas,
  ...listSchemas,
  ...mergeSchemas,
  ...realtimeSchemas,
  ...catalogSchemas,
  ...identityEventSchemas,
  ...realtimeEventSchemas,
];

export const messageSubjects = Object.keys(messageContracts);
export const eventNames = Object.keys(eventContracts);

export function messageRequestSchemaId(subject: string): string {
  const contract = messageContracts[subject];
  if (!contract) {
    throw new Error(`No message contract registered for subject ${subject}`);
  }
  return contract.request;
}

export function messageResponseSchemaId(subject: string): string {
  const contract = messageContracts[subject];
  if (!contract) {
    throw new Error(`No message contract registered for subject ${subject}`);
  }
  return contract.response;
}

export function eventSchemaId(eventName: string): string {
  const id = eventContracts[eventName];
  if (!id) {
    throw new Error(`No event contract registered for event ${eventName}`);
  }
  return id;
}
