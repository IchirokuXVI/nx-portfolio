// Cross service contracts for the Luna Shopper backend: enums, NATS message
// subjects and payloads, and event names shared by the gateway and the polyglot
// services. Add to these as each domain slice lands (plans 0005+).

// Shared
export * from './lib/pagination';

// Enums
export * from './lib/enums/assistant.enums';
export * from './lib/enums/auth.enums';
export * from './lib/enums/catalog.enums';
export * from './lib/enums/generated-list.enums';
export * from './lib/enums/harvest.enums';
export * from './lib/enums/list.enums';
export * from './lib/enums/merge.enums';
export * from './lib/enums/profile.enums';
export * from './lib/enums/realtime.enums';
export * from './lib/enums/zone.enums';

// Messages
export * from './lib/messages/admin-auth.messages';
export * from './lib/messages/admin-core.messages';
export * from './lib/messages/admin-dashboard.messages';
export * from './lib/messages/admin-users.messages';
export * from './lib/messages/assistant.messages';
export * from './lib/messages/auth.messages';
export * from './lib/messages/catalog.messages';
export * from './lib/messages/generated-list-sharing.messages';
export * from './lib/messages/generated-list.messages';
export * from './lib/messages/harvest.messages';
export * from './lib/messages/list.messages';
export * from './lib/messages/merge.messages';
export * from './lib/messages/profile.messages';
export * from './lib/messages/realtime.messages';
export * from './lib/messages/reconciliation.messages';
export * from './lib/messages/stats.messages';
export * from './lib/messages/zone.messages';

// Events
export * from './lib/events/catalog.events';
export * from './lib/events/identity.events';
export * from './lib/events/postal-code.events';
export * from './lib/events/realtime.events';

// JSON Schemas + validator (plan 0010): the language neutral, cross-service
// contract. Every NATS message and event payload has a schema here, validated in
// tests, so a future .NET/Spring service can hold the same contract.
export * from './schemas';
