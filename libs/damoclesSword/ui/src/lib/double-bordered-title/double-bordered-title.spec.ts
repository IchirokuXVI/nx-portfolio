import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DoubleBorderedTitle } from './double-bordered-title';

describe('DoubleBorderedTitle', () => {
  let component: DoubleBorderedTitle;
  let fixture: ComponentFixture<DoubleBorderedTitle>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DoubleBorderedTitle],
    }).compileComponents();

    fixture = TestBed.createComponent(DoubleBorderedTitle);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
