import { InitialCoreSchema1756000100000 } from './1756000100000-InitialCoreSchema';
import { ListPermissionsAndAutoApprove1756000200000 } from './1756000200000-ListPermissionsAndAutoApprove';
import { ListSharedWithZone1756000300000 } from './1756000300000-ListSharedWithZone';
import { VoiceComments1756000400000 } from './1756000400000-VoiceComments';
import { LineProductSet1756000600000 } from './1756000600000-LineProductSet';
import { ShoppingProfiles1756000700000 } from './1756000700000-ShoppingProfiles';
import { LineSettlements1756000800000 } from './1756000800000-LineSettlements';
import { GeneratedLists1756001000000 } from './1756001000000-GeneratedLists';
import { GeneratedListSharing1756001100000 } from './1756001100000-GeneratedListSharing';
import { SettlementParticipants1756001200000 } from './1756001200000-SettlementParticipants';
import { ParticipantUsernameAndReopen1756001300000 } from './1756001300000-ParticipantUsernameAndReopen';
import { BasketLineAuthor1756001400000 } from './1756001400000-BasketLineAuthor';
import { PostalCodeSourceAndNearby1756001500000 } from './1756001500000-PostalCodeSourceAndNearby';
import { ProfileLocationPreferences1756001600000 } from './1756001600000-ProfileLocationPreferences';
import { LineProductGroupSubscription1756001700000 } from './1756001700000-LineProductGroupSubscription';
import { CoreAudit1756001800000 } from './1756001800000-CoreAudit';

/**
 * Every core migration, in the order TypeORM must apply them (plan 0027,
 * section 2.1).
 *
 * Explicit rather than a filesystem glob: webpack cannot follow a glob, so the
 * bundled `migrate.js` the deploy Job runs would otherwise find zero migrations
 * and report success without creating anything. See the auth index for the full
 * reasoning; this file is the same decision for core.
 */
export const CORE_MIGRATIONS = [
  InitialCoreSchema1756000100000,
  ListPermissionsAndAutoApprove1756000200000,
  ListSharedWithZone1756000300000,
  VoiceComments1756000400000,
  LineProductSet1756000600000,
  ShoppingProfiles1756000700000,
  // Plan 0047 first: it drops `list_lines.status`, and the generated list tables
  // that follow are additive and reference nothing it touches.
  LineSettlements1756000800000,
  GeneratedLists1756001000000,
  GeneratedListSharing1756001100000,
  // Last of plan 0051's, because it alters plan 0047's table rather than
  // creating one of its own, so it has to run after whichever migration did
  // (plan 0051, section 10).
  SettlementParticipants1756001200000,
  // Additive on both tables plan 0051 left behind, so it follows them (plan
  // 0054, section 5).
  ParticipantUsernameAndReopen1756001300000,
  // Additive on the lines table `GeneratedLists1756001000000` created, so it
  // follows that (plan 0055, section 8). It took the next timestamp rather than
  // 0054's because that plan landed first and the two were written in parallel;
  // they touch different columns and neither depends on the other, so the order
  // between them is only the order they arrived in.
  BasketLineAuthor1756001400000,
  // Additive on `profile_postal_codes`, which plan 0049's migration created, so
  // it follows that one and nothing else (plan 0062, section 7).
  PostalCodeSourceAndNearby1756001500000,
  // A new table hanging off `shopping_profiles`, so it follows the migration
  // that created that and nothing else (plan 0064, section 6).
  ProfileLocationPreferences1756001600000,
  // Additive on `list_lines` and `list_line_items`, which plan 0048's migration
  // shaped, plus a new table hanging off the lines. It follows those and nothing
  // else (plan 0070, section 10).
  LineProductGroupSubscription1756001700000,
  // A new table that references nothing, so it follows everything and depends on
  // none of it (plan 0077, section 8).
  CoreAudit1756001800000,
];
