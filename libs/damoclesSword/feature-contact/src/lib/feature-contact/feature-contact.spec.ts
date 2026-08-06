import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DamoclesSwordUiModule } from '@portfolio/damoclesSword/ui';
import { MockModule } from 'ng-mocks';
import { DamoclesSwordFeatureContact } from './feature-contact';

describe('DamoclesSwordFeatureContact', () => {
  let component: DamoclesSwordFeatureContact;
  let fixture: ComponentFixture<DamoclesSwordFeatureContact>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordFeatureContact, MockModule(DamoclesSwordUiModule)],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordFeatureContact);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
