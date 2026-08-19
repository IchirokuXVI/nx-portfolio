import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
export class DetailToc implements AfterViewInit {
  items = input.required<TocItem[]>();

  /** Id of the section currently nearest the top of the viewport. */
  readonly activeId = signal<string | null>(null);

  private _destroyRef = inject(DestroyRef);

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
    history.replaceState(null, '', `#${id}`);
    this.activeId.set(id);
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const targets = this.items()
      .map((item) => document.getElementById(item.id))
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
    this._destroyRef.onDestroy(() => observer.disconnect());
  }
}
