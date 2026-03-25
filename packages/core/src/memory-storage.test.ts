import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStorageAdapter } from './memory-storage.js'
import type { NewTicket } from './types.js'

const TICKET: NewTicket = {
  type: 'bug',
  severity: 'medium',
  title: 'Test ticket',
  structuredReport: { description: 'A test bug' },
  userId: 'user-1',
  userEmail: 'user@test.com',
}

describe('MemoryStorageAdapter', () => {
  let storage: MemoryStorageAdapter

  beforeEach(() => {
    storage = new MemoryStorageAdapter()
  })

  describe('tickets', () => {
    it('creates a ticket with generated id and timestamps', async () => {
      const ticket = await storage.createTicket(TICKET)

      expect(ticket.id).toBeTruthy()
      expect(ticket.status).toBe('open')
      expect(ticket.title).toBe('Test ticket')
      expect(ticket.createdAt).toBeInstanceOf(Date)
      expect(ticket.updatedAt).toBeInstanceOf(Date)
    })

    it('getTicket returns null for missing id', async () => {
      expect(await storage.getTicket('nonexistent')).toBeNull()
    })

    it('updates ticket fields', async () => {
      const ticket = await storage.createTicket(TICKET)
      const updated = await storage.updateTicket(ticket.id, {
        status: 'fixing',
        agentRunId: 'run-1',
      })

      expect(updated.status).toBe('fixing')
      expect(updated.agentRunId).toBe('run-1')
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(ticket.updatedAt.getTime())
    })

    it('update throws for missing ticket', async () => {
      await expect(
        storage.updateTicket('bad-id', { status: 'resolved' }),
      ).rejects.toThrow('Ticket bad-id not found')
    })

    it('listTickets filters by status', async () => {
      await storage.createTicket(TICKET)
      const t2 = await storage.createTicket({ ...TICKET, title: 'Resolved' })
      await storage.updateTicket(t2.id, { status: 'resolved' })

      const open = await storage.listTickets({ status: 'open' })
      expect(open).toHaveLength(1)
      expect(open[0].title).toBe('Test ticket')
    })

    it('listTickets filters by type', async () => {
      await storage.createTicket(TICKET)
      await storage.createTicket({ ...TICKET, type: 'feature', title: 'Feature' })

      const features = await storage.listTickets({ type: 'feature' })
      expect(features).toHaveLength(1)
      expect(features[0].type).toBe('feature')
    })

    it('listTickets filters by userId', async () => {
      await storage.createTicket(TICKET)
      await storage.createTicket({ ...TICKET, userId: 'user-2', title: 'Other user' })

      const mine = await storage.listTickets({ userId: 'user-1' })
      expect(mine).toHaveLength(1)
    })

    it('listTickets respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.createTicket({ ...TICKET, title: `Ticket ${i}` })
      }

      const page = await storage.listTickets({ limit: 2, offset: 1 })
      expect(page).toHaveLength(2)
    })

    it('listTickets returns newest first', async () => {
      const t1 = await storage.createTicket({ ...TICKET, title: 'First' })
      // Ensure different timestamp
      await new Promise((r) => setTimeout(r, 5))
      const t2 = await storage.createTicket({ ...TICKET, title: 'Second' })

      const list = await storage.listTickets({})
      expect(list[0].id).toBe(t2.id)
      expect(list[1].id).toBe(t1.id)
    })
  })

  describe('messages', () => {
    it('saves and retrieves messages in order', async () => {
      const ticket = await storage.createTicket(TICKET)

      await storage.saveMessage(ticket.id, { role: 'user', content: 'Hello' })
      await storage.saveMessage(ticket.id, { role: 'assistant', content: 'Hi!' })

      const msgs = await storage.getMessages(ticket.id)
      expect(msgs).toHaveLength(2)
      expect(msgs[0].role).toBe('user')
      expect(msgs[1].role).toBe('assistant')
      expect(msgs[0].ticketId).toBe(ticket.id)
    })

    it('returns empty array for unknown ticket', async () => {
      const msgs = await storage.getMessages('no-ticket')
      expect(msgs).toEqual([])
    })

    it('stores attachments', async () => {
      const ticket = await storage.createTicket(TICKET)
      const msg = await storage.saveMessage(ticket.id, {
        role: 'user',
        content: 'See attached',
        attachments: [{ url: 'https://x.com/img.png', type: 'screenshot', name: 'img.png' }],
      })

      expect(msg.attachments).toHaveLength(1)
      expect(msg.attachments![0].name).toBe('img.png')
    })
  })

  describe('uploadAttachment', () => {
    it('returns a memory:// URL', async () => {
      const result = await storage.uploadAttachment(new Blob(['test']), 'test.txt')
      expect(result.url).toMatch(/^memory:\/\/attachments\//)
      expect(result.url).toContain('test.txt')
    })
  })

  describe('clear', () => {
    it('resets all state', async () => {
      await storage.createTicket(TICKET)
      storage.clear()

      const list = await storage.listTickets({})
      expect(list).toHaveLength(0)
    })
  })
})
