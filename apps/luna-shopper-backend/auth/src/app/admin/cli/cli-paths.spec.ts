import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The developer entry points reach the db tooling they say they reach.
 *
 * Neither `cli.js` is imported by anything, so nothing type checks them and no
 * spec ran a line of either: `admin/cli/cli.js` climbed one level too many and
 * resolved `apps/tools/db`, which does not exist, and every developer invocation
 * of `admin:create` died at require time with a module resolution stack instead
 * of the sentence about copying `.env.example`. The two files sit at the same
 * depth and must make the same climb, which is the whole assertion here.
 *
 * It reads the literal out of the source rather than requiring the file, because
 * requiring one runs it: `cli.js` resolves a database URL and registers ts-node
 * at import time, so a spec that loaded it would need a configured database to
 * say anything about a string.
 */
const CLI_ENTRY_POINTS = [
  join(__dirname, 'cli.js'),
  resolve(__dirname, '../../db/seed/cli.js'),
];

/** The `path.resolve(__dirname, '<here>')` that each file points at tools/db. */
function toolsDbLiteral(file: string): string {
  const source = readFileSync(file, 'utf8');
  const match = source.match(
    /path\.resolve\(__dirname,\s*'([^']*tools\/db)'\)/
  );
  if (!match) {
    throw new Error(`No tools/db path.resolve call found in ${file}.`);
  }
  return match[1];
}

describe('the developer CLI entry points', () => {
  it.each(CLI_ENTRY_POINTS)('resolves tools/db from %s', (file) => {
    const toolsDb = resolve(dirname(file), toolsDbLiteral(file));

    expect(existsSync(join(toolsDb, 'env.js'))).toBe(true);
  });

  it('makes the same climb from both, because both sit at the same depth', () => {
    const [adminCli, seedCli] = CLI_ENTRY_POINTS;

    expect(toolsDbLiteral(adminCli)).toBe(toolsDbLiteral(seedCli));
  });
});
