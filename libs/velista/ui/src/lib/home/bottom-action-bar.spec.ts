import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { BottomActionBar } from './bottom-action-bar';

/**
 * Plan 0019, section 4. The primary action on the dashboard was **New list**, which
 * called a method that did nothing, because a list belongs to a zone and the dashboard
 * is the one screen with no zone in scope. It is now **Get shopping list**, disabled,
 * with the reason on screen.
 *
 * The assertion worth keeping is that the disabled state is not reachable from
 * outside: it is a hard coded binding rather than an input, so no caller can enable a
 * button with nothing behind it.
 */
async function render(): Promise<ComponentFixture<BottomActionBar>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [BottomActionBar, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(BottomActionBar);
  fixture.detectChanges();

  return fixture;
}

function primary(
  fixture: ComponentFixture<BottomActionBar>
): HTMLButtonElement {
  const button = (
    fixture.nativeElement as HTMLElement
  ).querySelector<HTMLButtonElement>('.primary');
  if (button === null) {
    throw new Error('the primary action is not rendered');
  }
  return button;
}

describe('BottomActionBar', () => {
  it('offers Get shopping list as the primary action', async () => {
    const fixture = await render();

    expect(primary(fixture).textContent?.trim()).toBe(
      'home.action.generateList'
    );
  });

  it('ships it disabled, because there is nothing behind it yet', async () => {
    const fixture = await render();

    expect(primary(fixture).disabled).toBe(true);
  });

  it('says why, where a screen reader will find it', async () => {
    const fixture = await render();

    const describedBy = primary(fixture).getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();

    const reason = (fixture.nativeElement as HTMLElement).querySelector(
      `#${describedBy}`
    );
    expect(reason?.textContent?.trim()).toBe('home.action.generateListSoon');
  });

  it('leaves the join-by-code action working', async () => {
    const fixture = await render();

    let joined = 0;
    fixture.componentInstance.joinZone.subscribe(() => (joined += 1));

    const secondary = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('.secondary');
    secondary?.click();

    expect(joined).toBe(1);
  });
});
