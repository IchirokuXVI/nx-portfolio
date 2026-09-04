import { JsonSchema } from './builders';
import { commonSchemas } from './common.schemas';
import { enumSchemas } from './enums.schemas';
import {
  catalogEventContracts,
  catalogEventSchemas,
} from './events/catalog.schemas';
import {
  identityEventContracts,
  identityEventSchemas,
} from './events/identity.schemas';
import {
  postalCodeEventContracts,
  postalCodeEventSchemas,
} from './events/postal-code.schemas';
import {
  domainEventContracts,
  realtimeEventSchemas,
} from './events/realtime.schemas';
import {
  accountMessageContracts,
  accountSchemas,
} from './messages/account.schemas';
import {
  adminAuthMessageContracts,
  adminAuthSchemas,
} from './messages/admin-auth.schemas';
import {
  adminCoreMessageContracts,
  adminCoreSchemas,
} from './messages/admin-core.schemas';
import {
  adminUsersMessageContracts,
  adminUsersSchemas,
} from './messages/admin-users.schemas';
import {
  assistantMessageContracts,
  assistantSchemas,
} from './messages/assistant.schemas';
import { authMessageContracts, authSchemas } from './messages/auth.schemas';
import {
  catalogMessageContracts,
  catalogSchemas,
} from './messages/catalog.schemas';
import {
  generatedListSharingMessageContracts,
  generatedListSharingSchemas,
} from './messages/generated-list-sharing.schemas';
import {
  generatedListMessageContracts,
  generatedListSchemas,
} from './messages/generated-list.schemas';
import {
  harvestMessageContracts,
  harvestSchemas,
} from './messages/harvest.schemas';
import { listMessageContracts, listSchemas } from './messages/list.schemas';
import { mergeMessageContracts, mergeSchemas } from './messages/merge.schemas';
import {
  profileMessageContracts,
  profileSchemas,
} from './messages/profile.schemas';
import {
  realtimeMessageContracts,
  realtimeSchemas,
} from './messages/realtime.schemas';
import { statsMessageContracts, statsSchemas } from './messages/stats.schemas';
import { zoneMessageContracts, zoneSchemas } from './messages/zone.schemas';

export interface MessageContract {
  request: string;
  response: string;
}

/** subject -> { request schema id, response schema id } for every request/reply. */
export const messageContracts: Record<string, MessageContract> = {
  ...authMessageContracts,
  ...adminAuthMessageContracts,
  ...adminUsersMessageContracts,
  ...adminCoreMessageContracts,
  ...accountMessageContracts,
  ...zoneMessageContracts,
  ...listMessageContracts,
  ...mergeMessageContracts,
  ...profileMessageContracts,
  ...realtimeMessageContracts,
  ...catalogMessageContracts,
  ...harvestMessageContracts,
  ...statsMessageContracts,
  ...assistantMessageContracts,
  ...generatedListMessageContracts,
  ...generatedListSharingMessageContracts,
};

/** event name -> payload schema id for every published event. */
export const eventContracts: Record<string, string> = {
  ...identityEventContracts,
  ...domainEventContracts,
  ...postalCodeEventContracts,
  ...catalogEventContracts,
};

/** Every schema, ready to hand to a single Ajv instance (`ajv.addSchema`). */
export const allSchemas: JsonSchema[] = [
  ...enumSchemas,
  ...commonSchemas,
  ...authSchemas,
  ...adminAuthSchemas,
  ...adminUsersSchemas,
  ...adminCoreSchemas,
  ...accountSchemas,
  ...zoneSchemas,
  ...listSchemas,
  ...mergeSchemas,
  ...profileSchemas,
  ...realtimeSchemas,
  ...catalogSchemas,
  ...harvestSchemas,
  ...statsSchemas,
  ...assistantSchemas,
  ...generatedListSchemas,
  ...generatedListSharingSchemas,
  ...identityEventSchemas,
  ...realtimeEventSchemas,
  ...postalCodeEventSchemas,
  ...catalogEventSchemas,
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
