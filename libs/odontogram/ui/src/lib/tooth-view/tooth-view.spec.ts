import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToothView } from './tooth-view';

describe('ToothView', () => {
  let component: ToothView;
  let fixture: ComponentFixture<ToothView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToothView],
    }).compileComponents();

    fixture = TestBed.createComponent(ToothView);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
