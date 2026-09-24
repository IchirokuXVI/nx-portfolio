import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ListTools } from './list-tools';

/**
 * A page that projects both slots, as the basket does, and owns whether the field is
 * open, as both pages do since velista `0109`. A real page keeps it in the URL and
 * clears the query when it closes; this one does the same with a signal.
 */
@Component({
  imports: [ListTools],
  template: `
    <lib-list-tools
      (openChange)="asked.push($event); setOpen($event)"
      (openFilter)="filters = filters + 1"
      (queryChange)="query.set($event)"
      [activeCount]="active()"
      [open]="open()"
      [query]="query()"
      [shown]="1"
      [total]="3"
    >
      <p class="lead-content">4 of 12 got</p>
      <p class="below-content" listToolsBelow>chips</p>
    </lib-list-tools>
  `,
})
class Host {
  readonly query = signal('');
  readonly active = signal(0);
  readonly open = signal(false);
  readonly asked: boolean[] = [];
  filters = 0;

  setOpen(open: boolean): void {
    this.open.set(open);
    if (!open) {
      this.query.set('');
    }
  }
}

async function render(): Promise<ComponentFixture<Host>> {
  await TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
    providers: [provideVelistaTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

function query(fixture: ComponentFixture<Host>, selector: string) {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    selector
  );
}

/** The tools row shared by the basket and the zone list (velista `0082`, section 2). */
describe('ListTools', () => {
  it('draws the leading content and the two controls, with what goes below under them', async () => {
    const fixture = await render();

    expect(query(fixture, 'lib-list-tools.tools-bar')).not.toBeNull();
    expect(query(fixture, '.tools .lead .lead-content')).not.toBeNull();
    expect(query(fixture, '.tools-bar > .below-content')).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.tools .tool')
    ).toHaveLength(2);
  });

  it('opens the field in place of the row, focused, and keeps what goes below', async () => {
    const fixture = await render();

    query(fixture, '.tool')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const input = query(fixture, 'input.search-input');
    expect(query(fixture, '.tools')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(query(fixture, '.below-content')).not.toBeNull();
  });

  it('emits what was typed, and Cancel clears it and gives the focus back', async () => {
    const fixture = await render();
    query(fixture, '.tool')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const input = query(fixture, 'input.search-input') as HTMLInputElement;
    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.query()).toBe('milk');

    query(fixture, '.search-cancel')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.query()).toBe('');
    expect(query(fixture, 'input.search-input')).toBeNull();
    expect(document.activeElement).toBe(query(fixture, '.tool'));
  });

  it('asks the page to open and to close, and draws whatever the page says', async () => {
    const fixture = await render();
    const host = fixture.componentInstance;

    query(fixture, '.tool')?.click();
    expect(host.asked).toEqual([true]);

    // Escape asks exactly as Cancel does, and the query is left to the page.
    fixture.detectChanges();
    await fixture.whenStable();
    query(fixture, 'input.search-input')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape' })
    );
    expect(host.asked).toEqual([true, false]);

    // The page closing it on its own, which is the phone's back button.
    host.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    host.open.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(query(fixture, 'input.search-input')).toBeNull();
    expect(document.activeElement).toBe(query(fixture, '.tool'));
  });

  it('draws the field open when the page starts open, and moves no focus', async () => {
    await TestBed.configureTestingModule({
      imports: [Host, RokuTranslatorTestingModule.forTesting()],
      providers: [provideVelistaTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const input = query(fixture, 'input.search-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
    expect(document.activeElement).not.toBe(input);
  });

  it('puts the count in the filter button’s name and badge only while something is on', async () => {
    const fixture = await render();
    const filter = () =>
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.tool'
      )[1];

    expect(filter().getAttribute('aria-label')).toBe('basket.view.open');
    expect(filter().querySelector('.tool-badge')).toBeNull();

    fixture.componentInstance.active.set(2);
    fixture.detectChanges();

    expect(filter().getAttribute('aria-label')).toBe('basket.view.openCount');
    expect(filter().querySelector('.tool-badge')?.textContent?.trim()).toBe(
      '2'
    );

    filter().click();
    expect(fixture.componentInstance.filters).toBe(1);
  });
});
