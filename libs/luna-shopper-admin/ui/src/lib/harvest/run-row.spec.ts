import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { RunRowView, type RunRow } from './run-row';

function row(over: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run-1',
    mode: 'CATALOG_DISCOVERY',
    status: 'COMPLETED',
    requested: '3 Sep 2026, 09:42',
    processed: 4383,
    failed: 16,
    reverted: '',
    revertedBy: '',
    reasonKey: null,
    ...over,
  };
}

async function render(view: RunRow, link: readonly string[] | string) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RunRowView, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([]), provideLocationMocks()],
  }).compileComponents();

  const fixture = TestBed.createComponent(RunRowView);
  fixture.componentRef.setInput('row', view);
  fixture.componentRef.setInput('link', link);
  fixture.detectChanges();
  return fixture;
}

/**
 * The row two screens draw: the runs list and the dashboard.
 *
 * The link is an input rather than built here, because the list addresses a run
 * relative to itself and the dashboard addresses it absolutely.
 */
describe('RunRowView', () => {
  it('opens the run at whatever address it was given', async () => {
    const fixture = await render(row(), ['/', 'harvest', 'runs', 'run-1']);
    const anchor: HTMLAnchorElement = fixture.nativeElement.querySelector('a');

    expect(anchor.getAttribute('href')).toBe('/harvest/runs/run-1');
  });

  it('is the same row at a relative address', async () => {
    const fixture = await render(row(), ['run-1']);
    const anchor: HTMLAnchorElement = fixture.nativeElement.querySelector('a');

    expect(anchor.getAttribute('href')).toBe('/run-1');
  });

  /**
   * A second chip rather than a replacement: the status says how the run ended,
   * and a revert does not change that.
   */
  it('draws the revert chip beside the status, with the operator on hover', async () => {
    const fixture = await render(
      row({ reverted: '4 Sep 2026, 08:00', revertedBy: 'owner-1' }),
      ['run-1']
    );

    const chip = fixture.nativeElement.querySelector('.reverted');
    expect(chip.getAttribute('title')).toBe('owner-1');
    expect(
      fixture.nativeElement.querySelector('.status').textContent
    ).toContain('harvest.status.COMPLETED');
  });

  it('draws no revert chip for a run whose writes still stand', async () => {
    const fixture = await render(row(), ['run-1']);

    expect(fixture.nativeElement.querySelector('.reverted')).toBeNull();
  });

  /**
   * A finished run that failed because of a switch says which one, on the row,
   * because that is where somebody is looking when they wonder.
   */
  it('names the reason a run did nothing when there is one', async () => {
    const fixture = await render(
      row({ status: 'FAILED', reasonKey: 'harvest.blocked.service-off' }),
      ['run-1']
    );

    expect(
      fixture.nativeElement.querySelector('.reason').textContent
    ).toContain('harvest.blocked.service-off');
  });
});
