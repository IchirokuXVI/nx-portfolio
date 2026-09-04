import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { HarvestSwitch } from '@portfolio/luna-shopper-admin/models';
import { SwitchPanel } from './switch-panel';

/**
 * Section 7's third test: **the three switches render their real values and are
 * not editable.**
 *
 * The second half of that is the load bearing one here. Two of the three are
 * deployment configuration, and a back office control that edited a cluster's
 * config map is a different and much larger feature, so this panel must contain
 * no control at all.
 */

const shown: readonly HarvestSwitch[] = [
  { name: 'deployed', state: 'off', source: 'harvest.switch.from.chart' },
  {
    name: 'harvestEnabled',
    state: 'unknown',
    source: 'harvest.switch.from.nothing',
  },
  {
    name: 'mercadonaEnabled',
    state: 'on',
    source: 'harvest.switch.from.run',
  },
];

async function render(
  switches: readonly HarvestSwitch[] = shown
): Promise<ComponentFixture<SwitchPanel>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [SwitchPanel, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(SwitchPanel);
  fixture.componentRef.setInput('switches', switches);
  fixture.detectChanges();
  return fixture;
}

describe('SwitchPanel', () => {
  it('draws one row per switch', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(3);
  });

  it('names each switch and says what it decides', async () => {
    const text = (await render()).nativeElement.textContent;

    for (const item of shown) {
      expect(text).toContain(`harvest.switch.name.${item.name}`);
      expect(text).toContain(`harvest.switch.what.${item.name}`);
    }
  });

  it('renders each state as given, including the unknown one', async () => {
    const states = [
      ...(await render()).nativeElement.querySelectorAll('.state'),
    ].map((node: Element) => node.textContent?.trim());

    expect(states).toEqual([
      'harvest.switch.state.off',
      'harvest.switch.state.unknown',
      'harvest.switch.state.on',
    ]);
  });

  /**
   * Guessing `off` would be the worst available answer. Both switches default
   * to false, so the guess would be right most of the time and wrong exactly
   * when somebody is working out why their run did nothing.
   */
  it('does not round an unknown switch down to off', async () => {
    const fixture = await render([
      {
        name: 'harvestEnabled',
        state: 'unknown',
        source: 'harvest.switch.from.nothing',
      },
    ]);

    const state = fixture.nativeElement.querySelector('.state');
    expect(state.textContent.trim()).toBe('harvest.switch.state.unknown');
    expect(state.classList.contains('off')).toBe(false);
  });

  it('says how each state was arrived at', async () => {
    const text = (await render()).nativeElement.textContent;

    for (const item of shown) {
      expect(text).toContain(item.source);
    }
  });

  /**
   * The point of the panel. It shows all three and changes none of them: they
   * are deployment configuration, not application state.
   */
  it('offers no control of any kind', async () => {
    const panel = (await render()).nativeElement;

    expect(panel.querySelectorAll('button')).toHaveLength(0);
    expect(panel.querySelectorAll('input')).toHaveLength(0);
    expect(panel.querySelectorAll('select')).toHaveLength(0);
    expect(panel.querySelectorAll('a')).toHaveLength(0);
  });
});
