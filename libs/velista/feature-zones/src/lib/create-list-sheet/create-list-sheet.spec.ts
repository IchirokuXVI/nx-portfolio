import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorTestingModule,
} from '@portfolio/localization/rokutranslator-angular';
import {
  fakeListStore,
  provideFakeListStore,
  type FakeListStore,
} from '@portfolio/velista/data-access';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { of } from 'rxjs';
import { CreateListSheet } from './create-list-sheet';

/**
 * Plan 0024: who can see a new list, asked here and answered by default.
 *
 * The assertions worth having are about the **answer that goes over the wire**, not
 * about the checkbox being present. A box wired to nothing looks identical on screen
 * to one wired correctly, and the whole feature is what `createList` is called with.
 */
const ZONE_ID = '8f14e45f-ceea-4e2c-9e0b-9c1a6a3f2b71';

async function render(): Promise<{
  fixture: ComponentFixture<CreateListSheet>;
  lists: FakeListStore;
}> {
  TestBed.resetTestingModule();

  const lists = fakeListStore();
  const map = convertToParamMap({ zoneId: ZONE_ID });

  await TestBed.configureTestingModule({
    imports: [CreateListSheet, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideVelistaTesting({ basePath: '/velista' }),
      provideFakeListStore(lists),
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
          snapshot: { paramMap: map },
          paramMap: of(map),
          parent: null,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CreateListSheet);
  fixture.detectChanges();

  return { fixture, lists };
}

function el<T extends HTMLElement>(
  fixture: ComponentFixture<CreateListSheet>,
  selector: string
): T {
  const found = (fixture.nativeElement as HTMLElement).querySelector<T>(
    selector
  );
  if (found === null) {
    throw new Error(`${selector} is not rendered`);
  }
  return found;
}

function name(fixture: ComponentFixture<CreateListSheet>, value: string): void {
  const field = el<HTMLInputElement>(fixture, '#create-list-name');
  field.value = value;
  field.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

describe('CreateListSheet', () => {
  it('offers the share choice already ticked', async () => {
    const { fixture } = await render();

    expect(el<HTMLInputElement>(fixture, '#create-list-share').checked).toBe(
      true
    );
  });

  it('shares by default, with no interaction at all', async () => {
    // The path almost everybody takes: name it, press Create. The list has to reach
    // the rest of the group without anybody having thought about it.
    const { fixture, lists } = await render();

    name(fixture, 'Weekly shop');
    await fixture.componentInstance.submit();

    expect(lists.creations).toEqual([
      { zoneId: ZONE_ID, name: 'Weekly shop', shareWithZone: true },
    ]);
  });

  it('sends the choice when it is unticked', async () => {
    const { fixture, lists } = await render();

    name(fixture, 'Gift ideas');
    const box = el<HTMLInputElement>(fixture, '#create-list-share');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    await fixture.componentInstance.submit();

    expect(lists.creations).toEqual([
      { zoneId: ZONE_ID, name: 'Gift ideas', shareWithZone: false },
    ]);
  });

  it('describes what unticking costs, where a screen reader will find it', async () => {
    const { fixture } = await render();

    const describedBy = el<HTMLInputElement>(
      fixture,
      '#create-list-share'
    ).getAttribute('aria-describedby');

    expect(describedBy).not.toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(`#${describedBy}`)
    ).not.toBeNull();
  });

  it('still refuses an empty name, the choice notwithstanding', async () => {
    const { fixture, lists } = await render();

    name(fixture, '   ');
    await fixture.componentInstance.submit();

    expect(lists.creations).toEqual([]);
  });
});
