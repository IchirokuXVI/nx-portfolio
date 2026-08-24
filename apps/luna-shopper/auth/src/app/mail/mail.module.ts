import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthConfig } from '../config/app-config';
import { MailService } from './mail.service';

/**
 * SMTP mail wiring (plan 0005, section 4.2).
 *
 * Connects to the submission port over TLS (implicit on 465, STARTTLS on 587) so
 * the sending mailbox password (a Kubernetes Secret) never crosses the wire in
 * the clear. Locally this points at Mailpit, which catches the mail. Auth is
 * omitted when no username is configured (the local catcher needs none).
 */
@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { smtp } = configService.getOrThrow<AuthConfig>('auth');
        return {
          transport: {
            host: smtp.host,
            port: smtp.port,
            secure: smtp.port === 465,
            auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
          },
          defaults: { from: smtp.from },
        };
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
