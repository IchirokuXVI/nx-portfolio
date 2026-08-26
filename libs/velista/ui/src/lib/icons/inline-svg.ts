import { inject, signal, type Signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

/**
 * Loads an SVG file's source and hands back a signal of sanitizer-trusted markup.
 *
 * Every icon in this library is the same three lines, so they share this rather than
 * repeating a constructor each. Call it from a field initializer: it uses `inject`,
 * so it needs an injection context.
 *
 * **Inlined via `?raw`, never referenced as a URL.** That is the repo's icon
 * convention (CLAUDE.md), and here it is also the only route that builds: emitting an
 * SVG as an asset URL makes webpack fail this app's production build with "Can't
 * handle conflicting asset info for sourceFilename" while scope hoisting the library
 * (plan 0002, section 5.3). Inlining is also what makes `currentColor` resolve
 * against the surrounding text rather than against the file's own initial colour.
 */
export function inlineSvg(
  load: () => Promise<{ default: string }>
): Signal<SafeHtml | null> {
  const sanitizer = inject(DomSanitizer);
  const svg = signal<SafeHtml | null>(null);

  void load().then((module) => {
    // The markup is ours, checked into this repository, and never user supplied.
    svg.set(sanitizer.bypassSecurityTrustHtml(module.default));
  });

  return svg;
}
