import type {
  ProfileGenerationSourceView,
  ProfilePostalCodeView,
  ProfileSupermarketPreferenceView,
  ShoppingProfileView,
} from '@portfolio/luna-shopper/contracts';
import type {
  ProfileGenerationSource,
  ProfilePostalCode,
  ProfileSupermarketPreference,
  ShoppingProfile,
} from '../entities';

/**
 * Rows to wire views (plan 0049). The children are passed in rather than read
 * from a relation, because the parent declares none: three `OneToMany`s exist
 * only to be eagerly loaded once and would otherwise be a lazy relation nobody
 * asked for on every read of a profile.
 */

export function toPostalCodeView(
  row: ProfilePostalCode
): ProfilePostalCodeView {
  return {
    id: row.id,
    postalCode: row.postalCode,
    label: row.label,
    position: row.position,
  };
}

export function toSupermarketPreferenceView(
  row: ProfileSupermarketPreference
): ProfileSupermarketPreferenceView {
  return {
    id: row.id,
    supermarketId: row.supermarketId,
    excluded: row.excluded,
  };
}

export function toGenerationSourceView(
  row: ProfileGenerationSource
): ProfileGenerationSourceView {
  return { id: row.id, zoneId: row.zoneId, listId: row.listId };
}

export function toShoppingProfileView(
  row: ShoppingProfile,
  children: {
    postalCodes: ProfilePostalCode[];
    supermarkets: ProfileSupermarketPreference[];
    generationSources: ProfileGenerationSource[];
  }
): ShoppingProfileView {
  return {
    id: row.id,
    // Null travels as null. The client renders the localized default; core has
    // no locale to render it in (plan 0049, section 1.3).
    name: row.name,
    isDefault: row.isDefault,
    position: row.position,
    addressText: row.addressText,
    minSavingCents: row.minSavingCents,
    minSavingPercent: row.minSavingPercent,
    generationScope: row.generationScope,
    postalCodes: children.postalCodes.map(toPostalCodeView),
    supermarkets: children.supermarkets.map(toSupermarketPreferenceView),
    generationSources: children.generationSources.map(toGenerationSourceView),
  };
}
