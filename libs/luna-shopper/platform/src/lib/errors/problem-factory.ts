import { DEFAULT_LOCALE, type SupportedLocale } from '../localization/locale';
import { resolveErrorMessage } from './error-catalog';
import { ERROR_CODES, ERROR_STATUS, type ErrorCode } from './error-codes';
import type { ProblemDetails } from './problem-details';

/**
 * Assembles the house error envelope (plan 0004, section 2) from a resolved code,
 * so the HTTP filter and the gateway's broker-error translation produce byte for
 * byte the same shape. The `message` is localized here; `type`/`title` are
 * derived from the code so a client can dereference `type` for docs later.
 */
export function buildProblemDetails(input: {
  code: ErrorCode;
  correlationId: string;
  locale?: SupportedLocale;
  detail?: string;
  messageArgs?: Record<string, string | number>;
  errors?: Record<string, string[]>;
  retryAfterSeconds?: number;
}): ProblemDetails {
  const status = ERROR_STATUS[input.code] ?? ERROR_STATUS[ERROR_CODES.INTERNAL];
  const message = resolveErrorMessage(
    input.code,
    input.locale ?? DEFAULT_LOCALE,
    input.messageArgs
  );

  return {
    type: `https://errors.luna-shopper-backend/${input.code}`,
    title: input.code,
    status,
    code: input.code,
    detail: input.detail,
    message,
    correlationId: input.correlationId,
    ...(input.errors ? { errors: input.errors } : {}),
    ...(input.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: input.retryAfterSeconds }
      : {}),
  };
}
