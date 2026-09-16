/**
 * Two ways to run a child process, both injected everywhere they are used.
 *
 * `runCommand` captures what a child printed, which is what the renderer probe
 * and the census read. `runStreamed` lets the child print to this terminal,
 * which is what the build, the drift check and the validate step do, because an
 * operator reading a drift refusal wants the child's own lines.
 *
 * Nothing in the library calls either directly. Every caller takes a `run` or a
 * `stream` option and defaults to one of these, so a test passes a function and
 * no test starts a process.
 *
 * Zero npm dependencies, Node built ins only. Not browser reachable.
 */

import { spawn } from 'node:child_process';

/** A child, captured. It answers on a non-zero exit rather than throwing,
 * because an exit code is the answer the probe and the census want. */
export function runCommand(command, args, { cwd, env, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve({ code: -1, stdout: '', stderr: '', started: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timer = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    // A command that is not installed reaches here as ENOENT, which is an
    // answer and not a crash: it is how the probe learns the tool is absent.
    child.on('error', () => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ code: -1, stdout, stderr, started: false });
    });
    child.on('close', (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({ code: code ?? 0, stdout, stderr, started: true });
    });
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill();
      }, timeoutMs);
    }
  });
}

/** A child whose own output is this run's output. */
export function runStreamed(command, args, { cwd, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      });
    } catch {
      resolve({ code: -1, started: false });
      return;
    }
    child.on('error', () => resolve({ code: -1, started: false }));
    child.on('close', (code) => resolve({ code: code ?? 0, started: true }));
  });
}
