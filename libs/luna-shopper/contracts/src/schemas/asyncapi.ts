import { JsonSchema } from './builders';
import { allSchemas, eventContracts, messageContracts } from './registry';

/**
 * A minimal AsyncAPI 2.6 document describing the NATS surface: one channel per
 * request/reply subject (request + reply message) and one per event, with every
 * payload schema inlined as a component. Optional (plan 0010, section 2.1); the
 * enforceable contract is the JSON Schemas + validator, this is documentation a
 * tool can render.
 */
export function buildAsyncApiDocument(): Record<string, unknown> {
  const channels: Record<string, unknown> = {};
  for (const [subject, contract] of Object.entries(messageContracts)) {
    channels[subject] = {
      publish: { message: { payload: { $ref: contract.request } } },
      subscribe: { message: { payload: { $ref: contract.response } } },
    };
  }
  for (const [event, schemaRef] of Object.entries(eventContracts)) {
    channels[event] = {
      subscribe: { message: { payload: { $ref: schemaRef } } },
    };
  }
  const schemas: Record<string, JsonSchema> = {};
  for (const schema of allSchemas) {
    schemas[String(schema['$id'])] = schema;
  }
  return {
    asyncapi: '2.6.0',
    info: { title: 'Luna Shopper broker contracts', version: '0.1.0' },
    defaultContentType: 'application/json',
    channels,
    components: { schemas },
  };
}
