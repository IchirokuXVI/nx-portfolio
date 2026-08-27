import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DamoclesSwordWrapper } from './damocles-sword-wrapper';

describe('DamoclesSwordWrapper', () => {
  let component: DamoclesSwordWrapper;
  let fixture: ComponentFixture<DamoclesSwordWrapper>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DamoclesSwordWrapper],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(DamoclesSwordWrapper);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
