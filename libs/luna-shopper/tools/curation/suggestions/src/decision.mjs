/**
 * The shape of a decision and the nine validators (plan 0001).
 *
 * Carried over unchanged from backend plan 0098. Nothing here talks to a
 * gateway, reads a file or knows what a run directory is: it takes what the
 * model answered plus what the caller already fetched, and says what is wrong
 * with it.
 */

import {
  brandKey,
  carriesBrand,
  carriesGlitch,
  carriesSize,
  chainName,
  chainNamesById,
  findBrand,
} from './rules.mjs';

/** Below this a decision is a REVIEW, whatever the model wrote. */
export const CONFIDENCE_THRESHOLD = 0.9;

/**
 * The issues that buy the model a second attempt rather than a REVIEW.
 *
 * Every other validator reports a judgment the model made and stands by: a
 * format that does not match, a name that carries its brand, a private label
 * on the wrong chain. Asking again would get the same answer, so the row goes
 * to a person.
 *
 * `NAME_GLITCH` is the one that is not a judgment. A digit inside a word is the
 * generation going wrong for one token, and the same row asked again almost
 * always comes back spelled correctly, which makes it a `MODEL_OUTPUT_INVALID`
 * in every way but the shape of the reply. So `decide` answers `retryable` on
 * it and writes nothing, and a second glitch on the same row is recorded as a
 * REVIEW carrying the code, exactly as a second unparseable reply is.
 */
export const RETRYABLE_ISSUE_CODES = new Set(['NAME_GLITCH']);

/** Whether these issues are worth asking the same row about once more. */
export function retryableIssues(issues) {
  return (issues ?? []).filter((entry) =>
    RETRYABLE_ISSUE_CODES.has(entry?.code)
  );
}

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
  brands = new Map(),
  supermarkets = [],
  categories = [],
  units = [],
  local = false,
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
      if (carriesGlitch(name)) {
        issues.push(
          issue(
            'NAME_GLITCH',
            `${field} "${name}" has a digit inside a word, which is a generation glitch and not a name.`
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

  // The two brand registry checks, on a CREATE only (plan 0004). A LINK writes
  // no brand: it binds the entry to a catalog product whose brand a person
  // already settled, so there is nothing here for either of them to judge.
  //
  // Neither is retryable. Both report a judgment the model made and stands by,
  // and asking the same row again would get the same brand back; what the row
  // needs is the person who can register it.
  if (decision.decision === 'CREATE' && item) {
    const sourceBrand = findBrand(brands, entry?.brand);

    // A brand the registry does not hold. A null brand is a real answer and is
    // never demoted for it: plenty of products carry no brand at all.
    if (item.brand && !findBrand(brands, item.brand)) {
      issues.push({
        ...issue(
          'BRAND_UNREGISTERED',
          `"${item.brand}" is not a registered brand. Register it in the back office or correct the brand.`
        ),
        // Read by `end`, which counts the run's unregistered brands by key and
        // names the spelling the model wrote most often. The key is carried
        // here rather than parsed back out of the sentence above.
        brand: item.brand,
        brandKey: brandKey(item.brand),
      });
    }

    // A spelling difference is not one of these. Catalog stores a registered
    // brand's label on every item written with its key (plan 0115 section 4),
    // so `HACENDADO` and `Hacendado` are one brand and neither is worth a
    // person's time.
    if (sourceBrand && brandKey(item.brand) !== sourceBrand.key) {
      issues.push(
        issue(
          'BRAND_DIFFERS_FROM_SOURCE',
          `the chain prints "${entry.brand}", a registered brand, and the decision writes ${item.brand ? `"${item.brand}"` : 'no brand'}.`
        )
      );
    }
  }

  // Rule 6, by chain id (plan 0004). The registry is where a private label is
  // declared and it declares the owner as an id, so the comparison is an id
  // against the entry's own `supermarketId`. It used to compare the chain's
  // name against a name written beside the brand in a JSON file, which made
  // two spellings of one chain two chains.
  const brand =
    decision.decision === 'LINK'
      ? (linkTarget?.brand ?? null)
      : (item?.brand ?? null);
  const label = findBrand(brands, brand);
  if (label?.privateLabelSupermarketId && entry) {
    if (label.privateLabelSupermarketId !== entry.supermarketId) {
      const owner =
        chainNamesById(supermarkets).get(label.privateLabelSupermarketId) ??
        label.privateLabelSupermarketId;
      issues.push(
        issue(
          'PRIVATE_LABEL_CROSSES_CHAIN',
          `"${label.label}" is ${owner}'s own label and this entry belongs to ${supermarket ? chainName(supermarket) : entry.supermarketId} (rule 6).`
        )
      );
    }
  }

  // The last check, and the only one that asks who answered rather than what
  // was answered (plan 0003). A product with no printed size is a real product
  // and the prompt tells the model to create one, so this is not a defect of
  // the answer. It is the half of the judgment a smaller model does not make:
  // measured on eighty SuperCash cosmetics rows, sonnet sent all twenty seven
  // sizeless rows to review and gemma4:12b created all twenty seven, at a stuck
  // confidence of 0.95 that no threshold can catch. Rule 1 merges on brand plus
  // format, so a product with no format is one rule 1 cannot be tested against,
  // and that is a person's call.
  if (
    local &&
    decision.decision === 'CREATE' &&
    item &&
    item.unitSize === null
  ) {
    issues.push(
      issue(
        'SIZELESS_CREATE',
        `"${item.nameEs}" is created with no size, so rule 1 cannot be tested against it. A local model is not trusted to settle that.`
      )
    );
  }

  return issues;
}
