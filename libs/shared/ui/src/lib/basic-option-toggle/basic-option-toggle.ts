import { CommonModule } from '@angular/common';
import {
  Component,
  ContentChild,
  forwardRef,
  input,
  signal,
  TemplateRef,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { findField } from '@portfolio/shared/util';

@Component({
  selector: 'lib-basic-option-toggle',
  templateUrl: 'basic-option-toggle.html',
  styleUrls: ['basic-option-toggle.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BasicOptionToggle),
      multi: true,
    },
  ],
  imports: [CommonModule],
})
export class BasicOptionToggle implements ControlValueAccessor {
  options = input.required<any[]>();

  selectedOption = signal<any>(null);

  labelField = input('label');
  valueField = input('value');

  private onChange: (value: any) => void = () => {};
  private onTouched: () => void = () => {};
  disabled = signal(false);

  @ContentChild('icon') iconTemplate?: TemplateRef<any>;

  writeValue(value: any): void {
    this.selectedOption.set(value);
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  onSelectOption(option: any) {
    // @ts-ignore
    const val = findField(option, this.valueField());

    this.onTouched();
    this.onChange(val);
    this.selectedOption.set(option);
  }

  findFieldAndJoin(value: any, field: string) {
    // @ts-ignore
    return findField(value, field).join(', ');
  }
}
