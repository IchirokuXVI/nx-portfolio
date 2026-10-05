import type { GatewayError } from '@portfolio/luna-shopper-admin/data-access';

/**
 * A failure, as the sentence a screen shows.
 *
 * Code first and status second, the same order `toSignInFailure` uses and for
 * the same reason: the code is the contract, and the status is the fallback for
 * a body that did not reach this app intact, which is what a proxy answering
 * instead of the gateway looks like.
 *
 * The mapping is **total** over failures. An unanticipated one reaches the
 * operator as a sentence saying the server did not explain itself, rather than
 * as an empty screen or a blank banner.
 *
 * **No failure is `null`, and it is not the unknown one.** Every screen that
 * draws this key guards it on truthiness, so a string here for the state where
 * nothing went wrong put "That did not work" over four working screens: the
 * shops and sources queues, and the two queues behind `QueueFrame`. A caller
 * that has already established a failure and only lost its type says so with
 * `?? 'resource.error.unknown'`, which is one visible word at the call site
 * rather than a default nothing can opt out of.
 *
 * There is no case for `unauthorized`. A 401 never gets this far: the
 * interceptor turns it into a token renewal, an overlay and a retry (plan 0003,
 * section 6), so a screen that showed a message about it would be describing
 * something the operator has already been asked about.
 */
export function gatewayErrorKey(error: GatewayError | null): string | null {
  if (error === null) {
    return null;
  }

  switch (error.code) {
    case 'not_found':
      return 'resource.error.notFound';
    case 'forbidden':
      return 'resource.error.forbidden';
    case 'conflict':
      return 'resource.error.conflict';
    case 'validation_failed':
      return 'resource.error.validation';
    case 'postal_code_unknown':
      // A code that is not in the national centroid table, which means somebody
      // typed it wrong (backend plan 0097, section 6.1). It is named apart from
      // the generic validation sentence because it is the answer an operator
      // adding a city's worth of codes gets most often, and "that code does not
      // exist" is a typo they can fix while "the request was refused" is not.
      return 'resource.error.postalCodeUnknown';
    case 'brand_label_empty':
      // A label made of punctuation, which makes no key and therefore no brand
      // (backend plan 0115, section 5.3). LIDL's `-` and `---` are the real
      // cases. Named apart from the generic validation sentence because the fix
      // is to type a letter, and "the request was refused" does not say that.
      return 'resource.error.brandLabelEmpty';
    case 'brand_key_taken':
      // Another brand already holds this key. A conflict, and the useful half is
      // which brand: the refusal publishes its id, so the screen that was
      // refused can offer to open it instead of only apologising.
      return 'resource.error.brandKeyTaken';
    case 'brand_link_to_self':
      // A brand asked to be a spelling of itself (backend plan 0124, section 3).
      // The picker offers every brand, including the one being edited, because
      // the one level rule is the server's and a client that pre filtered would
      // be a second copy of it.
      return 'resource.error.brandLinkToSelf';
    case 'brand_link_too_deep':
      // A link that would make a chain of spellings, either because the target
      // is itself a spelling or because this brand already has spellings
      // pointing at it. The refusal names the brand that breaks the rule, so
      // the form offers to open it.
      return 'resource.error.brandLinkTooDeep';
    case 'brand_link_owns_no_chain':
      // A spelling of another brand has no private label chain of its own: the
      // brand it spells is where that belongs.
      return 'resource.error.brandLinkOwnsNoChain';
    case 'brand_link_keeps_key':
      // A linked brand renamed into a name that makes another key. The link is
      // what holds the spelling's own key to the brand it spells, so a rename
      // that changed the key would leave its products behind.
      return 'resource.error.brandLinkKeepsKey';
    case 'brand_not_linked':
      // A delete asked for a brand that is not a spelling of another one. Only
      // a linked brand can be deleted, because only its products have somewhere
      // to go back to.
      return 'resource.error.brandNotLinked';
    // The category tree (backend plan 0166, admin plan 0036). Each is named
    // apart because each has its own fix, and "the request was refused" says
    // none of them.
    case 'category_too_deep':
      // A third level: the parent picked is itself inside another category, or
      // the category being moved under one already has categories inside it.
      return 'resource.error.categoryTooDeep';
    case 'category_not_a_leaf':
      // A product put on a top level category, or a category that holds
      // products made top level. Products only go on a category inside another.
      return 'resource.error.categoryNotALeaf';
    case 'item_needs_a_category':
      return 'resource.error.itemNeedsACategory';
    case 'category_in_use':
      // A delete of a category that still holds categories or products. Move
      // them first; nothing in this app deletes one that holds something.
      return 'resource.error.categoryInUse';
    case 'category_not_found':
      return 'resource.error.categoryNotFound';
    // Shop sections (backend plan 0167, admin plan 0037).
    case 'section_not_found':
      return 'resource.error.sectionNotFound';
    case 'section_of_another_chain':
      // A shop's list or a product's pins naming a section of another chain.
      // The pickers offer only the right chain's, so this is a stale screen.
      return 'resource.error.sectionOfAnotherChain';
    case 'section_slug_taken':
      return 'resource.error.sectionSlugTaken';
    case 'run_in_progress':
      // A row the harvester is working on right now. A conflict, but the useful
      // half is which conflict: waiting for the run to finish is the whole of
      // what the operator has to do.
      return 'resource.error.runInProgress';
    case 'guest_has_no_roles':
      // A role given to a guest account (backend plan 0175). The page of a
      // person offers a guest no role, so this is a screen that is behind:
      // the account was a registered one when the page read it.
      return 'resource.error.guestHasNoRoles';
  }

  switch (error.status) {
    case 0:
      // No response at all: the request never arrived, or the browser refused
      // it. Naming it separately is worth a key, because it is the one failure
      // an operator can usually fix themselves.
      return 'resource.error.unreachable';
    case 403:
      return 'resource.error.forbidden';
    case 404:
      return 'resource.error.notFound';
    case 409:
      return 'resource.error.conflict';
    default:
      return 'resource.error.unknown';
  }
}
