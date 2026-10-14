/**
 * The `pathFromRoot` of a route snapshot at this path, for a spec that stands an
 * `ActivatedRoute` double in: the catalog pickers find the page that opened them
 * from it (`catalogOpenerPath`). One step holding every segment is enough, since
 * the pickers read the segments and not the steps.
 */
export function pathFromRootAt(
  path: string
): readonly { readonly url: readonly { readonly path: string }[] }[] {
  return [
    {
      url: path
        .split('/')
        .filter((segment) => segment !== '')
        .map((segment) => ({ path: segment })),
    },
  ];
}
