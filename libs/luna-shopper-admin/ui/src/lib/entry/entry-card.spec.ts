import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EntryCard } from './entry-card';

/** A screen that stands in front of the app, as the three real ones use the card. */
@Component({
  imports: [EntryCard],
  template: `
    <lib-entry-card
      [deployment]="deployment()"
      [heading]="'Sign in'"
      [level]="level()"
      [showDeployment]="named()"
      headingId="the-heading"
    >
      <form>
        <label for="field">Password</label>
        <input id="field" />
        <p class="entry-error" role="alert">That did not match.</p>
        <button type="submit">Carry on</button>
        <button class="entry-quiet" type="button">Sign out</button>
      </form>
    </lib-entry-card>
  `,
})
class Host {
  readonly deployment = signal<Deployment | null | undefined>('staging');
  readonly level = signal<1 | 2>(2);
  readonly named = signal(true);
}

function render(): ComponentFixture<Host> {
  TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

const el = (fixture: ComponentFixture<Host>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector(selector);

afterEach(() => TestBed.resetTestingModule());

/**
 * The card of the sign in page and the two covers (admin plan 0046, target 8).
 */
describe('EntryCard', () => {
  it('draws the heading and holds what the screen puts in it', () => {
    const fixture = render();

    expect(el(fixture, 'h2#the-heading')?.textContent).toBe('Sign in');
    expect(el(fixture, '.entry-card form input#field')).not.toBeNull();
    expect(el(fixture, '.entry-card')?.getAttribute('aria-labelledby')).toBe(
      'the-heading'
    );
  });

  /** The sign in page is the page, so its heading is the first one. A cover's is not. */
  it('draws a first heading only where the card is the page', () => {
    const fixture = render();
    expect(el(fixture, 'h1')).toBeNull();

    fixture.componentInstance.level.set(1);
    fixture.detectChanges();

    expect(el(fixture, 'h1#the-heading')?.textContent).toBe('Sign in');
    expect(el(fixture, 'h2')).toBeNull();
  });

  describe('the deployment', () => {
    /**
     * A key per deployment, as the rail writes it, so a name this app does not
     * know cannot reach the screen as raw text from the API.
     */
    it.each(['production', 'staging', 'development'] as const)(
      'names %s above the heading',
      (deployment) => {
        const fixture = render();
        fixture.componentInstance.deployment.set(deployment);
        fixture.detectChanges();

        const name = el(fixture, '.entry-deployment');

        expect(name?.textContent).toContain(`environment.short.${deployment}`);
        // In words for a screen reader too: the label says what the name is.
        expect(name?.textContent).toContain('environment.label');
        expect(
          name?.compareDocumentPosition(el(fixture, '.entry-heading') as Node)
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(el(fixture, '.entry-unknown')).toBeNull();
      }
    );

    /** Could not find out is a statement, and keeps the warning text. */
    it('says so when the deployment could not be established', () => {
      const fixture = render();
      fixture.componentInstance.deployment.set(null);
      fixture.detectChanges();

      expect(el(fixture, '.entry-deployment')?.textContent).toContain(
        'environment.short.unknown'
      );
      expect(el(fixture, '.entry-unknown')?.textContent?.trim()).toBe(
        'environment.unknownExplanation'
      );
    });

    /** Still asking is a quiet line, and no name is shown before one is known. */
    it('says it is checking while the deployment is being asked for', () => {
      const fixture = render();
      fixture.componentInstance.deployment.set(undefined);
      fixture.detectChanges();

      expect(el(fixture, '.entry-checking')?.textContent?.trim()).toBe(
        'environment.checking'
      );
      expect(el(fixture, '.entry-deployment')).toBeNull();
    });

    /** The two covers do not ask for it. */
    it('names no deployment unless asked to', () => {
      const fixture = render();
      fixture.componentInstance.named.set(false);
      fixture.detectChanges();

      expect(el(fixture, '.entry-deployment')).toBeNull();
      expect(el(fixture, '.entry-checking')).toBeNull();
    });
  });

  /**
   * The styles, read out of the source: a spec here loads no component
   * styles. The card is drawn over the two covers, which are opaque by rule
   * (plan 0003, section 5), so nothing in it may be see through either.
   */
  describe('the styles', () => {
    const source = readFileSync(join(__dirname, 'entry-card.ts'), 'utf8');
    const styles = source.slice(source.indexOf('styles: `'));

    it.each([
      ['a blur', /backdrop-filter|blur\(/],
      ['a translucent colour', /rgba?\(|hsla?\(|#[0-9a-f]{8}\b/i],
      ['a see through layer', /opacity/],
    ])('never draws with %s', (_case, forbidden) => {
      expect(styles).not.toMatch(forbidden);
    });

    /** A refusal is red on the red wash, with the ink of that wash. */
    it('draws a refusal on the danger wash, in its ink', () => {
      expect(styles).toMatch(
        /\.entry-error,\s*:host ::ng-deep \.entry-warning \{[^}]*background: var\(--admin-danger-wash\);\s*color: var\(--admin-danger-on-wash\);/
      );
    });

    /** The name of the deployment takes the pair of the rail at rest. */
    it('writes the deployment in the ink of the rail, on its color', () => {
      expect(styles).toMatch(
        /\.entry-deployment \{[^}]*background: var\(--admin-nav\);[^}]*color: var\(--admin-nav-ink\);/
      );
    });

    /** A field is 16 px on a phone, through the token, so that iOS does not zoom. */
    it('sizes a field through the tokens', () => {
      expect(styles).toMatch(/min-block-size: var\(--admin-control\)/);
      expect(styles).toMatch(/font-size: var\(--admin-field-size\)/);
    });
  });
});
