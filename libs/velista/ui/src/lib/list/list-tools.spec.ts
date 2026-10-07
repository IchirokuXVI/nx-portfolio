import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ListTools } from './list-tools';

/** A page that projects every slot, as the basket does. */
@Component({
  imports: [ListTools],
  template: `
    <lib-list-tools
      (openFilter)="filters = filters + 1"
      [activeCount]="active()"
    >
      <p class="lead-content">4 of 12 got</p>
      <p class="trail-content" listToolsTrail>total</p>
      <p class="below-content" listToolsBelow>chips</p>
    </lib-list-tools>
  `,
})
class Host {
  readonly active = signal(0);
  filters = 0;
}

/** A page that projects nothing, as the zone list does. */
@Component({
  imports: [ListTools],
  template: `<lib-list-tools />`,
})
class Bare {}

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
  it('draws the leading content and the filter, with what goes below under them', async () => {
    const fixture = await render();

    expect(query(fixture, 'lib-list-tools.tools-bar')).not.toBeNull();
    expect(query(fixture, '.tools .lead .lead-content')).not.toBeNull();
    expect(query(fixture, '.tools-bar > .below-content')).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.tools .tool')
    ).toHaveLength(1);
  });

  /** Velista `0132`, section 3: the total sits between the count and the filter. */
  it('draws what the page marks `listToolsTrail` directly before the filter', async () => {
    const fixture = await render();
    const trail = query(fixture, '.tools > .trail-content');

    expect(trail?.previousElementSibling?.classList).toContain('lead');
    expect(trail?.nextElementSibling?.classList).toContain('tool');
  });

  /** The zone list page fills neither, and an empty slot must cost no layout. */
  it('leaves nothing between the lead and the filter for a page that projects no trail', async () => {
    await TestBed.configureTestingModule({
      imports: [Bare, RokuTranslatorTestingModule.forTesting()],
      providers: [provideVelistaTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Bare);
    fixture.detectChanges();

    const row = (fixture.nativeElement as HTMLElement).querySelector('.tools');
    expect(Array.from(row?.children ?? []).map((el) => el.className)).toEqual([
      'lead',
      'tool',
    ]);
  });

  /** Velista `0117`: the composer's field is the search, so the row has none. */
  it('draws no search of its own', async () => {
    const fixture = await render();

    expect(query(fixture, 'input')).toBeNull();
    expect(query(fixture, 'lib-search-icon')).toBeNull();
  });

  it('puts the count in the filter button’s name and badge only while something is on', async () => {
    const fixture = await render();
    const filter = () => query(fixture, '.tool') as HTMLElement;

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
