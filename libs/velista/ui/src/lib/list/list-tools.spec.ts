import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ListTools } from './list-tools';

/** A page that projects both slots, as the basket does. */
@Component({
  imports: [ListTools],
  template: `
    <lib-list-tools
      (openFilter)="filters = filters + 1"
      (queryChange)="query.set($event)"
      [activeCount]="active()"
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
  filters = 0;
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
