import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  RokuTranslatorService,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddingBar } from './adding-bar';

/**
 * The line that says which list the plus adds to (velista `0134`, section 4.2):
 * the list's name, which opens the sheet of lists, and the count of what this
 * visit added, which opens the sheet of those.
 */
interface Inputs {
  readonly list?: string;
  readonly count?: number;
  readonly compact?: boolean;
}

/** Every translator call of the render, to read the values a string was given. */
let asked: jest.SpyInstance;

async function render(
  inputs: Inputs = {}
): Promise<ComponentFixture<AddingBar>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AddingBar, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();
  asked = jest.spyOn(TestBed.inject(RokuTranslatorService), 't');

  const fixture = TestBed.createComponent(AddingBar);
  fixture.componentRef.setInput('list', inputs.list ?? 'Weekly shop');
  if (inputs.count !== undefined) {
    fixture.componentRef.setInput('count', inputs.count);
  }
  if (inputs.compact !== undefined) {
    fixture.componentRef.setInput('compact', inputs.compact);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function host(fixture: ComponentFixture<AddingBar>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function listButton(fixture: ComponentFixture<AddingBar>): HTMLButtonElement {
  return host(fixture).querySelector(
    '[data-adding="list"]'
  ) as HTMLButtonElement;
}

function countButton(
  fixture: ComponentFixture<AddingBar>
): HTMLButtonElement | null {
  return host(fixture).querySelector<HTMLButtonElement>(
    '[data-adding="count"]'
  );
}

/** The values the last call for a key was given. */
function valuesOf(key: string): unknown {
  const calls = asked.mock.calls.filter((call) => call[0] === key);
  return calls[calls.length - 1]?.[3];
}

function record(fixture: ComponentFixture<AddingBar>): string[] {
  const heard: string[] = [];
  fixture.componentInstance.listPressed.subscribe(() => heard.push('list'));
  fixture.componentInstance.countPressed.subscribe(() => heard.push('count'));
  return heard;
}

describe('AddingBar', () => {
  it('says Adding to, and the name of the list', async () => {
    const fixture = await render({ list: 'Weekly shop' });

    expect(host(fixture).querySelector('.lead')?.textContent).toContain(
      'catalog.adding.to'
    );
    expect(listButton(fixture).querySelector('.list-name')?.textContent).toBe(
      'Weekly shop'
    );
  });

  it('names the list button for the list and for what a press does', async () => {
    const fixture = await render({ list: 'Weekly shop' });

    expect(listButton(fixture).getAttribute('aria-label')).toBe(
      'catalog.adding.change'
    );
    expect(valuesOf('catalog.adding.change')).toEqual({ list: 'Weekly shop' });
  });

  it('draws the name of another list when the choice changes', async () => {
    const fixture = await render({ list: 'Weekly shop' });

    fixture.componentRef.setInput('list', 'Barbecue');
    fixture.detectChanges();

    expect(listButton(fixture).querySelector('.list-name')?.textContent).toBe(
      'Barbecue'
    );
  });

  it('draws no count before the first add', async () => {
    const fixture = await render();

    expect(countButton(fixture)).toBeNull();
    expect(host(fixture).querySelectorAll('button')).toHaveLength(1);
    expect(host(fixture).textContent).not.toContain('catalog.adding.count');
  });

  it('draws no count at an explicit zero', async () => {
    const fixture = await render({ count: 0 });

    expect(countButton(fixture)).toBeNull();
  });

  it('counts one product', async () => {
    const fixture = await render({ count: 1 });

    expect(countButton(fixture)?.textContent).toContain('catalog.adding.count');
    expect(valuesOf('catalog.adding.count')).toEqual({ count: 1 });
  });

  it('counts three products', async () => {
    const fixture = await render({ count: 3 });

    expect(countButton(fixture)?.textContent).toContain('catalog.adding.count');
    expect(valuesOf('catalog.adding.count')).toEqual({ count: 3 });
  });

  it('has a singular and a plural for the count in both languages', () => {
    // The testing translator answers the key, so the two forms are read off the
    // files the real one loads.
    for (const locale of ['en', 'es']) {
      const file = join(__dirname, '../../../assets/i18n', `${locale}.json`);
      const adding = JSON.parse(readFileSync(file, 'utf8')).catalog.adding;

      expect(adding.count_one).toContain('{{count}}');
      expect(adding.count_other).toContain('{{count}}');
      expect(adding.count_one).not.toBe(adding.count_other);
    }
  });

  it('opens the sheet of lists from the name', async () => {
    const fixture = await render({ count: 3 });
    const heard = record(fixture);

    listButton(fixture).click();

    expect(heard).toEqual(['list']);
  });

  it('opens the sheet of what was added from the count', async () => {
    const fixture = await render({ count: 3 });
    const heard = record(fixture);

    countButton(fixture)?.click();

    expect(heard).toEqual(['count']);
  });

  it('is the name alone when compact, whatever was added', async () => {
    const fixture = await render({ count: 3, compact: true });

    expect(host(fixture).classList.contains('is-compact')).toBe(true);
    expect(countButton(fixture)).toBeNull();
    expect(listButton(fixture).querySelector('.list-name')?.textContent).toBe(
      'Weekly shop'
    );
  });

  it('still opens the sheet of lists when compact', async () => {
    const fixture = await render({ count: 3, compact: true });
    const heard = record(fixture);

    listButton(fixture).click();

    expect(heard).toEqual(['list']);
  });

  it('is not compact unless asked', async () => {
    const fixture = await render({ count: 3 });

    expect(host(fixture).classList.contains('is-compact')).toBe(false);
  });
});
