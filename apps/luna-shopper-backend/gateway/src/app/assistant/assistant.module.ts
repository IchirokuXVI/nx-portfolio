import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { GatewayConfig } from '../config/app-config';
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
 *
 * The multipart handling that arrives with plan 0041 is the one exception to
 * "nothing but a proxy", and it is not assistant logic: it is a byte cap and a
 * place to put a file, both of which have to exist before anything can be
 * forwarded at all.
 */
@Module({
  imports: [
    MessagingModule,
    /**
     * The only file handling anywhere in this backend (plan 0041, section 4.1).
     *
     * `registerAsync` rather than options on the interceptor, because the cap is
     * a deployment's to set and `FileInterceptor`'s own options are evaluated
     * when the controller class is defined — before `ConfigModule` has read
     * anything. Registered here, the number comes from the validated config like
     * every other one.
     *
     * **`memoryStorage` is stated rather than inherited.** It is multer's default
     * with no `dest`, and relying on a library default for a privacy guarantee is
     * exactly the kind of thing that quietly stops being true: rule A2 and plan
     * 0041 section 6 say a recording never reaches a disk, and this line is where
     * that is enforced.
     */
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize:
            config.getOrThrow<GatewayConfig>('gateway').assistantAudioMaxBytes,
          // One file and nothing else. A multipart body with twenty parts is not
          // a thing this route has any use for, and refusing it at the parser is
          // cheaper than reasoning about it afterwards.
          files: 1,
        },
      }),
    }),
  ],
  controllers: [AssistantController],
})
export class GatewayAssistantModule {}
