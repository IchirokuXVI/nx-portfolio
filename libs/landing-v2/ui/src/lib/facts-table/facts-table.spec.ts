import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRokuTranslatorTesting } from '@portfolio/localization/rokutranslator-angular';
import { FactsTable } from './facts-table';

describe('FactsTable', () => {
  let fixture: ComponentFixture<FactsTable>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FactsTable],
      providers: [provideRokuTranslatorTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(FactsTable);
  });

  it('renders one row per fact with its label and value', () => {
    fixture.componentRef.setInput('facts', [
      { labelKey: 'facts.stack.label', valueKey: 'facts.stack.value' },
      { labelKey: 'facts.apps.label', valueKey: 'facts.apps.value' },
    ]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const rows = host.querySelectorAll('.facts-table__row');
    expect(rows.length).toBe(2);
    // The testing translator echoes the key back.
    expect(rows[0].querySelector('.facts-table__label')?.textContent).toBe(
      'facts.stack.label'
    );
    expect(rows[0].querySelector('.facts-table__value')?.textContent).toBe(
      'facts.stack.value'
    );
  });

  it('renders nothing when there are no facts', () => {
    fixture.componentRef.setInput('facts', []);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.facts-table')).toBeNull();
  });
});
