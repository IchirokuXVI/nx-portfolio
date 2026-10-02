import { gzipSync } from 'node:zlib';

/**
 * A small DIA, for the two runner specs (plan 0174, section 11).
 *
 * It answers the same paths the real site does, in the same shapes, and it
 * holds the one piece of server state the adapter is built around: **a
 * session keeps a postal code**, a refused `PUT` leaves it alone, and a
 * listing is priced by the store that serves the session's code.
 *
 * It names no test framework, because a `*.fake.ts` is compiled into the app
 * build. What was sent is recorded into an array.
 */
export interface FakeDiaRow {
  sku: string;
  name: string;
  brand?: string | null;
  price: number;
  /** Defaults to `price`, which is a row with no other price. */
  strikethrough?: number;
  unitPrice?: number;
  unit?: string;
  club?: boolean;
  promo?: boolean;
  promotions?: Array<{ description: string; only_club_dia?: boolean }>;
  stock?: number;
}

export interface FakeDiaLeaf {
  id: string;
  name: string;
  path: string;
  rootId: string;
  rootName: string;
}

export interface FakeDiaShop {
  idTienda: number;
  codigoTienda: number;
  /** 0 is DIA, 1 is Clarel. */
  tipoTienda?: number;
  province: number;
  latitude: number;
  longitude: number;
  /** The detail the shop answers, or a status when the request fails. */
  detail: Record<string, unknown> | number;
}

export interface FakeDiaWorld {
  /** The postal code a new session holds. */
  defaultPostalCode?: string;
  /** Postal code to the fulfilment store that serves it. */
  served: Record<string, string>;
  leaves?: FakeDiaLeaf[];
  /** Store code, then leaf id, then the rows that store lists there. */
  listings?: Record<string, Record<string, FakeDiaRow[]>>;
  shops?: FakeDiaShop[];
  /** A leaf path that answers 301 to another path. */
  moved?: Record<string, string>;
  /** A status to answer instead, by method and path. */
  fail?: (method: string, path: string) => number | undefined;
}

const API = '/api/v1/common-aggregator';
const LISTING = '/api/v1/plp-back/reduced';
const PAGE_SIZE = 20;

export function fakeDiaSite(world: FakeDiaWorld): {
  fetchImpl: typeof fetch;
  /** Every request, as `METHOD path`. */
  sent: string[];
} {
  const sent: string[] = [];
  const sessions = new Map<string, string>();
  const fallback = world.defaultPostalCode ?? '28041';

  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const method = init?.method ?? 'GET';
    sent.push(`${method} ${path}`);

    const failed = world.fail?.(method, path);
    if (failed !== undefined) {
      return new Response(null, { status: failed });
    }

    const headers = (init?.headers ?? {}) as Record<string, string>;
    const cookie = /session_id=([^;]+)/.exec(headers['cookie'] ?? '')?.[1];

    if (url.pathname === `${API}/header-data`) {
      const responseHeaders = new Headers();
      let id = cookie;
      if (!id) {
        id = `s${sessions.size + 1}`;
        sessions.set(id, fallback);
        responseHeaders.append('set-cookie', `session_id=${id}; Path=/`);
      }
      return json(
        { cart: { postal_code: sessions.get(id) ?? fallback } },
        200,
        responseHeaders
      );
    }
    if (url.pathname === `${API}/save-shipping-address`) {
      const code = url.searchParams.get('new_postal_code') ?? '';
      if (!cookie || !world.served[code]) {
        // The real refusal: 206, and the session keeps the code it had.
        return json({ code: 206, type: 'VALIDATION_ERROR' }, 206);
      }
      sessions.set(cookie, code);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === `${API}/check-service`) {
      const store = world.served[url.searchParams.get('postal_code') ?? ''];
      return store
        ? json({ physical_store_id: store })
        : new Response('', { status: 206 });
    }
    if (url.pathname === `${API}/menu-data`) {
      return json(menuOf(world.leaves ?? []));
    }
    if (url.pathname.startsWith(LISTING)) {
      const leafPath = url.pathname.slice(LISTING.length);
      const movedTo = world.moved?.[leafPath];
      if (movedTo) {
        return new Response(null, {
          status: 301,
          headers: { location: movedTo },
        });
      }
      const leaf = (world.leaves ?? []).find(
        (candidate) =>
          candidate.path === leafPath ||
          Object.entries(world.moved ?? {}).some(
            ([from, to]) => to === leafPath && from === candidate.path
          )
      );
      const store = world.served[sessions.get(cookie ?? '') ?? fallback];
      const rows = (leaf && world.listings?.[store]?.[leaf.id]) || [];
      const page = Number(url.searchParams.get('page') ?? '1');
      return json({
        pagination: {
          page_number: page,
          page_size: PAGE_SIZE,
          total_pages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
        },
        total_items: rows.length,
        selected_category_id: leaf?.id ?? null,
        seo: { current_category_name: leaf?.name ?? null },
        plp_items: rows
          .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
          .map((row) => rowOf(row, leaf)),
      });
    }
    if (url.pathname === '/tiendas/buscador-tiendas-folletos') {
      return new Response(
        '<html><input id="gz" type="hidden" ' +
          'value="https://www.dia.es/clubdia/ES/tiendas.v1.json.gz"/></html>',
        { status: 200 }
      );
    }
    if (url.pathname === '/clubdia/ES/tiendas.v1.json.gz') {
      return new Response(
        new Uint8Array(
          gzipSync(
            JSON.stringify(
              (world.shops ?? []).map((shop) => ({
                tipoTienda: shop.tipoTienda ?? 0,
                codigoProvincia: shop.province,
                codigoTienda: shop.codigoTienda,
                idTienda: shop.idTienda,
                posicionX: String(shop.latitude),
                posicionY: String(shop.longitude),
              }))
            )
          )
        ),
        { status: 200 }
      );
    }
    if (url.pathname === '/tiendas/buscadorTiendas.html') {
      const shop = (world.shops ?? []).find(
        (candidate) => String(candidate.idTienda) === url.searchParams.get('id')
      );
      if (!shop) {
        return json({});
      }
      return typeof shop.detail === 'number'
        ? new Response(null, { status: shop.detail })
        : json({ tiendaCodigo: shop.codigoTienda, ...shop.detail });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  return { fetchImpl, sent };
}

function json(body: unknown, status = 200, headers = new Headers()): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function menuOf(leaves: readonly FakeDiaLeaf[]): unknown {
  const roots = new Map<
    string,
    { id: string; name: string; children: unknown[] }
  >();
  for (const leaf of leaves) {
    let root = roots.get(leaf.rootId);
    if (!root) {
      root = {
        id: leaf.rootId,
        name: leaf.rootName,
        // The "Todo" child every root carries, which is not a leaf.
        children: [
          { id: leaf.rootId, name: `Todo ${leaf.rootName}`, link: '/todo' },
        ],
      };
      roots.set(leaf.rootId, root);
    }
    root.children.push({ id: leaf.id, name: leaf.name, link: leaf.path });
  }
  return {
    categories: [...roots.values()].map((root) => ({
      ...root,
      link: `/root/c/${root.id}`,
    })),
    offer_category: { id: 'L150', name: 'Ofertas', link: '/ofertas' },
  };
}

function rowOf(row: FakeDiaRow, leaf: FakeDiaLeaf | undefined): unknown {
  return {
    sku_id: row.sku,
    object_id: row.sku,
    display_name: row.name,
    ...(row.brand === null ? {} : { brand: row.brand ?? 'Dia' }),
    url: `${(leaf?.path ?? '').replace(/\/c\/.*$/, '')}/p/${row.sku}`,
    image: `/product_images/${row.sku}/${row.sku}_ISO_0_ES.jpg`,
    prices: {
      currency: 'EUR',
      price: row.price,
      strikethrough_price: row.strikethrough ?? row.price,
      price_per_unit: row.unitPrice ?? row.price,
      measure_unit: row.unit ?? 'LITRO',
      is_club_price: row.club ?? false,
      is_promo_price: row.promo ?? row.club ?? false,
      discount_percentage: 0,
    },
    promotions: row.promotions ?? [],
    units_in_stock: row.stock ?? 10,
  };
}
