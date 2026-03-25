'use client'

import React, { useEffect, useState, useCallback, type FormEvent } from 'react'
import { useBugloop } from './use-bugloop.js'
import type { SupportMessage, Ticket } from '@bugloop/core'

// ---------------------------------------------------------------------------
// SupportPanel — full-page support view (ticket detail + chat thread)
// ---------------------------------------------------------------------------

export interface SupportPanelProps {
  /** Ticket ID to display */
  ticketId: string
  /** API base path (default: '/api/support') */
  basePath?: string
  /** Primary brand color */
  accentColor?: string
}

export function SupportPanel({
  ticketId,
  basePath,
  accentColor = '#2563eb',
}: SupportPanelProps) {
  const { getTicket, resolve, reopen, addMessage, loading, error } = useBugloop({ basePath })
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [input, setInput] = useState('')

  useEffect(() => {
    getTicket(ticketId).then(({ ticket: t, messages: msgs }) => {
      setTicket(t)
      setMessages(msgs)
    }).catch(() => {})
  }, [ticketId, getTicket])

  const handleSend = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!input.trim() || loading) return
      const content = input.trim()
      setInput('')

      const msg = await addMessage(ticketId, content)
      setMessages((prev) => [...prev, msg])
    },
    [ticketId, input, loading, addMessage],
  )

  const handleResolve = useCallback(async () => {
    await resolve(ticketId)
    setTicket((prev) => (prev ? { ...prev, status: 'resolved' } : prev))
  }, [ticketId, resolve])

  const handleReopen = useCallback(async () => {
    await reopen(ticketId, 'Issue still occurring')
    setTicket((prev) => (prev ? { ...prev, status: 'open' } : prev))
  }, [ticketId, reopen])

  if (!ticket) {
    return <div style={{ padding: '2rem', color: '#6b7280' }}>Loading ticket...</div>
  }

  const severityColor: Record<string, string> = {
    critical: '#dc2626',
    high: '#ea580c',
    medium: '#ca8a04',
    low: '#16a34a',
  }

  return (
    <div style={{ maxWidth: '48rem', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* Ticket header */}
      <div style={{ padding: '1.5rem 0', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '0.125rem 0.5rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              backgroundColor: severityColor[ticket.severity] ?? '#6b7280',
              color: '#fff',
            }}
          >
            {ticket.severity}
          </span>
          <span
            style={{
              display: 'inline-block',
              padding: '0.125rem 0.5rem',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 500,
              border: '1px solid #d1d5db',
              color: '#374151',
            }}
          >
            {ticket.type}
          </span>
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            #{ticket.id.slice(0, 8)}
          </span>
        </div>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{ticket.title}</h2>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem', color: '#6b7280' }}>
          Status: <strong>{ticket.status}</strong>
          {ticket.prUrl && (
            <>
              {' — '}
              <a href={ticket.prUrl} target="_blank" rel="noreferrer" style={{ color: accentColor }}>
                View PR
              </a>
            </>
          )}
        </p>
      </div>

      {/* Messages */}
      <div style={{ padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <span style={{ fontSize: '0.625rem', color: '#9ca3af', marginBottom: '0.25rem', textTransform: 'uppercase' }}>
              {msg.role === 'system' ? 'system' : msg.role === 'user' ? 'you' : 'bugloop'}
            </span>
            <div
              style={{
                backgroundColor:
                  msg.role === 'user' ? accentColor : msg.role === 'system' ? '#fef3c7' : '#f3f4f6',
                color: msg.role === 'user' ? '#fff' : '#111827',
                padding: '0.625rem 0.875rem',
                borderRadius: '0.75rem',
                maxWidth: '80%',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: '0.875rem', padding: '0.5rem 0' }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 0' }}>
        {ticket.status === 'deployed' && (
          <>
            <button
              onClick={handleResolve}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#16a34a',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Confirm fixed
            </button>
            <button
              onClick={handleReopen}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Still broken
            </button>
          </>
        )}
      </div>

      {/* Follow-up input */}
      {ticket.status !== 'resolved' && (
        <form
          onSubmit={handleSend}
          style={{
            display: 'flex',
            gap: '0.5rem',
            padding: '0.75rem 0',
            borderTop: '1px solid #e5e7eb',
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add more context..."
            style={{
              flex: 1,
              padding: '0.5rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: loading ? '#9ca3af' : accentColor,
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: loading ? 'default' : 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Send
          </button>
        </form>
      )}
    </div>
  )
}
