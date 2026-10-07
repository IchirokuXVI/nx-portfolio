import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { ContentLocaleStore } from '@portfolio/luna-shopper-admin/data-access';
import { localizedTextValue } from '@portfolio/luna-shopper-admin/models';
import {
  ScopePicker,
  type ScopePickerChain,
  type ScopePickerChoice,
  type ScopePickerScope,
} from '@portfolio/luna-shopper-admin/ui';
import { priceScopeMark } from '../catalog-enums';
import {
  ScopeChoices,
  scopeLevel,
  scopeName,
  type PriceScopeChoice,
  type ScopeRow,
} from './scope-choices';

/**
 * The scope picker, with the chains and the scopes it offers (admin plan
 * 0043).
 *
 * `ScopePicker` draws and reads nothing. This is the half that reads: the
 * chains when the picker opens, a chain's general scopes when the chain is
 * opened, and its single shop scopes when they are asked for. Both the product
 * list and the price form choose a scope through it.
 *
 * It holds no choice. It is handed the one that is chosen and says which was
 * chosen next, as a scope together with its chain, so that whoever holds the
 * choice can name it without a read.
 */
@Component({
  selector: 'lib-price-scope-picker',
  imports: [ScopePicker],
  template: `
    <lib-scope-picker
      (chainChange)="openChain($event)"
      (opened)="opened()"
      (scopeChange)="pick($event)"
      (shopsWanted)="wantShops()"
      [chainId]="chainId()"
      [chains]="chains()"
      [choice]="shown()"
      [clearable]="clearable()"
      [clearKey]="clearKey()"
      [controlId]="controlId()"
      [describedBy]="describedBy()"
      [label]="label()"
      [placeholder]="placeholder()"
      [prefix]="prefix()"
      [scopes]="scopes()"
      [shopsOffered]="shopsOffered()"
      [truncated]="truncated()"
      [value]="choice()?.scope?.id ?? null"
    />
  `,
  styles: `
    :host {
      display: inline-flex;
      min-inline-size: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceScopePicker {
  private readonly _choices = inject(ScopeChoices);
  private readonly _content = inject(ContentLocaleStore);
  private readonly _translate = inject(RokuTranslatorService);

  /** What the picker is for, already translated. */
  readonly label = input.required<string>();
  /** Words before the choice on the button, already translated. */
  readonly prefix = input('');
  /** What the button says while nothing is chosen, already translated. */
  readonly placeholder = input('');
  /** The scope that is chosen, with its chain, or `null`. */
  readonly choice = input<PriceScopeChoice | null>(null);
  /** The id of the button, for the label of a form row. */
  readonly controlId = input<string | null>(null);
  /** The ids of the lines that describe the button, or `null` for none. */
  readonly describedBy = input<string | null>(null);
  /** Whether "no scope" is a choice. */
  readonly clearable = input(false);
  /** What the choice of no scope says, as a key. */
  readonly clearKey = input('catalog.scopePicker.clear');

  /** A scope was chosen, or the choice was cleared (`null`). */
  readonly choiceChange = output<PriceScopeChoice | null>();

  /** The chain whose scopes are listed, or `null` on the list of chains. */
  readonly chainId = signal<string | null>(null);

  readonly chains = computed<readonly ScopePickerChain[] | null>(() => {
    const chains = this._choices.chains();
    if (chains === null) {
      // A read that failed is an empty list, said in words by the picker.
      return this._choices.chainsFailed() ? [] : null;
    }
    const order = this._content.order();
    return chains.map((chain) => ({
      id: chain.id,
      name: localizedTextValue(chain.name, order) || chain.id,
    }));
  });

  /** The open chain's scopes: the general ones, then its single shop ones. */
  readonly scopes = computed<readonly ScopePickerScope[] | null>(() => {
    const chainId = this.chainId();
    if (chainId === null) {
      return null;
    }
    const held = this._choices.scopesOf(chainId);
    if (held.general === null) {
      return null;
    }
    const chain = this._chainName(chainId);
    // The widest first: nationwide, then the regions, the local areas and the
    // single shops, each kind by name.
    return [...held.general, ...(held.shops ?? [])]
      .map((scope) => this._option(scope, chain))
      .sort(
        (a, b) =>
          (a.level ?? 5) - (b.level ?? 5) || a.name.localeCompare(b.name)
      );
  });

  readonly truncated = computed(() => {
    const chainId = this.chainId();
    return chainId !== null && this._choices.scopesOf(chainId).truncated;
  });

  /** Offered until they were asked for. */
  readonly shopsOffered = computed(() => {
    const chainId = this.chainId();
    if (chainId === null) {
      return false;
    }
    const held = this._choices.scopesOf(chainId);
    return held.general !== null && held.shops === null && !held.readingShops;
  });

  /** The chosen scope, as the button says it. */
  readonly shown = computed<ScopePickerChoice | null>(() => {
    const choice = this.choice();
    if (choice === null) {
      return null;
    }
    const chain =
      localizedTextValue(choice.chain.name, this._content.order()) ||
      choice.chain.id;
    const option = this._option(choice.scope, chain);
    return {
      chain,
      scope: option.name,
      level: option.level,
      kind: option.kind,
    };
  });

  /** The picker opened: on the chain of the choice, when there is one. */
  opened(): void {
    void this._choices.loadChains();
    const chainId = this.choice()?.chain.id ?? null;
    this.chainId.set(chainId);
    if (chainId !== null) {
      void this._choices.loadScopes(chainId);
    }
  }

  openChain(chainId: string | null): void {
    this.chainId.set(chainId);
    if (chainId !== null) {
      void this._choices.loadScopes(chainId);
    }
  }

  wantShops(): void {
    const chainId = this.chainId();
    if (chainId !== null) {
      void this._choices.loadShopScopes(chainId);
    }
  }

  pick(scopeId: string | null): void {
    if (scopeId === null) {
      this.choiceChange.emit(null);
      return;
    }

    const chainId = this.chainId();
    const chain =
      chainId === null ? undefined : this._choices.chainsById().get(chainId);
    const held = chainId === null ? null : this._choices.scopesOf(chainId);
    const scope = [...(held?.general ?? []), ...(held?.shops ?? [])].find(
      (row) => row.id === scopeId
    );

    if (chain !== undefined && scope !== undefined) {
      this.choiceChange.emit({
        // Only what naming the choice needs, since it may be stored.
        chain: {
          id: chain.id,
          name: chain.name,
          defaultPriceScopeId: chain.defaultPriceScopeId,
        },
        scope: {
          id: scope.id,
          supermarketId: scope.supermarketId,
          kind: scope.kind,
          externalKey: scope.externalKey,
          label: scope.label,
        },
      });
    }
  }

  private _chainName(chainId: string): string {
    const chain = this._choices.chainsById().get(chainId);
    return chain === undefined
      ? ''
      : localizedTextValue(chain.name, this._content.order());
  }

  /**
   * A scope as the picker says it. One named after its chain, which is what a
   * chain's nationwide scope is, is called by its kind: "Mercadona, Mercadona"
   * would say the chain twice and the scope not at all.
   */
  private _option(scope: ScopeRow, chain: string): ScopePickerScope {
    // Read so that the kind is said in words once the catalogue has loaded:
    // a list opened cold names its kept scope before the words arrive.
    this._translate.loaded();
    const mark = priceScopeMark(scope.kind);
    const kind =
      mark === undefined ? String(scope.kind) : this._translate.t(mark.label);
    const name = scopeName(scope, this._content.order(), kind);
    return {
      id: scope.id,
      name: chain !== '' && name === chain ? kind : name,
      level: scopeLevel(scope.kind),
      kind,
    };
  }
}
