import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeLineStore,
  provideFakeLineStore,
} from '@portfolio/velista/data-access';
import type { Line } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { ConfirmSheet } from '@portfolio/velista/ui';
import { of } from 'rxjs';
import { DeleteLineSheet } from './delete-line-sheet';

/**
 * Where a confirmed delete leaves to, and what the confirmation says when the line went
 * some other way (velista plan 0083, section 6).
 */

const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';
const LIST_ID = '3c9a1d02-5f47-4b8e-9a1c-7d2e6b4f0a35';
const LINE_ID = 'ln-1';
const LIST_URL = `/velista/en/zones/${ZONE_ID}/lists/${LIST_ID}`;

function line(): Line {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity: 2,
    itemIds: [],
    productGroupId: null,
    groupItemIds: [],
    position: 1,
    approvalStatus: 'PENDING',
    boughtCount: 0,
    lastSettlementOutcome: null,
    createdByUserId: 'user-me',
    approvedByUserId: null,
    version: 1,
  };
}

async function render(options: { overList: boolean }): Promise<{
  fixture: ComponentFixture<DeleteLineSheet>;
  lines: ReturnType<typeof fakeLineStore>;
  sheets: { dismiss: jest.Mock; leaveTo: jest.Mock };
}> {
  TestBed.resetTestingModule();

  const lines = fakeLineStore({ lines: [line()], state: 'loaded' });
  const sheets = {
    dismiss: jest.fn().mockResolvedValue(undefined),
    leaveTo: jest.fn().mockResolvedValue(undefined),
  };
  const map = convertToParamMap({
    zoneId: ZONE_ID,
    listId: LIST_ID,
    lineId: LINE_ID,
  });

  await TestBed.configureTestingModule({
    imports: [DeleteLineSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeLineStore(lines),
      { provide: SheetNavigation, useValue: sheets },
      { provide: Router, useValue: { navigateByUrl: jest.fn() } },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(map),
          snapshot: {
            paramMap: map,
            parent: null,
            data: options.overList ? { popsAfterDelete: true } : {},
          },
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DeleteLineSheet);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, lines, sheets };
}

async function settle(
  fixture: ComponentFixture<DeleteLineSheet>
): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('DeleteLineSheet', () => {
  it('pops back to the detail sheet after a delete over the list, and only once', async () => {
    const { fixture, sheets } = await render({ overList: true });

    await fixture.componentInstance.confirm();
    await settle(fixture);

    expect(sheets.dismiss).toHaveBeenCalledTimes(1);
    expect(sheets.dismiss).toHaveBeenCalledWith(LIST_URL);
    expect(sheets.leaveTo).not.toHaveBeenCalled();
  });

  it('leaves for the list after a delete over the line page', async () => {
    const { fixture, sheets } = await render({ overList: false });

    await fixture.componentInstance.confirm();
    await settle(fixture);

    expect(sheets.leaveTo).toHaveBeenCalledTimes(1);
    expect(sheets.leaveTo).toHaveBeenCalledWith(LIST_URL);
    expect(sheets.dismiss).not.toHaveBeenCalled();
  });

  it('stays on a failed delete, with nothing closed', async () => {
    const { fixture, lines, sheets } = await render({ overList: true });
    lines.setWriteOutcome('failed');

    await fixture.componentInstance.confirm();
    await settle(fixture);

    expect(sheets.dismiss).not.toHaveBeenCalled();
    expect(fixture.componentInstance.errorKey()).not.toBeNull();
  });

  it('says another user deleted the line, in place of the question', async () => {
    const { fixture, lines } = await render({ overList: true });

    lines.deleteByOthers(LINE_ID);
    await settle(fixture);

    expect(fixture.nativeElement.textContent).toContain('list.gone.byOthers');
    expect(fixture.debugElement.query(By.directive(ConfirmSheet))).toBeNull();
  });
});
