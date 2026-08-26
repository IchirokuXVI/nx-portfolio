import { ERROR_CODES } from './error-codes';
import { PROBLEM_JSON_CONTENT_TYPE } from './problem-details';

/**
 * The {@link ProblemDetails} envelope as a JSON Schema, for the published OpenAPI
 * document (plan 0019, section 3).
 *
 * Every error this system returns is this shape, so it is described once here
 * rather than restated per route. The `code` enum is spread from
 * {@link ERROR_CODES} instead of being listed by hand: a new code is documented
 * the moment it is added, and a renamed one cannot leave a stale value behind.
 *
 * It lives beside the interface rather than in the gateway because the envelope
 * is a platform guarantee, and any service that grows an HTTP surface documents
 * the same shape.
 */
export const PROBLEM_DETAILS_SCHEMA = {
  type: 'object',
  description: `The RFC 7807 error envelope, served as \`${PROBLEM_JSON_CONTENT_TYPE}\`. \`message\` is already translated to the request locale, so a client can show it without knowing any backend error code; \`code\` is the stable value to branch on.`,
  required: ['type', 'title', 'status', 'code', 'message', 'correlationId'],
  additionalProperties: false,
  properties: {
    type: {
      type: 'string',
      description: 'A URI identifying the problem type.',
    },
    title: { type: 'string', description: 'A short, stable problem summary.' },
    status: {
      type: 'integer',
      description: 'The HTTP status code, repeated in the body.',
    },
    code: {
      type: 'string',
      enum: Object.values(ERROR_CODES),
      description: 'The stable machine code the client branches on.',
    },
    detail: {
      type: 'string',
      description: 'Extra context about this occurrence, when there is any.',
    },
    message: {
      type: 'string',
      description: "The message to show the user, in the request's locale.",
    },
    correlationId: {
      type: 'string',
      description:
        'Identifies this request across every service log; quote it in a bug report.',
    },
    errors: {
      type: 'object',
      description:
        'Per field validation messages. Present only when `code` is `validation_failed`.',
      additionalProperties: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

/** The component name the envelope is published under. */
export const PROBLEM_DETAILS_SCHEMA_NAME = 'ProblemDetails';
