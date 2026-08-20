import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** One entry in the table of contents. `id` matches a `detail-section`'s
 * `sectionId`; `labelKey` is an i18n key resolved in the template so the TOC
 * re-translates on a runtime locale switch. */
export interface TocItem {
  id: string;
  labelKey: string;
}

/**
 * Quiet section navigation for a long detail page (0007). Renders anchor links
 * to each section id and highlights whichever section is currently in view via
 * an IntersectionObserver (no scroll listener). Presentational and project
 * agnostic; the parent supplies the item list.
 */
@Component({
  selector: 'lib-landing-v2-detail-toc',
  imports: [RokuTranslatorPipe],
  templateUrl: './detail-toc.html',
  styleUrl: './detail-toc.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DetailToc {
  items = input.required<TocItem[]>();

  /** Id of the section currently nearest the top of the viewport. */
  readonly activeId = signal<string | null>(null);

  private _destroyRef = inject(DestroyRef);
  private _observer?: IntersectionObserver;

  constructor() {
    // Re-observe whenever the section list changes (the deep view swaps in more
    // sections), so the active-section highlight tracks the current list.
    effect(() => {
      const ids = this.items().map((item) => item.id);
      this._observe(ids);
    });

    this._destroyRef.onDestroy(() => this._observer?.disconnect());
  }

  private _observe(ids: string[]): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    // The section elements are rendered by the parent; wait a frame so a freshly
    // swapped-in list is in the DOM before we look the ids up.
    requestAnimationFrame(() => {
      this._observer?.disconnect();

      const targets = ids
        .map((id) => document.getElementById(id))
        .filter((element): element is HTMLElement => element !== null);

      if (!targets.length) {
        return;
      }

      // The band sits in the upper third of the viewport, so the active entry is
      // the section whose top has just scrolled past the header, not whatever
      // happens to be centered.
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              this.activeId.set(entry.target.id);
            }
          }
        },
        { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
      );

      targets.forEach((target) => observer.observe(target));
      this._observer = observer;
    });
  }

  /** Smooth-scrolls to the target section while keeping the anchor's real
   * `href` (and updating the hash) so keyboard and middle-click still work.
   * Honors reduced-motion by falling back to an instant jump. */
  onNavigate(event: MouseEvent, id: string): void {
    const target = document.getElementById(id);

    if (!target) {
      return;
    }

    event.preventDefault();

    const prefersReduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    target.scrollIntoView({
      behavior: prefersReduced ? 'auto' : 'smooth',
      block: 'start',
    });
    // Keep the full path and query; a bare `#id` would be resolved against the
    // app's <base href> and drop the current route.
    history.replaceState(
      null,
      '',
      `${location.pathname}${location.search}#${id}`
    );
    this.activeId.set(id);
  }
}
