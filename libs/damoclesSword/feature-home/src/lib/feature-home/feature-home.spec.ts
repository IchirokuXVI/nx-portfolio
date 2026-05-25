import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordFeatureHome } from '../damoclesSword/feature-home/damoclesSword/feature-home';

describe('DamoclesSwordFeatureHome', () => {
  let component: DamoclesSwordFeatureHome;
  let fixture: ComponentFixture<DamoclesSwordFeatureHome>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordFeatureHome],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureHome);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
