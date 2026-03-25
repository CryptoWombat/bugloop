'use client'

import { useCallback, useState } from 'react'
import type { SupportMessage, Ticket } from '@bugloop/core'

// ---------------------------------------------------------------------------
// useBugloop — React hook for interacting with the Bugloop API
// ---------------------------------------------------------------------------

export interface UseBugloopOptions {
  /** Base path where the Bugloop API is mounted (default: '/api/support') */
  basePath?: string
}

export interface UseBugloopReturn {
  /** Submit a new support message (creates a ticket) */
  submit: (message: string, attachments?: AttachmentInput[]) => Promise<SubmitResult>
  /** Upload a file and get back its URL */
  uploadFile: (file: File) => Promise<AttachmentInput>
  /** List the current user's tickets */
  listTickets: (filter?: { status?: string; type?: string }) => Promise<Ticket[]>
  /** Get a ticket with its messages */
  getTicket: (id: string) => Promise<{ ticket: Ticket; messages: SupportMessage[] }>
  /** Confirm a ticket is resolved */
  resolve: (ticketId: string) => Promise<void>
  /** Reopen a ticket with additional context */
  reopen: (ticketId: string, context?: string) => Promise<void>
  /** Add a follow-up message to a ticket */
  addMessage: (ticketId: string, content: string) => Promise<SupportMessage>

  /** Current loading state */
  loading: boolean
  /** Last error */
  error: string | null
}

interface AttachmentInput {
  url: string
  type: 'image' | 'file' | 'screenshot'
  name: string
}

interface SubmitResult {
  ticket: Ticket
  response?: string
  triageType: string
}

export function useBugloop(options?: UseBugloopOptions): UseBugloopReturn {
  const basePath = options?.basePath ?? '/api/support'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const api = useCallback(
    async <T>(path: string, init?: RequestInit): Promise<T> => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${basePath}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...init?.headers,
          },
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(body.error ?? `Request failed: ${res.status}`)
        }
        return (await res.json()) as T
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(msg)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [basePath],
  )

  const submit = useCallback(
    (message: string, attachments?: AttachmentInput[]) =>
      api<SubmitResult>('/', {
        method: 'POST',
        body: JSON.stringify({ message, attachments }),
      }),
    [api],
  )

  const uploadFile = useCallback(
    async (file: File): Promise<AttachmentInput> => {
      setLoading(true)
      setError(null)
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`${basePath}/upload`, {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }))
          throw new Error(body.error ?? `Upload failed: ${res.status}`)
        }
        const data = await res.json()
        const isImage = file.type.startsWith('image/')
        return {
          url: data.url,
          type: isImage ? 'screenshot' : 'file',
          name: file.name,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed'
        setError(msg)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [basePath],
  )

  const listTickets = useCallback(
    async (filter?: { status?: string; type?: string }) => {
      const params = new URLSearchParams()
      if (filter?.status) params.set('status', filter.status)
      if (filter?.type) params.set('type', filter.type)
      const qs = params.toString()
      const result = await api<{ tickets: Ticket[] }>(`/tickets${qs ? `?${qs}` : ''}`)
      return result.tickets
    },
    [api],
  )

  const getTicket = useCallback(
    (id: string) =>
      api<{ ticket: Ticket; messages: SupportMessage[] }>(`/tickets/${id}`),
    [api],
  )

  const resolve = useCallback(
    async (ticketId: string) => {
      await api(`/tickets/${ticketId}/resolve`, { method: 'POST', body: '{}' })
    },
    [api],
  )

  const reopen = useCallback(
    async (ticketId: string, context?: string) => {
      await api(`/tickets/${ticketId}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ context }),
      })
    },
    [api],
  )

  const addMessage = useCallback(
    (ticketId: string, content: string) =>
      api<{ message: SupportMessage }>(`/tickets/${ticketId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }).then((r) => r.message),
    [api],
  )

  return {
    submit,
    uploadFile,
    listTickets,
    getTicket,
    resolve,
    reopen,
    addMessage,
    loading,
    error,
  }
}
