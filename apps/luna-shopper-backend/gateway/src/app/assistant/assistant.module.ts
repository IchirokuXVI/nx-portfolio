import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { AssistantController } from './assistant.controller';

/**
 * The assistant's surface on the gateway (plan 0039, section 3): one route,
 * proxied to the assistant service over NATS.
 *
 * **It is the only gateway change the plan asks for, and it holds no assistant
 * logic** — deliberately, because what backlog 0005 refused was a provider outage
 * or a runaway conversation sitting inside the app's request path. Everything
 * that could be slow lives in the service on the other side of this hop.
 */
@Module({
  imports: [MessagingModule],
  controllers: [AssistantController],
})
export class GatewayAssistantModule {}
