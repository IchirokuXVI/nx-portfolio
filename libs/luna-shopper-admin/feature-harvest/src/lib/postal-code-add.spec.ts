import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  POSTAL_CODE_SERVICE,
  PostalCodeMemory,
  type HarvestServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { PostalCodeAddPage, splitPostalCodes } from './postal-code-add-page';

/**
 * Adding several postal codes at once (admin plan 0021, sections 3 and 8).
 *
 * The route keeps one code per call, so the interesting behaviour is entirely
 * in what this screen does around that: how it reads what was typed, and what it
 * does when some of the calls are refused and some are not.
 */

const drain = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

/** The harvester, refusing whichever codes a test names. */
function refusing(...refused: readonly string[]): {
  service: HarvestServiceI;
  added: string[];
} {
  const inner = new HarvestMemory();
  const added: string[] = [];

  const service = Object.assign(Object.create(inner) as HarvestServiceI, {
    addPostalCode: async (
      input: Wire.AddPostalCodeDiscoveryDto
    ): Promise<Wire.HarvestPostalCodeDiscoveryRequestView> => {
      if (refused.includes(input.postalCode)) {
        throw new GatewayError({
          code: 'postal_code_unknown',
          status: 400,
          correlationId: '',
        });
      }

      added.push(input.postalCode);
      return inner.addPostalCode(input);
    },
  });

  return { service, added };
}

async function render(
  service: HarvestServiceI
): Promise<ComponentFixture<PostalCodeAddPage>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [PostalCodeAddPage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideLocationMocks(),
      { provide: HARVEST_SERVICE, useValue: service },
      { provide: POSTAL_CODE_SERVICE, useValue: new PostalCodeMemory() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(PostalCodeAddPage);
  fixture.detectChanges();
  return fixture;
}

describe('splitPostalCodes', () => {
  /**
   * Section 3. An operator pasting a list from somewhere else has no idea which
   * separator that list used, and none of the three can appear inside a code.
   */
  it('splits on whitespace, commas and new lines', () => {
    expect(splitPostalCodes('14013, 14012\n14011 14004')).toEqual([
      '14013',
      '14012',
      '14011',
      '14004',
    ]);
  });

  it('drops repeats and keeps the order they were typed in', () => {
    expect(splitPostalCodes('14013 14012 14013')).toEqual(['14013', '14012']);
  });

  it('answers nothing for an empty box', () => {
    expect(splitPostalCodes('   \n  ')).toEqual([]);
  });
});

describe('the add postal codes form', () => {
  it('sends one call per code', async () => {
    const { service, added } = refusing();
    const fixture = await render(service);

    fixture.componentInstance.codes.set('30001, 30002\n30003');
    await fixture.componentInstance.submit();
    await drain();

    expect(added).toEqual(['30001', '30002', '30003']);
  });

  /**
   * Section 3's last rule, and the reason the report names codes rather than
   * counting them. An operator told "3 of 12 failed" cannot fix a typo they
   * cannot see.
   */
  it('keeps only the refused codes and names each reason', async () => {
    const { service, added } = refusing('3000X', '9999Y');
    const fixture = await render(service);

    fixture.componentInstance.codes.set('30001 3000X 30002 9999Y');
    await fixture.componentInstance.submit();
    await drain();

    expect(added).toEqual(['30001', '30002']);
    // What succeeded stays succeeded: pressing again retries exactly the two
    // that were refused.
    expect(fixture.componentInstance.codes()).toBe('3000X\n9999Y');

    const report = fixture.componentInstance.report();
    expect(report?.added).toBe(2);
    expect(report?.total).toBe(4);
    expect(report?.failed).toEqual([
      { postalCode: '3000X', reasonKey: 'resource.error.postalCodeUnknown' },
      { postalCode: '9999Y', reasonKey: 'resource.error.postalCodeUnknown' },
    ]);
  });

  /**
   * The checkbox is the difference between a code that costs a run today and one
   * that is merely tracked, and it is on by default because that is what
   * somebody typing a code into this screen wants.
   */
  it('queues a run by default and parks the code when it is turned off', async () => {
    const service = new HarvestMemory();
    const fixture = await render(service);

    expect(fixture.componentInstance.discoverNow()).toBe(true);

    fixture.componentInstance.discoverNow.set(false);
    fixture.componentInstance.codes.set('30004');
    await fixture.componentInstance.submit();
    await drain();

    const page = await service.listPostalCodes({ postalCode: '30004' });
    expect(page.items[0].status).toBe('PARKED');
  });

  it('is nothing to press with an empty box', async () => {
    const fixture = await render(new HarvestMemory());

    expect(fixture.componentInstance.parsed()).toEqual([]);
    await fixture.componentInstance.submit();

    expect(fixture.componentInstance.report()).toBeNull();
  });
});
