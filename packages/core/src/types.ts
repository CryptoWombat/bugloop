// ---------------------------------------------------------------------------
// Bugloop Core Types
// ---------------------------------------------------------------------------

/** The user reporting an issue. Provided by the host app's auth adapter. */
export interface BugloopUser {
  id: string
  email?: string
  name?: string
  /** Arbitrary host-app metadata (plan, org, role, etc.) */
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export type TicketType = 'question' | 'bug' | 'feature'

export type TicketSeverity = 'low' | 'medium' | 'high' | 'critical'

export type TicketStatus =
  | 'open'
  | 'triaging'
  | 'answering'
  | 'investigating'
  | 'fixing'
  | 'deployed'
  | 'resolved'
  | 'wont_fix'

export interface StructuredReport {
  description: string
  stepsToReproduce?: string[]
  expected?: string
  actual?: string
  environment?: Record<string, string>
  screenshotUrls?: string[]
  fileUrls?: string[]
  /** Raw user message that triggered the ticket — kept for audit */
  rawInput?: string
}

export interface Ticket {
  id: string
  type: TicketType
  severity: TicketSeverity
  status: TicketStatus
  title: string
  structuredReport: StructuredReport
  agentRunId?: string
  agentSessionId?: string
  prUrl?: string
  userId: string
  userEmail?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  resolvedAt?: Date
}

export interface NewTicket {
  type: TicketType
  severity: TicketSeverity
  title: string
  structuredReport: StructuredReport
  userId: string
  userEmail?: string
  metadata?: Record<string, unknown>
}

export interface TicketFilter {
  status?: TicketStatus | TicketStatus[]
  type?: TicketType | TicketType[]
  userId?: string
  limit?: number
  offset?: number
}

export interface TicketUpdate {
  status?: TicketStatus
  agentRunId?: string
  agentSessionId?: string
  prUrl?: string
  resolvedAt?: Date
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Messages (support chat thread attached to a ticket)
// ---------------------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system'

export interface SupportMessage {
  id: string
  ticketId: string
  role: MessageRole
  content: string
  attachments?: Attachment[]
  createdAt: Date
}

export interface NewMessage {
  role: MessageRole
  content: string
  attachments?: Attachment[]
}

export interface Attachment {
  url: string
  type: 'image' | 'file' | 'screenshot'
  name: string
  mimeType?: string
}

// ---------------------------------------------------------------------------
// Adapters — contracts the host app implements
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  // Tickets
  createTicket(ticket: NewTicket): Promise<Ticket>
  getTicket(id: string): Promise<Ticket | null>
  updateTicket(id: string, update: TicketUpdate): Promise<Ticket>
  listTickets(filter: TicketFilter): Promise<Ticket[]>

  // Messages
  saveMessage(ticketId: string, message: NewMessage): Promise<SupportMessage>
  getMessages(ticketId: string): Promise<SupportMessage[]>

  // Attachments
  uploadAttachment(file: Blob, filename: string): Promise<{ url: string }>
}

export interface AuthAdapter {
  /** Extract the current user from an incoming request. Return null if unauthenticated. */
  getUser(request: Request): Promise<BugloopUser | null>
}

export interface AgentAdapter {
  /** Dispatch an auto-fix agent for the given ticket. */
  trigger(ticket: Ticket): Promise<{ runId: string }>
  /** Poll the status of a running agent. */
  getStatus(runId: string): Promise<AgentRunStatus>
  /** Cancel a running agent. */
  cancel(runId: string): Promise<void>
}

export interface AgentRunStatus {
  runId: string
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  prUrl?: string
  error?: string
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// AI Provider — how Bugloop calls an LLM for triage
// ---------------------------------------------------------------------------

export interface AIProviderConfig {
  provider: 'anthropic' | 'openai' | 'google'
  apiKey: string
  model?: string
}

// ---------------------------------------------------------------------------
// Project context — what the host app tells Bugloop about itself
// ---------------------------------------------------------------------------

export interface ProjectContext {
  /** Human-readable app name */
  name: string
  /** What the app does — helps the triage AI understand domain */
  description: string
  /** GitHub repo (owner/repo) — required for agent adapter */
  repo?: string
  /** Markdown FAQ/docs the triage AI can search to answer questions */
  knowledgeBase?: string
  /** Extend or override the default triage system prompt */
  customTriageInstructions?: string
}

// ---------------------------------------------------------------------------
// Top-level SDK config
// ---------------------------------------------------------------------------

export interface BugloopConfig {
  storage: StorageAdapter
  auth: AuthAdapter
  ai: AIProviderConfig
  project: ProjectContext
  agent?: {
    adapter: AgentAdapter
    /** Only create PRs, never push to main (default: true) */
    prOnly?: boolean
    /** Max USD cost per fix attempt (default: 5) */
    maxCostPerFix?: number
    /** Max auto-retry attempts before escalating (default: 2) */
    maxRetries?: number
  }
  /** Shared secret for HMAC verification of agent callbacks */
  callbackSecret?: string
  /** Base path for API routes (default: '/api/support') */
  basePath?: string
}

// ---------------------------------------------------------------------------
// Triage result — what the AI returns after classifying a message
// ---------------------------------------------------------------------------

export interface TriageResult {
  type: TicketType
  severity: TicketSeverity
  title: string
  /** Direct answer (for questions) */
  answer?: string
  /** Structured bug/feature report */
  structuredReport?: StructuredReport
}
