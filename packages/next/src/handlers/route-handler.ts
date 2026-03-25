// ---------------------------------------------------------------------------
// Bugloop Next.js Route Handler
// ---------------------------------------------------------------------------
// Creates a catch-all route handler for the Bugloop API.
//
// Usage in app/api/support/[...bugloop]/route.ts:
//
//   import { createHandler } from '@bugloop/next'
//   export const { GET, POST } = createHandler({ ... })
// ---------------------------------------------------------------------------

import { TicketManager } from '@bugloop/core'
import type { BugloopConfig } from '@bugloop/core'
import { NextResponse } from 'next/server'

async function verifyHmac(
  body: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false
  const prefix = 'sha256='
  if (!signature.startsWith(prefix)) return false
  const sig = signature.slice(prefix.length)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return sig === expected
}

export type BugloopHandlerConfig = BugloopConfig

/**
 * Creates Next.js App Router route handlers for all Bugloop endpoints.
 *
 * Routes (relative to the catch-all mount point):
 *   POST /            — submit a new support message (triage + create ticket)
 *   GET  /tickets     — list tickets for the current user
 *   GET  /tickets/:id — get a single ticket with messages
 *   POST /tickets/:id/resolve   — user confirms fix
 *   POST /tickets/:id/reopen    — user reports still broken
 *   POST /tickets/:id/messages  — add a follow-up message
 *   POST /callback              — agent callback (webhook)
 */
export function createHandler(config: BugloopHandlerConfig) {
  const manager = new TicketManager(config)
  const basePath = config.basePath ?? '/api/support'

  function parsePath(url: string): string[] {
    const u = new URL(url)
    const rel = u.pathname.replace(basePath, '').replace(/^\/+/, '')
    return rel ? rel.split('/') : []
  }

  async function authenticate(request: Request) {
    const user = await config.auth.getUser(request)
    if (!user) {
      throw new Error('Unauthorized')
    }
    return user
  }

  // -------------------------------------------------------------------------
  // GET handler
  // -------------------------------------------------------------------------

  async function GET(request: Request) {
    try {
      const user = await authenticate(request)
      const segments = parsePath(request.url)

      // GET /tickets
      if (segments[0] === 'tickets' && !segments[1]) {
        const url = new URL(request.url)
        const status = url.searchParams.get('status')
        const type = url.searchParams.get('type')
        const limit = url.searchParams.get('limit')

        const tickets = await manager.listTickets({
          userId: user.id,
          status: status as Parameters<typeof manager.listTickets>[0]['status'],
          type: type as Parameters<typeof manager.listTickets>[0]['type'],
          limit: limit ? parseInt(limit, 10) : 20,
        })

        return NextResponse.json({ tickets })
      }

      // GET /tickets/:id
      if (segments[0] === 'tickets' && segments[1]) {
        const ticket = await manager.getTicket(segments[1])
        if (!ticket || ticket.userId !== user.id) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 })
        }

        const messages = await manager.getMessages(segments[1])
        return NextResponse.json({ ticket, messages })
      }

      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    } catch (err) {
      if (err instanceof Error && err.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Internal error' },
        { status: 500 },
      )
    }
  }

  // -------------------------------------------------------------------------
  // POST handler
  // -------------------------------------------------------------------------

  async function POST(request: Request) {
    try {
      const segments = parsePath(request.url)

      // POST /callback — agent webhook (no user auth, verified by HMAC)
      if (segments[0] === 'callback') {
        const rawBody = await request.text()

        // Verify HMAC signature if a callback secret is configured
        if (config.callbackSecret) {
          const signature = request.headers.get('x-bugloop-signature')
          const valid = await verifyHmac(rawBody, signature, config.callbackSecret)
          if (!valid) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
          }
        }

        const body = JSON.parse(rawBody) as {
          ticket_id: string
          state: 'succeeded' | 'failed'
          pr_url?: string
          error?: string
        }

        await manager.handleAgentCallback(body.ticket_id, {
          state: body.state === 'succeeded' ? 'succeeded' : 'failed',
          prUrl: body.pr_url,
          error: body.error,
        })

        return NextResponse.json({ ok: true })
      }

      // All other POST routes require auth
      const user = await authenticate(request)

      // POST /upload — upload a file attachment
      if (segments[0] === 'upload') {
        const formData = await request.formData()
        const file = formData.get('file') as File | null
        if (!file) {
          return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        }
        const result = await config.storage.uploadAttachment(file, file.name)
        return NextResponse.json(result)
      }

      // POST / — submit a new support message
      if (segments.length === 0) {
        const body = (await request.json()) as {
          message: string
          attachments?: Array<{ url: string; type: string; name: string }>
        }

        if (!body.message?.trim()) {
          return NextResponse.json(
            { error: 'Message is required' },
            { status: 400 },
          )
        }

        const result = await manager.handleMessage(
          user.id,
          body.message,
          body.attachments?.map((a) => ({
            url: a.url,
            type: a.type as 'image' | 'file' | 'screenshot',
            name: a.name,
          })),
          user.email,
        )

        return NextResponse.json({
          ticket: result.ticket,
          response: result.immediateResponse,
          triageType: result.triageResult.type,
        })
      }

      // POST /tickets/:id/resolve
      if (segments[0] === 'tickets' && segments[2] === 'resolve') {
        await manager.confirmResolved(segments[1])
        return NextResponse.json({ ok: true })
      }

      // POST /tickets/:id/reopen
      if (segments[0] === 'tickets' && segments[2] === 'reopen') {
        const body = (await request.json()) as { context?: string }
        await manager.reportStillBroken(segments[1], body.context)
        return NextResponse.json({ ok: true })
      }

      // POST /tickets/:id/messages
      if (segments[0] === 'tickets' && segments[2] === 'messages') {
        const body = (await request.json()) as {
          content: string
          attachments?: Array<{ url: string; type: string; name: string }>
        }

        const message = await manager.addMessage(segments[1], {
          role: 'user',
          content: body.content,
          attachments: body.attachments?.map((a) => ({
            url: a.url,
            type: a.type as 'image' | 'file' | 'screenshot',
            name: a.name,
          })),
        })

        return NextResponse.json({ message })
      }

      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    } catch (err) {
      if (err instanceof Error && err.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Internal error' },
        { status: 500 },
      )
    }
  }

  return { GET, POST }
}
