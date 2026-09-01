import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import { BasketStore } from '@portfolio/velista/data-access';
import type { BasketShareLink } from '@portfolio/velista/models';
import {
  provideVelistaTesting,
  SheetNavigation,
} from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { ShareSheet } from './share-sheet';

/**
 * Plan 0052, section 4: the revoke confirm cannot be reached by a double tap.
 *
 * The sheet panel is anchored to the bottom of the viewport and grows upward, so the
 * last control in a pane is always the same distance from the bottom of the screen
 * whichever pane is showing. Both stacks used to end two buttons deep with the
 * destructive confirm in the upper of the two, which is exactly where the trigger that
 * summoned it had been.
 *
 * So what is asserted here is **position**, not appearance: index 0 of the revoke
 * pane's footer must be the safe answer, because index 0 of the link pane's footer is
 * the trigger. A test that only checked both buttons were present would have passed
 * before the fix.
 */

const BASKET_ID = 'b4b1f0e2-1f5a-4c2e-9a4d-6f0e2b7c1d33';

function link(): BasketShareLink {
  return {
    id: 'sl1',
    secret: 's3cr3t',
    createdAt: new Date('2026-08-21T09:00:00.000Z'),
    expiresAt: null,
    participantCount: 2,
  };
}

async function render() {
  TestBed.resetTestingModule();

  const paramMap = convertToParamMap({ generatedListId: BASKET_ID });

  await TestBed.configureTestingModule({
    imports: [ShareSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      {
        provide: BasketStore,
        useValue: {
          basket: signal(null),
          state: signal('ready'),
          error: signal(null),
          // Already minted, which is the pane the trigger lives on.
          shareLink: signal(link()),
          share: jest.fn().mockResolvedValue(link()),
          revokeLink: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: SheetNavigation,
        useValue: {
          dismiss: jest.fn().mockResolvedValue(undefined),
          leaveTo: jest.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: Router,
        useValue: {
          navigate: jest.fn().mockResolvedValue(true),
          navigateByUrl: jest.fn().mockResolvedValue(true),
        },
      },
      { provide: RokuLocaleStore, useValue: { locale: signal('en') } },
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(paramMap),
          snapshot: { paramMap, parent: null },
          parent: {
            paramMap: of(paramMap),
            snapshot: { paramMap, parent: null },
            parent: null,
          },
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ShareSheet);
  fixture.detectChanges();
  return fixture;
}

/** The footer's controls, in the order they are stacked. */
const footer = (fixture: Awaited<ReturnType<typeof render>>) =>
  [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll(
      '.footer button'
    ),
  ] as HTMLButtonElement[];

describe('ShareSheet: the revoke pane cannot be double tapped into', () => {
  it('puts the cancel where the trigger was', async () => {
    // The one assertion the whole section is about. `Revoke the link` is index 0 of
    // the link pane's footer, so a stray second tap at those coordinates has to land
    // on the safe answer once the pane has switched.
    const fixture = await render();

    const [trigger] = footer(fixture);
    expect(trigger.textContent?.trim()).toBe('basket.share.revoke');

    trigger.click();
    fixture.detectChanges();

    const [first, second] = footer(fixture);
    expect(first.textContent?.trim()).toBe('basket.revoke.cancel');
    expect(second.textContent?.trim()).toBe('basket.revoke.confirm');
  });

  it('gives the cancel the trigger’s own treatment, so the rows line up', async () => {
    // A `.quiet` cancel is shorter than the `secondary-button` it stands in for, and
    // the geometry would be off by the difference: index 0 of one stack has to be
    // exactly index 0 of the other for the position argument to hold.
    const fixture = await render();

    const [trigger] = footer(fixture);
    trigger.click();
    fixture.detectChanges();

    const [cancel] = footer(fixture);
    expect(cancel.classList.contains('cancel')).toBe(true);
    expect(cancel.classList.contains('quiet')).toBe(false);
  });

  it('draws both stacks in the footer, not in the body', async () => {
    // What makes the alignment a rule rather than a coincidence: the footer is
    // outside the scroll and pinned to the bottom of the panel, so the positions stop
    // depending on how much copy is above them. The revoke pane's body is a paragraph
    // shorter and a checkbox taller than the link pane's.
    const fixture = await render();
    expect(footer(fixture)).toHaveLength(2);

    footer(fixture)[0].click();
    fixture.detectChanges();

    expect(footer(fixture)).toHaveLength(2);
  });

  it('leaves the dismissing control where it was, which is safe', async () => {
    // The confirm lands where `Close` was, and that does not move the bug: `Close`
    // dismisses the sheet, so its second tap arrives after the sheet is gone.
    const fixture = await render();

    const [, close] = footer(fixture);
    expect(close.textContent?.trim()).toBe('basket.share.close');
  });
});
