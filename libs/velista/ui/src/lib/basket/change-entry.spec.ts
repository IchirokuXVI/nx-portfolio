import { TestBed } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { ChangeEntry, type ChangeEntryView } from './change-entry';

/**
 * One entry of the changes sheet (velista `0093`, section 6).
 *
 * The component decides nothing: the sentence, the name, the list and the time
 * are all resolved before they reach it. What is worth asserting is that it
 * **offers no control** and that its second line disappears rather than drawing
 * an empty muted row for a guest who is served none of the three.
 */
function view(over: Partial<ChangeEntryView> = {}): ChangeEntryView {
  return {
    id: 'chg-1',
    key: 'basket.changes.entry.renamed',
    args: { name: 'Milk', before: 'Leche' },
    who: 'Dani',
    list: 'in Weekly shop',
    when: '1 Sep 2026, 09:00',
    unseen: false,
    ...over,
  };
}

async function render(entry: ChangeEntryView) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ChangeEntry, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(ChangeEntry);
  fixture.componentRef.setInput('entry', entry);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ChangeEntry', () => {
  it('draws the sentence it was handed, and nothing to press', async () => {
    const host = await render(view());

    expect(host.querySelector('.what')?.textContent).toContain(
      'basket.changes.entry.renamed'
    );
    // A change is a fact, and the row it is about is one dismiss away.
    expect(host.querySelectorAll('button, a')).toHaveLength(0);
  });

  it('joins who, which list and when into one muted line', async () => {
    const host = await render(view());

    expect(host.querySelector('.meta')?.textContent?.trim()).toBe(
      'Dani · in Weekly shop · 1 Sep 2026, 09:00'
    );
  });

  it('draws no second line at all for a reader served none of the three', async () => {
    // A guest. An empty muted row under every entry is a sheet that looks
    // broken to the reader it is redacted for.
    const host = await render(view({ who: '', list: '', when: '' }));

    expect(host.querySelector('.meta')).toBeNull();
  });

  it('leaves the separator out where a piece is missing', async () => {
    const host = await render(view({ list: '' }));

    expect(host.querySelector('.meta')?.textContent?.trim()).toBe(
      'Dani · 1 Sep 2026, 09:00'
    );
  });

  it('wears the same tag a marked row does when the server says it is new', async () => {
    const host = await render(view({ unseen: true }));

    expect(host.querySelector('.tag')?.textContent).toContain(
      'basket.mark.added'
    );
    expect(host.querySelector('.tag-dot')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('wears none when the server says it has been seen', async () => {
    const host = await render(view({ unseen: false }));

    expect(host.querySelector('.tag')).toBeNull();
  });
});
