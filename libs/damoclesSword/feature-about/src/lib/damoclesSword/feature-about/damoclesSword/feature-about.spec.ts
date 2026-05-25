import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordFeatureAbout } from './feature-about';

describe('DamoclesSwordFeatureAbout', () => {
  let component: DamoclesSwordFeatureAbout;
  let fixture: ComponentFixture<DamoclesSwordFeatureAbout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordFeatureAbout],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureAbout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
