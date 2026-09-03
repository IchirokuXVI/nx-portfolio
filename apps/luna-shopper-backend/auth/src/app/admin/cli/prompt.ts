import { createInterface, type Interface } from 'node:readline';

/**
 * Reading a password without showing it (plan 0071, section 6).
 *
 * Two implementations behind one function, and the split is not cosmetic. A
 * terminal is interactive and needs the echo muted; a pipe has already been
 * written and needs nothing muted, but readline handles it badly enough to be
 * worth going around.
 *
 * **Piped input is read whole, once, and served from a queue.** readline over a
 * non terminal stream emits `close` as soon as the buffered input ends, which
 * happens before the second question is asked, so the second answer is lost. What
 * that looked like was two prompts, no row written, and exit code **zero** — the
 * worst available failure for a command whose only job is to create a credential.
 * Reading stdin up front makes the timing irrelevant.
 *
 * **On a terminal the echo is muted by replacing readline's writer.** Node offers
 * no supported way to switch it off, and a password command that prints the
 * password is worse than no command at all. One interface for the session, closed
 * once, because closing one ends the stream every later question would read from.
 */

interface MutableInterface extends Interface {
  _writeToOutput?: (text: string) => void;
}

const isTty = (): boolean => process.stdin.isTTY === true;

/** The interactive interface. Created on first use, closed by `closePrompt`. */
let session: MutableInterface | undefined;

/** Every line of a piped stdin, read once and then consumed in order. */
let piped: string[] | undefined;

function readAllPipedLines(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text.split(/\r?\n/)));
    process.stdin.on('error', reject);
  });
}

async function nextPipedLine(): Promise<string> {
  piped ??= await readAllPipedLines();
  const line = piped.shift();
  if (line === undefined) {
    throw new Error('Input ended before the prompt was answered.');
  }
  return line;
}

/** Closes the interactive interface, if one was ever opened. */
export function closePrompt(): void {
  session?.close();
  session = undefined;
}

function askTerminal(prompt: string, muted: boolean): Promise<string> {
  session ??= createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  }) as MutableInterface;
  const rl = session;

  if (muted) {
    let promptWritten = false;
    rl._writeToOutput = (text: string) => {
      // The prompt goes out once and nothing after it does, so the caret sits
      // where they are typing and the characters never appear.
      if (!promptWritten) {
        process.stdout.write(text);
        promptWritten = true;
      }
    };
  }

  return new Promise((resolve, reject) => {
    // Ctrl-D before an answer. Without this the promise stays pending forever and
    // the process exits successfully with the work half done.
    const onClose = () =>
      reject(new Error('Input ended before the prompt was answered.'));
    rl.once('close', onClose);

    rl.question(prompt, (answer) => {
      rl.off('close', onClose);
      if (muted) {
        delete rl._writeToOutput;
        process.stdout.write('\n');
      }
      resolve(answer);
    });
  });
}

async function question(prompt: string, muted: boolean): Promise<string> {
  if (isTty()) {
    return askTerminal(prompt, muted);
  }
  // The prompt is still printed, so somebody watching a `kubectl exec` with no
  // tty can see which value the command is waiting on.
  process.stdout.write(prompt + '\n');
  return nextPipedLine();
}

/** Reads one line, echoing it. For the username and other non secrets. */
export async function ask(prompt: string): Promise<string> {
  return (await question(prompt, false)).trim();
}

/**
 * Reads one line without echoing it.
 *
 * When stdin is not a terminal (a pipe, a CI runner, a `kubectl exec` with no
 * tty) there is nothing to echo to and nothing to mute, so it degrades to a plain
 * read rather than failing. That is what makes the command usable from a script
 * that already holds the password, without giving it a second, quieter way to
 * take one on the command line where a shell history would keep it.
 */
export function askSecret(prompt: string): Promise<string> {
  return question(prompt, true);
}

/**
 * Asks twice and refuses a mismatch, which is the whole reason it asks twice: a
 * mistyped password on an account with no reset link is an account nobody can use
 * and nobody can recover.
 */
export async function askNewPassword(): Promise<string> {
  const first = await askSecret('Password: ');
  const second = await askSecret('Repeat password: ');
  if (first !== second) {
    throw new Error('The two passwords do not match.');
  }
  return first;
}
