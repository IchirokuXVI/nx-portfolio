import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ListPicker, type ListPickerRow } from './list-picker';

/**
 * The basket's list picker (velista `0116`): a popover held against the button
 * that was pressed, one button per list, and the pick is the add.
 *
 * The overlay is drawn into the document next to its anchor, so the queries here
 * read the document and not the fixture.
 */
const ROWS: readonly ListPickerRow[] = [
  { listId: 'l1', name: 'Compra semanal', zoneName: 'Casa', pending: 10 },
  { listId: 'l2', name: 'Fin de semana', zoneName: 'Casa', pending: 2 },
];

let anchor: HTMLButtonElement;

async function render(
  rows: readonly ListPickerRow[] = ROWS
): Promise<ComponentFixture<ListPicker>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ListPicker, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  anchor = document.createElement('button');
  document.body.append(anchor);

  const fixture = TestBed.createComponent(ListPicker);
  fixture.componentRef.setInput('rows', rows);
  fixture.detectChanges();
  return fixture;
}

function open(fixture: ComponentFixture<ListPicker>): void {
  fixture.componentRef.setInput('anchor', anchor);
  fixture.detectChanges();
}

function options(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('.option')];
}

afterEach(() => {
  anchor?.remove();
});

describe('ListPicker', () => {
  it('draws nothing until it is given an anchor', async () => {
    await render();

    expect(options()).toHaveLength(0);
  });

  it('asks which list, with one button per list in the order given', async () => {
    const fixture = await render();
    open(fixture);

    expect(document.querySelector('.title')?.textContent).toContain(
      'basket.add.sheetTitle'
    );
    expect(
      options().map((one) => one.querySelector('.name')?.textContent)
    ).toEqual(['Compra semanal', 'Fin de semana']);
    expect(options()[0]?.querySelector('.caption')?.textContent).toContain(
      'basket.add.listCaption'
    );
  });

  it('is named by its title', async () => {
    const fixture = await render();
    open(fixture);

    const dialog = document.querySelector('[role="dialog"]');
    const title = document.querySelector('.title');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(title?.id);
  });

  it('says which list was picked', async () => {
    const fixture = await render();
    const picked: string[] = [];
    fixture.componentInstance.chosen.subscribe((id) => picked.push(id));
    open(fixture);

    options()[1]?.click();

    expect(picked).toEqual(['l2']);
  });

  it('opens for a single list too, because the reader sees where it goes', async () => {
    const fixture = await render([ROWS[0] as ListPickerRow]);
    open(fixture);

    expect(options()).toHaveLength(1);
  });

  it('keeps the keyboard up: a press on a list does not take focus', async () => {
    const fixture = await render();
    open(fixture);
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
    });

    options()[0]?.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  it('closes on Escape and hands focus back to the button that opened it', async () => {
    const fixture = await render();
    const reasons: string[] = [];
    fixture.componentInstance.dismissed.subscribe((why) => reasons.push(why));
    open(fixture);

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    expect(reasons).toEqual(['escape']);
    expect(document.activeElement).toBe(anchor);
  });
});
