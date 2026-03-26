// ---------------------------------------------------------------------------
// Bugloop Ticket Lifecycle
// ---------------------------------------------------------------------------
// Orchestrates the full flow: triage → create ticket → (optionally) dispatch
// agent → track status → notify user.
// ---------------------------------------------------------------------------

import { triage } from './triage.js'
import type {
  AgentAdapter,
  Attachment,
  AIProviderConfig,
  BugloopConfig,
  NewMessage,
  ProjectContext,
  StorageAdapter,
  SupportMessage,
  Ticket,
  TicketFilter,
  TriageResult,
} from './types.js'

// ---------------------------------------------------------------------------
// Ticket Manager — stateless service object
// ---------------------------------------------------------------------------

export class TicketManager {
  private storage: StorageAdapter
  private ai: AIProviderConfig
  private project: ProjectContext
  private agent?: {
    adapter: AgentAdapter
    prOnly: boolean
    maxRetries: number
  }

  constructor(config: BugloopConfig) {
    this.storage = config.storage
    this.ai = config.ai
    this.project = config.project

    if (config.agent) {
      this.agent = {
        adapter: config.agent.adapter,
        prOnly: config.agent.prOnly ?? true,
        maxRetries: config.agent.maxRetries ?? 2,
      }
    }
  }

  // -------------------------------------------------------------------------
  // Triage a raw user message → create ticket or answer directly
  // -------------------------------------------------------------------------

  async handleMessage(
    userId: string,
    text: string,
    attachments?: Attachment[],
    userEmail?: string,
  ): Promise<{
    ticket: Ticket
    triageResult: TriageResult
    immediateResponse?: string
  }> {
    // 1. Classify
    const triageResult = await triage(
      { text, attachments },
      this.project,
      this.ai,
    )

    // 2. Create ticket
    const ticket = await this.storage.createTicket({
      type: triageResult.type,
      severity: triageResult.severity,
      title: triageResult.title,
      structuredReport: {
        description: triageResult.structuredReport?.description ?? text,
        stepsToReproduce: triageResult.structuredReport?.stepsToReproduce,
        expected: triageResult.structuredReport?.expected,
        actual: triageResult.structuredReport?.actual,
        screenshotUrls: attachments
          ?.filter((a) => a.type === 'image' || a.type === 'screenshot')
          .map((a) => a.url),
        fileUrls: attachments
          ?.filter((a) => a.type === 'file')
          .map((a) => a.url),
        rawInput: text,
      },
      userId,
      userEmail,
    })

    // 3. Save the user's original message to the thread
    await this.storage.saveMessage(ticket.id, {
      role: 'user',
      content: text,
      attachments,
    })

    // 4. For questions — save the answer and return it
    if (triageResult.type === 'question' && triageResult.answer) {
      await this.storage.updateTicket(ticket.id, { status: 'answering' })

      await this.storage.saveMessage(ticket.id, {
        role: 'assistant',
        content: triageResult.answer,
      })

      await this.storage.updateTicket(ticket.id, {
        status: 'resolved',
        resolvedAt: new Date(),
      })

      return { ticket, triageResult, immediateResponse: triageResult.answer }
    }

    // 5. For bugs — optionally dispatch agent
    if (triageResult.type === 'bug' && this.agent) {
      await this.dispatchAgent(ticket)
    }

    // 6. Acknowledge
    const ack =
      triageResult.type === 'bug'
        ? this.agent
          ? "I've logged this bug and dispatched an agent to investigate. I'll update you when there's progress."
          : "I've logged this bug. The team will look into it."
        : "Thanks for the suggestion! I've logged this as a feature request."

    await this.storage.saveMessage(ticket.id, {
      role: 'assistant',
      content: ack,
    })

    return { ticket, triageResult, immediateResponse: ack }
  }

  // -------------------------------------------------------------------------
  // Agent dispatch
  // -------------------------------------------------------------------------

  private async dispatchAgent(ticket: Ticket): Promise<void> {
    if (!this.agent) return

    try {
      await this.storage.updateTicket(ticket.id, { status: 'investigating' })

      const { runId } = await this.agent.adapter.trigger(ticket)

      await this.storage.updateTicket(ticket.id, {
        status: 'fixing',
        agentRunId: runId,
      })

      await this.storage.saveMessage(ticket.id, {
        role: 'system',
        content: `Agent dispatched (run: ${runId}). Investigating the issue...`,
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error dispatching agent'

      await this.storage.saveMessage(ticket.id, {
        role: 'system',
        content: `Failed to dispatch agent: ${message}. Escalating to human review.`,
      })

      await this.storage.updateTicket(ticket.id, { status: 'open' })
    }
  }

  // -------------------------------------------------------------------------
  // Agent callback — called when the agent reports back
  // -------------------------------------------------------------------------

  async handleAgentCallback(
    ticketId: string,
    result: {
      state: 'succeeded' | 'failed'
      prUrl?: string
      error?: string
      sessionId?: string
    },
  ): Promise<void> {
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`)

    if (result.state === 'succeeded' && result.prUrl) {
      await this.storage.updateTicket(ticketId, {
        status: 'deployed',
        prUrl: result.prUrl,
        agentSessionId: result.sessionId,
      })

      await this.storage.saveMessage(ticketId, {
        role: 'assistant',
        content: `A fix has been prepared: ${result.prUrl}\n\nOnce deployed, I'll ask you to confirm the issue is resolved.`,
      })
    } else {
      await this.storage.updateTicket(ticketId, {
        status: 'open',
        agentSessionId: result.sessionId,
      })

      await this.storage.saveMessage(ticketId, {
        role: 'assistant',
        content: `The automated fix attempt was unsuccessful${result.error ? `: ${result.error}` : ''}. This has been escalated for human review.`,
      })
    }
  }

  // -------------------------------------------------------------------------
  // User confirms fix / reports still broken
  // -------------------------------------------------------------------------

  async confirmResolved(ticketId: string): Promise<void> {
    await this.storage.updateTicket(ticketId, {
      status: 'resolved',
      resolvedAt: new Date(),
    })

    await this.storage.saveMessage(ticketId, {
      role: 'system',
      content: 'User confirmed the issue is resolved. Ticket closed.',
    })
  }

  async reportStillBroken(
    ticketId: string,
    additionalContext?: string,
  ): Promise<void> {
    const ticket = await this.storage.getTicket(ticketId)
    if (!ticket) throw new Error(`Ticket ${ticketId} not found`)

    await this.storage.saveMessage(ticketId, {
      role: 'user',
      content: additionalContext ?? 'The issue is still happening.',
    })

    // If agent is configured, retry (up to max)
    if (this.agent) {
      await this.storage.updateTicket(ticketId, { status: 'open' })
      await this.dispatchAgent(ticket)
    } else {
      await this.storage.updateTicket(ticketId, { status: 'open' })

      await this.storage.saveMessage(ticketId, {
        role: 'assistant',
        content:
          'Sorry about that. I\'ve reopened the ticket with your additional context. The team will investigate further.',
      })
    }
  }

  // -------------------------------------------------------------------------
  // CRUD pass-throughs
  // -------------------------------------------------------------------------

  async getTicket(id: string): Promise<Ticket | null> {
    return this.storage.getTicket(id)
  }

  async listTickets(filter: TicketFilter): Promise<Ticket[]> {
    return this.storage.listTickets(filter)
  }

  async getMessages(ticketId: string): Promise<SupportMessage[]> {
    return this.storage.getMessages(ticketId)
  }

  async addMessage(
    ticketId: string,
    message: NewMessage,
  ): Promise<SupportMessage> {
    return this.storage.saveMessage(ticketId, message)
  }

  async uploadAttachment(
    file: Blob,
    filename: string,
  ): Promise<{ url: string }> {
    return this.storage.uploadAttachment(file, filename)
  }
}
