/**
 * The decider CLI, driven as a child process (plan 0001).
 *
 * Every subcommand answers one JSON object on stdout and nothing else, so this
 * file is thin on purpose: it builds the argument list, spawns the process,
 * reads the object back, and turns a non-zero exit into an error carrying the
 * stderr the decider wrote. Which decider is running is one path.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

/** The two implementations, and the CLI each one names. */
export const IMPLEMENTATIONS = {
  suggestions: 'libs/luna-shopper/curation-suggestions/src/cli.mjs',
  groups: 'libs/luna-shopper/curation-groups/src/cli.mjs',
};

export const IMPLEMENTATION_NAMES = Object.keys(IMPLEMENTATIONS);

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
 * The JSON object a subcommand answered.
 *
 * The contract is one object and nothing else, but a decider is free to write
 * progress to stderr, so the read is anchored on the last non-empty line of
 * stdout rather than on the whole of it.
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
 * The decider driver.
 *
 * `spawn` is injected in every test and answers `{ code, stdout, stderr }`.
 * Nothing here holds a token or a piece of run state: the decider owns both,
 * in its run directory.
 */
export function makeDecider({
  spawn,
  cliPath,
  runDir,
  node = process.execPath,
  mainPassword = null,
}) {
  const password =
    typeof mainPassword === 'string' && mainPassword !== ''
      ? ['--main-password', mainPassword]
      : [];

  async function call(args, input = undefined) {
    const answer = await spawn(node, [cliPath, ...args], { input });
    if (answer.code !== 0) {
      throw new Error(
        `${args[0]} failed: ${(answer.stderr || answer.stdout || '').trim() || `exit ${answer.code}`}`
      );
    }
    return readAnswer(answer.stdout);
  }

  return {
    cliPath,
    runDir,

    /** Verifies both logins, counts the queue, answers the rules prompt. */
    start({ mainUrl, rehearsalUrl, mainUser, model, chain }) {
      return call([
        'start',
        '--main-url',
        mainUrl,
        '--rehearsal-url',
        rehearsalUrl,
        '--run-dir',
        runDir,
        ...(mainUser ? ['--main-user', mainUser] : []),
        ...(model ? ['--model', model] : []),
        ...(chain ? ['--chain', chain] : []),
        ...password,
      ]);
    },

    /**
     * One row, or `{ done: true }`.
     *
     * With a count it is `{ rows, remaining }` instead, up to that many rows
     * the decider composed so that no two of them can be about the same
     * product (plan 0002). The count is `engine.batchSize` and nothing else,
     * so an engine that holds one request in flight passes none and the
     * subcommand is the one it has always been.
     */
    next(count = null) {
      return call([
        'next',
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
        [
          'decide',
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

    /** The report, with the usage this run accumulated. */
    end(usage) {
      return call([
        'end',
        '--run-dir',
        runDir,
        ...(usage ? ['--usage', JSON.stringify(usage)] : []),
      ]);
    },

    /** The replay: no slot, no model, one request against the main gateway. */
    apply({ mainUrl, file, mainUser }) {
      return call([
        'apply',
        '--main-url',
        mainUrl,
        '--file',
        file,
        ...(mainUser ? ['--main-user', mainUser] : []),
        ...password,
      ]);
    },
  };
}
