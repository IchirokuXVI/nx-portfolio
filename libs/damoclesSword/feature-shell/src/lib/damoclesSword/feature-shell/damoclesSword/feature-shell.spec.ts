import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordFeatureShell } from './feature-shell';

describe('DamoclesSwordFeatureShell', () => {
  let component: DamoclesSwordFeatureShell;
  let fixture: ComponentFixture<DamoclesSwordFeatureShell>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordFeatureShell],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureShell);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
