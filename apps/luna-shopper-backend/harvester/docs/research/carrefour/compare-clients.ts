/**
 * Show which HTTP clients Cloudflare lets through to carrefour.es, and which it blocks.
 *
 * Run: npx tsx tools/research/carrefour/compare-clients.ts
 *
 * This is the script behind the central claim of plan 0090: the harvester cannot read
 * this storefront with `fetch`, and needs a browser. The finding is easy to doubt,
 * because a 403 also looks like an ordinary rate limit, so the test is built to rule
 * that out:
 *
 * - Every client asks for a different category URL, so no result is a cached repeat.
 * - The clients are interleaved rather than grouped, so a throttle that built up over
 *   time would hit both and not just one.
 * - The pause between requests is long enough that the whole run is slower than a
 *   human browsing.
 *
 * If node were merely being rate limited, the curl rows would fail too. They do not.
 *
 * Requires `curl` on PATH. On Windows that is the Schannel build, which passes, and
 * that result is itself informative: it is the operating system TLS stack, so it is
 * not evidence that a Linux deployment could use curl. The Docker row tests exactly
 * that and is skipped when Docker is absent.
 */

import { execFile } from 'node:child_process';
import https from 'node:https';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { ORIGIN, sleep } from './carrefour-browser';

const execFileAsync = promisify(execFile);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** One distinct listing URL per client, so nothing is a repeated fetch. */
const PATHS = [
  '/supermercado/la-despensa/cat20001/c',
  '/supermercado/frescos/cat20002/c',
  '/supermercado/bebidas/cat20003/c',
  '/supermercado/cuidado-personal-e-higiene/cat20004/c',
  '/supermercado/drogueria-y-limpieza/cat20005/c',
  '/supermercado/bebe/cat20006/c',
];

const GAP_MS = 10000;

interface Row {
  client: string;
  status: number | string;
  bytes: number;
  note: string;
}

/** node's own TLS stack, HTTP/1.1. */
function nodeHttps(
  path: string,
  extra: Record<string, unknown> = {}
): Promise<Row> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'www.carrefour.es',
        path,
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: '*/*' },
        ...extra,
      },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => (bytes += c.length));
        res.on('end', () =>
          resolve({
            client: `node https ${Object.keys(extra).length ? '(chrome ciphers)' : '(defaults)'}`,
            status: res.statusCode ?? 0,
            bytes,
            note: 'OpenSSL',
          })
        );
      }
    );
    req.on('error', (e) =>
      resolve({
        client: 'node https',
        status: 'ERR',
        bytes: 0,
        note: e.message,
      })
    );
    req.end();
  });
}

/** Whatever curl is on PATH. Its TLS backend is what decides the result. */
async function localCurl(path: string): Promise<Row> {
  try {
    const { stdout } = await execFileAsync('curl', [
      '-s',
      '-o',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
      '-w',
      '%{http_code} %{size_download}',
      '-A',
      UA,
      '--max-time',
      '40',
      ORIGIN + path,
    ]);
    const [code, size] = stdout.trim().split(/\s+/);
    const { stdout: version } = await execFileAsync('curl', ['--version']);
    const backend = /Schannel/i.test(version)
      ? 'Schannel'
      : /OpenSSL|quictls/i.test(version)
        ? 'OpenSSL'
        : 'other';
    return {
      client: 'curl (local)',
      status: Number(code),
      bytes: Number(size),
      note: backend,
    };
  } catch (error) {
    return {
      client: 'curl (local)',
      status: 'ERR',
      bytes: 0,
      note: (error as Error).message,
    };
  }
}

/** Linux curl, which is what a container in the cluster would have. */
async function dockerCurl(path: string): Promise<Row> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'run',
        '--rm',
        'curlimages/curl:latest',
        '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code} %{size_download}',
        '-A',
        UA,
        '--max-time',
        '40',
        ORIGIN + path,
      ],
      { timeout: 180000 }
    );
    const [code, size] = stdout.trim().split(/\s+/);
    return {
      client: 'curl (linux, docker)',
      status: Number(code),
      bytes: Number(size),
      note: 'OpenSSL',
    };
  } catch (error) {
    return {
      client: 'curl (linux, docker)',
      status: 'skip',
      bytes: 0,
      note: 'docker unavailable',
    };
  }
}

/** A real browser. */
async function headlessChromium(path: string): Promise<Row> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ locale: 'es-ES', userAgent: UA });
    const page = await ctx.newPage();
    await page.route('**/*', (route) => {
      const t = route.request().resourceType();
      return t === 'image' || t === 'font' || t === 'media'
        ? route.abort()
        : route.continue();
    });
    const res = await page.goto(ORIGIN + path, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    const items = await page.evaluate(
      () =>
        (
          window as unknown as {
            __INITIAL_STATE__?: {
              productCardList?: { results?: { items?: unknown[] } };
            };
          }
        ).__INITIAL_STATE__?.productCardList?.results?.items?.length ?? -1
    );
    const html = await page.content();
    return {
      client: 'headless chromium',
      status: res?.status() ?? 0,
      bytes: html.length,
      note: `${items} cards read from window state`,
    };
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  console.log(
    `# client comparison against ${ORIGIN}  (${new Date().toISOString()})`
  );
  console.log(`# one distinct URL per client, ${GAP_MS / 1000}s apart\n`);

  const CHROME_CIPHERS = [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
  ].join(':');

  const steps: Array<(p: string) => Promise<Row>> = [
    (p) => localCurl(p),
    (p) => nodeHttps(p),
    (p) => localCurl(p),
    (p) =>
      nodeHttps(p, {
        ciphers: CHROME_CIPHERS,
        ecdhCurve: 'X25519:prime256v1:secp384r1',
      }),
    (p) => headlessChromium(p),
    (p) => dockerCurl(p),
  ];

  const rows: Row[] = [];
  for (let i = 0; i < steps.length; i++) {
    const row = await steps[i](PATHS[i % PATHS.length]);
    rows.push(row);
    console.log(
      `${String(row.status).padEnd(6)} ${String(row.bytes).padStart(8)}b  ${row.client.padEnd(26)} ${row.note}`
    );
    await sleep(GAP_MS);
  }

  console.log('\n## Reading\n');
  console.log(
    'A 200 with a large body is the listing. A 403 with about 5 KB is the'
  );
  console.log(
    'Cloudflare challenge page. If the curl rows pass while the node rows fail in'
  );
  console.log(
    'the same run, the difference is the client and not the request rate.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
