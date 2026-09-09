/**
 * The rehearsal slot, and the only place in the toolchain that knows what a
 * slot is (plan 0001).
 *
 * The deciders take urls. This file turns "a fresh dev slot" into those urls:
 * it asks `luna-slot` which slots are taken, picks the lowest free one, brings
 * up only the three services a rehearsal needs, and takes it down again. It
 * never probes a port itself, because `luna-slot --list` already answers that
 * and two answers would eventually disagree.
 *
 * EVERY VERB IS `--ephemeral`, and that is the whole relationship with the
 * checkout it runs in. An ordinary `luna-slot --up <n>` configures the worktree
 * for that slot: it rewrites eight .env files and moves the claim. Doing that
 * for a rehearsal meant taking the developer's own stack apart for the length of
 * a run and putting it back afterwards, from a `finally` that a Ctrl+C skips. An
 * ephemeral run writes none of it and claims nothing, so a developer serving
 * slot 0 in the same checkout keeps serving slot 0 while this runs beside it,
 * and a run that dies leaves their configuration exactly as it was.
 *
 * The price is that the slot number goes on every command, because nothing
 * records it. That is why `down` takes one.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/**
 * Slot 0 is never taken: it is the developer's own, and it is usually the main
 * API this run reads its queue from. The upper bound is `MAX_SLOT` in
 * `luna-slot.sh`, and a change there has to be repeated here.
 */
export const MIN_SLOT = 1;
export const MAX_SLOT = 9;

/** The band `luna-slot.sh` derives a slot's ports from. Gateway is offset 0. */
const SLOT_BAND = 43000;
const SLOT_STRIDE = 100;
const DEFAULT_GATEWAY_PORT = 3000;

/** The three services a rehearsal uses, and no others. */
export const REHEARSAL_SERVICES = ['gateway', 'auth', 'catalog'];

/** Readiness, not liveness: the gateway answers this once it can serve. */
export const READY_PATH = '/health/ready';

/**
 * How long `--up` may take to see the services listen.
 *
 * `luna-slot` defaults to 180 seconds, which is generous for a warm workspace
 * and short for a cold one: the first `nx serve` of a backend service in a
 * fresh worktree compiles it. A rehearsal that times out costs the whole run,
 * so it waits longer.
 */
export const UP_TIMEOUT_SECONDS = 600;

/** The Postgres the dump reads, and the role that owns it. */
const CATALOG_DB_SERVICE = 'catalog-db';
const CATALOG_DB_USER = 'luna_catalog';
const CATALOG_DB_NAME = 'luna_catalog';

const SH_PATH = 'k8s/e2e/luna-shopper-backend/luna-slot.sh';

/**
 * One data row of the `--list` table.
 *
 * The table is fixed width: two leading spaces, the slot number, the compose
 * project, then four `open/total` counts. The header row
 * says `SLOT` rather than a number and the notes below the table never start
 * with a number, so anchoring on "digits, a project name, a count" reads the
 * body and nothing else.
 */
const LIST_ROW =
  /^\s+(\d+)\s+(?:luna-slot\d+|luna-shopper-backend)\s+\d+\/\d+\s/;

/**
 * Every slot the table names, which is every slot that is taken.
 *
 * A row exists when a worktree claims the slot or one of its ports answers,
 * which is exactly the two ways a slot can be somebody else's. A slot with
 * neither is omitted from the table, so absence is the free answer.
 */
export function parseTakenSlots(text) {
  const taken = new Set();
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = LIST_ROW.exec(line);
    if (match) {
      taken.add(Number(match[1]));
    }
  }
  return [...taken].sort((a, b) => a - b);
}

/**
 * The lowest free slot, or an error naming what is in the way.
 *
 * No free slot stops the run here, before a service is started or a token is
 * spent, and the message names the taken slots so the operator can free one.
 */
export function pickFreeSlot(taken, { min = MIN_SLOT, max = MAX_SLOT } = {}) {
  const busy = new Set(taken);
  for (let slot = min; slot <= max; slot++) {
    if (!busy.has(slot)) {
      return slot;
    }
  }
  const listed = [...busy]
    .filter((slot) => slot >= min && slot <= max)
    .sort((a, b) => a - b)
    .join(', ');
  throw new Error(
    `Every slot from ${min} to ${max} is taken (${listed}). Free one with luna-slot --down in the worktree that holds it, then run this again.`
  );
}

/** The compose project of a slot, named the same way luna-slot names it. */
export function slotProject(slot) {
  return slot === 0 ? 'luna-shopper-backend' : `luna-slot${slot}`;
}

/** The gateway port of a slot. Slot 0 keeps the historic port. */
export function gatewayPort(slot) {
  return slot === 0
    ? DEFAULT_GATEWAY_PORT
    : SLOT_BAND + (slot - 1) * SLOT_STRIDE;
}

/** The url the deciders are given as `--rehearsal-url`. */
export function rehearsalUrl(slot) {
  return `http://localhost:${gatewayPort(slot)}`;
}

/**
 * The command that runs a `luna-slot` verb.
 *
 * Always bash, on every platform. The PowerShell twin was deleted with
 * `tools/dev/plans/0003`: Git Bash is the supported shell on Windows, and the
 * bash script already handles Windows itself, through `taskkill //F //T` and
 * `netstat -ano`.
 *
 * `platform` is still accepted, and ignored, so no caller has to change.
 */
export function lunaSlotCommand(
  verb,
  { repoRoot, slot, services, timeoutSeconds }
) {
  const args = [`${repoRoot}/${SH_PATH}`];
  if (verb === 'list') {
    // The one verb that is not ephemeral: it reads every slot and writes
    // nothing, and `--ephemeral` is refused on it for saying otherwise.
    args.push('--list');
    return { command: 'bash', args };
  }

  if (verb !== 'up' && verb !== 'down' && verb !== 'restart') {
    throw new Error(`luna-slot has no ${verb} for a rehearsal to run.`);
  }
  if (!Number.isInteger(slot)) {
    throw new Error(
      `luna-slot --ephemeral --${verb} needs the slot number: nothing records it.`
    );
  }
  args.push('--ephemeral', `--${verb}`, String(slot));

  if (services && services.length) {
    args.push('--services', services.join(','));
  }
  if (timeoutSeconds) {
    args.push('--timeout', String(timeoutSeconds));
  }
  return { command: 'bash', args };
}

/**
 * The `pg_dump` that saves the rehearsal before the teardown removes it.
 *
 * Compose names a container `<project>-<service>-1` and nothing in the compose
 * file overrides that, so the container is addressable without reading the
 * compose file or its environment.
 */
export function catalogDumpCommand(slot) {
  return {
    command: 'docker',
    args: [
      'exec',
      '-i',
      `${slotProject(slot)}-${CATALOG_DB_SERVICE}-1`,
      'pg_dump',
      '-U',
      CATALOG_DB_USER,
      CATALOG_DB_NAME,
    ],
  };
}

/**
 * The slot driver the orchestrator holds.
 *
 * `run` is injected in every test and is the only thing here that touches a
 * process: it takes a command and its arguments and answers
 * `{ code, stdout, stderr }`.
 */
export function makeSlots({
  run,
  repoRoot,
  platform = process.platform,
  writeFile = null,
}) {
  async function invoke(verb, options = {}) {
    const { command, args } = lunaSlotCommand(verb, {
      platform,
      repoRoot,
      ...options,
    });
    const answer = await run(command, args, { cwd: repoRoot });
    if (answer.code !== 0) {
      throw new Error(
        `luna-slot ${verb} failed with exit ${answer.code}: ${(answer.stderr || answer.stdout || '').trim()}`
      );
    }
    return answer;
  }

  return {
    /** Every taken slot, as `luna-slot --list` reports it. */
    async list() {
      const answer = await invoke('list');
      return parseTakenSlots(answer.stdout);
    },

    /**
     * Brings up one slot with only the rehearsal's services.
     *
     * Ephemeral, so it configures nothing: this checkout's .env files and its
     * claim are read and left alone, and the slot's own values reach the three
     * services through their environment.
     */
    up(slot, services = REHEARSAL_SERVICES) {
      return invoke('up', {
        slot,
        services,
        timeoutSeconds: UP_TIMEOUT_SECONDS,
      });
    },

    /**
     * Takes that slot down: its services, its containers and its volumes.
     *
     * The number is required and it is the number `up` was given. An ephemeral
     * slot records nothing, so a `down` with no number would have nothing to
     * read back, and the slot this checkout claims is exactly what it must not
     * reach for instead.
     */
    down(slot) {
      return invoke('down', { slot });
    },

    /**
     * Dumps the rehearsal catalog into the run directory.
     *
     * It runs before the teardown and only on a failure, because the teardown
     * removes the slot's volumes and a failed run's rehearsal state is the one
     * thing that cannot be reconstructed afterwards.
     */
    async dumpCatalog(slot, path) {
      const { command, args } = catalogDumpCommand(slot);
      const answer = await run(command, args, { cwd: repoRoot });
      if (answer.code !== 0) {
        throw new Error(
          `pg_dump of slot ${slot} failed with exit ${answer.code}: ${(answer.stderr || '').trim()}`
        );
      }
      if (writeFile) {
        writeFile(path, answer.stdout);
      }
      return path;
    },
  };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the slot gateway to answer readiness.
 *
 * `luna-slot --up` waits for the port to open, which happens before Nest has
 * finished wiring the broker. The dual login gate immediately after this would
 * read that as a failed login, so the run waits for the service rather than
 * for the socket.
 */
export async function waitForGateway({
  url,
  fetchImpl = fetch,
  timeoutMs = 120000,
  intervalMs = 1000,
  sleep = defaultSleep,
  now = () => Date.now(),
}) {
  const deadline = now() + timeoutMs;
  let lastError = 'it never answered';
  for (;;) {
    try {
      const response = await fetchImpl(`${url}${READY_PATH}`);
      if (response.ok) {
        return true;
      }
      lastError = `it answered ${response.status}`;
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
    if (now() >= deadline) {
      throw new Error(
        `The rehearsal gateway at ${url} did not become ready within ${Math.round(timeoutMs / 1000)}s: ${lastError}.`
      );
    }
    await sleep(intervalMs);
  }
}
