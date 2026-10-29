/**
 * The versions of the two legal documents (plan 0231, section 1).
 *
 * The texts are velista's (plan 0172). The repository ships one template of
 * each, and an operator may amend their own deployment's terms on top of it.
 * One string names both, because that string is what a person accepted.
 *
 * Browser reachable: it names no `process`. Auth and the gateway compute the
 * version with the same function from the same env key, so they cannot
 * disagree unless the two pods were given different values.
 */

/** The repository's templates. Bumped in the PR that changes their meaning. */
export const LEGAL_TEMPLATES = {
  terms: { version: '2026-10-28' },
  privacy: { updatedOn: '2026-10-28' },
} as const;

/** The separator between the template version and an operator revision. */
const REVISION_SEPARATOR = '+';

function revisionOf(operatorRevision: string | null | undefined): string {
  return (operatorRevision ?? '').trim();
}

/**
 * `2026-10-28` alone, or `2026-10-28+2026-12-15` with an operator revision.
 *
 * Acceptance compares this string exactly. Nothing parses it for order: a
 * version is either the current one or it is not.
 */
export function effectiveTermsVersion(
  operatorRevision: string | null | undefined
): string {
  const revision = revisionOf(operatorRevision);
  return revision
    ? `${LEGAL_TEMPLATES.terms.version}${REVISION_SEPARATOR}${revision}`
    : LEGAL_TEMPLATES.terms.version;
}

/**
 * The later of two `YYYY-MM-DD` dates. Strings of that shape sort as dates, so
 * no parse is needed.
 */
function laterOf(template: string, revision: string): string {
  return revision && revision > template ? revision : template;
}

/** The later of the terms template date and the operator revision, as `YYYY-MM-DD`. */
export function termsUpdatedOn(
  operatorRevision: string | null | undefined
): string {
  return laterOf(LEGAL_TEMPLATES.terms.version, revisionOf(operatorRevision));
}

/** The later of the policy template date and the operator revision, as `YYYY-MM-DD`. */
export function privacyUpdatedOn(
  operatorRevision: string | null | undefined
): string {
  return laterOf(
    LEGAL_TEMPLATES.privacy.updatedOn,
    revisionOf(operatorRevision)
  );
}
