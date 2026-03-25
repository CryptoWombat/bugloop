// ---------------------------------------------------------------------------
// In-memory StorageAdapter — for testing and development
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type {
  NewMessage,
  NewTicket,
  StorageAdapter,
  SupportMessage,
  Ticket,
  TicketFilter,
  TicketUpdate,
} from './types.js'

export class MemoryStorageAdapter implements StorageAdapter {
  private tickets = new Map<string, Ticket>()
  private messages = new Map<string, SupportMessage[]>()

  async createTicket(input: NewTicket): Promise<Ticket> {
    const now = new Date()
    const ticket: Ticket = {
      id: randomUUID(),
      type: input.type,
      severity: input.severity,
      status: 'open',
      title: input.title,
      structuredReport: input.structuredReport,
      userId: input.userId,
      userEmail: input.userEmail,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }
    this.tickets.set(ticket.id, ticket)
    this.messages.set(ticket.id, [])
    return ticket
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return this.tickets.get(id) ?? null
  }

  async updateTicket(id: string, update: TicketUpdate): Promise<Ticket> {
    const ticket = this.tickets.get(id)
    if (!ticket) throw new Error(`Ticket ${id} not found`)

    const updated: Ticket = {
      ...ticket,
      ...update,
      updatedAt: new Date(),
    }
    this.tickets.set(id, updated)
    return updated
  }

  async listTickets(filter: TicketFilter): Promise<Ticket[]> {
    let results = Array.from(this.tickets.values())

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      results = results.filter((t) => statuses.includes(t.status))
    }
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      results = results.filter((t) => types.includes(t.type))
    }
    if (filter.userId) {
      results = results.filter((t) => t.userId === filter.userId)
    }

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    if (filter.offset) results = results.slice(filter.offset)
    if (filter.limit) results = results.slice(0, filter.limit)

    return results
  }

  async saveMessage(ticketId: string, input: NewMessage): Promise<SupportMessage> {
    const msg: SupportMessage = {
      id: randomUUID(),
      ticketId,
      role: input.role,
      content: input.content,
      attachments: input.attachments,
      createdAt: new Date(),
    }
    const thread = this.messages.get(ticketId) ?? []
    thread.push(msg)
    this.messages.set(ticketId, thread)
    return msg
  }

  async getMessages(ticketId: string): Promise<SupportMessage[]> {
    return this.messages.get(ticketId) ?? []
  }

  async uploadAttachment(_file: Blob, filename: string): Promise<{ url: string }> {
    return { url: `memory://attachments/${randomUUID()}/${filename}` }
  }

  /** Test helper — reset all state */
  clear(): void {
    this.tickets.clear()
    this.messages.clear()
  }
}
