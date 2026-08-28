/**
 * Answer "is anything listening on this TCP port" for a list of ports, once, in a
 * way that reads the same on Windows and on Linux.
 *
 * Both slot scripts need this and each has a shell twin, so the platform specific
 * spellings would otherwise be written four times: `ss`, `lsof` and `netstat`, with
 * three output formats and three different words for LISTEN between them. Node is
 * already a hard dependency of this workspace, so one connect attempt per port is
 * both shorter and more truthful than parsing a table.
 *
 * A connect that succeeds proves a server accepted it. ECONNREFUSED proves nothing
 * is there. Anything else (a timeout, a host firewall) is reported as `unknown`
 * rather than guessed at, because a slot wrongly called free is how two worktrees
 * end up fighting over a port, which is the exact failure these scripts exist to
 * prevent.
 *
 * Both loopback addresses are tried, and this is not belt and braces. The dev
 * servers here do not agree on which one to bind: the shell's serve target sets
 * `host: 0.0.0.0`, so it answers on 127.0.0.1, while a remote binds `localhost`,
 * which Node resolves to ::1 first and which then refuses IPv4 outright. Probing
 * v4 alone reported a running velista as closed, which would have let a second
 * worktree take a port that was already in use.
 *
 * Usage:
 *   node tools/dev/probe-ports.mjs 4200 4202 4203
 *   -> one `<port>\t<open|closed|unknown>` line per port, in the order given.
 */
import net from 'node:net';

const TIMEOUT_MS = 400;
const HOSTS = ['127.0.0.1', '::1'];

function probeHost(port, host) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.once('connect', () => finish('open'));
    socket.once('timeout', () => finish('unknown'));
    socket.once('error', (err) =>
      // ECONNREFUSED means nothing is listening. EAFNOSUPPORT / EADDRNOTAVAIL mean
      // this machine has no such stack, which is also not a listener.
      finish(
        [
          'ECONNREFUSED',
          'EAFNOSUPPORT',
          'EADDRNOTAVAIL',
          'ENETUNREACH',
        ].includes(err.code)
          ? 'closed'
          : 'unknown'
      )
    );
    socket.connect(port, host);
  });
}

/** Open if either stack answers; unknown if neither answered and one was unclear. */
async function probe(port) {
  const states = await Promise.all(HOSTS.map((host) => probeHost(port, host)));
  if (states.includes('open')) return 'open';
  if (states.includes('unknown')) return 'unknown';
  return 'closed';
}

const ports = process.argv.slice(2).map(Number).filter(Number.isInteger);
const states = await Promise.all(ports.map(probe));
for (let i = 0; i < ports.length; i++) {
  process.stdout.write(`${ports[i]}\t${states[i]}\n`);
}
