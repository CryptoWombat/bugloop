// ---------------------------------------------------------------------------
// Bugloop Supabase Adapter
// ---------------------------------------------------------------------------
// Provides StorageAdapter and AuthAdapter backed by Supabase.
// The host app provides their existing Supabase client; this adapter
// creates its own tables (via shipped SQL migration) in the host's DB.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AuthAdapter,
  BugloopUser,
  NewMessage,
  NewTicket,
  StorageAdapter,
  SupportMessage,
  Ticket,
  TicketFilter,
  TicketUpdate,
} from '@bugloop/core'

// ---------------------------------------------------------------------------
// Storage Adapter
// ---------------------------------------------------------------------------

export interface SupabaseAdapterOptions {
  /** Supabase client (service-role recommended for server-side use) */
  client: SupabaseClient
  /** Table name prefix (default: 'bugloop_') */
  tablePrefix?: string
  /** Storage bucket for attachments (default: 'bugloop-attachments') */
  storageBucket?: string
}

export class SupabaseStorageAdapter implements StorageAdapter {
  private db: SupabaseClient
  private tickets: string
  private messages: string
  private bucket: string

  constructor(options: SupabaseAdapterOptions) {
    this.db = options.client
    const prefix = options.tablePrefix ?? 'bugloop_'
    this.tickets = `${prefix}tickets`
    this.messages = `${prefix}messages`
    this.bucket = options.storageBucket ?? 'bugloop-attachments'
  }

  async createTicket(ticket: NewTicket): Promise<Ticket> {
    const { data, error } = await this.db
      .from(this.tickets)
      .insert({
        type: ticket.type,
        severity: ticket.severity,
        status: 'open' as const,
        title: ticket.title,
        structured_report: ticket.structuredReport,
        user_id: ticket.userId,
        user_email: ticket.userEmail,
        metadata: ticket.metadata ?? {},
      })
      .select()
      .single()

    if (error) throw new Error(`Failed to create ticket: ${error.message}`)
    return rowToTicket(data)
  }

  async getTicket(id: string): Promise<Ticket | null> {
    const { data, error } = await this.db
      .from(this.tickets)
      .select()
      .eq('id', id)
      .single()

    if (error?.code === 'PGRST116') return null
    if (error) throw new Error(`Failed to get ticket: ${error.message}`)
    return rowToTicket(data)
  }

  async updateTicket(id: string, update: TicketUpdate): Promise<Ticket> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (update.status !== undefined) row.status = update.status
    if (update.agentRunId !== undefined) row.agent_run_id = update.agentRunId
    if (update.agentSessionId !== undefined) row.agent_session_id = update.agentSessionId
    if (update.prUrl !== undefined) row.pr_url = update.prUrl
    if (update.resolvedAt !== undefined) row.resolved_at = update.resolvedAt.toISOString()
    if (update.metadata !== undefined) row.metadata = update.metadata

    const { data, error } = await this.db
      .from(this.tickets)
      .update(row)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(`Failed to update ticket: ${error.message}`)
    return rowToTicket(data)
  }

  async listTickets(filter: TicketFilter): Promise<Ticket[]> {
    let query = this.db.from(this.tickets).select()

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status]
      query = query.in('status', statuses)
    }
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type]
      query = query.in('type', types)
    }
    if (filter.userId) {
      query = query.eq('user_id', filter.userId)
    }

    query = query.order('created_at', { ascending: false })

    if (filter.limit) query = query.limit(filter.limit)
    if (filter.offset) query = query.range(filter.offset, filter.offset + (filter.limit ?? 50) - 1)

    const { data, error } = await query
    if (error) throw new Error(`Failed to list tickets: ${error.message}`)
    return (data ?? []).map(rowToTicket)
  }

  async saveMessage(ticketId: string, message: NewMessage): Promise<SupportMessage> {
    const { data, error } = await this.db
      .from(this.messages)
      .insert({
        ticket_id: ticketId,
        role: message.role,
        content: message.content,
        attachments: message.attachments ?? [],
      })
      .select()
      .single()

    if (error) throw new Error(`Failed to save message: ${error.message}`)
    return rowToMessage(data)
  }

  async getMessages(ticketId: string): Promise<SupportMessage[]> {
    const { data, error } = await this.db
      .from(this.messages)
      .select()
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })

    if (error) throw new Error(`Failed to get messages: ${error.message}`)
    return (data ?? []).map(rowToMessage)
  }

  async uploadAttachment(file: Blob, filename: string): Promise<{ url: string }> {
    const path = `${Date.now()}-${filename}`

    const { error } = await this.db.storage
      .from(this.bucket)
      .upload(path, file)

    if (error) throw new Error(`Failed to upload attachment: ${error.message}`)

    const { data: urlData } = this.db.storage
      .from(this.bucket)
      .getPublicUrl(path)

    return { url: urlData.publicUrl }
  }
}

// ---------------------------------------------------------------------------
// Auth Adapter
// ---------------------------------------------------------------------------

export interface SupabaseAuthAdapterOptions {
  /** Supabase client (anon key — will use the request's auth header) */
  client: SupabaseClient
}

export class SupabaseAuthAdapter implements AuthAdapter {
  private db: SupabaseClient

  constructor(options: SupabaseAuthAdapterOptions) {
    this.db = options.client
  }

  async getUser(request: Request): Promise<BugloopUser | null> {
    // Extract the access token from the Authorization header or cookie
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (!token) return null

    const { data: { user }, error } = await this.db.auth.getUser(token)
    if (error || !user) return null

    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name ?? user.user_metadata?.name,
      metadata: user.user_metadata,
    }
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTicket(row: any): Ticket {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    structuredReport: row.structured_report,
    agentRunId: row.agent_run_id ?? undefined,
    agentSessionId: row.agent_session_id ?? undefined,
    prUrl: row.pr_url ?? undefined,
    userId: row.user_id,
    userEmail: row.user_email ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMessage(row: any): SupportMessage {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    role: row.role,
    content: row.content,
    attachments: row.attachments?.length ? row.attachments : undefined,
    createdAt: new Date(row.created_at),
  }
}

// ---------------------------------------------------------------------------
// SQL migration (exported so the host app can run it)
// ---------------------------------------------------------------------------

export { MIGRATION_SQL } from './migration.js'
