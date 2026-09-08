/**
 * The five subcommands (plan 0001).
 *
 * The same contract as the suggestions decider, over a different domain: the
 * products belonging to no group, decided into ASSIGN, CREATE_GROUP or REVIEW.
 * Each subcommand is invoked once, keeps nothing in memory between invocations,
 * and answers a single JSON object. Everything that has to survive a kill is in
 * the run directory. Nothing here calls a model: the caller does that, and
 * hands the answer to `decide` on stdin.
 */

import { randomUUID } from 'node:crypto';
import { createAdminSession } from '../../curation-auth/src/session.mjs';
import {
  CONFIDENCE_THRESHOLD,
  checkDecisionShape,
  issue,
  validateDecision,
} from './decision.mjs';
import { CANDIDATE_LIMIT, makeGateway, toCreateGroupBody } from './gateway.mjs';
import { buildItemPacket, toCandidate } from './packet.mjs';
import {
  buildSystemPrompt,
  itemName,
  loadVocabularies,
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

/**
 * The catalog bulk route plan 0100 adds beside the per product update.
 *
 * `apply` is the only caller. The path lives in one constant because plan 0100
 * owns it and this library only replays into it; `--route` overrides it without
 * a code change if the two ever disagree.
 */
export const BULK_GROUP_ASSIGNMENTS_PATH =
  '/v1/admin/catalog/product-groups/assignments';

/** Plan 0100's cap. A larger file is refused, never chunked, because chunks break the promise. */
export const MAX_OPERATIONS = 1000;

/** How many products one listing page holds. The plan asks for 10 to 20. */
const LISTING_PAGE = 20;

/** The default session factory. Every test passes its own. */
function defaultMakeSession(options) {
  return createAdminSession(options);
}

function normalizeUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

/** `ref-<item id>`: one CREATE_GROUP per product, so the id is already unique. */
function refFor(id) {
  return `ref-${id}`;
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/**
 * Verifies both logins, counts the ungrouped products, and answers the prompt.
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
  makeSession = defaultMakeSession,
  vocabularies = loadVocabularies(),
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
  // on. The walk itself pages again from its own cursor; this pass keeps none.
  const total = await main.countUngrouped();

  const runId = randomUUID();
  createRun(runDir, {
    runId,
    mainUrl: normalizeUrl(mainUrl),
    rehearsalUrl: normalizeUrl(rehearsalUrl),
    mainUser,
    model,
    total,
  });

  return {
    runId,
    remaining: total,
    prompt: buildSystemPrompt({
      units: vocabularies.units,
      unitFamilies: vocabularies.unitFamilies,
    }),
  };
}

// ---------------------------------------------------------------------------
// The candidate merge
// ---------------------------------------------------------------------------

/**
 * The groups one product might join, from both catalogs, merged and labeled.
 *
 * This runs at `next` time and never at prefetch time. The merge has to see
 * what the previous `decide` created, because the whole reason a rehearsal slot
 * exists is that the search then answers this run's own groups. A page of
 * candidates computed in advance is the duplicate the toolchain was built to
 * kill, reborn one layer down.
 *
 * The search is the duplicate check as well as the candidate list: plan 0099
 * held a directory in memory and compared against it, which does not survive
 * thousands of groups. A group this run created is found the same way
 * production finds one, through the `query` filter over names and synonyms.
 */
export async function collectCandidates({
  item,
  main,
  rehearsal,
  createdRefs,
  query = null,
}) {
  const key = query ?? normalizeName(itemName(item));
  const refByGroupId = new Map(
    Object.entries(createdRefs ?? {}).map(([ref, groupId]) => [groupId, ref])
  );

  const [mainHits, runHits] = await Promise.all([
    main.searchGroups(key),
    rehearsal.searchGroups(key),
  ]);

  const candidates = [];
  const groupsById = new Map();
  const known = [];

  for (const group of mainHits) {
    groupsById.set(group.id, group);
    known.push(group);
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
      known.push(group);
      candidates.push(toCandidate(group, { origin: 'run', ref }));
    }
  }

  return {
    candidates: candidates.slice(0, CANDIDATE_LIMIT * 2),
    groupsById,
    runGroups,
    known,
  };
}

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

/**
 * Walks the ungrouped listing to the first product this run has not decided.
 *
 * A decided product is still ungrouped in the main catalog, because nothing is
 * written there until `apply`. So the walk cannot rely on the listing shrinking
 * and skips on the ids the run directory holds, which is also what makes a
 * `next` repeated after a crash answer the same product rather than skip one.
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

  let cursor = state.cursor ?? undefined;
  let moved = false;

  for (;;) {
    const page = await main.ungroupedPage({ cursor, limit: LISTING_PAGE });
    const items = page?.items ?? [];
    const row = items.find((item) => !decided.has(item.id));

    if (row) {
      if (moved) {
        writeState(runDir, { ...state, cursor: cursor ?? null });
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

    moved = true;
    if (page?.nextCursor) {
      cursor = page.nextCursor;
      continue;
    }
    writeState(runDir, { ...state, cursor: cursor ?? null, exhausted: true });
    return { done: true, remaining: 0 };
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
 * writes nothing, because the caller owns the retry (plan 0099's semantics, now
 * one layer up). `final: true` says the caller has run out of retries, and the
 * product is then recorded as a REVIEW with the parse failure as its issue.
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
  vocabularies = loadVocabularies(),
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
      `Product ${itemId} is not on the listing page the walk is standing on. It was grouped or deleted elsewhere.`
    );
  }

  // The optimistic check plan 0100's catalog route re-asserts on the server,
  // read here at decide time. A stale file then dies on the server with zero
  // writes rather than moving a product somebody has already sorted.
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

  // The listing asked for the ungrouped products, so a product carrying a group
  // moved between the page and this call. Its `expect` would fail on the server
  // and take the whole file with it, which is a worse way to learn it.
  if (item.productGroupId) {
    found.push(
      issue(
        'ALREADY_GROUPED',
        `Somebody sorted this product into group ${item.productGroupId} since the walk read it.`
      )
    );
  }

  if (proposal.confidence < CONFIDENCE_THRESHOLD) {
    found.push(
      issue(
        'LOW_CONFIDENCE',
        `Confidence ${proposal.confidence} is below the ${CONFIDENCE_THRESHOLD} threshold.`
      )
    );
  }

  const { candidates, groupsById, runGroups, known } = await collectCandidates({
    item,
    main,
    rehearsal,
    createdRefs: state.createdRefs,
  });

  let assignTarget = null;
  let assignRef = null;
  if (proposal.decision === 'ASSIGN') {
    if (proposal.groupId) {
      assignTarget =
        groupsById.get(proposal.groupId) ??
        (await main.getGroup(proposal.groupId));
    } else if (proposal.groupRef) {
      assignTarget = runGroups.get(proposal.groupRef) ?? null;
      assignRef = assignTarget ? proposal.groupRef : null;
    }
  }

  // A slug is not a word the group listing searches, so a proposal's own slug
  // is looked up as its words. It finds the group whose slug was made from its
  // name, which is every group this toolchain creates. Catalog checks slug
  // collisions again inside the transaction that would do the writing, so a
  // collision this pass cannot see costs a refused file and never a duplicate.
  const collisionPool = [...known];
  if (proposal.decision === 'CREATE_GROUP') {
    const words = slugWords(proposal.group.slug);
    if (words && words !== normalizeName(itemName(item))) {
      const bySlug = await collectCandidates({
        item,
        main,
        rehearsal,
        createdRefs: state.createdRefs,
        query: words,
      });
      for (const group of bySlug.known) {
        if (!collisionPool.some((held) => held.id === group.id)) {
          collisionPool.push(group);
        }
      }
    }
  }

  found.push(
    ...validateDecision({
      decision: proposal,
      item,
      assignTarget,
      known: collisionPool,
      unitFamilies: vocabularies.unitFamilies,
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
      groupRef: outcome === 'ASSIGN' ? assignRef : null,
      confidence: proposal.confidence,
      issues: [...proposal.issues, ...found],
      reasoning: proposal.reasoning,
      candidateCount: candidates.length,
      remaining: remainingAfter(),
    });
  }

  // The rehearsal write. It is a plain group create against the slot, so the
  // next product's search sees this group the way production would.
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

/** The product as the listing answers it now, on the page the walk stands on. */
async function findItem({ main, state, itemId }) {
  const page = await main.ungroupedPage({
    cursor: state.cursor ?? undefined,
    limit: LISTING_PAGE,
  });
  const row = (page?.items ?? []).find((item) => item.id === itemId);
  if (row) {
    return row;
  }
  // The one place a single product is fetched by id: the page moved under the
  // run, and refusing here would strand a decision the caller already paid for.
  return main.getItem(itemId);
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
    itemName: itemName(item),
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
    groupsCreated: records
      .filter((row) => row.decision === 'CREATE_GROUP')
      .map((row) => ({
        ref: row.ref,
        slug: row.group?.slug ?? null,
        nameEs: row.group?.nameEs ?? null,
        referenceUnit: row.group?.referenceUnit ?? null,
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
 * One request, so the file lands whole or not at all (plan 0100). This one is
 * truly all or nothing, unlike the entry decisions its sibling replays: groups
 * and item membership live in one database, so there is no price shaped step
 * outside the transaction and no exception to explain.
 *
 * **A refusal is a 201 answer, not an error.** The route reports which
 * operation failed which check rather than throwing, because a problem document
 * carries one message for a thousand rows. So the verdict is `applied`, a
 * boolean the server decided, and this function passes it through beside
 * `error` and the ids each `ref` ended up naming. The CLI turns a false verdict
 * into a non zero exit, so a shell replaying a stale file is not told it
 * succeeded.
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
      applied: true,
      appliedOperations: 0,
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

  // The request carries no run id: catalog stores no run for a decisions file
  // and the contract names no field for one. The report is where a session ties
  // its writes back to itself.
  const answer = await admin.fetch(route, {
    method: 'POST',
    body: { operations },
  });

  const results = answer?.results ?? [];
  return {
    runId: header.runId,
    operations: operations.length,
    applied: answer?.applied === true,
    appliedOperations: results.filter((result) => result.applied).length,
    error: answer?.error ?? null,
    results,
    createdGroups: answer?.createdGroups ?? [],
  };
}

/**
 * The operations plan 0100's catalog route names: every create, then every
 * assignment.
 *
 * The order is the contract, not a preference. An `assignItem` may name a group
 * by `groupRef`, and a ref means nothing until the `createGroup` that declared
 * it has been read, so the creates go first as one block.
 *
 * A CREATE_GROUP contributes both: the group, and the assignment of the product
 * that caused it. Recording the create alone would leave that product ungrouped
 * beside the group it was the reason for. A REVIEW contributes neither.
 */
export function buildOperations(records) {
  const creates = [];
  const assigns = [];
  for (const row of records) {
    if (row.decision === 'CREATE_GROUP' && row.group) {
      creates.push({
        op: 'createGroup',
        ref: row.ref,
        ...toCreateGroupBody(row.group),
      });
      assigns.push({
        op: 'assignItem',
        itemId: row.itemId,
        groupRef: row.ref,
        expect: row.expect,
      });
    } else if (row.decision === 'ASSIGN') {
      assigns.push({
        op: 'assignItem',
        itemId: row.itemId,
        ...(row.groupId
          ? { groupId: row.groupId }
          : { groupRef: row.groupRef }),
        expect: row.expect,
      });
    }
  }
  return [...creates, ...assigns];
}
