import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormButton } from './form-button';

describe('FormButton', () => {
  let component: FormButton;
  let fixture: ComponentFixture<FormButton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormButton],
    }).compileComponents();

    fixture = TestBed.createComponent(FormButton);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default to a submit button', () => {
    const button: HTMLButtonElement =
      fixture.nativeElement.querySelector('button');
    expect(button.type).toBe('submit');
  });
});
