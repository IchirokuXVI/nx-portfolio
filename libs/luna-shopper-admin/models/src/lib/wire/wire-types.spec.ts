import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * The committed wire types are current (plan 0004, section 2).
 *
 * The plan's exception to rule D4 is only safe because of this file. The
 * argument for generating the types rather than hand mapping them is that the
 * gateway ships from this repository at this commit, so the contract cannot
 * change underneath the app without the change being in the same diff. That is
 * true of the *document*; it is true of these types only if something notices
 * when the two disagree, and this is that something.
 *
 * It rides `nx affected -t test`, which pull requests already run, and
 * `project.json` names the gateway as an implicit dependency so that a gateway
 * change marks this library affected. Without that line the check would exist
 * and never run on the change it exists for.
 *
 * The generator is spawned rather than imported. It is an ESM module under
 * `tools/`, outside every Nx project, and reaching it from a CommonJS jest
 * transform costs more configuration than one process does time.
 */
describe('the generated wire types', () => {
  const workspaceRoot = join(__dirname, '..', '..', '..', '..', '..', '..');

  it('match the gateway OpenAPI document', () => {
    // The generator's own sentence is the failure message, rather than an exit
    // code an operator has to go and interpret: it names the file and the
    // command that fixes it.
    let complaint = '';
    try {
      execFileSync(
        process.execPath,
        [join('tools', 'openapi', 'generate-wire-types.mjs'), '--check'],
        { cwd: workspaceRoot, stdio: 'pipe' }
      );
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr;
      complaint = stderr === undefined ? String(error) : stderr.toString();
    }

    expect(complaint).toBe('');
  });
});
