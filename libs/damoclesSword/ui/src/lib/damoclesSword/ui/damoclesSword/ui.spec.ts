import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordUi } from './ui';

describe('DamoclesSwordUi', () => {
  let component: DamoclesSwordUi;
  let fixture: ComponentFixture<DamoclesSwordUi>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordUi],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordUi);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
