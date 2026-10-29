import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { AddChoiceRow } from '@portfolio/velista/models';
import { BackStack } from '@portfolio/velista/platform';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddChoice } from './add-choice';

/**
 * The question a typed name already on the list asks (velista `0170`, target 5):
 * one row per line, in order, then "A new line"; focus on the first row; a press is
 * the answer.
 */
const ROWS: readonly AddChoiceRow[] = [
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
    name: 'Leche entera sin lactosa de la marca más larga del pasillo',
    product: null,
    imageUrl: null,
    from: 0,
    to: 1,
  },
];

async function render(
  inputs: Partial<{
    name: string;
    rows: readonly AddChoiceRow[];
    scope: 'list' | 'basket';
    back: string | null;
    added: number;
  }> = {}
): Promise<ComponentFixture<AddChoice>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AddChoice, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(AddChoice);
  fixture.componentRef.setInput('name', inputs.name ?? 'Leche entera');
  fixture.componentRef.setInput('rows', inputs.rows ?? ROWS);
  if (inputs.scope !== undefined) {
    fixture.componentRef.setInput('scope', inputs.scope);
  }
  if (inputs.back !== undefined) {
    fixture.componentRef.setInput('back', inputs.back);
  }
  if (inputs.added !== undefined) {
    fixture.componentRef.setInput('added', inputs.added);
  }
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function rows(fixture: ComponentFixture<AddChoice>): HTMLButtonElement[] {
  return [
    ...(
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('.row'),
  ];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AddChoice', () => {
  it('draws one row per line in order, and a new line last', async () => {
    const fixture = await render();

    const drawn = rows(fixture);
    expect(drawn).toHaveLength(3);
    expect(drawn[0].querySelector('.name')?.textContent?.trim()).toBe(
      'Leche entera'
    );
    expect(drawn[0].querySelector('.product')?.textContent?.trim()).toBe(
      'Hacendado · 1 L'
    );
    expect(drawn[0].querySelector('.count')?.textContent).toMatch(/2\s*→\s*3/);
    expect(drawn[1].querySelector('.product')).toBeNull();
    expect(drawn[1].querySelector('.count')?.textContent).toMatch(/0\s*→\s*1/);
    expect(drawn[2].classList.contains('new')).toBe(true);
    expect(drawn[2].textContent).toContain('list.addChoice.newLine');
    expect(drawn[2].querySelector('.dashed lib-plus-icon')).not.toBeNull();
  });

  it('titles the list and the basket each in their own words', async () => {
    let fixture = await render();
    const title = () =>
      (fixture.nativeElement as HTMLElement).querySelector('.title');
    expect(title()?.textContent).toContain('list.addChoice.title');

    fixture = await render({ scope: 'basket' });
    expect(title()?.textContent).toContain('basket.addChoice.title');
  });

  it('names each row for a screen reader, with what the add makes of it', async () => {
    const fixture = await render({ added: 2 });

    expect(rows(fixture)[0].getAttribute('aria-label')).toBe(
      'list.addChoice.row'
    );
    expect(rows(fixture)[1].getAttribute('aria-label')).toBe(
      'list.addChoice.rowNoProduct'
    );
    // The arrow is drawn for the eye; the name already says it.
    expect(
      rows(fixture)[0].querySelector('.count')?.getAttribute('aria-hidden')
    ).toBe('true');
  });

  it('moves focus to the first row when it opens', async () => {
    const fixture = await render();

    expect(document.activeElement).toBe(rows(fixture)[0]);
  });

  it('answers with the line pressed, or with a new line', async () => {
    const fixture = await render();
    const chose: string[] = [];
    let fresh = 0;
    fixture.componentInstance.chose.subscribe((id) => chose.push(id));
    fixture.componentInstance.newLine.subscribe(() => (fresh += 1));

    rows(fixture)[1].click();
    rows(fixture)[2].click();

    expect(chose).toEqual(['line-b']);
    expect(fresh).toBe(1);
  });

  it('draws the way back to the lists only when it is given one', async () => {
    let fixture = await render();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('.back')
    ).toBeNull();

    fixture = await render({ scope: 'basket', back: 'Compra semanal' });
    const back = (fixture.nativeElement as HTMLElement).querySelector(
      '.back'
    ) as HTMLButtonElement;
    let returned = 0;
    fixture.componentInstance.returned.subscribe(() => (returned += 1));
    expect(back.textContent).toContain('Compra semanal');

    back.click();

    expect(returned).toBe(1);
  });

  it('closes on the back gesture, which has no route to pop', async () => {
    const fixture = await render();
    let dismissed = 0;
    fixture.componentInstance.dismissed.subscribe(() => (dismissed += 1));

    expect(TestBed.inject(BackStack).handle()).toBe(true);
    expect(dismissed).toBe(1);
  });

  it('wraps the title and cuts a row, and never shrinks the count', () => {
    // The rules of the mock, stated where they live: a title is never clamped and
    // breaks a word with no spaces, a name and a product line cut with an ellipsis,
    // and the count beside them does not give way.
    const scss = readFileSync(join(__dirname, 'add-choice.scss'), 'utf8');
    const rule = (selector: string) => {
      const start = scss.indexOf(`\n${selector} {`);
      return start === -1 ? '' : scss.slice(start, scss.indexOf('}', start));
    };

    expect(rule('.title')).toContain('overflow-wrap: anywhere');
    expect(rule('.title')).not.toMatch(/line-clamp|nowrap/);
    expect(scss).toMatch(
      /\.name,\s*\n\.product\s*\{[^}]*text-overflow: ellipsis/
    );
    expect(rule('.count')).toContain('flex: none');
    expect(rule('.count')).toContain('white-space: nowrap');
  });
});
