import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { BottomActionBar } from './bottom-action-bar';

/**
 * Plan 0019, section 4. The primary action on the dashboard was **New list**, which
 * called a method that did nothing, because a list belongs to a zone and the dashboard
 * is the one screen with no zone in scope. It is now **Get shopping list**.
 *
 * It was disabled with a permanent caption underneath. Plan 0025 makes it live and
 * moves the caption behind the tap, so the assertions worth keeping are that nothing
 * says **Coming soon** until somebody asks, and that asking is what says it.
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

  it('says nothing about it being unbuilt until somebody asks', async () => {
    const fixture = await render();

    expect(primary(fixture).disabled).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.soon')
    ).toBeNull();
    expect(primary(fixture).getAttribute('aria-describedby')).toBeNull();
  });

  it('answers the tap, where a screen reader will hear it', async () => {
    const fixture = await render();

    primary(fixture).click();
    fixture.detectChanges();

    const describedBy = primary(fixture).getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();

    const reason = (fixture.nativeElement as HTMLElement).querySelector(
      `#${describedBy}`
    );
    expect(reason?.textContent?.trim()).toBe('home.action.generateListSoon');
    // A live region, because the answer appears with nothing else on screen moving.
    expect(reason?.getAttribute('role')).toBe('status');
  });

  it('keeps the answer once given, rather than timing it out', async () => {
    const fixture = await render();

    primary(fixture).click();
    primary(fixture).click();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.soon')
    ).toHaveLength(1);
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
