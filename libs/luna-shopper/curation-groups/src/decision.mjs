/**
 * The shape of a decision and the validators (plan 0001).
 *
 * Carried over from backend plan 0099. Nothing here talks to a gateway, reads a
 * file or knows what a run directory is: it takes what the model answered plus
 * what the caller already fetched, and says what is wrong with it.
 *
 * One validator did not carry over the way it was written. `GROUP_DUPLICATE`
 * used to compare a proposal against the whole in-memory directory, and there is
 * no directory any more: duplicate detection is the same search that produced
 * the candidates, so the caller hands the search results in and this file
 * compares against those.
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
  return Array.isArray(raw) ? raw.filter(isString).map((v) => v.trim()) : [];
}

/**
 * The local schema check.
 *
 * Types only. A slug the service would refuse and a reference unit in the wrong
 * family are a validator's business, not a parse failure, because the difference
 * matters: a malformed reply is retried and a wrong value is reported.
 *
 * An ASSIGN carries either `groupId` (a real catalog group) or `groupRef` (one
 * this run created in the rehearsal catalog and which has no real id until
 * `apply`). The merged candidate list is where the model met the second kind.
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
    if (group.synonyms !== undefined) {
      const lists = [group.synonyms?.es, group.synonyms?.en];
      if (lists.some((list) => list !== undefined && !Array.isArray(list))) {
        return {
          ok: false,
          error: '"group.synonyms.es" and ".en" must be arrays',
        };
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
 * Every reason this decision must not be written, named.
 *
 * An empty list is the only thing that lets a rehearsal write happen. What the
 * caller has to fetch first is stated by the arguments: the group an ASSIGN
 * named, the group already holding a proposed slug, and the groups a search for
 * the proposal's own words answered. All three are searched on the main gateway
 * and on the rehearsal one, so a group this run created a moment ago collides
 * exactly like one the catalog has held for a year.
 */
export function validateDecision({
  decision,
  item,
  target = null,
  slugOwner = null,
  neighbours = [],
  unitFamilies = new Map(),
}) {
  const issues = [];

  if (decision.decision === 'ASSIGN') {
    if (!target) {
      issues.push(
        issue(
          'GROUP_TARGET_MISSING',
          `No group answers to ${decision.groupId ?? decision.groupRef}.`
        )
      );
      return issues;
    }
    issues.push(
      ...unitIssues(target.referenceUnit, item.defaultUnit, unitFamilies)
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
  } else if (slugOwner) {
    issues.push(
      issue(
        'SLUG_TAKEN',
        `The slug "${slug}" already belongs to ${describe(slugOwner)}.`
      )
    );
  }

  const words = proposedWords(proposal);
  for (const group of neighbours) {
    const shared = [...words].find((word) => groupWords(group).has(word));
    if (shared) {
      issues.push(
        issue(
          'GROUP_DUPLICATE',
          `"${shared}" already names ${describe(group)}. Assign onto it instead.`
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

/** A group named the way an operator reading a report can act on. */
function describe(group) {
  return group?.slug ? `the group ${group.slug}` : `group ${group?.id}`;
}

/**
 * The reference unit and the product's own unit have to be the same kind.
 *
 * A unit outside the families is not a crash and not a pass: it is a product a
 * person looks at, which is what a vocabulary this library cannot place means.
 */
function unitIssues(referenceUnit, defaultUnit, unitFamilies) {
  const families = unitFamilies ?? new Map();
  const reference = families.get(referenceUnit);
  const own = families.get(defaultUnit);
  if (!reference || !own) {
    const unknown = reference ? defaultUnit : referenceUnit;
    return [
      issue(
        'UNIT_FAMILY_MISMATCH',
        `"${unknown}" is not a unit this library can place in a family.`
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
