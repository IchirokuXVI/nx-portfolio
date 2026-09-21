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
import { WaitingSettlements1756001900000 } from './1756001900000-WaitingSettlements';
import { ParticipantInvitesAndEndings1756002000000 } from './1756002000000-ParticipantInvitesAndEndings';
import { SoftDeletedLines1756002100000 } from './1756002100000-SoftDeletedLines';
import { BasketKindStatusAndSources1756002200000 } from './1756002200000-BasketKindStatusAndSources';
import { SettlementBasket1756002300000 } from './1756002300000-SettlementBasket';
import { BasketTripRows1756002400000 } from './1756002400000-BasketTripRows';
import { BasketsBecomeViews1756002500000 } from './1756002500000-BasketsBecomeViews';
import { BasketLineSkips1756002600000 } from './1756002600000-BasketLineSkips';
import { ListLineChangesAndCursors1756002700000 } from './1756002700000-ListLineChangesAndCursors';
import { BasketLinkAndAccessExpiry1756002800000 } from './1756002800000-BasketLinkAndAccessExpiry';
import { OpenBasketsByOwner1756002900000 } from './1756002900000-OpenBasketsByOwner';
import { PersonPurchases1756003000000 } from './1756003000000-PersonPurchases';
import { SettlementPricePaid1756003100000 } from './1756003100000-SettlementPricePaid';
import { UserAppState1756003200000 } from './1756003200000-UserAppState';

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
  // Alters the table `LineSettlements1756000800000` created and `plan 0054`'s
  // migration last touched, so it follows both and nothing else (plan 0093,
  // section 5).
  WaitingSettlements1756001900000,
  // Additive on `generated_list_participants`, which plan 0051's migration
  // created and plan 0054's last touched, so it follows both and nothing else
  // (plan 0114, section 3).
  ParticipantInvitesAndEndings1756002000000,
  // Additive on `list_lines`, plus the one index plan 0017's migration created
  // there made partial. It follows those and nothing else (plan 0132, section
  // 5).
  SoftDeletedLines1756002100000,
  // Rebuilds two things on `generated_lists`, which plan 0050's migration
  // created: its status enum, and the sources it kept in a `jsonb` column. Both
  // are read by every migration that touched the table before it and by none
  // after, so it follows all of them and nothing else (plan 0133, section 8).
  BasketKindStatusAndSources1756002200000,
  // Alters the table `LineSettlements1756000800000` created, which plan 0093's
  // migration last touched, and reads `generated_lists.kind`, which plan 0133's
  // creates. It follows all three and nothing else (plan 0134, section 6).
  SettlementBasket1756002300000,
  // A new table referencing `generated_lists`, which plan 0050's migration
  // created and plan 0133's last reshaped, and `list_lines`, which plan 0132's
  // last touched. Its backfill reads plan 0133's status literals, so it follows
  // that migration, plan 0132's and plan 0134's, and nothing else (plan 0135,
  // section 6).
  BasketTripRows1756002400000,
  // The centre of the plan 0130 series (plan 0136, section 9). It drops the
  // three tables `GeneratedLists1756001000000` created, the column plan 0134's
  // migration added and the two constraints plan 0093's did, and it asserts
  // plan 0134's and plan 0135's backfills before it drops anything. So it
  // follows every migration that touched `generated_list_lines`,
  // `line_settlements` or `basket_trip_rows`, and nothing else.
  BasketsBecomeViews1756002500000,
  // A new table referencing `generated_lists`, which plan 0050's migration
  // created and plan 0133's last reshaped, and `list_lines`, which plan 0132's
  // last touched. It reads nothing plan 0136's migration dropped and adds
  // nothing anything before it needs, so it follows that one and nothing else
  // (plan 0137, section 2).
  BasketLineSkips1756002600000,
  // Two new tables. The first references `shopping_lists`, which plan 0007's
  // migration created, and the second `generated_list_participants`, which plan
  // 0051's created and plan 0114's last touched. It reads nothing any earlier
  // migration wrote and adds nothing any of them needs, so it follows all of
  // them and nothing else (plan 0138, section 11).
  ListLineChangesAndCursors1756002700000,
  // Alters `generated_list_participants` and `generated_list_share_links`,
  // which plan 0051's migration created and plan 0114's last touched, and it
  // recreates plan 0114's `endedReason` constraint with a fourth value. Its
  // backfill reads plan 0114's `invitedAt` and plan 0051's `kind`, and nothing
  // any later migration wrote, so it follows every migration that touched
  // either table and nothing else (plan 0140, section 9).
  BasketLinkAndAccessExpiry1756002800000,
  // One partial index on `generated_lists`, which plan 0050's migration created
  // and plan 0133's last reshaped. It adds no column, moves no row and reads
  // nothing, so it follows that migration and nothing else (plan 0139, section
  // 9).
  OpenBasketsByOwner1756002900000,
  // One index swapped on `generated_list_participants`, which plan 0051's
  // migration created and plan 0140's last touched. It adds no column, moves no
  // row and reads nothing, so it follows every migration that touched that
  // table and nothing else (plan 0142, section 9).
  PersonPurchases1756003000000,
  // Two columns and four constraints on `line_settlements`, which plan 0047's
  // migration created and plan 0136's last reshaped. It writes no row and
  // reads none, and every constraint it adds holds over a table whose four
  // price columns are null on every existing row, so it follows every
  // migration that touched that table and nothing else (plan 0143, section 5).
  SettlementPricePaid1756003100000,
  // One new table, `user_app_state`. It references nothing any earlier
  // migration created, nothing references it, and it reads and writes no row,
  // so it follows every migration and none of them in particular (plan 0145,
  // section 1).
  UserAppState1756003200000,
];
