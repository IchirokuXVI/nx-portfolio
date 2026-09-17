# luna-shopper/contracts

Cross service contracts for the Luna Shopper backend (`@portfolio/luna-shopper/contracts`): the shared enums, the NATS message subjects and payloads, the event names, the paginated response types and the brand key function. `src/schemas` holds the JSON Schemas and the validator for every message and event payload, plus the harvest document schemas the file import reads.

This library was generated with [Nx](https://nx.dev).

## Running unit tests

Run `nx test luna-shopper/contracts` to execute the unit tests via [Jest](https://jestjs.io).

Run `nx lint luna-shopper/contracts` to lint it. It has no build target.
