/**
 * The decider CLI, driven as one long lived child process (plan 0002).
 *
 * The decider used to be spawned once per step: a hundred Node starts for an
 * eighty row walk, each one loading the commands, the rules, the validators and
 * the vocabularies again. It is now started once, at the first call, and every
 * step is a JSON line written to its stdin and a JSON line read back off its
 * stdout. Which decider is running is still one path.
 *
 * What did not change is everything the run's correctness rests on. The child
 * runs one command at a time and each command still reads and rewrites the
 * state file, so a killed walk leaves the run directory a killed process would
 * have left, and the ordering argument of plan 0002 of this library still
 * holds. Nothing here holds a token or a piece of run state: the decider owns
 * both, in its run directory.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/** The two implementations, and the CLI each one names. */
export const IMPLEMENTATIONS = {
  suggestions: 'libs/luna-shopper/curation-suggestions/src/cli.mjs',
  groups: 'libs/luna-shopper/curation-groups/src/cli.mjs',
};

export const IMPLEMENTATION_NAMES = Object.keys(IMPLEMENTATIONS);

/** How much of the child's stderr is kept for the message a failure carries. */
const STDERR_TAIL = 4000;

/** How long a closing child has to end itself before it is killed. */
const CLOSE_GRACE_MS = 2000;

/** How long a broken request pipe waits for the exit that explains it. */
const PIPE_GRACE_MS = 200;

/** The path of one implementation's CLI, or an error naming the two there are. */
export function deciderPath(implementation, repoRoot) {
  const relative = IMPLEMENTATIONS[implementation];
  if (!relative) {
    throw new Error(
      `Unknown implementation ${implementation}. It is one of: ${IMPLEMENTATION_NAMES.join(', ')}.`
    );
  }
  return `${repoRoot}/${relative}`;
}

/**
 * The JSON object one line of the decider's stdout carries.
 *
 * The contract is one object per line and nothing else, but a decider is free
 * to write progress to stderr, so this is anchored on the last non-empty line
 * rather than on the whole of what it was handed. The channel below feeds it
 * one line at a time and treats a line it refuses as noise.
 */
export function readAnswer(stdout) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const last = lines[lines.length - 1];
  if (last === undefined) {
    throw new Error('the decider answered nothing on stdout');
  }
  try {
    return JSON.parse(last);
  } catch (error) {
    throw new Error(
      `the decider answered something that is not JSON: ${String(error.message ?? error)}`
    );
  }
}

/**
 * The line protocol, over one child process.
 *
 * `child` is whatever `startChild` answered, and the only things asked of it
 * are the three streams, `on` and `kill`, so the tests hand it a pair of
 * in-memory streams and no process is started.
 *
 * A child that exits is a failed run, always: `serve` ends when its stdin
 * closes and never otherwise. So an exit rejects every call still waiting and
 * every call made afterwards, with one error naming the exit code and the tail
 * of the stderr, which is the message the operator needs.
 */
export function makeChannel(child) {
  const pending = new Map();
  let nextId = 1;
  let stderrTail = '';
  let dead = null;
  let exited = null;

  child.stdout?.setEncoding?.('utf8');
  child.stderr?.setEncoding?.('utf8');

  let buffer = '';
  child.stdout?.on('data', (chunk) => {
    buffer += chunk;
    let cut = buffer.indexOf('\n');
    while (cut !== -1) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      deliver(line);
      cut = buffer.indexOf('\n');
    }
  });

  child.stderr?.on('data', (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_TAIL);
  });

  /**
   * One line of stdout.
   *
   * A line that is not JSON, and a line whose id names no call, are both
   * ignored. Matching an answer onto the wrong call would record a decision
   * against the wrong row, so anything unrecognized is noise by construction.
   */
  function deliver(line) {
    if (line.trim() === '') {
      return;
    }
    let message;
    try {
      message = readAnswer(line);
    } catch {
      return;
    }
    const call = pending.get(message?.id);
    if (!call) {
      return;
    }
    pending.delete(message.id);
    if (typeof message.error === 'string') {
      call.reject(new Error(message.error));
      return;
    }
    call.resolve(message.answer);
  }

  function die(reason) {
    dead = dead ?? reason;
    for (const [id, call] of pending) {
      pending.delete(id);
      call.reject(dead);
    }
  }

  const onExit = (code, signal) => {
    exited = { code: code ?? null, signal: signal ?? null };
    const how =
      code === null || code === undefined
        ? `was killed by ${signal ?? 'a signal'}`
        : `exited with code ${code}`;
    const tail = stderrTail.trim();
    die(
      new Error(
        `the decider ${how}${tail ? `: ${tail}` : ' and wrote nothing to stderr'}`
      )
    );
  };
  child.on('exit', onExit);
  child.on('error', (error) => {
    die(new Error(`the decider could not be run: ${error.message ?? error}`));
  });
  // A write into a pipe whose reader is gone fails on the stream rather than at
  // the call, and an unhandled stream error would end this process. The child
  // is on its way out whenever this happens, and the exit that follows carries
  // the exit code and the stderr, which is the message worth reading. So the
  // pipe error waits a moment for that exit and only speaks if none comes,
  // which is the case that would otherwise hang the call in flight.
  child.stdin?.on('error', (error) => {
    const timer = setTimeout(() => {
      die(
        new Error(
          `the decider stopped reading its requests: ${error.message ?? error}`
        )
      );
    }, PIPE_GRACE_MS);
    timer.unref?.();
  });

  return {
    get exited() {
      return exited;
    },

    /** One request, and the answer to it. */
    send(command, args, input) {
      if (dead) {
        return Promise.reject(dead);
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const request = { id, command, args };
        if (input !== undefined) {
          request.input = input;
        }
        try {
          child.stdin.write(`${JSON.stringify(request)}\n`);
        } catch (error) {
          pending.delete(id);
          reject(
            new Error(
              `the decider would not take the request: ${error.message ?? error}`
            )
          );
        }
      });
    },

    /**
     * Ends the session.
     *
     * Closing stdin is what ends `serve`, so the ordinary close is the child
     * ending itself. The kill is the second lock, for a decider wedged inside a
     * command: without it a stuck child would keep the orchestrator alive after
     * the run had finished.
     */
    close() {
      if (exited) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill?.();
        }, CLOSE_GRACE_MS);
        timer.unref?.();
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        try {
          child.stdin.end();
        } catch {
          // A pipe already gone is a child already going. The exit above is
          // what this waits for either way.
        }
      });
    },
  };
}

/**
 * The decider driver.
 *
 * `startChild` is injected in every test and answers a child process: three
 * streams, `on` and `kill`. The child is started at the first call rather than
 * here, so building a decider costs nothing and a run that never reaches the
 * decider never starts one.
 */
export function makeDecider({
  startChild,
  cliPath,
  runDir,
  node = process.execPath,
  mainPassword = null,
}) {
  const password =
    typeof mainPassword === 'string' && mainPassword !== ''
      ? ['--main-password', mainPassword]
      : [];

  let channel = null;

  function open() {
    if (!channel) {
      channel = makeChannel(startChild(node, [cliPath, 'serve']));
    }
    return channel;
  }

  async function call(command, args, input = undefined) {
    try {
      return await open().send(command, args, input);
    } catch (error) {
      // The shape the one shot path had, so the orchestrator's failure path
      // reads a dead child exactly as it read a non-zero exit.
      throw new Error(`${command} failed: ${error.message ?? error}`);
    }
  }

  async function close() {
    if (channel) {
      await channel.close();
    }
  }

  return {
    cliPath,
    runDir,
    close,

    /** Verifies both logins, counts the queue, answers the rules prompt. */
    start({ mainUrl, rehearsalUrl, mainUser, model, local, chain }) {
      return call('start', [
        '--main-url',
        mainUrl,
        '--rehearsal-url',
        rehearsalUrl,
        '--run-dir',
        runDir,
        ...(mainUser ? ['--main-user', mainUser] : []),
        ...(model ? ['--model', model] : []),
        // A bare flag, and absent when the engine is not a local one, so a run
        // against a Claude model builds the argument list it always built.
        ...(local ? ['--local'] : []),
        ...(chain ? ['--chain', chain] : []),
        ...password,
      ]);
    },

    /**
     * One row, or `{ done: true }`.
     *
     * With a count it is `{ rows, remaining }` instead, up to that many rows
     * the decider composed so that no two of them can be about the same
     * product (plan 0002 of this library). The count is `engine.batchSize` and
     * nothing else, so an engine that holds one request in flight passes none
     * and the command is the one it has always been.
     */
    next(count = null) {
      return call('next', [
        '--run-dir',
        runDir,
        ...(count ? ['--count', String(count)] : []),
        ...password,
      ]);
    },

    /**
     * The decision, validated and recorded by the decider.
     *
     * Without `final` a reply that breaks the schema answers `retryable: true`
     * and writes nothing, which is what buys the one retry. A row whose
     * candidates changed since `next` handed it out answers `stale: true` with
     * the refreshed packet, writes nothing, and spends no retry: the model was
     * asked the wrong question rather than answering badly.
     */
    decide(entryId, decision, { final = false } = {}) {
      return call(
        'decide',
        [
          '--run-dir',
          runDir,
          '--entry',
          entryId,
          ...(final ? ['--final'] : []),
          ...password,
        ],
        JSON.stringify(decision)
      );
    },

    /**
     * The report, with the usage this run accumulated.
     *
     * The last thing a run asks for, so it is also what closes the child. A
     * run that fails before it gets here is closed by `cli.mjs`, and `close` is
     * idempotent, so the two paths cannot fight.
     */
    async end(usage) {
      try {
        return await call('end', [
          '--run-dir',
          runDir,
          ...(usage ? ['--usage', JSON.stringify(usage)] : []),
        ]);
      } finally {
        await close();
      }
    },

    /**
     * The replay: no slot, no model, one request against the main gateway.
     *
     * A refused file answers `applied: false` and, from the command line, exits
     * 2, which the one shot channel turned into a throw. There are no exit
     * codes inside a session, so the throw is raised here instead. It is the
     * contract callers have, accident of the exit code or not.
     */
    async apply({ mainUrl, file, mainUser }) {
      try {
        const answer = await call('apply', [
          '--main-url',
          mainUrl,
          '--file',
          file,
          ...(mainUser ? ['--main-user', mainUser] : []),
          ...password,
        ]);
        if (answer?.applied === false) {
          throw new Error(`apply failed: ${JSON.stringify(answer)}`);
        }
        return answer;
      } finally {
        await close();
      }
    },
  };
}
