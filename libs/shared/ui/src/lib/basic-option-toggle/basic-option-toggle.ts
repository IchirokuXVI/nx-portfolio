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
    const val = this.findValue(option);

    if (this.selectedOption() === val) return;

    this.onTouched();
    this.onChange(val);
    this.selectedOption.set(option);
  }

  findValue(option: any) {
    return typeof option === 'string'
      ? option
      : // @ts-ignore
        findField(option, this.valueField());
  }

  findFieldAndJoin(value: any, field: string) {
    if (typeof value === 'string') {
      return value;
    }

    // @ts-ignore
    return findField(value, field);
  }
}
