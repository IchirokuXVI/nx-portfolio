import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A DEZA listing that answers on localhost, for the runner's tests.
 *
 * The library's own tests parse captured pages and touch nothing (plan 0085,
 * section 5). The **runner's** tests are about the crawl rather than the parse:
 * the ceiling, the split, the budget, the deduplication and the shop write, none
 * of which a static fixture can exercise because every one of them is a sequence
 * of requests. So this renders the same markup the real site does, over the same
 * session cookie, from a list of products a test states.
 *
 * It is deliberately faithful about the three things the crawl depends on:
 *
 * - **The selection lives in a session cookie**, so a page fetch that carries
 *   the wrong jar reads somebody else's section.
 * - **Every query answers at most 300 rows**, in pages of 15, and the widget
 *   stops at 20 whatever the section holds.
 * - **A query that fits on one page renders no widget at all**, which is what
 *   tells the crawler it has the whole answer.
 */

export interface FakeProduct {
  description: string;
  /** The leaf section code it is filed under. */
  section: string;
  /** The shop codes whose popup names it. */
  shops: string[];
}

export interface FakeSection {
  code: string;
  name: string;
  children?: FakeSection[];
}

export interface FakeListing {
  url: string;
  /** Every query the server was asked, in order, as `section|terms`. */
  queries: string[];
  /** Every request it answered, pages included. What the gate has to have seen. */
  requests(): number;
  close(): Promise<void>;
}

const PAGE_SIZE = 15;
const CEILING_ROWS = 300;
const CEILING_PAGES = 20;

const SHOP_NAMES: Record<string, string> = {
  T1: 'Jesús Rescatado',
  T2: 'Ctra. de Castro',
  T3: 'Ronda del Marrubial',
  C1: 'SuperCash (Quemadas)',
  Z1: 'Zoco',
};

export async function startFakeListing(
  sections: FakeSection[],
  products: FakeProduct[]
): Promise<FakeListing> {
  const sessions = new Map<string, { section: string; terms: string[] }>();
  const queries: string[] = [];
  let requests = 0;
  let nextSession = 0;

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const cookie = /PHPSESSID=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
    requests += 1;

    const finish = (
      session: string,
      state: { section: string; terms: string[] }
    ) => {
      const page = Number(url.searchParams.get('paged') ?? '1');
      const body = render(sections, products, state, page);
      response.writeHead(200, {
        'content-type': 'text/html; charset=UTF-8',
        'set-cookie': `PHPSESSID=${session}; path=/`,
      });
      response.end(body);
    };

    if (request.method === 'POST') {
      let raw = '';
      request.on('data', (chunk) => {
        raw += String(chunk);
      });
      request.on('end', () => {
        const form = new URLSearchParams(raw);
        const state = {
          section: form.get('wpdzSeccProd') ?? '',
          terms: (form.get('wpdz-input-name') ?? '')
            .split(/\s+/)
            .filter((term) => term !== ''),
        };
        queries.push(`${state.section}|${state.terms.join(' ')}`);
        nextSession += 1;
        const session = cookie ?? `s${nextSession}`;
        sessions.set(session, state);
        finish(session, state);
      });
      return;
    }

    nextSession += 1;
    const session = cookie ?? `s${nextSession}`;
    const state = sessions.get(session) ?? { section: '', terms: [] };
    sessions.set(session, state);
    finish(session, state);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    queries,
    requests: () => requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function matching(
  products: FakeProduct[],
  state: { section: string; terms: string[] }
): FakeProduct[] {
  const found = products.filter((product) => {
    if (state.section && product.section !== state.section) {
      return false;
    }
    const haystack = product.description.toLowerCase();
    return state.terms.every((term) => haystack.includes(term.toLowerCase()));
  });
  // Every query returns at most 300 rows, whatever the section holds.
  return found.slice(0, CEILING_ROWS);
}

function render(
  sections: FakeSection[],
  products: FakeProduct[],
  state: { section: string; terms: string[] },
  page: number
): string {
  const found = matching(products, state);
  const pages = Math.min(Math.ceil(found.length / PAGE_SIZE), CEILING_PAGES);
  const rows = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return [
    '<html><body>',
    `<ul id='search-art'><li><a id='TODAS' href='#'>TODAS</a><ul>`,
    sections.map(renderSection).join(''),
    '</ul></li></ul>',
    `<div id='rejilla_productos' class='wpdz-lista-arts'><ul>`,
    rows.map(renderRow).join(''),
    '</ul></div>',
    // A query that fits on one page renders no widget, which is a last page of
    // 0 rather than 1 and is how a complete query announces itself.
    pages > 1 ? renderPagination(pages, page) : '',
    '</body></html>',
  ].join('');
}

function renderSection(section: FakeSection): string {
  const children = section.children ?? [];
  return (
    `<li><a id='${section.code}' href='#'>${section.name}</a>` +
    (children.length > 0
      ? `<ul>${children.map(renderSection).join('')}</ul>`
      : '') +
    '</li>'
  );
}

function renderRow(product: FakeProduct): string {
  const shops = product.shops
    .map(
      (code) =>
        `<strong class='wpdz-precio-oculto' id='${code}' style='display:none;'></strong>` +
        `<strong class='wpdz-precio-ok' id='${code}' ></strong>` +
        `<strong>&nbsp;&nbsp;${SHOP_NAMES[code] ?? code}</strong><br />`
    )
    .join('');
  return (
    `<div class='wpdz-row'>` +
    `<div class='wpdz-row-col-desc'>${product.description}</div>` +
    `<div class='wpdz-row-col-icons'></div>` +
    `<div class='wpdz-row-col-disponible'><div class='wpdz-popup-trigger'>` +
    `<div class='pop-up pop-up-artic'><div class='pop-up-title'>${product.description}</div>` +
    `<div class='pop-up-artic-tiendas'>${shops}</div>` +
    `</div></div></div></div><hr />`
  );
}

function renderPagination(pages: number, current: number): string {
  const links: string[] = [];
  for (let page = 1; page <= pages; page += 1) {
    links.push(
      page === current
        ? `<span aria-current="page" class="page-numbers current">${page}</span>`
        : `<a class="page-numbers" href="/productos/?paged=${page}&#038;wpdz-pagination=1">${page}</a>`
    );
  }
  return links.join('');
}
