// Cross service contracts for the Luna Shopper backend: enums, NATS message
// subjects and payloads, and event names shared by the gateway and the polyglot
// services. Add to these as each domain slice lands (plans 0005+).

// Shared
export * from './lib/pagination';

// Enums
export * from './lib/enums/auth.enums';
export * from './lib/enums/catalog.enums';
export * from './lib/enums/list.enums';
export * from './lib/enums/merge.enums';
export * from './lib/enums/realtime.enums';
export * from './lib/enums/zone.enums';

// Messages
export * from './lib/messages/auth.messages';
export * from './lib/messages/catalog.messages';
export * from './lib/messages/list.messages';
export * from './lib/messages/merge.messages';
export * from './lib/messages/realtime.messages';
export * from './lib/messages/zone.messages';

// Events
export * from './lib/events/identity.events';
export * from './lib/events/realtime.events';
