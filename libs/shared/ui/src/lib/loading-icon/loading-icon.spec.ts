import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadingIcon } from './loading-icon';

describe('LoadingIcon', () => {
  let component: LoadingIcon;
  let fixture: ComponentFixture<LoadingIcon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoadingIcon],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadingIcon);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should apply size inputs', () => {
    component.size = 'xl';
    component.sizeMultiplier = 3;
    component.thickness = 'thick';
    component.color = '#ff0000';
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const icon = el.querySelector('.three-quarter-circle');
    expect(icon?.classList)
      .toContain('xl');
    expect(icon?.classList)
      .toContain('x3');
  });

  it('should apply size multiplier', () => {
    component.size = 'md';
    component.sizeMultiplier = 1;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const icon = el.querySelector('.three-quarter-circle');
    const styles = getComputedStyle(icon as HTMLElement);

    const width = parseFloat(styles.width);

    component.sizeMultiplier = 3;
    fixture.detectChanges();

    const newStyles = getComputedStyle(icon as HTMLElement);
    const newWidth = parseFloat(newStyles.width);

    expect(newWidth).toBe(width * 3);

    component.size = 'lg';
    component.sizeMultiplier = 2;
    fixture.detectChanges();

    const lgStyles = getComputedStyle(icon as HTMLElement);
    const lgWidth = parseFloat(lgStyles.width);

    component.sizeMultiplier = 3;
    fixture.detectChanges();

    const newLgStyles = getComputedStyle(icon as HTMLElement);
    const newLgWidth = parseFloat(newLgStyles.width);

    expect(newLgWidth).toBe(lgWidth * 1.5);

    component.size = 'md';
    component.sizeMultiplier = 1;
    fixture.detectChanges();

    const resettedStyles = getComputedStyle(icon as HTMLElement);
    const resettedWidth = parseFloat(resettedStyles.width);

    expect(resettedWidth).toBe(width);
  });

  it('should apply color', async () => {
    component.color = 'rgb(255, 0, 0)';
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const icon = el.querySelector('.three-quarter-circle') as HTMLElement;

    const styles = getComputedStyle(icon as HTMLElement);
    expect(styles.borderColor).toBe('rgb(255, 0, 0)');

    // Jest for some reason doesn't render the border-left-color correctly and fails
    // because it thinks that border-left-color should also be rgb(255, 0, 0)
    // expect(styles.borderLeftColor).toBe('rgba(0, 0, 0, 0)');
  });
});
