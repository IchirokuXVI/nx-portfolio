/**
 * Where this document is mounted, read from its `<base>` element (plan 0165 D3).
 *
 * velista's nginx rewrites the base to `/velista/` when the request carried the
 * portfolio's prefix, and leaves it at `/` on the own origin (plan 0165 D2).
 * The router keeps `APP_BASE_HREF` at `/`, so the mount reaches the route table here.
 *
 * @returns `'/velista'` under the portfolio, `''` on the own origin or with no `<base>`.
 */
export function documentMount(doc: Document = document): string {
  const href = doc.querySelector('base')?.getAttribute('href') ?? '/';

  return href.replace(/\/+$/, '');
}
