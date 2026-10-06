import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createTransport, type Transporter } from 'nodemailer'
import { MailNotConfiguredError, MailTransport, type MailMessage } from './mail-transport'

/** SMTP through nodemailer, configured from the environment. Unset host = not configured (sending reports it, nothing is sent). */
@Injectable()
export class SmtpTransport extends MailTransport {
  private transporter: Transporter | null = null

  constructor(private readonly config: ConfigService) {
    super()
  }

  from(): string | null {
    return this.config.get<string>('SMTP_HOST') ? (this.config.get<string>('MAIL_FROM') ?? null) : null
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    if (!this.from()) throw new MailNotConfiguredError()

    this.transporter ??= createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT') ?? 587),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: this.config.get<string>('SMTP_USER') ? { user: this.config.getOrThrow<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })

    const info = await this.transporter.sendMail({ from: message.from, to: message.to, subject: message.subject, text: message.text, html: message.html, attachments: message.attachments })

    return { messageId: String(info.messageId) }
  }
}
