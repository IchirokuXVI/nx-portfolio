/**
 * The shape of a decision and the nine validators (plan 0001).
 *
 * Carried over unchanged from backend plan 0098. Nothing here talks to a
 * gateway, reads a file or knows what a run directory is: it takes what the
 * model answered plus what the caller already fetched, and says what is wrong
 * with it.
 */

import {
  carriesBrand,
  carriesSize,
  chainName,
  normalizeName,
} from './rules.mjs';

/** Below this a decision is a REVIEW, whatever the model wrote. */
export const CONFIDENCE_THRESHOLD = 0.9;

const DECISIONS = new Set(['LINK', 'CREATE', 'REVIEW']);

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

/**
 * The local schema check.
 *
 * Types only. A category outside the vocabulary is a validator's business, not
 * a parse failure, because the difference matters: a malformed reply is retried
 * and a wrong value is reported.
 *
 * A LINK carries either `itemId` (a real catalog product) or `itemRef` (one
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
      error: `"decision" must be one of LINK, CREATE, REVIEW, got ${JSON.stringify(value.decision)}`,
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
    itemId: null,
    itemRef: null,
    item: null,
    confidence: value.confidence,
    issues: normalizeIssues(value.issues),
    reasoning: isString(value.reasoning) ? value.reasoning.trim() : '',
  };

  if (value.decision === 'LINK') {
    if (isString(value.itemId)) {
      decision.itemId = value.itemId.trim();
    } else if (isString(value.itemRef)) {
      decision.itemRef = value.itemRef.trim();
    } else {
      return { ok: false, error: 'a LINK needs an "itemId" or an "itemRef"' };
    }
  }

  if (value.decision === 'CREATE') {
    const item = value.item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'a CREATE needs an "item" object' };
    }
    if (!isString(item.nameEs)) {
      return { ok: false, error: 'a CREATE needs "item.nameEs"' };
    }
    if (!isString(item.category)) {
      return { ok: false, error: 'a CREATE needs "item.category"' };
    }
    if (!isString(item.defaultUnit)) {
      return { ok: false, error: 'a CREATE needs "item.defaultUnit"' };
    }
    if (
      item.unitSize !== null &&
      item.unitSize !== undefined &&
      typeof item.unitSize !== 'number'
    ) {
      return { ok: false, error: '"item.unitSize" must be a number or null' };
    }
    decision.item = {
      nameEs: item.nameEs.trim(),
      nameEn: isString(item.nameEn) ? item.nameEn.trim() : null,
      brand: isString(item.brand) ? item.brand.trim() : null,
      unitSize:
        item.unitSize === null || item.unitSize === undefined
          ? null
          : item.unitSize,
      defaultUnit: item.defaultUnit.trim(),
      category: item.category.trim(),
      ean: isString(item.ean) ? item.ean.trim() : null,
    };
  }

  return { ok: true, decision };
}

function sameNumber(a, b) {
  return Number(a) === Number(b);
}

function supermarketKeys(supermarket) {
  return [supermarket?.name?.es, supermarket?.name?.en]
    .filter(isString)
    .map(normalizeName);
}

/**
 * Every check the library makes for itself, whatever the model's confidence was.
 *
 * A decision that fails any of them is demoted to REVIEW with the named issue,
 * so the row stays in the queue where the back office already shows it.
 */
export function validateDecision({
  decision,
  entry,
  supermarket,
  linkTarget = null,
  eanOwner = null,
  privateLabels = new Map(),
  categories = [],
  units = [],
}) {
  const issues = [];
  const item = decision.item;

  // Must not happen, which is exactly why it is checked.
  if (!supermarket) {
    issues.push(
      issue(
        'CHAIN_NOT_REGISTERED',
        `No catalog supermarket answers to ${entry.supermarketId}.`
      )
    );
  }

  if (decision.decision === 'CREATE' && item) {
    for (const [field, name] of [
      ['nameEs', item.nameEs],
      ['nameEn', item.nameEn],
    ]) {
      if (!name) {
        continue;
      }
      if (item.brand && carriesBrand(name, item.brand)) {
        issues.push(
          issue(
            'NAME_CARRIES_BRAND',
            `${field} "${name}" carries the brand "${item.brand}" (rule 2).`
          )
        );
      }
      if (carriesSize(name)) {
        issues.push(
          issue(
            'NAME_CARRIES_SIZE',
            `${field} "${name}" states a size, which belongs in unitSize and defaultUnit (rule 3).`
          )
        );
      }
    }

    if (!categories.includes(item.category)) {
      issues.push(
        issue(
          'UNKNOWN_CATEGORY',
          `"${item.category}" is not one of ${categories.join(', ')}.`
        )
      );
    }
    if (!units.includes(item.defaultUnit)) {
      issues.push(
        issue(
          'UNKNOWN_UNIT',
          `"${item.defaultUnit}" is not one of ${units.join(', ')}.`
        )
      );
    }

    if (item.ean && eanOwner) {
      issues.push(
        issue(
          'EAN_CONFLICT',
          `EAN ${item.ean} already belongs to catalog item ${eanOwner.id}. Link onto it instead.`
        )
      );
    }
  }

  if (decision.decision === 'LINK') {
    if (!linkTarget) {
      issues.push(
        issue(
          'LINK_TARGET_MISSING',
          `Item ${decision.itemId ?? decision.itemRef} is not among the candidates and catalog does not hold it.`
        )
      );
    } else {
      if (entry.ean && linkTarget.ean && entry.ean !== linkTarget.ean) {
        issues.push(
          issue(
            'EAN_CONFLICT',
            `The entry states EAN ${entry.ean} and item ${linkTarget.id} carries ${linkTarget.ean}.`
          )
        );
      }
      if (
        entry.unitSize !== null &&
        entry.unitSize !== undefined &&
        linkTarget.unitSize !== null &&
        linkTarget.unitSize !== undefined &&
        !sameNumber(entry.unitSize, linkTarget.unitSize)
      ) {
        issues.push(
          issue(
            'FORMAT_MISMATCH',
            `The entry is ${entry.unitSize} and item ${linkTarget.id} is ${linkTarget.unitSize}. Same brand plus same format merges, and nothing else does (rule 1).`
          )
        );
      }
    }
  }

  const brand =
    decision.decision === 'LINK'
      ? (linkTarget?.brand ?? null)
      : (item?.brand ?? null);
  const label = brand ? privateLabels.get(normalizeName(brand)) : undefined;
  if (label && supermarket) {
    const keys = supermarketKeys(supermarket);
    if (!keys.includes(label.chainKey)) {
      issues.push(
        issue(
          'PRIVATE_LABEL_CROSSES_CHAIN',
          `"${label.brand}" is ${label.chain}'s own label and this entry belongs to ${chainName(supermarket)} (rule 6).`
        )
      );
    }
  }

  return issues;
}
