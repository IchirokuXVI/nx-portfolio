import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { BottomActionBar } from './bottom-action-bar';

/**
 * Plan 0019, section 4. The primary action on the dashboard was **New list**, which
 * called a method that did nothing, because a list belongs to a zone and the dashboard
 * is the one screen with no zone in scope. It became **Get shopping list**.
 *
 * It was disabled with a permanent **Coming soon** caption; `0025` made it live and
 * moved the caption behind the tap; **plan 0045 built the feature**, so the caption is
 * gone along with the state that held it. What is left to assert is that the button is
 * live, that it says nothing about being unbuilt, and that it raises the output the
 * dashboard turns into a route.
 *
 * Plan 0061 made the bar the shell both screens that end in one use, so the second
 * group of cases guards the refactor rather than the measurements: projected content
 * replaces the dashboard's pair, and with nothing projected the pair is still there and
 * its outputs still fire. Nothing here asserts a size, because jsdom computes no layout
 * and a spec on a class name would assert nothing about one (section 3).
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

  it('is live, with nothing hedging it', async () => {
    const fixture = await render();

    expect(primary(fixture).disabled).toBe(false);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.soon')
    ).toBeNull();
    expect(primary(fixture).getAttribute('aria-describedby')).toBeNull();
  });

  it('raises the output the dashboard routes to the sheet', async () => {
    const fixture = await render();

    let asked = 0;
    fixture.componentInstance.getList.subscribe(() => (asked += 1));

    primary(fixture).click();

    expect(asked).toBe(1);
  });

  // The caption is gone, and so is the signal behind it (plan 0045). Asserted rather
  // than merely deleted, because "no Coming soon anywhere" is the visible half of
  // shipping the feature, and a reintroduced caption would otherwise pass silently.
  it('never says Coming soon, even after the tap', async () => {
    const fixture = await render();

    primary(fixture).click();
    fixture.detectChanges();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('generateListSoon');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.soon')
    ).toBeNull();
    expect(primary(fixture).getAttribute('aria-describedby')).toBeNull();
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

/** A caller that supplies its own row, the way the shopping list history does. */
@Component({
  imports: [BottomActionBar],
  template: `
    <lib-bottom-action-bar>
      <button class="projected" type="button">get list</button>
    </lib-bottom-action-bar>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ProjectingHost {}

describe('BottomActionBar as a shell', () => {
  async function renderHost(): Promise<ComponentFixture<ProjectingHost>> {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [ProjectingHost, RokuTranslatorTestingModule.forTesting()],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProjectingHost);
    fixture.detectChanges();

    return fixture;
  }

  it('renders a projected row inside the bar', async () => {
    const fixture = await renderHost();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.bar > .projected')).not.toBeNull();
  });

  // The whole point of the fallback: a caller with a row of its own gets its row and
  // nothing else, so the history page does not also grow the dashboard's join button.
  it('drops the dashboard pair when a row is projected', async () => {
    const fixture = await renderHost();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.primary')).toBeNull();
    expect(host.querySelector('.secondary')).toBeNull();
  });

  it('keeps the dashboard pair when nothing is projected', async () => {
    const fixture = await render();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.bar > .primary')).not.toBeNull();
    expect(host.querySelector('.bar > .secondary')).not.toBeNull();
  });
});
