import type { Provider } from '@angular/core';
import { AccountMemory } from './account/account-memory';
import { ProfileStore } from './account/profile-store';
import { ApiUrl } from './api-url';
import { AssistantMemory } from './assistant/assistant-memory';
import { AccountNotice } from './auth/account-notice';
import { AuthMemory } from './auth/auth-memory';
import { SessionStore } from './auth/session-store';
import { TokenStore } from './auth/token-store';
import { ItemNames } from './catalog/item-names';
import { CommentMemory } from './comments/comment-memory';
import { ConnectionRecovery } from './connection-recovery';
import { BasketSessionStore } from './generated-lists/basket-session-store';
import { BasketStore } from './generated-lists/basket-store';
import { GeneratedListMemory } from './generated-lists/generated-list-memory';
import { GeneratedListStore } from './generated-lists/generated-list-store';
import { LineMemory } from './lines/line-memory';
import { LineStore } from './lines/line-store';
import { ListMemory } from './lists/list-memory';
import { ListStore } from './lists/list-store';
import { MemberNames } from './memberships/member-names';
import { MembershipMemory } from './memberships/membership-memory';
import { MembershipStore } from './memberships/membership-store';
import { PresenceStore } from './presence/presence-store';
import { ShoppingProfileMemory } from './profiles/shopping-profile-memory';
import { ShoppingProfileStore } from './profiles/shopping-profile-store';
import { ShopMemory } from './shops/shop-memory';
import { ZoneMemory } from './zones/zone-memory';
import { ZoneStore } from './zones/zone-store';

/**
 * The `data-access` services the app layer has to install (rule D5, plan 0004
 * section 9). See `VELISTA_PLATFORM_PROVIDERS` for why root scope is not an option.
 *
 * Three different reasons land the members here, and the difference is worth knowing
 * before adding a fourth:
 *
 * - `ApiUrl` reads `APP_API_CONFIG` directly. `TokenStore` and `SessionStore` reach it
 *   through `ApiUrl`. Transitive counts: the failure is identical.
 * - `ZoneStore` injects no app token at all. It is here because it has to resolve
 *   `ZONE_SERVICE` in the injector where the app **binds** that token. Created at the
 *   root it would resolve the token's own default instead and quietly serve in-memory
 *   data while the app looked like it was talking to the backend. That was the real
 *   bug, and it is the one that would have survived longest unnoticed.
 * - `ZoneMemory` is the in-memory implementation and by rights would stay root scoped.
 *   It cannot, because it injects `TokenStore` to answer as the current caller, and
 *   `TokenStore` reaches `APP_API_CONFIG`. It is no longer any token's default, so it
 *   is only here for the specs and backend-less runs that ask for it by name.
 *
 * `ConnectionRecovery` is here so it is **available**, which is the library's business.
 * Nothing injects it, so listing it constructs nothing: it is a listener, and starting
 * it is the app's decision, made by the environment initializer in `appProviders`.
 * Separating those two is what stops the app file from having to name the class twice.
 *
 * `ZoneApi` and `AuthApi` are deliberately **not** here. Choosing to talk to a real
 * gateway is the app's call, and `appProviders` binds each to its token with
 * `useClass`, which provides it in the same breath.
 *
 * `AccountNotice` (plan 0009) joins for the same reason `ZoneStore` did, one step
 * milder: it injects nothing, so root would work, but it is shared between the auth
 * screens and the dashboard and every service those pages share is installed here.
 * `AuthMemory` joins for `ZoneMemory`'s reason exactly, and no other: it reaches
 * `TokenStore`, and it is nobody's default.
 *
 * `ListStore` (plan 0010) joins for `ZoneStore`'s reason exactly: it resolves
 * `LIST_SERVICE`, and at the root it would get that token's own default instead of
 * whatever the app bound. `ListMemory` and `MembershipMemory` join for `ZoneMemory`'s:
 * both reach `TokenStore`, and neither is any token's default, so they are here for the
 * specs and backend-less runs that ask for them by name.
 *
 * `ListApi` and `MembershipApi` are deliberately **not** here, matching `ZoneApi` and
 * `AuthApi`: choosing to talk to a real gateway is the app's call, and `appProviders`
 * binds each to its token with `useClass`, which provides it in the same breath.
 *
 * `LineStore` (plan 0012) joins for `ListStore`'s reason, and `MemberNames` for the
 * same one: it resolves `MEMBERSHIP_SERVICE`, so at the root it would quietly serve
 * fixture names beside real comments. `LineMemory` and `CommentMemory` are here for
 * `ZoneMemory`'s reason. `CommentMemory` injects nothing, so root scope would work for
 * it and it is listed here anyway, to keep every fake in this library installed in one
 * place rather than two. `LineMemory` **must** be here: since plan 0030 section 9 it
 * injects `ListMemory` to ask what the caller may do on a list, and `ListMemory` reaches
 * `TokenStore`. It asks rather than recomputing so that a line write and a list write
 * cannot disagree about who the caller is. `LineApi` and `CommentApi` stay out, like
 * every other real transport.
 *
 * `MembershipStore` (plan 0018) joins for `ZoneStore`'s reason as well: it resolves
 * both `MEMBERSHIP_SERVICE` and `REALTIME_CLIENT`, and it holds the rows the members
 * screen renders, which used to be page state and therefore learned about one event out
 * of seven.
 *
 * `PresenceStore` (plan 0017) joins for `ZoneStore`'s reason a fourth time: it
 * resolves `REALTIME_CLIENT`, so at the root it would listen to that token's default
 * while every other store applied events from the socket the app bound, and it would
 * be the only store in the app that is permanently empty.
 *
 * `ProfileStore` (plan 0015) joins for `ZoneStore`'s reason a third time: it resolves
 * `ACCOUNT_SERVICE`, so at the root it would serve a fixture email beside a real
 * session. It is listed **above** `SessionStore` only for readability; `SessionStore`
 * injects it, and DI does not care about the order of an array. `AccountMemory` joins
 * for `ZoneMemory`'s reason exactly, and `AccountApi` stays out like every other real
 * transport.
 *
 * `ShoppingProfileStore` (plan 0046) joins for `ZoneStore`'s reason a fifth time: it
 * resolves `SHOPPING_PROFILE_SERVICE` and `REALTIME_CLIENT`, so at the root it would
 * offer fixture chains beside a real account and would apply `profiles.changed` from a
 * socket nobody was connected to. It is app scoped rather than page scoped for a second
 * reason as well: the selected profile outlives the profiles page, because `0045`'s
 * generation sheet asks which profile a basket is being built for.
 * `ShoppingProfileMemory` joins for `AccountMemory`'s reason exactly, and
 * `ShoppingProfileApi` stays out like every other real transport.
 *
 * `GeneratedListStore` (plan 0045) joins for `ZoneStore`'s reason a sixth time: it
 * resolves `GENERATED_LIST_SERVICE` and `REALTIME_CLIENT`, so at the root it would list
 * fixture baskets beside a real account and would apply the owner's own basket events
 * from a socket nobody was connected to. It is app scoped rather than page scoped for
 * `ShoppingProfileStore`'s second reason: the dashboard card and the history page are
 * two routes reading one listing, and a page owned store would refetch it on every move
 * between them. `GeneratedListMemory` joins for `AccountMemory`'s reason exactly, and
 * `GeneratedListApi` stays out like every other real transport.
 *
 * `ItemNames` (plan 0047) joins for `MemberNames`' reason exactly: it resolves
 * `CATALOG_SERVICE`, so at the root it would name products from whatever that token's
 * default resolved to rather than from the catalog the app bound. It is app scoped
 * rather than page scoped because the line detail sheet and the line page ask the same
 * question about the same products, and the second is usually opened from the first.
 *
 * `AssistantMemory` (plan 0032) joins for `CommentMemory`'s reason and no stronger one:
 * it injects nothing, so root scope would work for it, and it is listed here anyway so
 * that every fake in this library is installed in one place rather than two. It is no
 * token's default, so it is constructed only by a spec or a backend-less run that asks
 * for it by name, which is the whole of its use today, backend `0039` being unbuilt.
 * `AssistantApi` stays out, like every other real transport.
 *
 * `ShopMemory` (plan 0059) joins for `AccountMemory`'s reason exactly and for no
 * stronger one. `ShopStore` is deliberately **not** here, and it is the first store in
 * this library that is not: everything it holds is about the screen that is open, a
 * franchise somebody tapped and a word they typed, so it is provided by the supermarkets
 * page itself and destroyed with it. `ShopApi` stays out like every other real transport.
 */
export const VELISTA_DATA_ACCESS_PROVIDERS: Provider[] = [
  ApiUrl,
  TokenStore,
  ProfileStore,
  SessionStore,
  AccountMemory,
  AccountNotice,
  AssistantMemory,
  ConnectionRecovery,
  AuthMemory,
  ZoneMemory,
  ZoneStore,
  ListMemory,
  ListStore,
  MembershipMemory,
  LineMemory,
  LineStore,
  CommentMemory,
  ItemNames,
  MemberNames,
  MembershipStore,
  PresenceStore,
  ShoppingProfileMemory,
  ShoppingProfileStore,
  ShopMemory,
  GeneratedListMemory,
  GeneratedListStore,
  BasketSessionStore,
  BasketStore,
];
