/**
 * The run, in order (plan 0001).
 *
 * Three parties that must never mix meet here and nowhere else: the decider
 * owns state, credentials and writes; the model owns judgment; this file owns
 * the run. It picks the slot, brings it up, waits for it, opens the run through
 * the decider (which is where both admin logins are verified), drives the
 * next/model/decide loop, and tears the slot down whatever happened.
 *
 * The slot is ephemeral (see `slots.mjs`), so the checkout this runs in is left
 * exactly as it was: nothing is configured on the way in and nothing has to be
 * put back on the way out. A developer serving slot 0 here keeps serving it.
 *
 * Everything that touches a process, a socket or the clock is injected, so the
 * whole of it runs under `node --test` with no network and no Docker.
 */

import { emptyUsage } from '../../model-engines/src/index.mjs';
import { pickFreeSlot, REHEARSAL_SERVICES, rehearsalUrl } from './slots.mjs';

/** How the second attempt is asked for after a reply that could not be used. */
const RETRY_INSTRUCTION =
  'That reply could not be used: {error}. Answer again with exactly one JSON object of the shape the rules name. No code fence, no prose.';

/**
 * What the model is shown for one row.
 *
 * The row as the decider answered it, minus `remaining`: a count of the rows
 * left is a fact about the run, and the model is told nothing about the run.
 */
export function toPacket(row) {
  const packet = { ...row };
  delete packet.remaining;
  delete packet.done;
  return packet;
}

/**
 * The id and the name of a row, whichever decider answered it.
 *
 * The suggestions decider answers a source entry and the groups decider answers
 * a catalog item, so the identity is read from either rather than from a shape
 * this file would have to be taught twice.
 */
export function rowIdentity(row) {
  const subject = row?.entry ?? row?.item ?? null;
  const id = subject?.id ?? null;
  const name =
    subject?.name?.es ??
    subject?.name?.en ??
    (typeof subject?.name === 'string' ? subject.name : null) ??
    id ??
    '(unnamed)';
  return { id, name };
}

/** The model's object, or null when the reply is not one. */
export function parseDecision(text, { stripFence }) {
  try {
    const parsed = JSON.parse(stripFence(text));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Why the decider could not use a reply, as one line for the retry. */
function issuesText(issues) {
  return (issues ?? [])
    .map((issue) => issue?.detail ?? issue?.code ?? '')
    .filter(Boolean)
    .join('; ');
}

/**
 * What a row carries between the attempts it takes to record it (plan 0004).
 *
 * `body` is the packet the model was last shown, which a stale answer replaces
 * with the refreshed one. `retried` is the whole of the retry budget: it is
 * what `--final` is passed on the next attempt, so a row is asked at most twice
 * about one packet whichever pass those two attempts fall in.
 */
export function rowAttempt(row) {
  return { row, body: JSON.stringify(toPacket(row), null, 2), retried: false };
}

/**
 * One attempt at one row: read the reply, record it, and say what is left.
 *
 * It answers `{ answer }` when the row is recorded and `{ prompt }` when it has
 * to be asked again, and it is where every rule about asking again lives. The
 * caller decides when that next prompt is sent, which is the one thing that
 * differs between a walk of one row at a time and a round that collects its
 * re-asks and sends them together.
 *
 * The retry is the plan 0098 semantics moved out of the model layer: a first
 * decision that breaks the schema comes back from the decider as
 * `retryable: true` with nothing written, the model is asked again with the
 * reason, and the second answer goes in with `--final`, which records a REVIEW
 * rather than asking a third time.
 *
 * **A stale packet is asked again and spends nothing** (plan 0002). The decider
 * re-runs its two lookups before it records, and a candidate set that changed
 * since the row was handed out means the model was asked the wrong question,
 * not that it answered badly. So the row is asked again on the refreshed packet
 * with the retry budget untouched, and a row that goes stale and then breaks
 * the schema still gets both of the attempts `--final` counts.
 */
export async function stepRow({ attempt, reply, decider, stripFence }) {
  const { id } = rowIdentity(attempt.row);

  // A prompt the engine gave up on comes back as its own entry rather than as
  // a throw, so that one failure does not discard the answers beside it. Here
  // it is a reply that cannot be used, which is what the retry is for.
  const gaveUp = reply?.error
    ? String(reply.error?.message ?? reply.error)
    : null;
  const text = gaveUp ? '' : String(reply?.text ?? '');

  const decision = gaveUp ? null : parseDecision(text, { stripFence });
  let reason = gaveUp ?? 'the reply is not one JSON object';

  // A last attempt is recorded whatever it says: `--final` turns an unusable
  // reply into a REVIEW carrying the reason, so the walk moves on rather than
  // stopping.
  if (decision || attempt.retried) {
    const answer = await decider.decide(
      id,
      decision ?? { modelReply: (gaveUp ?? text).slice(0, 2000) },
      { final: attempt.retried }
    );
    if (answer?.stale) {
      attempt.body = JSON.stringify(toPacket(answer.packet), null, 2);
      return { prompt: attempt.body };
    }
    if (attempt.retried || !answer.retryable) {
      return { answer };
    }
    reason = issuesText(answer.issues);
  }

  attempt.retried = true;
  return {
    prompt: `${attempt.body}\n\n${RETRY_INSTRUCTION.replace('{error}', reason || 'it broke the schema')}`,
  };
}

/**
 * One row, from its first reply to the decision that is recorded for it.
 *
 * `stepRow` in a loop around a single row, which is what a walk of one row at a
 * time is. `reply` is the answer a round already carries for this row, so a
 * batched walk spends its first attempt in the round rather than here. Absent,
 * the row is asked here.
 *
 * The whole of the walk goes through the same step, so there is one place a
 * retry is spent and one place a stale packet is re-asked, whichever width the
 * walk is running at.
 */
export async function decideRow({
  row,
  prompt,
  schema = null,
  engine,
  decider,
  stripFence,
  reply = null,
}) {
  const attempt = rowAttempt(row);

  // The rules go in the system half and the packet in the user half, and the
  // rules are never repeated in the user half. Both engines send the system
  // half on every call, so the one thing that changes between calls is the
  // packet, and the unchanging remainder is what the server side cache serves.
  const ask = async (text) => ({
    text: String(
      (await engine.ask(text, { system: prompt, schema })).text ?? ''
    ),
  });

  let current = reply ?? (await ask(attempt.body));
  for (;;) {
    const outcome = await stepRow({
      attempt,
      reply: current,
      decider,
      stripFence,
    });
    if (outcome.answer) {
      return outcome.answer;
    }
    current = await ask(outcome.prompt);
  }
}

/**
 * How many rows one round of the walk covers (plan 0004).
 *
 * What the engine advises, and never more than the decider will hand out at
 * once. There is no flag for either half. An engine that advises nothing falls
 * back to how many requests it holds in flight, which is what the width was
 * until this plan, and an engine that reports neither is walked one row at a
 * time.
 *
 * `batches` is the decider's own cap and is the reason a round never crosses
 * its queue page: a batch composed across two pages is a batch whose collision
 * guarantee nobody proved. A decider that composes no batches answers nothing
 * here and is walked exactly as it has always been walked.
 */
export function roundWidth(engine, batches) {
  const advised = Math.trunc(
    Number(engine?.roundSize ?? engine?.batchSize ?? 1)
  );
  return Math.max(
    1,
    Math.min(advised || 1, Math.trunc(Number(batches ?? 1)) || 1)
  );
}

/**
 * The rows to work next, and how many of the run are left at that moment.
 *
 * A width of one asks for exactly what it has always asked for, with no count
 * on the command line, so an engine that holds one request in flight walks the
 * queue it has always walked and the decider answers one row.
 */
export async function fetchBatch(decider, width) {
  if (width <= 1) {
    const row = await decider.next();
    return row?.done
      ? { rows: [], remaining: 0 }
      : { rows: [row], remaining: row?.remaining ?? 0 };
  }
  const answer = await decider.next(width);
  return { rows: answer?.rows ?? [], remaining: answer?.remaining ?? 0 };
}

/**
 * The whole run.
 *
 * Steps 1 to 6 of the plan, in that order. The teardown is a `finally`, and on
 * a failure the rehearsal catalog is dumped first, because `--down` removes the
 * slot's volumes and a failed run's rehearsal state is the one thing that
 * cannot be rebuilt afterwards.
 *
 * **A stopped run ends the same way a finished one does.** `signal` is aborted
 * by the first Ctrl+C (see `cli.mjs`), and the walk stops at the row it is on
 * rather than at the process: the report is written over the rows that were
 * decided, and the slot comes down. The rows that were never reached are not
 * lost, because the decider records a decision per row and the queue is read
 * from the main API, so nothing was written there before `--apply`.
 *
 * A stop is recognized by asking the signal, never by reading an error. Ctrl+C
 * reaches the whole terminal, so whichever child was in flight dies of the same
 * keystroke and reports it in its own words; a step that failed while the run
 * was stopping is the stop, and the walk breaks rather than throwing.
 *
 * **The walk asks several rows at a time** (plan 0002), as many as the engine
 * advises and the decider composes. A round is one `askEach` and then one
 * `decide` per row in input order, and the order is what makes it equivalent to
 * walking one row at a time: at the moment row k is recorded, the rehearsal
 * catalog holds the creations of the rows before it in its own round, so the
 * decider's lookups answer exactly what they would have answered sequentially.
 *
 * **Each row is decided as its own reply arrives** (plan 0004), rather than
 * once the whole round is back, so the engine is still answering the rows
 * behind row k for the whole of the time row k spends in the decider. Row k is
 * recorded before the reply to row k plus one is read, so the order above is
 * the order there has always been.
 *
 * **A row that has to be asked again waits for the rest of its round**, and the
 * re-asks are then sent together as another pass over the same rows. What makes
 * that safe is the round's composition rather than the order: no two of its
 * rows can be about the same product, so deferring one of them to the end
 * cannot change what any of them is shown. A round ends when a pass sets
 * nothing aside, and the retry budget is what bounds the passes.
 *
 * A stop part way through a round is a stop like any other: the replies that
 * have not arrived reject with the signal's own reason, the rows already
 * recorded stay recorded, and nothing still in flight is applied. A round is
 * not a transaction and was never going to be one, which is what makes a
 * stopped run resumable.
 *
 * **`limit` stops handing rows to the model after that many** (plan 0003), and
 * is the whole of what it does. It is not a stop: the rows already handed out
 * are decided, the report is written over them, and the run ends the way a
 * finished one does, so the exit code is 0 and the decisions file is a file
 * `--apply` takes. It narrows the batch it asks for rather than trimming one it
 * already fetched, because a fetched row carries a handout the decider is
 * holding open and nothing would ever close it.
 */
export async function runCuration({
  slots,
  makeDeciderFor,
  engine,
  runDir,
  mainUrl,
  mainUser = null,
  model = null,
  chain = null,
  limit = null,
  services = REHEARSAL_SERVICES,
  waitForGateway,
  stripFence,
  stdout,
  stderr,
  dumpPath,
  usage = emptyUsage(),
  signal = null,
  onSlot = null,
}) {
  const taken = await slots.list();
  const slot = pickFreeSlot(taken);
  const url = rehearsalUrl(slot);

  // The number goes to the caller before the slot is brought up, so a second
  // Ctrl+C can name the slot it is leaving behind.
  onSlot?.(slot);

  stderr.write(
    `rehearsing on slot ${slot} (${url}), services ${services.join(', ')}\n`
  );

  await slots.up(slot, services);

  let failed = null;
  let stopped = false;
  let runId = null;
  try {
    await waitForGateway({ url, signal });

    const decider = makeDeciderFor({ runDir });
    // Both admin logins are verified inside `start`. A failure here is a run
    // that ends before the first model call, which is the point of the gate.
    const opened = await decider.start({
      mainUrl,
      rehearsalUrl: url,
      mainUser,
      model,
      chain,
    });

    runId = opened.runId;
    const total = opened.remaining ?? 0;
    stderr.write(`run ${opened.runId}: ${total} rows\n`);
    if (limit !== null) {
      stderr.write(`limit ${limit}: the walk ends after ${limit} rows\n`);
    }

    const width = roundWidth(engine, opened.batches);
    const askOptions = {
      // A decider that answers no schema is driven exactly as before, which is
      // what keeps the two implementations independent of each other.
      system: opened.prompt,
      schema: opened.schema ?? null,
    };

    /**
     * The replies to a pass, one promise per prompt, in input order.
     *
     * A round wider than one goes through `askEach`, so the caller reads the
     * answers as they arrive and the engine is still working on the rows behind
     * the one being decided. A width of one goes through `ask`, which is the
     * walk plan 0001 shipped: one request, and a failure the engine gave up on
     * ends the run rather than being recorded as an unusable reply.
     */
    const askPass = (texts) =>
      width > 1
        ? engine.askEach(texts, askOptions)
        : texts.map((text) =>
            engine
              .ask(text, askOptions)
              .then((answer) => ({ text: String(answer?.text ?? '') }))
          );

    let handed = 0;

    walk: for (;;) {
      if (signal?.aborted) {
        stopped = true;
        break;
      }
      if (limit !== null && handed >= limit) {
        stderr.write(`limit ${limit} reached: ${handed} rows handed out\n`);
        break;
      }
      try {
        // Never wider than the rows the limit has left, so the batch that ends
        // the walk is the exact remainder rather than a batch whose tail would
        // have to be thrown away with its handouts still open.
        const room =
          limit === null ? width : Math.min(width, Math.max(1, limit - handed));
        const batch = await fetchBatch(decider, room);
        if (batch.rows.length === 0) {
          break;
        }
        handed += batch.rows.length;

        // One call for the whole round, and the whole of the saving. A round is
        // composed so that no two of its rows can be about the same product, so
        // asking them together shows each of them what asking them one after
        // another would have shown it.
        let attempts = batch.rows.map(rowAttempt);
        let replies = askPass(attempts.map((attempt) => attempt.body));
        let first = true;

        // A round is a series of passes and ends when a pass sets nothing
        // aside. The retry budget is what bounds them: a row either spends its
        // one retry, and its next answer is recorded whatever it says, or the
        // decider refreshed its packet, which is a question that was never
        // asked. There is no pass counter, on purpose.
        while (attempts.length > 0) {
          const again = [];
          const prompts = [];

          // In input order, and one row at a time: row k is recorded before the
          // reply to row k plus one is even read, which is what makes the round
          // equivalent to walking its rows one after another. What is not
          // waited for is the rest of the round, which the engine is still
          // answering while the decider works.
          for (let index = 0; index < attempts.length; index++) {
            if (signal?.aborted) {
              stopped = true;
              break walk;
            }
            const attempt = attempts[index];
            if (first) {
              const { name } = rowIdentity(attempt.row);
              const position = Math.max(1, total - batch.remaining + 1 + index);
              stderr.write(`${position}/${total} - ${name}\n`);
            }

            const outcome = await stepRow({
              attempt,
              reply: await replies[index],
              decider,
              stripFence,
            });
            if (outcome.answer) {
              stdout.write(`${JSON.stringify(outcome.answer)}\n`);
              continue;
            }
            // A row that has to be asked again waits for the rest of its round
            // rather than being asked here on its own (plan 0004). A re-ask
            // alone is a round of one, with every other slot idle for as long
            // as it takes, and the round's composition is what makes deferring
            // it safe: no two of its rows can be about the same product.
            again.push(attempt);
            prompts.push(outcome.prompt);
          }

          attempts = again;
          first = false;
          if (attempts.length > 0) {
            replies = askPass(prompts);
          }
        }
      } catch (error) {
        if (!signal?.aborted) {
          throw error;
        }
        stopped = true;
        break;
      }
    }

    if (stopped) {
      stderr.write(`stopped: the report covers the rows decided so far\n`);
    }

    // Written for a stopped run too, and that is the whole point of stopping
    // this way: `end` reads the decisions file, so it reports over however many
    // rows the walk reached.
    const report = await decider.end(usage);
    // What the run saw, beside what the plan predicted. A chain that clusters
    // differently from the one that was measured says so here.
    if (report?.reasks) {
      stderr.write(
        `re-asked ${report.reasks.stale} of ${report.reasks.decided} decided rows\n`
      );
    }
    stderr.write(`report: ${report.report}\n`);
    return { slot, runId: opened.runId, report, usage, stopped };
  } catch (error) {
    // A stop that arrived before the first row (during the wait for the
    // gateway, or while the run was opening) has no decisions to report, so
    // there is nothing to write and nothing to say beyond the teardown below.
    if (signal?.aborted) {
      stderr.write(
        runId === null
          ? 'stopped before the run opened; nothing was decided\n'
          : `stopped, and the report could not be written: ${error.message ?? error}\n`
      );
      return { slot, runId, report: null, usage, stopped: true };
    }
    failed = error;
    throw error;
  } finally {
    if (failed && dumpPath) {
      try {
        await slots.dumpCatalog(slot, dumpPath);
        stderr.write(`rehearsal catalog dumped to ${dumpPath}\n`);
      } catch (dumpError) {
        stderr.write(
          `the rehearsal catalog could not be dumped: ${dumpError.message ?? dumpError}\n`
        );
      }
    }
    // The slot is named rather than inferred: it was taken ephemerally, so
    // nothing recorded it, and the alternative to naming it is taking down
    // whichever slot this checkout happens to claim.
    try {
      await slots.down(slot);
    } catch (downError) {
      stderr.write(
        `slot ${slot} did not come down cleanly: ${downError.message ?? downError}\n`
      );
      stderr.write(
        `take it down with: bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --down ${slot}\n`
      );
    }
  }
}
