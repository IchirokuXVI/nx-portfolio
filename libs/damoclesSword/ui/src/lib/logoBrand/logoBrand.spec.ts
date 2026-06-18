import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LogoBrand } from './logoBrand';

describe('LogoBrand', () => {
  let component: LogoBrand;
  let fixture: ComponentFixture<LogoBrand>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LogoBrand],
    }).compileComponents();

    fixture = TestBed.createComponent(LogoBrand);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
