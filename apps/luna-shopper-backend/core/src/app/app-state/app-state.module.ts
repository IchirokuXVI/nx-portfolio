import { Module } from '@nestjs/common';
import { AppStateController } from './app-state.controller';
import { UserAppStateService } from './user-app-state.service';

/**
 * What an account has been shown (plan 0145).
 *
 * A module of its own rather than a corner of `ProfilesModule`, because the
 * fact is not a shopping preference: a profile says how somebody shops, and
 * this says what the app has already put in front of them. They are read by
 * different screens and they will grow in different directions.
 *
 * It registers no repository and imports nothing. Both operations are single
 * statements on the injected `DataSource` (`user-app-state.sql.ts`), because
 * both rules the plan states are rules about what the database does under two
 * callers at once.
 */
@Module({
  controllers: [AppStateController],
  providers: [UserAppStateService],
})
export class AppStateModule {}
