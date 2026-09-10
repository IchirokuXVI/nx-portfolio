/**
 * The five subcommands (plan 0001).
 *
 * Each one is invoked once, keeps nothing in memory between invocations, and
 * answers a single JSON object. Everything that has to survive a kill is in the
 * run directory. Nothing here calls a model: the caller does that, and hands
 * the answer to `decide` on stdin.
 */

import { randomUUID } from 'node:crypto';
import { createAdminSession } from '../../curation-auth/src/session.mjs';
import {
  CONFIDENCE_THRESHOLD,
  checkDecisionShape,
  issue,
  validateDecision,
} from './decision.mjs';
import { CANDIDATE_LIMIT, makeGateway, toCreateItemBody } from './gateway.mjs';
import { buildEntryPacket, toCandidate } from './packet.mjs';
import {
  buildDecisionSchema,
  buildSystemPrompt,
  chainName,
  loadPrivateLabels,
  loadVocabularies,
  normalizeName,
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
 * The bulk route plan 0100 adds beside the per row queue routes.
 *
 * `apply` is the only caller. The path lives in one constant because plan 0100
 * owns it and this library only replays into it; `--route` overrides it without
 * a code change if the two ever disagree before both have landed.
 */
export const BULK_ENTRY_DECISIONS_PATH = '/v1/admin/harvest/entries/decisions';

/** Plan 0100's cap. A larger file is refused, never chunked, because chunks break the promise. */
export const MAX_OPERATIONS = 1000;

/** How many rows one queue page holds. The plan asks for 10 to 20. */
const QUEUE_PAGE = 20;

/** The default session factory. Every test passes its own. */
function defaultMakeSession(options) {
  return createAdminSession(options);
}

function normalizeUrl(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

/** `ref-<entry id>`: one CREATE per entry, so the entry id is already unique. */
function refFor(entryId) {
  return `ref-${entryId}`;
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/**
 * Verifies both logins, counts the queue, and answers the rules prompt.
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
  chain = null,
  makeSession = defaultMakeSession,
  vocabularies = loadVocabularies(),
  privateLabels = loadPrivateLabels(),
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

  const supermarkets = await main.listSupermarkets();
  const chains = supermarkets
    .filter((supermarket) => !chain || supermarket.id === chain)
    .map((supermarket) => ({
      supermarketId: supermarket.id,
      name: chainName(supermarket),
    }));

  if (chains.length === 0) {
    throw new Error(
      chain
        ? `No catalog supermarket answers to ${chain}.`
        : 'The main catalog holds no supermarkets, so there is no queue to work.'
    );
  }

  // One counting pass, so `remaining` means something from the first row on.
  // The walk itself pages again from its own cursor; this pass keeps no cursor.
  let total = 0;
  for (const entry of chains) {
    let cursor = undefined;
    for (;;) {
      const page = await main.queuePage(entry.supermarketId, {
        cursor,
        limit: 100,
      });
      total += page?.items?.length ?? 0;
      cursor = page?.nextCursor ?? null;
      if (!cursor) {
        break;
      }
    }
  }

  const runId = randomUUID();
  createRun(runDir, {
    runId,
    mainUrl: normalizeUrl(mainUrl),
    rehearsalUrl: normalizeUrl(rehearsalUrl),
    mainUser,
    model,
    chains,
    supermarkets,
    total,
  });

  return {
    runId,
    remaining: total,
    prompt: buildSystemPrompt({
      categories: vocabularies.categories,
      units: vocabularies.units,
      privateLabels,
    }),
    schema: buildDecisionSchema({
      categories: vocabularies.categories,
      units: vocabularies.units,
    }),
  };
}

// ---------------------------------------------------------------------------
// The candidate merge
// ---------------------------------------------------------------------------

/**
 * The candidates for one entry, from both catalogs, merged and labeled.
 *
 * This runs at `next` time and never at prefetch time. The merge has to see
 * what the previous `decide` created, because the whole reason a rehearsal slot
 * exists is that the production search then answers this run's own twins. A
 * page of candidates computed in advance is the duplicate bug the toolchain was
 * built to kill.
 */
export async function collectCandidates({
  entry,
  main,
  rehearsal,
  createdRefs,
}) {
  const key = normalizeName(entry.name);
  const refByItemId = new Map(
    Object.entries(createdRefs ?? {}).map(([ref, itemId]) => [itemId, ref])
  );

  const [mainHits, mainEan, runHits, runEan] = await Promise.all([
    main.searchItems(key),
    main.findByEan(entry.ean),
    rehearsal.searchItems(key),
    rehearsal.findByEan(entry.ean),
  ]);

  const candidates = [];
  const itemsById = new Map();

  for (const item of mainHits) {
    itemsById.set(item.id, item);
    candidates.push(toCandidate(item));
  }
  if (mainEan) {
    itemsById.set(mainEan.id, mainEan);
  }

  // The item the ladder itself proposed, when it proposed one and the search
  // did not surface it. It is the answer the queue is most often waiting on.
  if (entry.itemId && !itemsById.has(entry.itemId)) {
    const proposed = await main.getItem(entry.itemId);
    if (proposed) {
      itemsById.set(proposed.id, proposed);
      candidates.unshift(toCandidate(proposed, { proposedByLadder: true }));
    }
  }

  // A rehearsal row this run did not create has no ref, so the model could not
  // name it and a decision could not be replayed. A fresh slot holds no such
  // row; skipping it is the safe answer if one ever appears.
  const runItems = new Map();
  for (const item of [...runHits, ...(runEan ? [runEan] : [])]) {
    const ref = refByItemId.get(item.id);
    if (ref) {
      runItems.set(item.id, { item, ref });
    }
  }
  for (const { item, ref } of runItems.values()) {
    candidates.push(toCandidate(item, { origin: 'run', ref }));
  }

  const eanCandidate = mainEan
    ? toCandidate(mainEan)
    : runEan && refByItemId.has(runEan.id)
      ? toCandidate(runEan, { origin: 'run', ref: refByItemId.get(runEan.id) })
      : null;

  return {
    candidates: candidates.slice(0, CANDIDATE_LIMIT * 2),
    eanMatch: eanCandidate,
    itemsById,
    runItems,
  };
}

// ---------------------------------------------------------------------------
// next
// ---------------------------------------------------------------------------

/**
 * Walks the queue to the first row this run has not decided, and answers it.
 *
 * The page is re-read on every call rather than cached across invocations. That
 * costs one request per row, which is nothing beside a model call, and it buys
 * two things: the row is as fresh as the answer about to be recorded against
 * it, and a `next` repeated after a crash answers the same row rather than
 * skipping one.
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

  let chainIndex = state.chainIndex ?? 0;
  const chains = state.chains.map((chain) => ({ ...chain }));
  let moved = false;

  while (chainIndex < chains.length) {
    const chain = chains[chainIndex];
    const page = await main.queuePage(chain.supermarketId, {
      cursor: chain.cursor ?? undefined,
      limit: QUEUE_PAGE,
    });
    const items = page?.items ?? [];
    const row = items.find((item) => !decided.has(item.id));

    if (row) {
      if (moved) {
        writeState(runDir, { ...state, chains, chainIndex });
      }
      const supermarket = supermarketOf(state, row);
      const { candidates, eanMatch } = await collectCandidates({
        entry: row,
        main,
        rehearsal,
        createdRefs: state.createdRefs,
      });
      const packet = buildEntryPacket({
        entry: row,
        supermarket,
        candidates,
        eanMatch,
      });
      return {
        ...packet,
        remaining: Math.max(0, (state.total ?? 0) - decided.size),
      };
    }

    moved = true;
    if (page?.nextCursor) {
      chain.cursor = page.nextCursor;
    } else {
      chain.exhausted = true;
      chainIndex += 1;
    }
  }

  writeState(runDir, { ...state, chains, chainIndex });
  return { done: true, remaining: 0 };
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

/** The chain a row belongs to, from the list `start` recorded. */
function supermarketOf(state, entry) {
  return (
    (state.supermarkets ?? []).find(
      (supermarket) => supermarket.id === entry.supermarketId
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------

/**
 * Judges one answer and records it.
 *
 * A reply that does not even hold the right types answers `retryable: true` and
 * writes nothing, because the caller owns the retry (plan 0098's semantics, now
 * one layer up). `final: true` says the caller has run out of retries, and the
 * row is then recorded as a REVIEW with the parse failure as its issue, which
 * is where the single file tool left such a row too.
 *
 * REVIEW writes nothing anywhere. Only a CREATE that survived every validator
 * reaches the rehearsal catalog, and nothing ever reaches the main one.
 */
export async function decide({
  runDir,
  entryId,
  input,
  final = false,
  mainPassword,
  makeSession = defaultMakeSession,
  gateways = null,
  vocabularies = loadVocabularies(),
  privateLabels = loadPrivateLabels(),
}) {
  const { state } = loadRun(runDir);
  if ((state.decidedIds ?? []).includes(entryId)) {
    throw new Error(`Entry ${entryId} is already in ${decisionsPath(runDir)}.`);
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

  const entry = await findEntry({ main, state, entryId });
  if (!entry) {
    throw new Error(
      `Entry ${entryId} is not on the queue page the walk is standing on. It was decided or rejected elsewhere.`
    );
  }
  const supermarket = supermarketOf(state, entry);

  // The optimistic check plan 0100 re-asserts on the server, read here at
  // decide time. A stale file then dies on the server with zero writes.
  const expect = {
    status: entry.status ?? null,
    lastSeenAt: entry.lastSeenAt ?? null,
  };

  if (!shape.ok) {
    return record({
      runDir,
      state,
      entry,
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

  const { candidates, itemsById, runItems } = await collectCandidates({
    entry,
    main,
    rehearsal,
    createdRefs: state.createdRefs,
  });

  let linkTarget = null;
  let linkRef = null;
  if (proposal.decision === 'LINK') {
    if (proposal.itemId) {
      linkTarget =
        itemsById.get(proposal.itemId) ?? (await main.getItem(proposal.itemId));
    } else if (proposal.itemRef) {
      const created = [...runItems.values()].find(
        (row) => row.ref === proposal.itemRef
      );
      linkTarget = created?.item ?? null;
      linkRef = created ? proposal.itemRef : null;
      if (!created) {
        found.push(
          issue(
            'LINK_TARGET_MISSING',
            `Ref ${proposal.itemRef} names no product this run created.`
          )
        );
      }
    }
  }

  let eanOwner = null;
  if (proposal.decision === 'CREATE' && proposal.item?.ean) {
    eanOwner = await main.findByEan(proposal.item.ean);
  }

  found.push(
    ...validateDecision({
      decision: proposal,
      entry,
      supermarket,
      linkTarget,
      eanOwner,
      privateLabels,
      categories: vocabularies.categories,
      units: vocabularies.units,
    })
  );

  const outcome = found.length > 0 ? 'REVIEW' : proposal.decision;

  if (outcome !== 'CREATE') {
    return record({
      runDir,
      state,
      entry,
      expect,
      decision: outcome,
      proposedDecision:
        outcome === proposal.decision ? null : proposal.decision,
      itemId: outcome === 'LINK' ? proposal.itemId : null,
      itemRef: outcome === 'LINK' ? linkRef : null,
      confidence: proposal.confidence,
      issues: [...proposal.issues, ...found],
      reasoning: proposal.reasoning,
      candidateCount: candidates.length,
      remaining: remainingAfter(),
    });
  }

  // The rehearsal write. It is a plain catalog item create against the slot, so
  // the next row's search sees this product the way production would.
  const ref = refFor(entry.id);
  let rehearsalItemId = null;
  const issues = [...proposal.issues, ...found];
  try {
    const created = await rehearsal.createItem(toCreateItemBody(proposal.item));
    rehearsalItemId = created?.id ?? null;
  } catch (error) {
    issues.push(
      issue('REHEARSAL_WRITE_FAILED', String(error?.message ?? error))
    );
  }

  if (!rehearsalItemId) {
    return record({
      runDir,
      state,
      entry,
      expect,
      decision: 'REVIEW',
      proposedDecision: 'CREATE',
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
    entry,
    expect,
    decision: 'CREATE',
    proposedDecision: null,
    item: proposal.item,
    ref,
    rehearsalItemId,
    confidence: proposal.confidence,
    issues,
    reasoning: proposal.reasoning,
    candidateCount: candidates.length,
    remaining: remainingAfter(),
  });
}

/** The entry as the queue answers it now, found on the page the walk stands on. */
async function findEntry({ main, state, entryId }) {
  for (const chain of state.chains) {
    const page = await main.queuePage(chain.supermarketId, {
      cursor: chain.cursor ?? undefined,
      limit: QUEUE_PAGE,
    });
    const row = (page?.items ?? []).find((item) => item.id === entryId);
    if (row) {
      return row;
    }
  }
  return null;
}

function record({
  runDir,
  state,
  entry,
  expect,
  decision,
  proposedDecision = null,
  itemId = null,
  itemRef = null,
  item = null,
  ref = null,
  rehearsalItemId = null,
  confidence,
  issues,
  reasoning,
  candidateCount = null,
  remaining,
}) {
  const row = {
    entryId: entry.id,
    entryName: entry.name,
    supermarketId: entry.supermarketId,
    expect,
    decision,
    proposedDecision,
    itemId,
    itemRef,
    item,
    ref,
    rehearsalItemId,
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

  const counts = { LINK: 0, CREATE: 0, REVIEW: 0 };
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
    reviews: records
      .filter((row) => row.decision === 'REVIEW')
      .map((row) => ({
        entryId: row.entryId,
        entryName: row.entryName,
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
 * One request, so the file lands whole or not at all (plan 0100). A file the
 * server refuses leaves the queue exactly as it was, which is the point of
 * deciding and applying being two acts.
 *
 * **A refusal is a 201 answer, not an error.** The route reports which row
 * failed which check rather than throwing, because a problem document carries
 * one message for a thousand rows. So the verdict is `applied`, a boolean the
 * server decided, and this function passes it through beside `failedStep`,
 * `error` and `orphanedItemIds`. The CLI turns a false verdict into a non zero
 * exit, so a shell replaying a stale file is not told it succeeded.
 */
export async function apply({
  mainUrl,
  mainUser,
  mainPassword,
  file,
  route = BULK_ENTRY_DECISIONS_PATH,
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
      failedStep: null,
      error: null,
      results: [],
      priceSkips: [],
      orphanedItemIds: [],
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
    body: { runId: header.runId, operations },
  });

  const results = answer?.results ?? [];
  return {
    runId: answer?.runId ?? header.runId,
    operations: operations.length,
    // The file level verdict, which is the server's and not a count. A refused
    // file answers 201 with `applied: false`, so a caller reading only the
    // status code, or only how many rows say `applied`, cannot tell a file that
    // landed from one the first check threw out.
    applied: answer?.applied === true,
    appliedOperations: results.filter((result) => result.applied).length,
    // Which of the four steps refused it, and why, when no single row was at
    // fault. Without these an operator holding a refused file is told nothing.
    failedStep: answer?.failedStep ?? null,
    error: answer?.error ?? null,
    results,
    priceSkips: answer?.priceSkips ?? [],
    // Products step two created that a step three failure could not delete.
    // Unbound and nobody's, and reported rather than swallowed.
    orphanedItemIds: answer?.orphanedItemIds ?? [],
  };
}

/**
 * The operations plan 0100's route names, in the order they were decided.
 *
 * A REVIEW contributes none: it was never a decision, only a row handed back to
 * the queue. A LINK onto a product this run created carries `itemRef` rather
 * than an id, which the server resolves against the `createItem` that made it.
 */
export function buildOperations(records) {
  const operations = [];
  for (const row of records) {
    if (row.decision === 'CREATE') {
      operations.push({
        op: 'createItem',
        entryId: row.entryId,
        ref: row.ref,
        item: toCreateItemBody(row.item),
        expect: row.expect,
      });
    } else if (row.decision === 'LINK') {
      operations.push({
        op: 'accept',
        entryId: row.entryId,
        ...(row.itemId ? { itemId: row.itemId } : { itemRef: row.itemRef }),
        expect: row.expect,
      });
    }
  }
  return operations;
}
