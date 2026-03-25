import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TicketManager } from './ticket.js'
import { MemoryStorageAdapter } from './memory-storage.js'
import type {
  AgentAdapter,
  AgentRunStatus,
  AIProviderConfig,
  BugloopConfig,
  ProjectContext,
  Ticket,
} from './types.js'

// ---------------------------------------------------------------------------
// Mock the triage module — we don't want real LLM calls in unit tests
// ---------------------------------------------------------------------------

vi.mock('./triage.js', () => ({
  triage: vi.fn(),
}))

import { triage as triageMock } from './triage.js'
const triage = vi.mocked(triageMock)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AI_CONFIG: AIProviderConfig = {
  provider: 'anthropic',
  apiKey: 'test-key',
}

const PROJECT: ProjectContext = {
  name: 'TestApp',
  description: 'A test application',
}

function createConfig(overrides?: Partial<BugloopConfig>): BugloopConfig {
  return {
    storage: new MemoryStorageAdapter(),
    auth: { getUser: async () => null },
    ai: AI_CONFIG,
    project: PROJECT,
    ...overrides,
  }
}

function createMockAgent(): AgentAdapter {
  return {
    trigger: vi.fn().mockResolvedValue({ runId: 'run-123' }),
    getStatus: vi.fn().mockResolvedValue({
      runId: 'run-123',
      state: 'running',
      updatedAt: new Date(),
    } satisfies AgentRunStatus),
    cancel: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TicketManager', () => {
  let storage: MemoryStorageAdapter
  let manager: TicketManager

  beforeEach(() => {
    vi.clearAllMocks()
    storage = new MemoryStorageAdapter()
    manager = new TicketManager(createConfig({ storage }))
  })

  describe('handleMessage — question', () => {
    it('creates a ticket, answers immediately, and resolves', async () => {
      triage.mockResolvedValueOnce({
        type: 'question',
        severity: 'low',
        title: 'How do I reset my password?',
        answer: 'Go to Settings > Account > Reset Password.',
      })

      const result = await manager.handleMessage('user-1', 'How do I reset my password?')

      expect(result.triageResult.type).toBe('question')
      expect(result.immediateResponse).toBe('Go to Settings > Account > Reset Password.')

      // Ticket should be resolved
      const ticket = await storage.getTicket(result.ticket.id)
      expect(ticket?.status).toBe('resolved')
      expect(ticket?.resolvedAt).toBeInstanceOf(Date)

      // Thread should have user message + assistant answer
      const messages = await storage.getMessages(result.ticket.id)
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('user')
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].content).toBe('Go to Settings > Account > Reset Password.')
    })
  })

  describe('handleMessage — bug (no agent)', () => {
    it('creates a ticket with structured report and acknowledges', async () => {
      triage.mockResolvedValueOnce({
        type: 'bug',
        severity: 'high',
        title: 'Login page crashes on submit',
        structuredReport: {
          description: 'Clicking login causes a white screen',
          stepsToReproduce: ['Go to /login', 'Enter credentials', 'Click submit'],
          expected: 'Should redirect to dashboard',
          actual: 'White screen with console error',
        },
      })

      const result = await manager.handleMessage('user-1', 'Login page crashes')

      expect(result.triageResult.type).toBe('bug')
      expect(result.immediateResponse).toContain("I've logged this bug")
      expect(result.immediateResponse).toContain('team will look into it')

      const ticket = await storage.getTicket(result.ticket.id)
      expect(ticket?.status).toBe('open')
      expect(ticket?.structuredReport.stepsToReproduce).toHaveLength(3)
    })
  })

  describe('handleMessage — bug (with agent)', () => {
    it('dispatches agent and updates ticket status', async () => {
      const mockAgent = createMockAgent()
      const agentManager = new TicketManager(
        createConfig({ storage, agent: { adapter: mockAgent } }),
      )

      triage.mockResolvedValueOnce({
        type: 'bug',
        severity: 'medium',
        title: 'Button color wrong',
        structuredReport: { description: 'Submit button is red instead of blue' },
      })

      const result = await agentManager.handleMessage('user-1', 'Button color is wrong')

      expect(result.immediateResponse).toContain('dispatched an agent')
      expect(mockAgent.trigger).toHaveBeenCalledOnce()

      const ticket = await storage.getTicket(result.ticket.id)
      expect(ticket?.status).toBe('fixing')
      expect(ticket?.agentRunId).toBe('run-123')
    })

    it('handles agent dispatch failure gracefully', async () => {
      const failingAgent: AgentAdapter = {
        trigger: vi.fn().mockRejectedValue(new Error('GitHub API down')),
        getStatus: vi.fn(),
        cancel: vi.fn(),
      }
      const agentManager = new TicketManager(
        createConfig({ storage, agent: { adapter: failingAgent } }),
      )

      triage.mockResolvedValueOnce({
        type: 'bug',
        severity: 'high',
        title: 'App crashes',
        structuredReport: { description: 'App crashes on load' },
      })

      const result = await agentManager.handleMessage('user-1', 'App crashes')

      // Ticket should fall back to open (not stuck in investigating)
      const ticket = await storage.getTicket(result.ticket.id)
      expect(ticket?.status).toBe('open')

      // Should have system message about failure
      const messages = await storage.getMessages(result.ticket.id)
      const systemMsg = messages.find(
        (m) => m.role === 'system' && m.content.includes('Failed to dispatch'),
      )
      expect(systemMsg).toBeDefined()
    })
  })

  describe('handleMessage — feature', () => {
    it('creates a feature request ticket', async () => {
      triage.mockResolvedValueOnce({
        type: 'feature',
        severity: 'low',
        title: 'Add dark mode',
        structuredReport: { description: 'Would love a dark mode option' },
      })

      const result = await manager.handleMessage('user-1', 'Can you add dark mode?')

      expect(result.triageResult.type).toBe('feature')
      expect(result.immediateResponse).toContain('feature request')

      const ticket = await storage.getTicket(result.ticket.id)
      expect(ticket?.type).toBe('feature')
    })
  })

  describe('handleMessage — attachments', () => {
    it('extracts screenshot URLs into structured report', async () => {
      triage.mockResolvedValueOnce({
        type: 'bug',
        severity: 'medium',
        title: 'UI glitch',
        structuredReport: { description: 'Visual bug in header' },
      })

      const result = await manager.handleMessage(
        'user-1',
        'There is a UI glitch, see screenshot',
        [
          { url: 'https://example.com/screenshot.png', type: 'screenshot', name: 'screenshot.png' },
          { url: 'https://example.com/log.txt', type: 'file', name: 'log.txt' },
        ],
      )

      const ticket = await storage.getTicket(result.ticket.id)
      expect(ticket?.structuredReport.screenshotUrls).toEqual(['https://example.com/screenshot.png'])
      expect(ticket?.structuredReport.fileUrls).toEqual(['https://example.com/log.txt'])
    })
  })

  describe('handleAgentCallback', () => {
    let ticketId: string

    beforeEach(async () => {
      const ticket = await storage.createTicket({
        type: 'bug',
        severity: 'high',
        title: 'Test bug',
        structuredReport: { description: 'test' },
        userId: 'user-1',
      })
      ticketId = ticket.id
      await storage.updateTicket(ticketId, { status: 'fixing', agentRunId: 'run-1' })
    })

    it('marks ticket deployed on success with PR URL', async () => {
      await manager.handleAgentCallback(ticketId, {
        state: 'succeeded',
        prUrl: 'https://github.com/org/repo/pull/42',
      })

      const ticket = await storage.getTicket(ticketId)
      expect(ticket?.status).toBe('deployed')
      expect(ticket?.prUrl).toBe('https://github.com/org/repo/pull/42')

      const messages = await storage.getMessages(ticketId)
      expect(messages.some((m) => m.content.includes('fix has been prepared'))).toBe(true)
    })

    it('reopens ticket on failure', async () => {
      await manager.handleAgentCallback(ticketId, {
        state: 'failed',
        error: 'Could not reproduce',
      })

      const ticket = await storage.getTicket(ticketId)
      expect(ticket?.status).toBe('open')

      const messages = await storage.getMessages(ticketId)
      expect(messages.some((m) => m.content.includes('unsuccessful'))).toBe(true)
    })

    it('throws for unknown ticket', async () => {
      await expect(
        manager.handleAgentCallback('nonexistent', { state: 'failed' }),
      ).rejects.toThrow('Ticket nonexistent not found')
    })
  })

  describe('confirmResolved', () => {
    it('marks ticket resolved with timestamp', async () => {
      const ticket = await storage.createTicket({
        type: 'bug',
        severity: 'medium',
        title: 'Fixed bug',
        structuredReport: { description: 'test' },
        userId: 'user-1',
      })

      await manager.confirmResolved(ticket.id)

      const updated = await storage.getTicket(ticket.id)
      expect(updated?.status).toBe('resolved')
      expect(updated?.resolvedAt).toBeInstanceOf(Date)
    })
  })

  describe('reportStillBroken — no agent', () => {
    it('reopens ticket and adds message', async () => {
      const ticket = await storage.createTicket({
        type: 'bug',
        severity: 'medium',
        title: 'Still broken',
        structuredReport: { description: 'test' },
        userId: 'user-1',
      })
      await storage.updateTicket(ticket.id, { status: 'deployed' })

      await manager.reportStillBroken(ticket.id, 'It happens on mobile too')

      const updated = await storage.getTicket(ticket.id)
      expect(updated?.status).toBe('open')

      const messages = await storage.getMessages(ticket.id)
      expect(messages[0].content).toBe('It happens on mobile too')
      expect(messages[1].content).toContain('reopened')
    })
  })

  describe('reportStillBroken — with agent', () => {
    it('retries agent dispatch', async () => {
      const mockAgent = createMockAgent()
      const agentManager = new TicketManager(
        createConfig({ storage, agent: { adapter: mockAgent } }),
      )

      const ticket = await storage.createTicket({
        type: 'bug',
        severity: 'medium',
        title: 'Still broken',
        structuredReport: { description: 'test' },
        userId: 'user-1',
      })
      await storage.updateTicket(ticket.id, { status: 'deployed' })

      await agentManager.reportStillBroken(ticket.id)

      expect(mockAgent.trigger).toHaveBeenCalledOnce()
      const updated = await storage.getTicket(ticket.id)
      expect(updated?.status).toBe('fixing')
    })
  })

  describe('CRUD pass-throughs', () => {
    it('listTickets filters by status', async () => {
      await storage.createTicket({
        type: 'bug', severity: 'low', title: 'Open bug',
        structuredReport: { description: 'a' }, userId: 'u1',
      })
      const resolved = await storage.createTicket({
        type: 'bug', severity: 'low', title: 'Resolved bug',
        structuredReport: { description: 'b' }, userId: 'u1',
      })
      await storage.updateTicket(resolved.id, { status: 'resolved' })

      const open = await manager.listTickets({ status: 'open' })
      expect(open).toHaveLength(1)
      expect(open[0].title).toBe('Open bug')
    })

    it('addMessage and getMessages', async () => {
      const ticket = await storage.createTicket({
        type: 'question', severity: 'low', title: 'Test',
        structuredReport: { description: 'test' }, userId: 'u1',
      })

      await manager.addMessage(ticket.id, { role: 'user', content: 'Hello' })
      await manager.addMessage(ticket.id, { role: 'assistant', content: 'Hi!' })

      const msgs = await manager.getMessages(ticket.id)
      expect(msgs).toHaveLength(2)
      expect(msgs[0].content).toBe('Hello')
      expect(msgs[1].content).toBe('Hi!')
    })
  })
})
