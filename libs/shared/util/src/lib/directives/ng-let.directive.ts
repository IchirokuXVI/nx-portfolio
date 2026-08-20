import {
  Directive,
  inject,
  Input,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';

interface LetContext<T> {
  ngLet: T | undefined;
}

@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector -- `ngLet` intentionally mirrors Angular's built-in structural directives; renaming it would break existing `*ngLet` templates
  selector: '[ngLet]',
})
export class NgLetDirective<T> {
  private _context: LetContext<T> = { ngLet: undefined };

  constructor() {
    const viewContainer = inject(ViewContainerRef);
    const templateRef = inject(TemplateRef) as TemplateRef<LetContext<T>>;

    viewContainer.createEmbeddedView(templateRef, this._context);
  }

  @Input()
  set ngLet(value: T) {
    this._context.ngLet = value;
  }
}
