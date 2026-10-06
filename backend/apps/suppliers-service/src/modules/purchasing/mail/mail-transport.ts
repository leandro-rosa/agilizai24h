/** One outgoing message. The attachment, when there is one, is a PDF the panel rendered. */
export interface MailMessage {
  from: string
  to: string
  subject: string
  text: string
  html: string
  attachments?: { filename: string; content: Buffer; contentType: string }[]
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('E-mail sending is not configured: set SMTP_HOST and MAIL_FROM for suppliers-service')
  }
}

/**
 * The port the sending goes through. The real one speaks SMTP; tests use a fake, so no test ever sends an e-mail, and development
 * points SMTP at a local catcher.
 */
export abstract class MailTransport {
  /** The `from` address messages are sent with, or null while mail is not configured. */
  abstract from(): string | null

  abstract send(message: MailMessage): Promise<{ messageId: string }>
}
