import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordUiModule } from '@portfolio/damoclesSword/ui';
import { MockModule } from 'ng-mocks';
import { DamoclesSwordFeatureHome } from './feature-home';

describe('DamoclesSwordFeatureHome', () => {
  let component: DamoclesSwordFeatureHome;
  let fixture: ComponentFixture<DamoclesSwordFeatureHome>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordFeatureHome, MockModule(DamoclesSwordUiModule)],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureHome);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
