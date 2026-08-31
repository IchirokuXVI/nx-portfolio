// The response documentation bridge (plan 0019). Controllers import the two
// decorators; `main.ts` and the generation/round trip specs import the document
// helpers.

export {
  ApiContractResponse,
  type ContractResponseOptions,
} from './api-contract-response.decorator';
export {
  ApiProblemResponses,
  type ProblemResponseOptions,
} from './api-problem-responses.decorator';
export {
  GATEWAY_DOCS_PATH,
  OPENAPI_ARTIFACT_PATH,
  buildGatewayOpenApiDocument,
  gatewaySwaggerOptions,
  serializeOpenApiDocument,
} from './openapi-document';
export {
  componentNameFor,
  componentRef,
  hoistContractSchema,
  hoistPlatformStats,
  openApiComponents,
  toOpenApiSchema,
} from './openapi-schema';
