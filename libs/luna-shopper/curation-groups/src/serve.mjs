/**
 * The long lived mode (plan 0002 of `curation-suggestions`).
 *
 * **The twin of `curation-suggestions/src/serve.mjs`, and deliberately a
 * copy.** The two deciders share `curation-auth` and nothing else: neither
 * imports the other, and `run-dir`, `gateway`, `packet`, `rules`, `decision`
 * and `test-fakes` are each a pair of files by the same design. A loop that
 * knows only its own `run` is the smallest of those pairs, and making it the
 * first thing one library imports out of the other would buy a hundred lines
 * and cost the independence. Fix a defect in both.
 *
 * Every subcommand used to be a fresh Node process, which is roughly 200 ms of
 * start for a step that does one HTTP request. A walk of eighty rows pays that
 * a hundred times. `serve` pays it once: it reads one JSON request per line on
 * stdin, calls exactly the same `run` the command line calls, and writes one
 * JSON answer per line on stdout.
 *
 * Nothing about a command changes here, and that is the point. The state file
 * is still read and rewritten by every command that touches it, in the order it
 * always was, so a killed session leaves the same run directory a killed
 * process would have left.
 *
 *   { "id": 3, "command": "decide", "args": ["--run-dir", "/runs/x", "--item", "i1"], "input": "{...}" }
 *   { "id": 3, "answer": { "accepted": true, "remaining": 17 } }
 *   { "id": 3, "error": "the decision on stdin is not JSON: ..." }
 *
 * `args` is the flag list the command line would carry, without the command
 * word. `input` is what the one shot path would have read from stdin, and only
 * `decide` carries it. The answer is nested under `answer` rather than spread
 * into the line, so that a command which one day answers an `id` of its own
 * cannot overwrite the correlation id.
 *
 * Progress and errors still go to stderr. stdout carries answer lines and
 * nothing else.
 */

import { createInterface } from 'node:readline';

/** The commands a request may name. `serve` is not one of them. */
export const SERVABLE = ['start', 'next', 'decide', 'end', 'apply'];

/**
 * One request, answered.
 *
 * A request that cannot be read at all still answers a line, because the caller
 * is waiting on an id and an unanswered request would hang the walk rather than
 * fail it. The id is whatever the request carried, or null when it carried
 * nothing readable.
 */
export async function answerRequest(text, run) {
  let request = null;
  try {
    request = JSON.parse(text);
  } catch (error) {
    return {
      id: null,
      error: `the request is not JSON: ${String(error.message ?? error)}`,
    };
  }

  const id = request?.id ?? null;
  const command = request?.command;
  if (typeof command !== 'string' || !SERVABLE.includes(command)) {
    return {
      id,
      error: `${command === undefined ? '(no command)' : command} is not one of: ${SERVABLE.join(', ')}`,
    };
  }

  const args = Array.isArray(request.args) ? request.args.map(String) : [];
  const input = typeof request.input === 'string' ? request.input : '';

  try {
    const answer = await run([command, ...args], { stdin: () => input });
    return { id, answer };
  } catch (error) {
    return { id, error: String(error?.message ?? error) };
  }
}

/**
 * The loop, until stdin closes.
 *
 * Requests are answered in order, chained on one promise. That is deliberate
 * and it is not the beginning of a multiplexer: two commands in flight at once
 * would do read, modify and write on one state file, which is the third of the
 * three reasons plan 0003 of `curation-cli` refused to overlap the decider. The
 * id exists to match an answer to the call that asked for it, nothing more.
 */
export function serve({ input, output, run }) {
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input, crlfDelay: Infinity });
    let chain = Promise.resolve();
    let failed = null;

    lines.on('line', (line) => {
      const text = line.trim();
      if (text === '') {
        return;
      }
      chain = chain.then(async () => {
        const answer = await answerRequest(text, run);
        output.write(`${JSON.stringify(answer)}\n`);
      });
      // A write that fails takes the session down: the caller is waiting on an
      // answer that will never arrive, so failing loudly beats serving on into
      // a pipe nobody reads.
      chain = chain.catch((error) => {
        failed = failed ?? error;
        lines.close();
      });
    });

    lines.on('close', () => {
      chain.then(
        () => (failed ? reject(failed) : resolve()),
        (error) => reject(error)
      );
    });
    lines.on('error', reject);
  });
}
