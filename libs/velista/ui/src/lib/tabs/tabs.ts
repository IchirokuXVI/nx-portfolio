import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';

/** One tab: the value it selects, and the translation key it is labelled with. */
export interface TabItem {
  readonly id: string;
  readonly labelKey: string;
}

/** The id of the tab element for one value, so a panel can be labelled by it. */
export function tabElementId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/** The id of the panel one tab controls. The page gives its panel this id. */
export function tabPanelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

/**
 * An ARIA tab list (velista `0085`, section 5), and only the list: the page draws the
 * panels, with {@link tabPanelId} and `aria-labelledby` set to {@link tabElementId}.
 *
 * ## Manual activation
 *
 * The arrow keys, Home and End move focus between tabs, and Enter, Space or a tap
 * selects one. Selecting on focus would start a read for every tab an arrow passes
 * over, and each tab here is a request the first time it is shown.
 *
 * ## Roving tabindex
 *
 * One tab is in the tab order at a time: the focused one while the reader moves
 * through the list, and the selected one once focus leaves it. Tab from the page lands
 * on the selected tab, and Tab again leaves the list for its panel.
 */
@Component({
  selector: 'lib-tabs',
  imports: [RokuTranslatorPipe],
  templateUrl: './tabs.html',
  styleUrl: './tabs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Tabs {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tabs = input.required<readonly TabItem[]>();
  readonly selected = input.required<string>();

  /** Prefixes the ids of the tabs and of the panels the page draws. */
  readonly idPrefix = input.required<string>();

  /** The tab list's accessible name, as a translation key. */
  readonly labelKey = input.required<string>();

  readonly selectedChange = output<string>();

  /** The tab being moved through with the keyboard, or null when focus is elsewhere. */
  private readonly _focused = signal<string | null>(null);

  /** Which tab carries `tabindex="0"`. */
  protected readonly inOrder = computed(
    () => this._focused() ?? this.selected()
  );

  protected tabId(id: string): string {
    return tabElementId(this.idPrefix(), id);
  }

  protected panelId(id: string): string {
    return tabPanelId(this.idPrefix(), id);
  }

  protected choose(id: string): void {
    this._focused.set(id);
    if (id !== this.selected()) {
      this.selectedChange.emit(id);
    }
  }

  protected onFocus(id: string): void {
    this._focused.set(id);
  }

  /** Focus left the list, so the selected tab is the one Tab comes back to. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next === null || !this._host.nativeElement.contains(next)) {
      this._focused.set(null);
    }
  }

  protected onKeydown(event: KeyboardEvent, id: string): void {
    const ids = this.tabs().map((tab) => tab.id);
    const at = ids.indexOf(id);
    let target: string | undefined;

    switch (event.key) {
      case 'ArrowRight':
        target = ids[(at + 1) % ids.length];
        break;
      case 'ArrowLeft':
        target = ids[(at - 1 + ids.length) % ids.length];
        break;
      case 'Home':
        target = ids[0];
        break;
      case 'End':
        target = ids[ids.length - 1];
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.choose(id);
        return;
      default:
        return;
    }

    event.preventDefault();
    if (target === undefined) {
      return;
    }
    this._focused.set(target);
    const targetId = this.tabId(target);
    [...this._host.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.id === targetId)
      ?.focus();
  }
}
