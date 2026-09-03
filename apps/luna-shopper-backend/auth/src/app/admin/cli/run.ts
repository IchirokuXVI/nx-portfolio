import type { DataSource } from 'typeorm';
import { createAdmin, formatAdminList, listAdmins } from './admin-commands';
import { ask, askNewPassword, closePrompt } from './prompt';

/**
 * The command dispatcher both entry points share (plan 0071, section 6).
 *
 * There are two entry points and one of these, because the two differ only in how
 * they reach a `DataSource`: on a developer machine `cli.js` runs the TypeScript
 * through ts-node against the env files, and inside the image `admin-cli.js` is a
 * webpack bundle beside `main.js` that reads `AUTH_DB_URL` from the pod's
 * environment. What they do afterwards must not be able to differ, because "on
 * the server" is where this command matters.
 */

const USAGE = `Usage:
  admin:create <username> [display name]   create an operator, prompting for the password
  admin:list                               list operators (no secrets)

There is no update and no delete, and no route for any of the three. Changing an
admin means having the server (plan 0071, section 6).`;

export async function runAdminCli(
  dataSource: DataSource,
  argv: string[]
): Promise<void> {
  const [command, ...rest] = argv;

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    switch (command) {
      case 'create':
      case 'admin:create': {
        // The username may be typed at the prompt, but the password never comes
        // from the command line: an argument is in the shell history and in
        // `ps`, and this is the one credential that opens everything.
        const username = rest[0] ?? (await ask('Username: '));
        const displayName = rest.slice(1).join(' ') || undefined;
        const password = await askNewPassword();
        const created = await createAdmin(dataSource, {
          username,
          password,
          displayName,
        });
        console.log(`Created admin '${created.username}' (${created.id}).`);
        break;
      }
      case 'list':
      case 'admin:list': {
        console.log(formatAdminList(await listAdmins(dataSource)));
        break;
      }
      default:
        console.log(USAGE);
        // A wrong command is a failure, so a script that mistypes one stops
        // rather than reporting that it created an administrator.
        process.exitCode = 1;
    }
  } finally {
    // Both, and in this order. The readline interface holds stdin open, so a
    // command that only destroyed the pool would finish its work and then sit
    // there until somebody pressed ctrl-c.
    closePrompt();
    await dataSource.destroy();
  }
}
