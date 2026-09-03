import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { EnvironmentBadge } from './environment-badge';

/**
 * The badge an operator reads to know which database they are about to write to
 * (plan 0001, section 6).
 *
 * The three states are asserted apart because collapsing any two of them is the
 * failure the feature exists to prevent: an app that has not asked yet, an app that
 * asked and was not told, and an app that knows are three different things to be in
 * front of, and only the last of them may show a named environment.
 *
 * The translator double returns the key, so the assertions read as key names rather
 * than as copy.
 */

async function render(deployment: Deployment | null | undefined) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [EnvironmentBadge, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(EnvironmentBadge);
  fixture.componentRef.setInput('deployment', deployment);
  fixture.detectChanges();
  return fixture;
}

const text = (fixture: ComponentFixture<unknown>, selector: string) =>
  fixture.nativeElement.querySelector(selector)?.textContent?.trim();

describe('EnvironmentBadge', () => {
  it.each<Deployment>(['production', 'staging', 'development'])(
    'names the %s deployment',
    async (deployment) => {
      const fixture = await render(deployment);

      expect(text(fixture, '.name')).toBe(`environment.${deployment}`);
      expect(text(fixture, '.source')).toBe('environment.sourcedFromApi');
    }
  );

  it('says it is still asking, and names no environment', async () => {
    const fixture = await render(undefined);

    expect(text(fixture, '.checking')).toBe('environment.checking');
    expect(fixture.nativeElement.querySelector('.badge')).toBeNull();
  });

  /**
   * The one that matters most. A gateway that would not say must produce "unknown"
   * and an explanation, never a default that happens to be wrong in the one
   * direction this feature exists to make impossible.
   */
  it('says unknown, and says why, when the deployment could not be established', async () => {
    const fixture = await render(null);

    expect(text(fixture, '.name')).toBe('environment.unknown');
    expect(text(fixture, '.unknown')).toBe('environment.unknownExplanation');
    expect(fixture.nativeElement.querySelector('.source')).toBeNull();
  });
});
