import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  fakeLineStore,
  provideFakeLineStore,
} from '@portfolio/velista/data-access';
import type { Line } from '@portfolio/velista/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LineGoneNotice, lineGoneKey, watchLineGone } from './line-gone';

/**
 * Why a sheet says its line is gone, and with which words (velista `0083`, and the
 * `emptied` reason of velista `0192`).
 */

const LIST_ID = 'list-1';
const LINE_ID = 'ln-1';

function line(): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Bananas',
    quantity: 1,
    itemIds: ['item-bananas'],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    named: false,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    createdByUserId: 'user-me',
    approvedByUserId: null,
    version: 1,
  };
}

const closes = jest.fn().mockResolvedValue(undefined);

@Component({
  selector: 'lib-test-sheet',
  imports: [LineGoneNotice],
  template: `
    @if (gone.reason(); as reason) {
      <lib-line-gone-notice [reason]="reason" titleId="title" />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestSheet {
  readonly gone = watchLineGone({
    listId: signal(LIST_ID),
    lineId: signal(LINE_ID),
    close: closes,
  });
}

async function render(): Promise<{
  fixture: ComponentFixture<TestSheet>;
  lines: ReturnType<typeof fakeLineStore>;
}> {
  TestBed.resetTestingModule();
  closes.mockClear();
  const lines = fakeLineStore({ lines: [line()], state: 'loaded' });
  await TestBed.configureTestingModule({
    imports: [TestSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [provideFakeLineStore(lines)],
  }).compileComponents();
  const fixture = TestBed.createComponent(TestSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, lines };
}

describe('watchLineGone', () => {
  it('says the line reached 0 when another device took it there', async () => {
    const { fixture, lines } = await render();

    lines.emptyByOthers(LINE_ID);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.gone.reason()).toBe('emptied');
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('list.gone.emptied');
    expect(text).not.toContain('list.gone.byOthers');
    expect(closes).not.toHaveBeenCalled();
  });

  it('closes quietly for a line this reader took to 0', async () => {
    const { fixture, lines } = await render();

    lines.emptyByMe(LINE_ID);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.gone.reason()).toBeNull();
    expect(closes).toHaveBeenCalledTimes(1);
  });

  it('closes once the reader acknowledged the sentence', async () => {
    const { fixture, lines } = await render();
    lines.emptyByOthers(LINE_ID);
    fixture.detectChanges();

    await fixture.componentInstance.gone.acknowledge();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(lines.deletionOf(LINE_ID)).toBe('seen');
    expect(closes).toHaveBeenCalledTimes(1);
  });
});

describe('lineGoneKey', () => {
  it('names a sentence for every reason, in both languages', () => {
    const i18n = join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'ui',
      'assets',
      'i18n'
    );
    const gone = (locale: string): Record<string, string> =>
      JSON.parse(readFileSync(join(i18n, `${locale}.json`), 'utf8')).list.gone;

    expect(lineGoneKey('emptied')).toBe('list.gone.emptied');
    expect(lineGoneKey('byOthers')).toBe('list.gone.byOthers');
    expect(lineGoneKey('unavailable')).toBe('list.gone.unavailable');
    expect(gone('en')['emptied']).toBe('This line reached 0 and was removed');
    expect(gone('es')['emptied']).toBe('Esta línea llegó a 0 y se quitó');
  });
});
