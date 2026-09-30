export const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | undefined>;

/** Sets attributes, skipping undefined ones. */
export function attrs(node: Element, values: Attrs): void {
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) node.setAttribute(name, String(value));
  }
}

/** Creates an SVG element with attributes, appended to `parent` when given. */
export function svg<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  values: Attrs = {},
  parent?: Element
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, tag);
  attrs(node, values);
  if (parent) parent.appendChild(node);
  return node;
}

/** Rounds a css pixel coordinate to a tenth, which keeps attribute strings short. */
export const px = (n: number) => Math.round(n * 10) / 10;
