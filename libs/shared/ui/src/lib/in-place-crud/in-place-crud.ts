import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ContentChild,
  forwardRef,
  inject,
  input,
  model,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { LoadingNotifier } from '@portfolio/shared/util';
import { CloseIcon } from '../close-icon/close-icon';
import { EditIcon } from '../edit-icon/edit-icon';
import { LoadingIcon } from '../loading-icon/loading-icon';
import { SaveIcon } from '../save-icon/save-icon';
import { TrashIcon } from '../trash-icon/trash-icon';

@Component({
  selector: 'lib-in-place-crud',
  templateUrl: 'in-place-crud.html',
  styleUrls: ['in-place-crud.scss'],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InPlaceCrud),
      multi: true,
    },
    LoadingNotifier,
  ],
  imports: [
    CommonModule,
    FormsModule,
    EditIcon,
    LoadingIcon,
    SaveIcon,
    TrashIcon,
    CloseIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InPlaceCrud implements ControlValueAccessor {
  showDelete = input<boolean>(false);

  savedValue = signal<any>(null);
  currentValue = signal<any>(null);
  editing = model<boolean>(false);

  loadingSave = input<boolean>(false);
  loadingDelete = input<boolean>(false);

  delete = output<void>();

  private onChange: (value: any) => void = () => {};
  private onTouched: () => void = () => {};
  disabled = signal(false);

  @ContentChild('edit-icon') editIconTemplate?: TemplateRef<any>;
  @ContentChild('cancel-icon') cancelIconTemplate?: TemplateRef<any>;
  @ContentChild('save-icon') saveIconTemplate?: TemplateRef<any>;
  @ContentChild('delete-icon') deleteIconTemplate?: TemplateRef<any>;
  @ContentChild('loading-icon') loadingIconTemplate?: TemplateRef<any>;

  readonly loadingNotifier = inject(LoadingNotifier<['save', 'delete']>);

  constructor() {
    // Replace this code with a loop (mapping the variable to the loading string) if more
    // loading states are added in the future
    computed(() => {
      if (this.loadingSave()) {
        this.loadingNotifier.startLoading('save');
      } else {
        this.loadingNotifier.forceCompleteLoading('save');
      }
    });

    computed(() => {
      if (this.loadingDelete()) {
        this.loadingNotifier.startLoading('delete');
      } else {
        this.loadingNotifier.forceCompleteLoading('delete');
      }
    });
  }

  writeValue(value: any): void {
    this.savedValue.set(value);
    this.currentValue.set(value);
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

  onEditIconClick() {
    this.editing.set(true);
    this.onTouched();
  }

  onConfirmedChange() {
    this.savedValue.set(this.currentValue());
    this.loadingNotifier.startLoading('save');
    this.onChange(this.savedValue());
    this.editing.set(false);
  }

  onCancelChange() {
    this.editing.set(false);
    this.currentValue.set(this.savedValue());
  }

  onDeleteIconClick() {
    this.delete.emit();
  }
}
