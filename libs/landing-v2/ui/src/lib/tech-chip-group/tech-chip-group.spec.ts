import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TechChipGroup } from './tech-chip-group';

describe('TechChipGroup', () => {
  let fixture: ComponentFixture<TechChipGroup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TechChipGroup],
    }).compileComponents();

    fixture = TestBed.createComponent(TechChipGroup);
    fixture.componentRef.setInput('heading', 'Frontend');
  });

  it('renders the heading and one chip per entry', () => {
    fixture.componentRef.setInput('chips', ['Angular 21', 'TypeScript 5.9']);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.tech-chip-group__title')?.textContent).toBe(
      'Frontend'
    );
    const chips = host.querySelectorAll('.tech-chip-group__chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toBe('Angular 21');
  });

  it('renders nothing when there are no chips', () => {
    fixture.componentRef.setInput('chips', []);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.tech-chip-group')).toBeNull();
  });
});
