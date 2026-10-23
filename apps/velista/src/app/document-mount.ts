/**
 * Where this document is mounted, read from its `<base>` element (plan 0165 D3).
 *
 * The inline script in `index.html` sets the base to `/velista/` when the portfolio's
 * gateway serves the page under that path, and leaves it at `/` on the own origin.
 * The router keeps `APP_BASE_HREF` at `/`, so the mount reaches the route table here.
 *
 * @returns `'/velista'` under the portfolio, `''` on the own origin or with no `<base>`.
 */
export function documentMount(doc: Document = document): string {
  const href = doc.querySelector('base')?.getAttribute('href') ?? '/';

  return href.replace(/\/+$/, '');
}
