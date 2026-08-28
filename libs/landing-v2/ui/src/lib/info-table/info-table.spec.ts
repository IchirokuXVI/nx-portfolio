import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslatedInfoFact } from '@portfolio/landing-v2/models';
import { InfoTable } from './info-table';

function makeFact(
  overrides: Partial<TranslatedInfoFact> = {}
): TranslatedInfoFact {
  return {
    id: '1',
    factId: '1',
    order: 1,
    locale: 'en',
    label: 'FOCUS',
    value: 'Web apps & automation',
    ...overrides,
  };
}

describe('InfoTable', () => {
  let fixture: ComponentFixture<InfoTable>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InfoTable],
    }).compileComponents();

    fixture = TestBed.createComponent(InfoTable);
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders one row per fact, no hardcoded rows', () => {
    fixture.componentRef.setInput('facts', [
      makeFact({ id: '1', label: 'FOCUS' }),
      makeFact({ id: '2', label: 'STACK' }),
      makeFact({ id: '3', label: 'ALSO' }),
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll('.info-table__row');

    expect(rows.length).toBe(3);
    expect(rows[0].querySelector('.info-table__label')?.textContent).toBe(
      'FOCUS'
    );
  });

  it('renders an optional note sub-line under the value', () => {
    fixture.componentRef.setInput('facts', [
      makeFact({ label: 'BASED', value: 'Spain', note: 'Working remotely' }),
    ]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.info-table__note')?.textContent).toBe(
      'Working remotely'
    );
  });

  it('renders nothing when there are no facts (empty state, not an empty shell)', () => {
    fixture.componentRef.setInput('facts', []);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.info-table')).toBeNull();
  });
});
