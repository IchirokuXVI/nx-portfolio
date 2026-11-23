import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { ListRowLayout } from '@portfolio/velista/models';
import { ViewPicker } from './view-picker';

/**
 * The view picker (velista `0202`, section 2, spec 3): a button that opens the two
 * views, the current one checked, and a choice that is handed out and closes it.
 *
 * The overlay is drawn into the document next to its anchor, so the rows are read
 * from the document and not the fixture.
 */
let fixture: ComponentFixture<ViewPicker>;
let picked: ListRowLayout[];

async function render(
  layout: ListRowLayout = 'default',
  look: 'header' | 'tool' = 'header'
): Promise<void> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ViewPicker, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  fixture = TestBed.createComponent(ViewPicker);
  fixture.componentRef.setInput('layout', layout);
  fixture.componentRef.setInput('look', look);
  // Focus only moves on an element that is in the document.
  document.body.append(fixture.nativeElement as HTMLElement);
  fixture.detectChanges();
  await fixture.whenStable();

  picked = [];
  fixture.componentInstance.chosen.subscribe((view) => picked.push(view));
}

async function settle(): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function trigger(): HTMLButtonElement {
  return (fixture.nativeElement as HTMLElement).querySelector(
    'button.trigger'
  ) as HTMLButtonElement;
}

async function open(): Promise<void> {
  trigger().click();
  await settle();
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

function option(view: ListRowLayout): HTMLButtonElement {
  return document.querySelector(
    `[role="menuitemradio"][data-view="${view}"]`
  ) as HTMLButtonElement;
}

afterEach(() => {
  fixture?.destroy();
  document.body.innerHTML = '';
});

describe('ViewPicker (velista 0202)', () => {
  it('is a header action named View with the view glyph, closed', async () => {
    await render();

    expect(trigger().hasAttribute('libpageheaderaction')).toBe(true);
    expect(trigger().getAttribute('aria-label')).toBe('view.title');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().querySelector('lib-view-icon')).not.toBeNull();
    expect(menu()).toBeNull();
  });

  it('is a square of the tools row in the tool look', async () => {
    await render('default', 'tool');

    expect(trigger().classList).toContain('tool');
    expect(trigger().hasAttribute('libpageheaderaction')).toBe(false);
    expect(trigger().querySelector('lib-view-icon.tool-glyph')).not.toBeNull();
  });

  it('opens two menuitemradio rows, each a glyph and its words', async () => {
    await render();
    await open();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().classList).toContain('is-open');
    expect(menu()?.getAttribute('aria-label')).toBe('view.title');
    const rows = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ];
    expect(rows.map((row) => row.dataset['view'])).toEqual([
      'default',
      'compact',
    ]);
    expect(
      option('default').querySelector('lib-default-view-icon')
    ).not.toBeNull();
    expect(option('default').textContent).toContain('view.default');
    expect(
      option('compact').querySelector('lib-compact-view-icon')
    ).not.toBeNull();
    expect(option('compact').querySelector('.name')?.textContent).toBe(
      'view.compact'
    );
    expect(option('compact').querySelector('.hint')?.textContent).toBe(
      'view.compactHint'
    );
    expect(option('default').querySelector('.hint')).toBeNull();
  });

  it.each(['default', 'compact'] as const)(
    'checks the current view, %s, with the tick and the heavier weight',
    async (layout) => {
      await render(layout);
      await open();

      const other: ListRowLayout = layout === 'default' ? 'compact' : 'default';
      expect(option(layout).getAttribute('aria-checked')).toBe('true');
      expect(option(layout).classList).toContain('is-on');
      expect(
        option(layout).querySelector('.tick lib-check-icon')
      ).not.toBeNull();
      expect(option(other).getAttribute('aria-checked')).toBe('false');
      expect(option(other).querySelector('.tick lib-check-icon')).toBeNull();
    }
  );

  it('puts focus on the current row when it opens', async () => {
    await render('compact');
    await open();

    expect(document.activeElement).toBe(option('compact'));
  });

  it('hands out a choice, closes, and gives focus back to the button', async () => {
    await render();
    await open();

    option('compact').click();
    await settle();

    expect(picked).toEqual(['compact']);
    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on Escape with no choice, and focus goes back to the button', async () => {
    await render();
    await open();

    option('default').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    await settle();

    expect(picked).toEqual([]);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('moves between the rows with the arrow keys', async () => {
    await render();
    await open();

    option('default').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );

    expect(document.activeElement).toBe(option('compact'));
  });

  it('closes on a second press of the button', async () => {
    await render();
    await open();
    await open();

    expect(menu()).toBeNull();
  });
});
