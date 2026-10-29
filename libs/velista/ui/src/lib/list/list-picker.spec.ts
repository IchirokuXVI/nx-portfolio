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

  /**
   * Velista `0170`, target 6: after a pick, the question of which line takes the
   * popover's place, held against the same button, with the list as the way back.
   */
  describe('the second question', () => {
    const CHOICE = {
      name: 'Leche entera',
      listName: 'Compra semanal',
      added: 1,
      rows: [
        {
          lineId: 'line-a',
          name: 'Leche entera',
          product: 'Hacendado · 1 L',
          imageUrl: null,
          from: 2,
          to: 3,
        },
        {
          lineId: 'line-b',
          name: 'Leche entera',
          product: null,
          imageUrl: null,
          from: 0,
          to: 1,
        },
      ],
    };
    const lines = () => [
      ...document.querySelectorAll<HTMLButtonElement>('.pop .row'),
    ];

    it('takes the place of the lists, in the same popover, labelled by its own title', async () => {
      const fixture = await render();
      open(fixture);

      fixture.componentRef.setInput('choice', CHOICE);
      fixture.detectChanges();

      expect(options()).toHaveLength(0);
      expect(lines()).toHaveLength(3);
      expect(document.querySelectorAll('.pop')).toHaveLength(1);
      expect(document.querySelector('.pop .back')?.textContent).toContain(
        'Compra semanal'
      );
      const dialog = document.querySelector('[role="dialog"]');
      const title = document.querySelector('.pop .title');
      expect(title?.textContent).toContain('basket.addChoice.title');
      expect(dialog?.getAttribute('aria-labelledby')).toBe(title?.id);
    });

    it('answers with the line, a new line, or back to the lists', async () => {
      const fixture = await render();
      const picked: string[] = [];
      let fresh = 0;
      let back = 0;
      fixture.componentInstance.choseLine.subscribe((id) => picked.push(id));
      fixture.componentInstance.choseNewLine.subscribe(() => (fresh += 1));
      fixture.componentInstance.backToLists.subscribe(() => (back += 1));
      open(fixture);
      fixture.componentRef.setInput('choice', CHOICE);
      fixture.detectChanges();

      lines()[1]?.click();
      lines()[2]?.click();
      (document.querySelector('.pop .back') as HTMLButtonElement).click();

      expect(picked).toEqual(['line-b']);
      expect(fresh).toBe(1);
      expect(back).toBe(1);
    });

    it('draws the lists again once the question is taken away', async () => {
      const fixture = await render();
      open(fixture);
      fixture.componentRef.setInput('choice', CHOICE);
      fixture.detectChanges();

      fixture.componentRef.setInput('choice', null);
      fixture.detectChanges();

      expect(lines()).toHaveLength(0);
      expect(options()).toHaveLength(2);
    });
  });
});
