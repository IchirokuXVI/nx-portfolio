import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/**
 * A URL that is not a screen.
 *
 * `0002` sent every unknown URL to the only page there was, which was the right
 * answer while there was one page: a 404 would have said less. With chrome and
 * several resources there is somewhere to be and something to say, so an unknown
 * URL now says so and offers the way back.
 *
 * It is inside the shell, so the navigation is still there. A not found page
 * that also takes away the menu leaves the operator with nothing but the back
 * button.
 */
@Component({
  selector: 'lib-not-found-page',
  imports: [RouterLink, RokuTranslatorPipe],
  template: `
    <h1>{{ 'notFound.heading' | rokuT }}</h1>
    <p>{{ 'notFound.body' | rokuT }}</p>
    <a routerLink="/">{{ 'notFound.home' | rokuT }}</a>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      align-items: flex-start;
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    p {
      max-inline-size: 44ch;
      color: var(--admin-ink-muted);
    }

    a {
      color: var(--admin-accent);
    }

    a:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
