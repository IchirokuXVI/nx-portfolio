import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ACCEPTED_TERMS_VERSION_MAX_LENGTH } from '@portfolio/luna-shopper/contracts';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The optional `acceptedTermsVersion` of every body that can create an account
 * (plan 0231, section 4.2), declared once so the five DTOs cannot drift.
 *
 * Only shape is checked here: a string of 1 to 64 characters, as the contract
 * schemas declare it, so an empty string is refused rather than read as none.
 * Whether the version is the current one is auth's
 * question, answered with `terms_version_stale` or `terms_acceptance_missing`.
 */
export function AcceptedTermsVersion(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({
      minLength: 1,
      maxLength: ACCEPTED_TERMS_VERSION_MAX_LENGTH,
      description:
        'The `terms.version` of `GET /v1/legal/settings` the person was shown beside this action. A version that is not the current one answers `terms_version_stale`; none, where the deployment requires acceptance, answers `terms_acceptance_missing`.',
    }),
    IsOptional(),
    IsString(),
    MinLength(1),
    MaxLength(ACCEPTED_TERMS_VERSION_MAX_LENGTH)
  );
}
