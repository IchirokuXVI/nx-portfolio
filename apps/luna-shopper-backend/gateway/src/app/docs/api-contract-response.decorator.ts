import { HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { messageResponseSchemaId } from '@portfolio/luna-shopper/contracts';
import {
  componentRef,
  hoistContractSchema,
  hoistTokenHandshake,
} from './openapi-schema';

export interface ContractResponseOptions {
  /**
   * The status the handler actually returns. Nest answers 201 for `@Post` and
   * 200 for everything else unless `@HttpCode` says otherwise, and the generation
   * spec asserts the documented status matches, so a wrong value here fails a
   * test rather than misleading a client.
   */
  status?: HttpStatus | number;
  description?: string;
  /**
   * `tokenHandshake` documents the `{ tokens?, data }` wrapper the anonymous
   * create/join routes return instead of the bare view.
   */
  envelope?: 'tokenHandshake';
}

/**
 * Documents a handler's success response with the schema the contracts library
 * already publishes for that broker pattern (plan 0019, section 2).
 *
 * Reads as `@ApiContractResponse(ZONE_PATTERNS.listMine)`, which is shorter than
 * the `@ApiOkResponse` it replaces and cannot name a shape the contract does not
 * have: the pattern is looked up in the registry, so a typo, a renamed subject or
 * a response nobody wrote a schema for throws while the class is being defined,
 * i.e. at startup.
 */
export function ApiContractResponse(
  pattern: string,
  options: ContractResponseOptions = {}
): MethodDecorator {
  const schemaId = messageResponseSchemaId(pattern);
  const name =
    options.envelope === 'tokenHandshake'
      ? hoistTokenHandshake(schemaId)
      : hoistContractSchema(schemaId);

  return ApiResponse({
    status: options.status ?? HttpStatus.OK,
    description: options.description ?? `The \`${pattern}\` contract response.`,
    schema: componentRef(name),
  });
}
