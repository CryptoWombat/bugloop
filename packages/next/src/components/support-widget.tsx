'use client'

import React, { useState, useRef, useCallback, type FormEvent } from 'react'
import { useBugloop } from './use-bugloop.js'
import type { SupportMessage, Ticket } from '@bugloop/core'

// ---------------------------------------------------------------------------
// SupportWidget — floating chat bubble for reporting issues
// ---------------------------------------------------------------------------

export interface SupportWidgetProps {
  /** Where to anchor the widget (default: 'bottom-right') */
  position?: 'bottom-right' | 'bottom-left'
  /** API base path (default: '/api/support') */
  basePath?: string
  /** App name shown in the widget header */
  appName?: string
  /** Primary brand color (CSS value) */
  accentColor?: string
  /** Custom CSS class for the container */
  className?: string
}

type WidgetView = 'closed' | 'chat' | 'tickets'

interface ChatState {
  ticket: Ticket | null
  messages: SupportMessage[]
  response: string | null
}

export function SupportWidget({
  position = 'bottom-right',
  basePath,
  appName = 'Support',
  accentColor = '#2563eb',
  className,
}: SupportWidgetProps) {
  const [view, setView] = useState<WidgetView>('closed')
  const [input, setInput] = useState('')
  const [chat, setChat] = useState<ChatState>({ ticket: null, messages: [], response: null })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { submit, loading, error } = useBugloop({ basePath })

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const message = input.trim()
      if (!message || loading) return

      setInput('')
      setChat((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: `tmp-${Date.now()}`,
            ticketId: '',
            role: 'user' as const,
            content: message,
            createdAt: new Date(),
          },
        ],
      }))

      try {
        const result = await submit(message)
        setChat((prev) => ({
          ticket: result.ticket,
          messages: [
            ...prev.messages,
            ...(result.response
              ? [
                  {
                    id: `resp-${Date.now()}`,
                    ticketId: result.ticket.id,
                    role: 'assistant' as const,
                    content: result.response,
                    createdAt: new Date(),
                  },
                ]
              : []),
          ],
          response: result.response ?? null,
        }))
      } catch {
        // error is captured in the hook
      }
    },
    [input, loading, submit],
  )

  const handleNewChat = useCallback(() => {
    setChat({ ticket: null, messages: [], response: null })
  }, [])

  if (view === 'closed') {
    return (
      <button
        onClick={() => setView('chat')}
        className={className}
        aria-label="Open support"
        style={{
          position: 'fixed',
          [position === 'bottom-right' ? 'right' : 'left']: '1.5rem',
          bottom: '1.5rem',
          width: '3.5rem',
          height: '3.5rem',
          borderRadius: '50%',
          backgroundColor: accentColor,
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
        }}
      >
        ?
      </button>
    )
  }

  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        [position === 'bottom-right' ? 'right' : 'left']: '1.5rem',
        bottom: '1.5rem',
        width: '24rem',
        maxHeight: '36rem',
        borderRadius: '0.75rem',
        backgroundColor: '#fff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '1rem',
          backgroundColor: accentColor,
          color: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ fontWeight: 600 }}>{appName}</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {chat.ticket && (
            <button
              onClick={handleNewChat}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: '#fff',
                padding: '0.25rem 0.5rem',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontSize: '0.75rem',
              }}
            >
              New
            </button>
          )}
          <button
            onClick={() => setView('closed')}
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '1.25rem',
              lineHeight: 1,
            }}
          >
            x
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          minHeight: '12rem',
        }}
      >
        {chat.messages.length === 0 && (
          <p style={{ color: '#6b7280', fontSize: '0.875rem', textAlign: 'center', marginTop: '2rem' }}>
            Describe your issue, ask a question, or share a screenshot.
          </p>
        )}

        {chat.messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.role === 'user' ? accentColor : '#f3f4f6',
              color: msg.role === 'user' ? '#fff' : '#111827',
              padding: '0.625rem 0.875rem',
              borderRadius: '0.75rem',
              maxWidth: '85%',
              fontSize: '0.875rem',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {msg.content}
          </div>
        ))}

        {loading && (
          <div
            style={{
              alignSelf: 'flex-start',
              color: '#9ca3af',
              fontSize: '0.875rem',
              fontStyle: 'italic',
            }}
          >
            Analyzing...
          </div>
        )}

        {error && (
          <div
            style={{
              alignSelf: 'center',
              color: '#ef4444',
              fontSize: '0.75rem',
              backgroundColor: '#fef2f2',
              padding: '0.5rem 0.75rem',
              borderRadius: '0.5rem',
            }}
          >
            {error}
          </div>
        )}

        {chat.ticket && chat.ticket.status !== 'resolved' && (
          <div
            style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '0.5rem',
              padding: '0.625rem',
              fontSize: '0.75rem',
              color: '#166534',
            }}
          >
            Ticket #{chat.ticket.id.slice(0, 8)} — {chat.ticket.status}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '0.75rem',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          gap: '0.5rem',
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
          placeholder="Describe your issue..."
          rows={1}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.5rem',
            resize: 'none',
            fontSize: '0.875rem',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: loading || !input.trim() ? '#9ca3af' : accentColor,
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: loading || !input.trim() ? 'default' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}
