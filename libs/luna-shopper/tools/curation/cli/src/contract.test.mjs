/**
 * The arguments the orchestrator builds, read by the real deciders (plan 0005).
 *
 * `decider.test.mjs` checks what `makeDecider` sends and each decider's own
 * tests check what it reads. Both passed while the orchestrator sent `--entry`
 * and the groups decider required `--item`, so the first groups row failed in a
 * real run and no test said so. Here the lines `makeDecider` writes are handed
 * to each real CLI's `run()`, so a flag one side renames breaks this file.
 *
 * No command may fail on its flags. Each is pointed at something that answers
 * without the network, or at a local server that refuses the login, so what
 * comes back proves the command was reached and read what it was given.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { run as runGroups } from '../../groups/src/cli.mjs';
import { run as runSuggestions } from '../../suggestions/src/cli.mjs';
import { makeDecider } from './decider.mjs';
import { fakeChild } from './test-fakes.mjs';

/** What a decider says when it could not read its own flags. */
const FLAG_ERROR =
  /is required|Unexpected argument|Unknown command|takes a whole number|is not one of/;

/** A gateway that refuses every login, so `start` fails after its flags. */
async function refusingGateway() {
  const server = createServer((request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end('{"message":"no"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/**
 * A run directory in which the row `id` is already decided, so `decide`
 * answers with the id it was given, and `next` and `end` answer without a
 * gateway.
 */
function runDirFor(implementation, id) {
  const dir = mkdtempSync(
    join(tmpdir(), `curation-contract-${implementation}-`)
  );
  const header = { header: true, runId: 'r1', mainUrl: 'http://x' };
  writeFileSync(join(dir, 'decisions.jsonl'), `${JSON.stringify(header)}\n`);
  const state =
    implementation === 'suggestions'
      ? {
          runId: 'r1',
          mainUrl: 'http://x',
          rehearsalUrl: 'http://y',
          chains: [],
          decidedIds: [id],
        }
      : {
          runId: 'r1',
          mainUrl: 'http://x',
          rehearsalUrl: 'http://y',
          limit: 0,
          decidedIds: [id],
        };
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
  writeFileSync(join(dir, 'brands.json'), JSON.stringify({ brands: [] }));
  return dir;
}

/** Every request `makeDecider` writes over one walk, as the child reads them. */
async function requestsFor({ runDir, gatewayUrl, file, local }) {
  const { requests, startChild } = fakeChild([{}, {}, {}, {}, {}, {}]);
  const decider = makeDecider({
    startChild,
    cliPath: '/c.mjs',
    runDir,
    mainPassword: 'secret',
  });
  await decider.start({
    mainUrl: gatewayUrl,
    rehearsalUrl: gatewayUrl,
    mainUser: 'dev-admin',
    model: 'm',
    local,
    chain: 'chain-1',
  });
  await decider.next();
  await decider.next(4);
  await decider.decide('row-1', { decision: 'REVIEW' }, { final: true });
  await decider.end({ calls: 1 });

  const applier = fakeChild([{}]);
  await makeDecider({
    startChild: applier.startChild,
    cliPath: '/c.mjs',
    runDir: null,
    mainPassword: 'secret',
  }).apply({ mainUrl: 'http://x', file, mainUser: 'dev-admin' });
  return [...requests, ...applier.requests];
}

for (const [implementation, run, alreadyDecided] of [
  ['suggestions', runSuggestions, /Entry row-1 is already in/],
  ['groups', runGroups, /Product row-1 is already in/],
]) {
  test(`every request the orchestrator builds is one the ${implementation} CLI reads`, async () => {
    const gateway = await refusingGateway();
    const runDir = runDirFor(implementation, 'row-1');
    const file = join(runDir, 'decisions.jsonl');
    try {
      const requests = await requestsFor({
        runDir,
        gatewayUrl: gateway.url,
        file,
        local: true,
      });
      const outcomes = {};
      for (const request of requests) {
        try {
          outcomes[request.command] = {
            answer: await run([request.command, ...request.args], {
              stdin: () => request.input ?? '',
            }),
          };
        } catch (error) {
          outcomes[request.command] = { error: String(error.message) };
        }
        assert.doesNotMatch(
          outcomes[request.command].error ?? '',
          FLAG_ERROR,
          `${implementation} ${request.command} could not read its flags`
        );
      }

      // Reached, and refused by the login rather than by its flags.
      assert.match(outcomes.start.error, /401/);
      // Reached, and named the row the orchestrator sent.
      assert.match(outcomes.decide.error, alreadyDecided);
      assert.equal(outcomes.next.answer.done, true);
      assert.match(outcomes.end.answer.report, /report\.json$/);
      assert.equal(outcomes.apply.answer.operations, 0);
    } finally {
      gateway.close();
      rmSync(runDir, { recursive: true, force: true });
    }
  });
}
