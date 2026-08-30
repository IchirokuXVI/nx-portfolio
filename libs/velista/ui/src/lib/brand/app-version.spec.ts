import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { APP_VERSION } from '@portfolio/velista/models';
import { AppVersion } from './app-version';

/**
 * The version line, which exists so somebody can read out which bundle they are on.
 *
 * The assertions are split the way the testing translator asks for: the double returns
 * the key and ignores the interpolation values, so which **string** was asked for is
 * checked in the DOM and which **version** it was given is checked on the signal that
 * produced it. Reading an interpolated number back out of the markup would only be
 * proving that the double works.
 */
describe('AppVersion', () => {
  function render(version: string | null) {
    TestBed.configureTestingModule({
      imports: [AppVersion, RokuTranslatorTestingModule.forTesting()],
      providers:
        version === null ? [] : [{ provide: APP_VERSION, useValue: version }],
    });
    const fixture = TestBed.createComponent(AppVersion);
    fixture.detectChanges();
    return fixture;
  }

  it('names the build it was given', () => {
    const fixture = render('1.4.0');

    expect(fixture.componentInstance.version()).toBe('1.4.0');
    expect(
      (fixture.nativeElement as HTMLElement).textContent?.trim()
    ).toContain('app-version');
  });

  /**
   * `staging` and `0.0.0-dev` are the two strings a non release build carries, and by
   * plan 0034 D6 neither parses as a version. They are still shown, exactly as they
   * are: the point of the line is to say which bundle is running, and "not a release"
   * is the most useful thing it can say about these two.
   */
  it.each(['staging', '0.0.0-dev'])('shows %s as it is', (build) => {
    expect(render(build).componentInstance.version()).toBe(build);
  });

  it('draws nothing when no build was named', () => {
    // The token's own default, which is what a library rendered without the app's
    // providers gets. A line reading "Version unknown" is worse than no line.
    const fixture = render(null);

    expect(fixture.componentInstance.version()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('draws nothing for a blank build', () => {
    expect(render('   ').componentInstance.version()).toBeNull();
  });
});
