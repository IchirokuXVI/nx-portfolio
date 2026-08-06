import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordUiModule } from '@portfolio/damoclesSword/ui';
import { MockModule } from 'ng-mocks';
import { DamoclesSwordFeatureServices } from './feature-services';

describe('DamoclesSwordFeatureServices', () => {
  let component: DamoclesSwordFeatureServices;
  let fixture: ComponentFixture<DamoclesSwordFeatureServices>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        DamoclesSwordFeatureServices,
        MockModule(DamoclesSwordUiModule),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureServices);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
