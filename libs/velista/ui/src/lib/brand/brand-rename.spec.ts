import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_BRAND, type AppBrand } from '@portfolio/velista/models';
import { BrandMark } from './brand-mark';
import { BrandWordmark } from './brand-wordmark';

/**
 * Plan 0002, acceptance criterion 7: *renaming the product has been rehearsed once
 * by changing only the brand provider and the translation values, confirming no
 * component needed a change.*
 *
 * This is that rehearsal, kept as a test rather than done once by hand, because a
 * rehearsal that is not repeated stops being true the first time somebody types
 * the product name into a template. The product has already been renamed once,
 * from Luna Shopper to Velista, which is why the plan bothers.
 *
 * The rename is performed here by providing a different `AppBrand` and nothing
 * else. No component, route, token or translation **key** is touched, which is
 * exactly the claim rule N1 makes.
 */
const renamed: AppBrand = {
  name: 'Kestrel Basket',
  shortName: 'Kestrel',
  wordmarkSrc: 'kestrel-mark.svg',
  iconSrc: 'kestrel-app-icon.svg',
};

@Component({
  imports: [BrandMark, BrandWordmark],
  template: `<lib-brand-wordmark /> <lib-brand-mark [decorative]="false" />`,
})
class BrandHarness {}

describe('renaming the product', () => {
  function render(brand: AppBrand) {
    TestBed.configureTestingModule({
      imports: [BrandHarness],
      providers: [{ provide: APP_BRAND, useValue: brand }],
    });
    const fixture = TestBed.createComponent(BrandHarness);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('changes every rendered name from the provider alone', () => {
    const host = render(renamed);

    expect(host.textContent).toContain('Kestrel Basket');
    expect(
      host.querySelector('lib-brand-wordmark')?.getAttribute('aria-label')
    ).toBe('Kestrel Basket');
    // The second mark, not the first: the wordmark's own mark is decorative, so
    // the lockup carries one accessible name rather than two.
    const marks = host.querySelectorAll('lib-brand-mark .mark');
    expect(marks[0].getAttribute('aria-label')).toBeNull();
    expect(marks[1].getAttribute('aria-label')).toBe('Kestrel Basket');
  });

  it('leaves nothing of the previous name behind', () => {
    const host = render(renamed);

    // Everything a person can read or hear: the visible text and every accessible
    // name. A component that hardcoded the name it has now, or the one it had
    // before it, would fail here, and that is the whole point.
    const spoken = [...host.querySelectorAll('[aria-label]')]
      .map((element) => element.getAttribute('aria-label'))
      .join(' ');

    for (const surface of [host.textContent ?? '', spoken]) {
      expect(surface).not.toMatch(/velista/i);
      expect(surface).not.toMatch(/luna/i);
    }

    // Not `innerHTML`: the resolved asset URL is in there, and the two brand
    // **files** are the one place section 5.2 allows the product name, because the
    // mark is the identity itself. Asserting over the raw markup would either fail
    // on a legitimate filename or, worse, pass only because the test bundler
    // stubbed the URL out.
  });

  it('uses the short form only where it is asked for', () => {
    TestBed.configureTestingModule({
      imports: [BrandWordmark],
      providers: [{ provide: APP_BRAND, useValue: renamed }],
    });
    const fixture = TestBed.createComponent(BrandWordmark);
    fixture.componentRef.setInput('short', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Kestrel'
    );
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'Basket'
    );
  });
});
