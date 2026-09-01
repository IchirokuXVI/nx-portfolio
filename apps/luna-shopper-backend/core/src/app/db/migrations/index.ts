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
import { BasketLineAuthor1756001300000 } from './1756001300000-BasketLineAuthor';

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
  // Alters the table `GeneratedLists1756001000000` created, so it follows it
  // (plan 0055, section 8).
  BasketLineAuthor1756001300000,
];
