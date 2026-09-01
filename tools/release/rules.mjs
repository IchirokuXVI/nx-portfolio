// The one definition of what a pull request title has to look like in this
// repository, and of how a conforming title becomes a line in the release notes.
//
// Conventional Commits 1.0.0 (the Angular type set), narrowed to this workspace:
//
//   type(scope)!: summary (plan 0045)
//
// Everything that reads or enforces the convention imports from here, so the CI
// check, the release notes and the tests can never disagree about the rules.
// CONTRIBUTING.md is the prose version of this file; change both together.

/** Header length, counted the way GitHub renders a pull request title. */
export const MAX_HEADER = 100;

/** The shortest summary that can say anything useful. */
export const MIN_SUMMARY = 10;

/**
 * The Angular type set. `section` is where the change lands in the release
 * notes: a null section means the change is real but not something a user of
 * the deployed apps can see, so it stays out of the notes unless `--all` asks
 * for it.
 */
export const TYPES = {
  feat: { section: 'Features', order: 2 },
  fix: { section: 'Fixes', order: 3 },
  perf: { section: 'Performance', order: 4 },
  revert: { section: 'Reverts', order: 5 },
  refactor: { section: null, order: 6 },
  docs: { section: null, order: 7 },
  test: { section: null, order: 8 },
  build: { section: null, order: 9 },
  ci: { section: null, order: 10 },
  chore: { section: null, order: 11 },
  style: { section: null, order: 12 },
};

/** Where a breaking change goes, whatever its type. */
export const BREAKING_SECTION = 'Breaking changes';

/**
 * Scopes name an area of the workspace, not an Nx project: `velista` covers
 * the app and every `libs/velista/*` library, `luna` covers the backend as a
 * whole, and the seven service names cover one service each. A title may carry
 * several, comma separated, when the change genuinely spans them.
 *
 * A new area of the workspace is added here, in the pull request that adds it,
 * or that pull request's own title cannot pass the check.
 */
export const SCOPES = [
  // Micro frontends and the host.
  'shell',
  'odontogram',
  'damoclesSword',
  'landingV2',
  'velista',

  // The Luna Shopper backend: the whole of it, then one name per service.
  // `luna` is the short form and the one to reach for; `luna-shopper` is the
  // project prefix, accepted because half the history already uses it.
  'luna',
  'luna-shopper',
  'gateway',
  'realtime',
  'auth',
  'core',
  'catalog',
  'harvester',
  'assistant',
  'contracts',

  // Shared code.
  'shared',
  'i18n',

  // Everything that is not application code.
  'k8s',
  'helm',
  'docker',
  'ci',
  'tools',
  'e2e',
  'deps',
  'release',
];

const HEADER =
  /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?: (?<summary>.+)$/;
const SCOPE_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const PLAN_REF = /\((plans?)\s+([^()]+)\)\s*$/i;
const PLAN_NUMBER = /\b\d+\b/g;
const ISSUE_REF = /(^|\s)#\d+\b/;

/**
 * Parse and validate one title.
 *
 * Returns the parts on success and a list of readable reasons on failure. It
 * never throws: a title is data, and the caller decides whether a bad one is a
 * failed check or a line in the "needs a rename" section of the notes.
 */
export function parseTitle(rawTitle) {
  const title = String(rawTitle ?? '');
  const errors = [];

  if (title.trim() !== title) {
    errors.push('has leading or trailing whitespace');
  }

  const match = HEADER.exec(title.trim());
  if (!match) {
    return {
      ok: false,
      title: title.trim(),
      type: null,
      scopes: [],
      breaking: false,
      summary: title.trim(),
      plans: [],
      errors: [
        ...errors,
        'does not match `type(scope): summary`. Write the type in lower case, ' +
          'follow it with a colon and one space, then say what changed',
      ],
    };
  }

  const { type, scope, breaking, summary } = match.groups;

  if (!Object.hasOwn(TYPES, type)) {
    errors.push(
      `\`${type}\` is not a type. Use one of: ${Object.keys(TYPES).join(', ')}`
    );
  }

  let scopes = [];
  if (scope !== undefined) {
    if (scope.trim() === '') {
      errors.push(
        'has empty parentheses. Give a scope or drop the parentheses'
      );
    } else {
      scopes = scope.split(',').map((one) => one.trim());
      for (const one of scopes) {
        if (!SCOPE_NAME.test(one)) {
          errors.push(
            `\`${one}\` is not a scope name. Separate several scopes with a comma`
          );
        } else if (!SCOPES.includes(one)) {
          errors.push(
            `\`${one}\` is not a known scope. Use one of: ${SCOPES.join(', ')}. ` +
              'If the workspace really has a new area, add it to tools/release/rules.mjs first'
          );
        }
      }
    }
  }

  if (title.trim().length > MAX_HEADER) {
    errors.push(
      `is ${title.trim().length} characters. Keep the whole title to ${MAX_HEADER}`
    );
  }
  if (summary.trim().length < MIN_SUMMARY) {
    errors.push(
      `says too little after the colon. Write at least ${MIN_SUMMARY} characters`
    );
  }
  if (/\.\s*$/.test(summary)) {
    errors.push('ends in a full stop. A title is not a sentence');
  }
  if (ISSUE_REF.test(summary)) {
    errors.push(
      'names an issue or pull request number. GitHub adds that itself'
    );
  }
  if (summary.trim().toLowerCase().startsWith(`${type} `)) {
    errors.push(`repeats \`${type}\` in the summary`);
  }

  const plans = [];
  const planMatch = PLAN_REF.exec(summary);
  if (planMatch) {
    const numbers = planMatch[2].match(PLAN_NUMBER) ?? [];
    if (numbers.length === 0) {
      errors.push('has a plan reference with no plan number in it');
    }
    for (const number of numbers) {
      if (number.length !== 4) {
        errors.push(
          `plan \`${number}\` is not four digits. Plans are numbered 0001 upwards`
        );
      }
      plans.push(number);
    }
  }

  return {
    ok: errors.length === 0,
    title: title.trim(),
    type,
    scopes,
    breaking: breaking === '!',
    summary: summary.trim(),
    plans,
    errors,
  };
}

/** Where a parsed title belongs in the notes, or null when it is not shown. */
export function sectionFor(parsed) {
  if (!parsed.ok) return null;
  if (parsed.breaking) return BREAKING_SECTION;
  return TYPES[parsed.type]?.section ?? null;
}

/** The order sections are printed in. Breaking changes always lead. */
export function sectionOrder() {
  const named = Object.values(TYPES)
    .filter((one) => one.section)
    .sort((a, b) => a.order - b.order)
    .map((one) => one.section);
  return [BREAKING_SECTION, ...new Set(named)];
}
