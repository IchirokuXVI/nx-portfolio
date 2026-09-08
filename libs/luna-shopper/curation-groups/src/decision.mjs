/**
 * The shape of a decision and the validators (plan 0001).
 *
 * Carried over from backend plan 0099 with one change the split forced: an
 * `ASSIGN` may now name a `groupRef` as well as a `groupId`, because a group
 * this run created has no real id until `apply`. Nothing here talks to a
 * gateway, reads a file or knows what a run directory is: it takes what the
 * model answered plus what the caller already fetched, and says what is wrong
 * with it.
 */

import {
  canonicalSlug,
  groupWords,
  isValidSlug,
  proposedWords,
} from './rules.mjs';

/** Below this a decision is a REVIEW, whatever the model wrote. */
export const CONFIDENCE_THRESHOLD = 0.9;

const DECISIONS = new Set(['ASSIGN', 'CREATE_GROUP', 'REVIEW']);

export function issue(code, detail) {
  return { code, detail };
}

function isString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeIssues(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (isString(entry)) {
        return { code: 'MODEL_NOTE', detail: entry };
      }
      if (entry && typeof entry === 'object') {
        return {
          code: isString(entry.code) ? entry.code : 'MODEL_NOTE',
          detail: isString(entry.detail) ? entry.detail : '',
        };
      }
      return null;
    })
    .filter(Boolean);
}

function stringList(raw) {
  return Array.isArray(raw) ? raw.filter(isString).map((s) => s.trim()) : [];
}

/**
 * The local schema check.
 *
 * Types only. A unit outside the vocabulary and a slug catalog would refuse are
 * a validator's business, not a parse failure, because the difference matters:
 * a malformed reply is retried and a wrong value is reported.
 */
export function checkDecisionShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'the reply is not a JSON object' };
  }
  if (!DECISIONS.has(value.decision)) {
    return {
      ok: false,
      error: `"decision" must be one of ASSIGN, CREATE_GROUP, REVIEW, got ${JSON.stringify(value.decision)}`,
    };
  }
  if (typeof value.confidence !== 'number' || Number.isNaN(value.confidence)) {
    return { ok: false, error: '"confidence" must be a number' };
  }
  if (value.confidence < 0 || value.confidence > 1) {
    return { ok: false, error: '"confidence" must be between 0 and 1' };
  }

  const decision = {
    decision: value.decision,
    groupId: null,
    groupRef: null,
    group: null,
    confidence: value.confidence,
    issues: normalizeIssues(value.issues),
    reasoning: isString(value.reasoning) ? value.reasoning.trim() : '',
  };

  if (value.decision === 'ASSIGN') {
    if (isString(value.groupId)) {
      decision.groupId = value.groupId.trim();
    } else if (isString(value.groupRef)) {
      decision.groupRef = value.groupRef.trim();
    } else {
      return {
        ok: false,
        error: 'an ASSIGN needs a "groupId" or a "groupRef"',
      };
    }
  }

  if (value.decision === 'CREATE_GROUP') {
    const group = value.group;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      return { ok: false, error: 'a CREATE_GROUP needs a "group" object' };
    }
    for (const field of ['nameEs', 'nameEn', 'slug', 'referenceUnit']) {
      if (!isString(group[field])) {
        return {
          ok: false,
          error: `"group.${field}" must be a non empty string`,
        };
      }
    }
    if (group.synonyms !== undefined && group.synonyms !== null) {
      if (typeof group.synonyms !== 'object' || Array.isArray(group.synonyms)) {
        return { ok: false, error: '"group.synonyms" must be an object' };
      }
      for (const locale of ['es', 'en']) {
        const list = group.synonyms[locale];
        if (list !== undefined && !Array.isArray(list)) {
          return {
            ok: false,
            error: `"group.synonyms.${locale}" must be an array`,
          };
        }
      }
    }
    decision.group = {
      nameEs: group.nameEs.trim(),
      nameEn: group.nameEn.trim(),
      slug: group.slug.trim(),
      referenceUnit: group.referenceUnit.trim(),
      synonyms: {
        es: stringList(group.synonyms?.es),
        en: stringList(group.synonyms?.en),
      },
    };
  }

  return { ok: true, decision };
}

/**
 * Every check the library makes for itself, whatever the model's confidence was.
 *
 * A decision that fails any of them is demoted to REVIEW with the named issue,
 * so the product stays ungrouped, which is where the back office's
 * `productGroupId=none` filter already shows it.
 *
 * `known` is every group the caller found by searching, main and rehearsal
 * both. That search is the duplicate check: plan 0099 kept a directory in
 * memory and compared against it, and a directory does not survive thousands of
 * groups, so a collision is now whatever the same read production answers with
 * comes back holding.
 */
export function validateDecision({
  decision,
  item,
  assignTarget = null,
  known = [],
  unitFamilies = new Map(),
}) {
  const issues = [];

  if (decision.decision === 'ASSIGN') {
    if (!assignTarget) {
      issues.push(
        issue(
          'GROUP_TARGET_MISSING',
          `No group answers to ${decision.groupId ?? decision.groupRef}, in the catalog or among the groups this run created.`
        )
      );
      return issues;
    }
    issues.push(
      ...unitIssues(assignTarget.referenceUnit, item.defaultUnit, unitFamilies)
    );
    return issues;
  }

  if (decision.decision !== 'CREATE_GROUP') {
    return issues;
  }

  const proposal = decision.group;
  const slug = canonicalSlug(proposal.slug);
  if (!isValidSlug(proposal.slug)) {
    issues.push(
      issue(
        'SLUG_INVALID',
        `"${proposal.slug}" is not lower case words separated by single dashes.`
      )
    );
  } else if (known.some((group) => canonicalSlug(group.slug) === slug)) {
    issues.push(
      issue('SLUG_TAKEN', `The slug "${slug}" already belongs to a group.`)
    );
  }

  const words = proposedWords(proposal);
  for (const group of known) {
    const existing = groupWords(group);
    const shared = [...words].filter((word) => existing.has(word));
    if (shared.length > 0) {
      issues.push(
        issue(
          'GROUP_DUPLICATE',
          `"${shared[0]}" already names the group ${group.slug}. Assign onto it instead.`
        )
      );
      break;
    }
  }

  issues.push(
    ...unitIssues(proposal.referenceUnit, item.defaultUnit, unitFamilies)
  );
  return issues;
}

/** The reference unit and the product's own unit have to be the same kind. */
function unitIssues(referenceUnit, defaultUnit, unitFamilies) {
  const families = unitFamilies ?? new Map();
  const reference = families.get(referenceUnit);
  const own = families.get(defaultUnit);
  if (!reference || !own) {
    const unknown = !reference ? referenceUnit : defaultUnit;
    return [
      issue(
        'UNIT_FAMILY_MISMATCH',
        `"${unknown}" is not a unit this decider can place in a family.`
      ),
    ];
  }
  if (reference !== own) {
    return [
      issue(
        'UNIT_FAMILY_MISMATCH',
        `The group compares in ${referenceUnit} (${reference}) and the product is sold in ${defaultUnit} (${own}).`
      ),
    ];
  }
  return [];
}
