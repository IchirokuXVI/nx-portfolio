/**
 * `--apply`, as the operator types it (plan 0005).
 *
 * The replay itself is the decider's: it reads the file, builds the operations
 * and sends one request. What this file adds is everything the operator used
 * to do by hand before that request. The implementation is read from the run
 * directory, the main url from the file's own header, and a file over the
 * route's cap is split into parts that each fit.
 *
 * **A split never cuts a ref from what it names.** A LINK or an ASSIGN may name
 * a product or a group by the `ref` of a CREATE in the same file, and the
 * server resolves that ref inside one request only. So a CREATE and every row
 * that names its ref travel in the same part. Each part is an ordinary
 * decisions file with the original header, written beside the original, and
 * sent by the decider exactly as a file under the cap would be sent.
 *
 * A split file is not all or nothing any more, and that is the price of the
 * cap. The parts go in order and the first refusal stops the rest, so what
 * landed is always a prefix, and the message names the parts still to send.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { IMPLEMENTATION_NAMES } from './decider.mjs';
import {
  readDecisions,
  runFileBeside,
  sniffImplementation,
} from './run-files.mjs';
import { applyCommandLine } from './summary.mjs';

/**
 * The decider's own operation builder and cap.
 *
 * Imported when asked for rather than at the top of the file, so a walk that
 * never applies never loads either decider's commands.
 */
export async function loadDeciderOperations(implementation) {
  const module =
    implementation === 'groups'
      ? await import('../../groups/src/commands.mjs')
      : await import('../../suggestions/src/commands.mjs');
  return {
    buildOperations: module.buildOperations,
    maxOperations: module.MAX_OPERATIONS,
  };
}

/**
 * The records of a file, in parts of at most `max` operations each.
 *
 * A unit is a CREATE with every row that names its ref, or a row on its own.
 * Units are packed in the order they first appear, and the records of a part
 * keep the order they have in the file. A single unit over the cap cannot be
 * split without breaking a ref, so it is refused.
 */
export function splitDecisions({ records, buildOperations, max }) {
  const units = [];
  const unitOfRef = new Map();
  records.forEach((record, index) => {
    const names = record.itemRef ?? record.groupRef ?? null;
    const target =
      record.decision !== 'REVIEW' && names ? unitOfRef.get(names) : undefined;
    if (target) {
      target.entries.push({ record, index });
      return;
    }
    const unit = { entries: [{ record, index }] };
    units.push(unit);
    if (record.ref) {
      unitOfRef.set(record.ref, unit);
    }
  });

  const parts = [];
  let current = [];
  let size = 0;
  for (const unit of units) {
    const weight = buildOperations(
      unit.entries.map((entry) => entry.record)
    ).length;
    if (weight > max) {
      throw new Error(
        `${unit.entries[0].record.ref} and the rows that name it are ${weight} operations, over the cap of ${max}, and a ref cannot be split from what it names.`
      );
    }
    if (size + weight > max && current.length > 0) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(...unit.entries);
    size += weight;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts.map((entries) =>
    entries.sort((a, b) => a.index - b.index).map((entry) => entry.record)
  );
}

/** `decisions.part-2-of-3.jsonl`, beside the file it was cut from. */
export function partPath(file, index, count) {
  const name = basename(file).replace(/\.jsonl$/, '');
  return join(dirname(file), `${name}.part-${index + 1}-of-${count}.jsonl`);
}

/**
 * Applies a decisions file, in as many requests as the cap asks for.
 *
 * `makeDeciderFor` answers a fresh decider per request, because `apply` closes
 * the child it ran on.
 */
export async function applyDecisions({
  file,
  implementation: named = null,
  mainUrl: givenUrl = null,
  mainUser = null,
  passwordGiven = false,
  makeDeciderFor,
  stdout,
  stderr,
  loadOperations = loadDeciderOperations,
  writeFile = (path, text) => writeFileSync(path, text, 'utf8'),
}) {
  if (!existsSync(file)) {
    throw new Error(`${file} does not exist.`);
  }
  const { header, records } = readDecisions(file);
  if (!header) {
    throw new Error(`${file} has no header line. It is not a decisions file.`);
  }
  // The file says where it was decided against, and the decider refuses any
  // other url anyway. So the flag is only needed to name a different spelling
  // of the same gateway.
  const mainUrl = givenUrl ?? header.mainUrl;
  if (!mainUrl) {
    throw new Error(
      `${file} names no main url in its header. Pass --main-url.`
    );
  }

  const implementation =
    named ??
    runFileBeside(file)?.implementation ??
    sniffImplementation(records);
  if (!implementation) {
    stderr.write(`nothing to apply: ${file} holds no decided rows\n`);
    return { operations: 0, parts: 0 };
  }
  if (!IMPLEMENTATION_NAMES.includes(implementation)) {
    throw new Error(
      `Unknown implementation ${implementation}. It is one of: ${IMPLEMENTATION_NAMES.join(', ')}.`
    );
  }

  const { buildOperations, maxOperations } =
    await loadOperations(implementation);
  const operations = buildOperations(records).length;
  if (operations === 0) {
    stderr.write(
      `nothing to apply: every one of the ${records.length} decided rows is a REVIEW\n`
    );
    return { operations: 0, parts: 0 };
  }

  const send = async (path) => {
    const answer = await makeDeciderFor(implementation).apply({
      mainUrl,
      file: path,
      mainUser,
    });
    stdout.write(`${JSON.stringify(answer)}\n`);
    return answer;
  };

  if (operations <= maxOperations) {
    await send(file);
    stderr.write(`applied ${operations} operations to ${mainUrl}\n`);
    return { operations, parts: 1 };
  }

  const parts = splitDecisions({
    records,
    buildOperations,
    max: maxOperations,
  });
  const paths = parts.map((part, index) => {
    const path = partPath(file, index, parts.length);
    writeFile(
      path,
      [header, ...part].map((line) => `${JSON.stringify(line)}\n`).join('')
    );
    return path;
  });
  stderr.write(
    `${file} holds ${operations} operations and one request takes ${maxOperations}, so it goes as ${parts.length} requests. The parts are written beside it:\n${paths.map((path) => `  ${path}\n`).join('')}`
  );

  for (let index = 0; index < paths.length; index++) {
    try {
      await send(paths[index]);
      stderr.write(`part ${index + 1} of ${paths.length} applied\n`);
    } catch (error) {
      const landed =
        index === 0
          ? 'No part landed.'
          : `Parts 1 to ${index} landed and stay applied.`;
      stderr.write(
        `part ${index + 1} of ${paths.length} was refused. ${landed} Nothing after it was sent. Fix the cause, then apply the rest one part at a time, starting with this one:\n${paths
          .slice(index)
          .map(
            (path) =>
              `  ${applyCommandLine({ file: path, mainUser, passwordGiven })}\n`
          )
          .join('')}`
      );
      throw error;
    }
  }
  stderr.write(
    `applied ${operations} operations to ${mainUrl} in ${paths.length} requests\n`
  );
  return { operations, parts: paths.length };
}
