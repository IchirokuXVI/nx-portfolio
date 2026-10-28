import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { AssistantCapabilitiesProbe } from './assistant-capabilities.probe';
import { LegalController } from './legal.controller';

/** The public legal settings (plan 0231, section 2). */
@Module({
  imports: [MessagingModule],
  controllers: [LegalController],
  providers: [AssistantCapabilitiesProbe],
})
export class GatewayLegalModule {}
