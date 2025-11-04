import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BasicOptionToggle implements ControlValueAccessor {
  options = input.required<string[] | any[]>();

  selectedOption = signal<any>(null);

  labelField = input('label');
  valueField = input('value');
  disabledField = input('disabled');

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
    const val = this.findField(option, this.valueField());

    if (this.selectedOption() === val) return;

    this.onTouched();
    this.onChange(val);
    this.selectedOption.set(option);
  }

  findField(option: any, field: string) {
    return typeof option === 'string'
      ? option
      : // @ts-ignore
        findField(option, field);
  }

  findFieldAndJoin(value: any, field: string) {
    const val = this.findField(value, field);

    return Array.isArray(val) ? val.join(', ') : val;
  }
}
