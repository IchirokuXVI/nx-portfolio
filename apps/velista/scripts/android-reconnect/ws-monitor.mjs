#!/usr/bin/env node
// Watches the realtime socket of the velista Android app from outside the app.
//
// It attaches to the WebView over the Chrome DevTools Protocol and prints, with a
// timestamp, every WebSocket opened and closed, every socket.io frame, every API request,
// the console, and a five second poll of the page state (visibility, navigator.onLine,
// whether the header mark is drawn). Nothing in the app changes.
//
//   node apps/velista/scripts/android-reconnect/ws-monitor.mjs [logfile] [port]
//
// Before it: an APK built with VELISTA_NATIVE_DEBUG=1, running on the device, and
//   bash apps/velista/scripts/android-reconnect/scenario.sh <name> devtools
// which forwards the WebView's DevTools socket to localhost:9333.
import { appendFileSync } from 'node:fs';

const [logFile, portArg] = process.argv.slice(2);
const port = portArg ?? '9333';
const stamp = () => new Date().toISOString().slice(11, 23);
const log = (line) => {
  const text = `${stamp()} ${line}`;
  console.log(text);
  if (logFile) appendFileSync(logFile, text + '\n');
};

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target on the forwarded DevTools port');
  process.exit(1);
}
log(`attach ${page.url}`);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));

let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data);
  if (m.id !== undefined) {
    pending.get(m.id)?.(m.result);
    pending.delete(m.id);
    return;
  }
  const p = m.params ?? {};
  switch (m.method) {
    case 'Network.webSocketCreated':
      log(`WS CREATED ${p.requestId} ${p.url}`);
      break;
    case 'Network.webSocketHandshakeResponseReceived':
      log(`WS HANDSHAKE ${p.requestId} status ${p.response?.status}`);
      break;
    case 'Network.webSocketClosed':
      log(`WS CLOSED ${p.requestId}`);
      break;
    case 'Network.webSocketFrameError':
      log(`WS ERROR ${p.requestId} ${p.errorMessage}`);
      break;
    case 'Network.webSocketFrameReceived': {
      const d = p.response?.payloadData ?? '';
      log(
        d === '2'
          ? `WS <- ping ${p.requestId}`
          : `WS <- ${p.requestId} ${d.slice(0, 90)}`
      );
      break;
    }
    case 'Network.webSocketFrameSent': {
      const d = p.response?.payloadData ?? '';
      log(
        d === '3'
          ? `WS -> pong ${p.requestId}`
          : `WS -> ${p.requestId} ${d.slice(0, 90)}`
      );
      break;
    }
    case 'Network.requestWillBeSent':
      if (
        p.type !== 'WebSocket' &&
        !/\.(js|css|woff2|png|svg|json)(\?|$)/.test(p.request.url)
      ) {
        log(`HTTP ${p.request.method} ${p.request.url}`);
      }
      break;
    case 'Network.loadingFailed':
      log(`HTTP FAILED ${p.requestId} ${p.errorText}`);
      break;
    case 'Network.responseReceived':
      if (p.type !== 'WebSocket' && /\/v1\/|\/health/.test(p.response.url)) {
        log(`HTTP ${p.response.status} ${p.response.url}`);
      }
      break;
    case 'Runtime.consoleAPICalled':
      log(
        `CONSOLE ${p.type} ${p.args
          .map((a) => a.value ?? a.description ?? '')
          .join(' ')
          .slice(0, 200)}`
      );
      break;
    case 'Page.lifecycleEvent':
      log(`LIFECYCLE ${p.name}`);
      break;
  }
});

await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
await send('Page.setLifecycleEventsEnabled', { enabled: true });
log('enabled');

let last = '';
setInterval(async () => {
  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({vis: document.visibilityState, online: navigator.onLine, mark: !!document.querySelector('.offline-mark, .live-mark, .stale'), href: location.pathname})`,
    returnByValue: true,
  });
  const v = r?.result?.value ?? 'no-answer';
  if (v !== last) {
    last = v;
    log(`STATE ${v}`);
  }
}, 5000);
