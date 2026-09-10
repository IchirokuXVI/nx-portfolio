/**
 * The five subcommands (plan 0001).
 *
 * Each one is invoked once, keeps nothing in memory between invocations, and
 * answers a single JSON object. Everything that has to survive a kill is in the
 * run directory. Nothing here calls a model: the caller does that, and hands
 * the answer to `decide` on stdin.
 *
 * The sibling `curation-suggestions` is the template. What differs is the
 * domain: the rows are ungrouped catalog products, the candidates are product
 * groups found by search rather than a directory, and the replay lands on the
 * catalog bulk route rather than the harvester one.
 */

import { randomUUID } from 'node:crypto';
import { createAdminSession } from '../../curation-auth/src/session.mjs';
import {
  CONFIDENCE_THRESHOLD,
  checkDecisionShape,
  issue,
  validateDecision,
} from './decision.mjs';
import {
  BULK_GROUP_ASSIGNMENTS_PATH,
  makeGateway,
  toCreateGroupBody,
} from './gateway.mjs';
import { buildItemPacket, toCandidate } from './packet.mjs';
import {
  buildDecisionSchema,
  buildSystemPrompt,
  canonicalSlug,
  deriveUnitFamilies,
  itemLabel,
  itemSearchKey,
  loadUnits,
  normalizeName,
  slugWords,
} from './rules.mjs';
import {
  appendDecision,
  createRun,
  decisionsPath,
  loadRun,
  readJsonl,
  writeReport,
  writeState,
} from './run-dir.mjs';

export { BULK_GROUP_ASSIGNMENTS_PATH };

/** Plan 0100's cap. A larger file is refused, never chunked, because chunks break the promise. */
export const MAX_OPERATIONS = 1000;

/** How many products one page of the walk holds. The plan asks for 10 to 20. */
const WALK_PAGE = 20;

/** The default session factory. Every test passes its own. */
function defaultMakeSession(options) {
  return createAdminSession(options);
}

function normalizeUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

/** `ref-<item id>`: one CREATE_GROUP per product, so the product id is already unique. */
function refFor(itemId) {
  return `ref-${itemId}`;
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/**
 * Verifies both logins, counts the ungrouped products, and answers the rules
 * prompt.
 *
 * The two verifications come first and a failure stops here, before the caller
 * has spent a single model token on a run that could never have written
 * anything.
 */
export async function start({
  mainUrl,
  rehearsalUrl,
  mainUser,
  mainPassword,
  rehearsalUser,
  rehearsalPassword,
  runDir,
  model = null,
  limit = null,
  makeSession = defaultMakeSession,
  units = loadUnits(),
}) {
  const main = makeGateway(
    makeSession({
      baseUrl: mainUrl,
      username: mainUser,
      password: mainPassword,
      label: 'main',
    })
  );
  const rehearsal = makeGateway(
    makeSession({
      baseUrl: rehearsalUrl,
      username: rehearsalUser,
      password: rehearsalPassword,
      label: 'rehearsal',
    })
  );

  await main.session.verify();
  await rehearsal.session.verify();

  // One counting pass, so `remaining` means something from the first product
  // on. The walk itself pages again from its own cursor.
  const ungrouped = await main.countUngrouped();
  const total = limit === null ? ungrouped : Math.min(ungrouped, limit);

  const runId = randomUUID();
  createRun(runDir, {
    runId,
    mainUrl: normalizeUrl(mainUrl),
    rehearsalUrl: normalizeUrl(rehearsalUrl),
    mainUser,
    model,
    total,
    limit,
  });

  return {
    runId,
    remaining: total,
    ungrouped,
    prompt: buildSystemPrompt({ units }),
    schema: buildDecisionSchema({ units }),
  };
}

// ---------------------------------------------------------------------------
// The candidate merge
// ---------------------------------------------------------------------------

/**
 * The candidate groups for one product, from both catalogs, merged and labeled.
 *
 * This runs at `next` time and never at prefetch time. The merge has to see
 * what the previous `decide` created, because the whole reason a rehearsal slot
 * exists is that the production search then answers this run's own groups. A
 * page of candidates computed in advance is the duplicate bug the toolchain was
 * built to kill.
 *
 * There is no group directory anywhere in this library, and that is the
 * decision the user made: a catalog may hold thousands of groups, and a
 * directory in a prompt does not survive that. A run created group is therefore
 * found by the same tsvector search production uses.
 */
export async function collectCandidates({
  item,
  main,
  rehearsal,
  createdRefs,
}) {
  const key = itemSearchKey(item);
  const refByGroupId = new Map(
    Object.entries(createdRefs ?? {}).map(([ref, groupId]) => [groupId, ref])
  );

  const [mainHits, runHits] = await Promise.all([
    main.searchGroups(key),
    rehearsal.searchGroups(key),
  ]);

  const candidates = [];
  const groupsById = new Map();
  for (const group of mainHits) {
    groupsById.set(group.id, group);
    candidates.push(toCandidate(group));
  }

  // A rehearsal group this run did not create has no ref, so the model could
  // not name it and a decision could not be replayed. A fresh slot holds no
  // such row; skipping it is the safe answer if one ever appears.
  const runGroups = new Map();
  for (const group of runHits) {
    const ref = refByGroupId.get(group.id);
    if (ref) {
      runGroups.set(ref, group);
      candidates.push(toCandidate(group, { origin: 'run', ref }));
    }
  }

  return { candidates, groupsById, runGroups };
}

/**
 * The groups that could collide with a proposed one, from both catalogs.
 *
 * Three searches at most, because the proposal answers to at most three
 * distinct keys: its two names and its slug read as words. The slug is searched
 * for as words rather than as a slug because the group search runs over the
 * names and the synonyms and over no slug column at all, and a slug is almost
 * always its own group's name with the accents dropped.
 *
 * The database's unique index on the slug is still the thing that makes a
 * collision impossible. This check exists so that a collision is reported as a
 * REVIEW next to the product that caused it, rather than as a refused batch an
 * hour later.
 */
export async function collectNeighbours({ proposal, main, rehearsal }) {
  const terms = [
    ...new Set(
      [
        normalizeName(proposal.nameEs),
        normalizeName(proposal.nameEn),
        slugWords(proposal.slug),
      ].filter(Boolean)
    ),
  ];

  const found = await Promise.all(
    terms.flatMap((term) => [
      main.searchGroups(term),
      rehearsal.searchGroups(term),
    ])
  );

  const neighbours = new Map();
  for (const group of found.flat()) {
    neighbours.set(group.id, group);
  }
  const slug = canonicalSlug(proposal.slug);
  const slugOwner =
    [...neighbours.values()].find(
      (group) => canonicalSlug(group.slug) === slug
    ) ?? null;

  return { neighbours: [...neighbours.values()], slugOwner };
}

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

/**
 * Walks the ungrouped products to the first one this run has not decided, and
 * answers it.
 *
 * The page is re-read on every call rather than cached across invocations. That
 * costs one request per product, which is nothing beside a model call, and it
 * buys two things: the product is as fresh as the answer about to be recorded
 * against it, and a `next` repeated after a crash answers the same product
 * rather than skipping one.
 *
 * A decided product stays on the page it was found on, because nothing this run
 * does assigns it: the writes happen in `apply`, afterwards. So the walk skips
 * what it has already decided rather than expecting the list to shrink.
 */
export async function next({
  runDir,
  mainPassword,
  makeSession = defaultMakeSession,
  gateways = null,
}) {
  const { state } = loadRun(runDir);
  const { main, rehearsal } =
    gateways ?? openGateways({ state, makeSession, mainPassword });
  const decided = new Set(state.decidedIds ?? []);

  if (state.limit !== null && state.limit !== undefined) {
    if (decided.size >= state.limit) {
      return { done: true, remaining: 0 };
    }
  }

  let cursor = state.cursor ?? null;
  let moved = false;

  for (;;) {
    const page = await main.ungroupedPage({
      cursor: cursor ?? undefined,
      limit: WALK_PAGE,
    });
    const items = page?.items ?? [];
    const row = items.find((item) => !decided.has(item.id));

    if (row) {
      if (moved) {
        writeState(runDir, { ...state, cursor });
      }
      const { candidates } = await collectCandidates({
        item: row,
        main,
        rehearsal,
        createdRefs: state.createdRefs,
      });
      return {
        ...buildItemPacket({ item: row, candidates }),
        remaining: Math.max(0, (state.total ?? 0) - decided.size),
      };
    }

    if (!page?.nextCursor) {
      writeState(runDir, { ...state, cursor, exhausted: true });
      return { done: true, remaining: 0 };
    }
    cursor = page.nextCursor;
    moved = true;
  }
}

/**
 * The two sessions a subcommand after `start` needs.
 *
 * The main username comes out of the run directory and the password does not,
 * because the run directory never held one. In the development convention the
 * password is empty and nothing has to be passed; anywhere else the caller
 * repeats `--main-password`.
 *
 * The rehearsal slot is always the `dev-admin` that `luna-slot` seeds, so its
 * credentials are never an argument anywhere in this library.
 */
function openGateways({ state, makeSession, mainPassword }) {
  return {
    main: makeGateway(
      makeSession({
        baseUrl: state.mainUrl,
        ...(state.mainUser ? { username: state.mainUser } : {}),
        ...(mainPassword === undefined ? {} : { password: mainPassword }),
        label: 'main',
      })
    ),
    rehearsal: makeGateway(
      makeSession({ baseUrl: state.rehearsalUrl, label: 'rehearsal' })
    ),
  };
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

/**
 * Judges one answer and records it.
 *
 * A reply that does not even hold the right types answers `retryable: true` and
 * writes nothing, because the caller owns the retry. `final: true` says the
 * caller has run out of retries, and the product is then recorded as a REVIEW
 * with the parse failure as its issue.
 *
 * REVIEW writes nothing anywhere. Only a CREATE_GROUP that survived every
 * validator reaches the rehearsal catalog, and nothing ever reaches the main
 * one.
 */
export async function decide({
  runDir,
  itemId,
  input,
  final = false,
  mainPassword,
  makeSession = defaultMakeSession,
  gateways = null,
  unitFamilies = deriveUnitFamilies(),
}) {
  const { state } = loadRun(runDir);
  if ((state.decidedIds ?? []).includes(itemId)) {
    throw new Error(
      `Product ${itemId} is already in ${decisionsPath(runDir)}.`
    );
  }
  const { main, rehearsal } =
    gateways ?? openGateways({ state, makeSession, mainPassword });
  const decided = new Set(state.decidedIds ?? []);
  const remainingAfter = () =>
    Math.max(0, (state.total ?? 0) - decided.size - 1);

  const shape = checkDecisionShape(input);
  if (!shape.ok && !final) {
    return {
      accepted: false,
      retryable: true,
      decision: null,
      issues: [issue('MODEL_OUTPUT_INVALID', shape.error)],
      remaining: Math.max(0, (state.total ?? 0) - decided.size),
    };
  }

  const item = await findItem({ main, state, itemId });
  if (!item) {
    throw new Error(
      `Product ${itemId} is not on the page the walk is standing on. It was grouped or deleted elsewhere.`
    );
  }

  // The optimistic check plan 0100 re-asserts on the server, read here at
  // decide time. A stale file then dies on the server with zero writes.
  const expect = { productGroupId: item.productGroupId ?? null };

  if (!shape.ok) {
    return record({
      runDir,
      state,
      item,
      expect,
      decision: 'REVIEW',
      proposedDecision: null,
      confidence: 0,
      issues: [issue('MODEL_OUTPUT_INVALID', shape.error)],
      reasoning: '',
      remaining: remainingAfter(),
    });
  }

  const proposal = shape.decision;

  // The model's own notes are reported and never decide anything. Only what the
  // library found for itself demotes a decision.
  const found = [];
  if (proposal.confidence < CONFIDENCE_THRESHOLD) {
    found.push(
      issue(
        'LOW_CONFIDENCE',
        `Confidence ${proposal.confidence} is below the ${CONFIDENCE_THRESHOLD} threshold.`
      )
    );
  }

  const { candidates, groupsById, runGroups } = await collectCandidates({
    item,
    main,
    rehearsal,
    createdRefs: state.createdRefs,
  });

  let target = null;
  if (proposal.decision === 'ASSIGN') {
    if (proposal.groupId) {
      target =
        groupsById.get(proposal.groupId) ??
        (await main.getGroup(proposal.groupId));
    } else if (proposal.groupRef) {
      target = runGroups.get(proposal.groupRef) ?? null;
    }
  }

  let neighbours = [];
  let slugOwner = null;
  if (proposal.decision === 'CREATE_GROUP') {
    ({ neighbours, slugOwner } = await collectNeighbours({
      proposal: proposal.group,
      main,
      rehearsal,
    }));
  }

  found.push(
    ...validateDecision({
      decision: proposal,
      item,
      target,
      slugOwner,
      neighbours,
      unitFamilies,
    })
  );

  const outcome = found.length > 0 ? 'REVIEW' : proposal.decision;

  if (outcome !== 'CREATE_GROUP') {
    return record({
      runDir,
      state,
      item,
      expect,
      decision: outcome,
      proposedDecision:
        outcome === proposal.decision ? null : proposal.decision,
      groupId: outcome === 'ASSIGN' ? proposal.groupId : null,
      groupRef: outcome === 'ASSIGN' ? proposal.groupRef : null,
      confidence: proposal.confidence,
      issues: [...proposal.issues, ...found],
      reasoning: proposal.reasoning,
      candidateCount: candidates.length,
      remaining: remainingAfter(),
    });
  }

  // The rehearsal write. It is a plain product group create against the slot,
  // so the next product's search sees this group the way production would.
  const ref = refFor(item.id);
  let rehearsalGroupId = null;
  const issues = [...proposal.issues, ...found];
  try {
    const created = await rehearsal.createGroup(
      toCreateGroupBody(proposal.group)
    );
    rehearsalGroupId = created?.id ?? null;
  } catch (error) {
    issues.push(
      issue('REHEARSAL_WRITE_FAILED', String(error?.message ?? error))
    );
  }

  if (!rehearsalGroupId) {
    return record({
      runDir,
      state,
      item,
      expect,
      decision: 'REVIEW',
      proposedDecision: 'CREATE_GROUP',
      confidence: proposal.confidence,
      issues,
      reasoning: proposal.reasoning,
      candidateCount: candidates.length,
      remaining: remainingAfter(),
    });
  }

  return record({
    runDir,
    state,
    item,
    expect,
    decision: 'CREATE_GROUP',
    proposedDecision: null,
    group: proposal.group,
    ref,
    rehearsalGroupId,
    confidence: proposal.confidence,
    issues,
    reasoning: proposal.reasoning,
    candidateCount: candidates.length,
    remaining: remainingAfter(),
  });
}

/** The product as the catalog answers it now, found on the page the walk stands on. */
async function findItem({ main, state, itemId }) {
  const page = await main.ungroupedPage({
    cursor: state.cursor ?? undefined,
    limit: WALK_PAGE,
  });
  return (page?.items ?? []).find((item) => item.id === itemId) ?? null;
}

function record({
  runDir,
  state,
  item,
  expect,
  decision,
  proposedDecision = null,
  groupId = null,
  groupRef = null,
  group = null,
  ref = null,
  rehearsalGroupId = null,
  confidence,
  issues,
  reasoning,
  candidateCount = null,
  remaining,
}) {
  const row = {
    itemId: item.id,
    itemName: itemLabel(item),
    expect,
    decision,
    proposedDecision,
    groupId,
    groupRef,
    group,
    ref,
    rehearsalGroupId,
    confidence,
    issues,
    reasoning,
    candidateCount,
    decidedAt: new Date().toISOString(),
  };
  appendDecision(runDir, state, row);
  return {
    accepted: decision !== 'REVIEW',
    retryable: false,
    decision: row,
    issues,
    remaining,
  };
}

// ---------------------------------------------------------------------------
// end
// ---------------------------------------------------------------------------

/** Counts per decision, every REVIEW with its issues, and the caller's usage. */
export function end({ runDir, usage = null }) {
  const { state, header, records } = loadRun(runDir);

  const counts = { ASSIGN: 0, CREATE_GROUP: 0, REVIEW: 0 };
  for (const row of records) {
    counts[row.decision] = (counts[row.decision] ?? 0) + 1;
  }

  const path = writeReport(runDir, {
    runId: state.runId,
    mainUrl: state.mainUrl,
    rehearsalUrl: state.rehearsalUrl,
    model: state.model,
    startedAt: header?.startedAt ?? state.startedAt,
    endedAt: new Date().toISOString(),
    total: state.total ?? records.length,
    decided: records.length,
    counts,
    usage,
    groupsProposed: records
      .filter((row) => row.decision === 'CREATE_GROUP')
      .map((row) => ({
        ref: row.ref,
        slug: row.group?.slug ?? null,
        name: { es: row.group?.nameEs ?? null, en: row.group?.nameEn ?? null },
        referenceUnit: row.group?.referenceUnit ?? null,
        forItemId: row.itemId,
      })),
    reviews: records
      .filter((row) => row.decision === 'REVIEW')
      .map((row) => ({
        itemId: row.itemId,
        itemName: row.itemName,
        proposedDecision: row.proposedDecision,
        confidence: row.confidence,
        issues: row.issues,
      })),
  });

  return { report: path, counts, decided: records.length };
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/**
 * Replays a decisions file into the main catalog. No model, no slot.
 *
 * One request, so the file lands whole or not at all (plan 0100). Truly all or
 * nothing here, unlike the entry decisions the sibling replays: groups and item
 * membership live in one database, so there is no price shaped step outside the
 * transaction.
 *
 * A refused request answers 201 with `applied: false` rather than a problem
 * document, because the caller needs which operation failed which check. Only
 * an empty file or one over the cap is refused before it is sent.
 */
export async function apply({
  mainUrl,
  mainUser,
  mainPassword,
  file,
  route = BULK_GROUP_ASSIGNMENTS_PATH,
  makeSession = defaultMakeSession,
  session = null,
}) {
  const lines = readJsonl(file);
  const header = lines.find((line) => line.header) ?? null;
  const records = lines.filter((line) => !line.header);

  if (!header) {
    throw new Error(`${file} has no header line. It is not a decisions file.`);
  }
  if (normalizeUrl(header.mainUrl) !== normalizeUrl(mainUrl)) {
    throw new Error(
      `${file} was decided against ${header.mainUrl} and you are applying it to ${normalizeUrl(mainUrl)}. Refusing.`
    );
  }

  const operations = buildOperations(records);
  if (operations.length > MAX_OPERATIONS) {
    throw new Error(
      `${file} holds ${operations.length} operations and the route caps a request at ${MAX_OPERATIONS}. Refusing: chunking it would break the all or nothing promise.`
    );
  }
  if (operations.length === 0) {
    return {
      runId: header.runId,
      operations: 0,
      applied: false,
      error: null,
      results: [],
      createdGroups: [],
    };
  }

  const admin =
    session ??
    makeSession({
      baseUrl: mainUrl,
      username: mainUser,
      password: mainPassword,
      label: 'main',
    });

  const answer = await admin.fetch(route, {
    method: 'POST',
    body: { operations },
  });

  return {
    runId: header.runId,
    operations: operations.length,
    applied: answer?.applied === true,
    error: answer?.error ?? null,
    results: answer?.results ?? [],
    createdGroups: answer?.createdGroups ?? [],
  };
}

/**
 * The operations plan 0100's route names: every creation first, then every
 * assignment.
 *
 * The order is the contract, not a preference. An `assignItem` may name a group
 * by `groupRef`, and the ref only means something once the `createGroup` that
 * declared it has been read. Within each half the decided order is kept, so a
 * report and a request can be read side by side.
 *
 * A REVIEW contributes nothing: it was never a decision, only a product handed
 * to a person. A CREATE_GROUP contributes two operations, which is why an
 * operation count is not a product count and the cap bites sooner than it looks.
 */
export function buildOperations(records) {
  const creates = [];
  const assignments = [];
  for (const row of records) {
    if (row.decision === 'CREATE_GROUP') {
      creates.push({
        op: 'createGroup',
        ref: row.ref,
        ...toCreateGroupBody(row.group),
      });
      assignments.push({
        op: 'assignItem',
        itemId: row.itemId,
        groupRef: row.ref,
        expect: row.expect,
      });
    } else if (row.decision === 'ASSIGN') {
      assignments.push({
        op: 'assignItem',
        itemId: row.itemId,
        ...(row.groupId
          ? { groupId: row.groupId }
          : { groupRef: row.groupRef }),
        expect: row.expect,
      });
    }
  }
  return [...creates, ...assignments];
}
