/**
 * The run, in order (plan 0001).
 *
 * Three parties that must never mix meet here and nowhere else: the decider
 * owns state, credentials and writes; the model owns judgment; this file owns
 * the run. It picks the slot, brings it up, waits for it, opens the run through
 * the decider (which is where both admin logins are verified), drives the
 * next/model/decide loop, and tears the slot down whatever happened.
 *
 * Everything that touches a process, a socket or the clock is injected, so the
 * whole of it runs under `node --test` with no network and no Docker.
 */

import { emptyUsage } from './engine.mjs';
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

/**
 * One row: ask, record, and one retry when the reply cannot be used.
 *
 * The retry is the plan 0098 semantics moved out of the model layer: a first
 * decision that breaks the schema comes back from the decider as
 * `retryable: true` with nothing written, the model is asked again with the
 * reason, and the second answer goes in with `--final`, which records a REVIEW
 * rather than asking a third time.
 */
export async function decideRow({ row, prompt, engine, decider, stripFence }) {
  const { id } = rowIdentity(row);
  const packet = toPacket(row);
  const body = JSON.stringify(packet, null, 2);

  const first = await engine.ask(`${prompt}\n\n${body}`, { system: prompt });
  const decision = parseDecision(first.text, { stripFence });

  let answer;
  let reason;
  if (decision) {
    answer = await decider.decide(id, decision, { final: false });
    if (!answer.retryable) {
      return answer;
    }
    reason = (answer.issues ?? [])
      .map((issue) => issue?.detail ?? issue?.code ?? '')
      .filter(Boolean)
      .join('; ');
  } else {
    reason = 'the reply is not one JSON object';
  }

  const retryPrompt = `${prompt}\n\n${body}\n\n${RETRY_INSTRUCTION.replace('{error}', reason || 'it broke the schema')}`;
  const second = await engine.ask(retryPrompt, { system: prompt });
  const retried = parseDecision(second.text, { stripFence });

  // A second unusable reply is still a decided row: `--final` records it as a
  // REVIEW carrying the reason, so the walk moves on rather than stopping.
  return decider.decide(
    id,
    retried ?? { modelReply: String(second.text ?? '').slice(0, 2000) },
    {
      final: true,
    }
  );
}

/**
 * The whole run.
 *
 * Steps 1 to 6 of the plan, in that order. The teardown is a `finally`, and on
 * a failure the rehearsal catalog is dumped first, because `--down` removes the
 * slot's volumes and a failed run's rehearsal state is the one thing that
 * cannot be rebuilt afterwards.
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
  services = REHEARSAL_SERVICES,
  waitForGateway,
  stripFence,
  stdout,
  stderr,
  dumpPath,
  usage = emptyUsage(),
}) {
  const taken = await slots.list();
  const slot = pickFreeSlot(taken);
  const previousClaim = slots.claimedSlot();
  const url = rehearsalUrl(slot);

  stderr.write(
    `rehearsing on slot ${slot} (${url}), services ${services.join(', ')}\n`
  );

  await slots.up(slot, services);

  let failed = null;
  try {
    await waitForGateway({ url });

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

    const total = opened.remaining ?? 0;
    stderr.write(`run ${opened.runId}: ${total} rows\n`);

    for (;;) {
      const row = await decider.next();
      if (row?.done) {
        break;
      }
      const { name } = rowIdentity(row);
      const position = Math.max(1, total - (row.remaining ?? 0) + 1);
      stderr.write(`${position}/${total} - ${name}\n`);

      const answer = await decideRow({
        row,
        prompt: opened.prompt,
        engine,
        decider,
        stripFence,
      });
      stdout.write(`${JSON.stringify(answer)}\n`);
    }

    const report = await decider.end(usage);
    stderr.write(`report: ${report.report}\n`);
    return { slot, runId: opened.runId, report, usage };
  } catch (error) {
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
    try {
      await slots.down();
    } catch (downError) {
      stderr.write(
        `slot ${slot} did not come down cleanly: ${downError.message ?? downError}\n`
      );
    }
    // `--up <n>` moved this worktree's claim to the rehearsal slot. Putting the
    // previous one back means a developer who had a slot still has it.
    if (previousClaim !== null && previousClaim !== slot) {
      try {
        await slots.configure(previousClaim);
      } catch {
        stderr.write(
          `this worktree's claim on slot ${previousClaim} could not be restored; run luna-slot ${previousClaim} to put it back\n`
        );
      }
    }
  }
}
