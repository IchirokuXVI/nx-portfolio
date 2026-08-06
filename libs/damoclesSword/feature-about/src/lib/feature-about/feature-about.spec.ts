import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordUiModule } from '@portfolio/damoclesSword/ui';
import { MockModule } from 'ng-mocks';
import { DamoclesSwordFeatureAbout } from './feature-about';

describe('DamoclesSwordFeatureAbout', () => {
  let component: DamoclesSwordFeatureAbout;
  let fixture: ComponentFixture<DamoclesSwordFeatureAbout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordFeatureAbout, MockModule(DamoclesSwordUiModule)],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureAbout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
