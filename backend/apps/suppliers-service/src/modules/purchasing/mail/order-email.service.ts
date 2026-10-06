import { BadGatewayException, BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { PrismaClientService } from '../../db-client/prisma-client.service'
import type { SendOrderEmailDto } from '../dto/purchase.dto'
import { PurchasesService, type PurchaseView } from '../services/purchases.service'
import { MailNotConfiguredError, MailTransport } from './mail-transport'
import { buildOrderEmail, DEFAULT_MESSAGE } from './order-email'

/** The PDF the panel renders is small (an order); the request body limit is ~1 MB, so this keeps a clear message ahead of it. */
const MAX_ATTACHMENT_BYTES = 700 * 1024

export interface EmailPreview {
  /** The supplier's registered e-mail, or null: sending stays blocked until an address is given. */
  to: string | null
  supplier_name: string | null
  subject: string
  default_message: string
  text: string
  html: string
  attachment: { suggested_filename: string }
  /** SMTP is set up. When false nothing can be sent. */
  configured: boolean
  /** The order was already sent: sending again needs an explicit resend. */
  already_sent: boolean
  sent: { to: string; subject: string; result: string; error: string | null; sent_by: string | null; created_at: string }[]
}

/**
 * Sends an order to the supplier. Nothing leaves without a person confirming in the preview; a failed send leaves the order where it
 * was and is logged; a repeat needs an explicit resend. On the first successful send of a requisition the order moves to
 * "awaiting invoice".
 */
@Injectable()
export class OrderEmailService {
  constructor(
    private readonly prisma: PrismaClientService,
    private readonly purchases: PurchasesService,
    private readonly transport: MailTransport,
  ) {}

  async preview(id: number, message?: string): Promise<EmailPreview> {
    const order = await this.purchases.findById(id)
    const supplier = await this.prisma.supplier.findUnique({ where: { id: order.supplier_id } })
    const mail = buildOrderEmail(order, message ?? DEFAULT_MESSAGE)
    const log = await this.log(id)

    return {
      to: supplier?.email ?? null,
      supplier_name: supplier?.name ?? null,
      subject: mail.subject,
      default_message: DEFAULT_MESSAGE,
      text: mail.text,
      html: mail.html,
      attachment: { suggested_filename: `pedido-${id}.pdf` },
      configured: this.transport.from() !== null,
      already_sent: log.some(entry => entry.result === 'sent'),
      sent: log,
    }
  }

  async send(id: number, dto: SendOrderEmailDto): Promise<{ order: PurchaseView; email: { to: string; subject: string; message_id: string } }> {
    const order = await this.purchases.findById(id)
    if (order.status === 'received') throw new ConflictException('A received order is not sent to the supplier')

    const from = this.transport.from()
    if (!from) throw new ServiceUnavailableException(new MailNotConfiguredError().message)

    if (!dto.resend && (await this.log(id)).some(entry => entry.result === 'sent')) {
      throw new ConflictException('This order was already sent to the supplier. Send it again only by asking explicitly (resend)')
    }

    const attachment = decodePdf(dto)
    const mail = buildOrderEmail(order, dto.message?.trim() || DEFAULT_MESSAGE)
    const subject = dto.subject?.trim() || mail.subject

    let messageId: string
    try {
      messageId = (await this.transport.send({ from, to: dto.to, subject, text: mail.text, html: mail.html, attachments: attachment ? [attachment] : undefined })).messageId
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.prisma.purchaseEmail.create({ data: { purchase_id: id, to_address: dto.to, subject, has_attachment: Boolean(attachment), result: 'failed', error: reason.slice(0, 500), sent_by: dto.actor } })
      // The order stays where it was; the operator is told and can try again.
      throw new BadGatewayException(`The e-mail could not be sent: ${reason}`)
    }

    await this.prisma.purchaseEmail.create({ data: { purchase_id: id, to_address: dto.to, subject, has_attachment: Boolean(attachment), result: 'sent', message_id: messageId, sent_by: dto.actor } })

    const supplier = await this.prisma.supplier.findUnique({ where: { id: order.supplier_id } })
    if (dto.save_to_supplier && supplier && supplier.email !== dto.to) await this.prisma.supplier.update({ where: { id: supplier.id }, data: { email: dto.to } })

    const moved = order.status === 'requisition' ? await this.purchases.transition(id, { to: 'awaiting_invoice', actor: dto.actor, note: `enviado por e-mail a ${dto.to}` }) : order

    return { order: moved, email: { to: dto.to, subject, message_id: messageId } }
  }

  async log(id: number): Promise<EmailPreview['sent']> {
    const rows = await this.prisma.purchaseEmail.findMany({ where: { purchase_id: id }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] })

    return rows.map(r => ({ to: r.to_address, subject: r.subject, result: r.result, error: r.error, sent_by: r.sent_by, created_at: r.created_at.toISOString() }))
  }
}

/** A PDF the panel rendered, or nothing. Anything else is refused: this is not a file relay. */
function decodePdf(dto: SendOrderEmailDto): { filename: string; content: Buffer; contentType: string } | null {
  if (!dto.attachment_base64) return null

  const content = Buffer.from(dto.attachment_base64, 'base64')
  if (content.length > MAX_ATTACHMENT_BYTES) throw new BadRequestException(`The attachment is larger than ${Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB`)
  if (content.subarray(0, 4).toString('latin1') !== '%PDF') throw new BadRequestException('The attachment must be a PDF')

  const name = (dto.attachment_name?.trim() || 'pedido.pdf').replace(/[^\w.\- ]+/g, '_')

  return { filename: name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, content, contentType: 'application/pdf' }
}
