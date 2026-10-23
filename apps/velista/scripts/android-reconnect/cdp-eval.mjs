#!/usr/bin/env node
// Evaluates one expression in the velista WebView and prints the value as JSON.
//
//   node apps/velista/scripts/android-reconnect/cdp-eval.mjs "<expression>" [port]
//
// Needs the DevTools socket forwarded (scenario.sh <name> devtools) and an APK built with
// VELISTA_NATIVE_DEBUG=1.
const [expression, portArg] = process.argv.slice(2);
const port = portArg ?? '9333';
const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('no page target on the forwarded DevTools port');
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
ws.send(
  JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true },
  })
);
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id === 1) {
    console.log(
      JSON.stringify(message.result?.result?.value ?? message.result)
    );
    ws.close();
  }
});
