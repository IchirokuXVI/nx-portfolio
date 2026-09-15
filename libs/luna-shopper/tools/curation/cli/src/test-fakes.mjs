/**
 * A fake long lived decider, for the tests only (plan 0002 of
 * `curation-suggestions`).
 *
 * `decider.mjs` asks a child for three streams, `on`, `once` and `kill`, so a
 * pair of in-memory streams is a whole child as far as it is concerned. No test
 * in this library starts a process, and every one of them can therefore assert
 * on exactly which request lines were written and in which order.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

/**
 * A child that answers each request out of a queue.
 *
 * `answers` is consumed in order. An entry of `{ __error: 'why' }` answers
 * `{ id, error }`, an entry of `{ __noise: 'text' }` writes that line to stdout
 * before answering the request from the next entry, an entry of
 * `{ __hang: true }` takes the request and never answers it, and anything else
 * is the `answer` half of the line. A queue that runs out answers
 * `{ done: true }`, which is what a walk past the end of the queue sees.
 *
 * A request is answered synchronously, because a stream in flowing mode hands
 * a write straight to its reader. So `__hang` is the only way to hold a call
 * open long enough to do something to the child while it is in flight.
 */
export function fakeChild(answers = []) {
  const queue = [...answers];
  const requests = [];
  const child = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  child.stdin = stdin;
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('exit', null, 'SIGTERM');
  };

  /** Ends the child the way a crash would, so the channel has to notice. */
  child.crash = (code = 1, message = '') => {
    if (message) {
      stderr.write(message);
    }
    child.emit('exit', code, null);
  };

  let buffer = '';
  stdin.on('data', (chunk) => {
    buffer += chunk;
    let cut = buffer.indexOf('\n');
    while (cut !== -1) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      if (line.trim() !== '') {
        answerOne(JSON.parse(line));
      }
      cut = buffer.indexOf('\n');
    }
  });

  // Closing stdin is what ends a real `serve`, so the fake ends the same way.
  stdin.on('end', () => {
    child.emit('exit', 0, null);
  });

  function answerOne(request) {
    requests.push(request);
    while (queue[0]?.__noise !== undefined) {
      stdout.write(`${queue.shift().__noise}\n`);
    }
    const entry = queue.shift() ?? { done: true };
    if (entry.__hang) {
      return;
    }
    const line =
      entry.__error === undefined
        ? { id: request.id, answer: entry }
        : { id: request.id, error: entry.__error };
    stdout.write(`${JSON.stringify(line)}\n`);
  }

  return { child, requests, startChild: () => child };
}
