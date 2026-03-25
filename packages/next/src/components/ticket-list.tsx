'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useBugloop } from './use-bugloop.js'
import type { Ticket } from '@bugloop/core'

// ---------------------------------------------------------------------------
// TicketList — displays the current user's support tickets
// ---------------------------------------------------------------------------

export interface TicketListProps {
  /** API base path (default: '/api/support') */
  basePath?: string
  /** Called when a ticket is clicked */
  onSelect?: (ticket: Ticket) => void
  /** Primary brand color */
  accentColor?: string
}

export function TicketList({ basePath, onSelect, accentColor = '#2563eb' }: TicketListProps) {
  const { listTickets, loading, error } = useBugloop({ basePath })
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')

  const load = useCallback(async () => {
    const status = filter === 'all' ? undefined : filter
    const result = await listTickets({ status })
    setTickets(result)
  }, [filter, listTickets])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  const statusColor: Record<string, string> = {
    open: '#2563eb',
    triaging: '#7c3aed',
    answering: '#7c3aed',
    investigating: '#ca8a04',
    fixing: '#ea580c',
    deployed: '#16a34a',
    resolved: '#6b7280',
    wont_fix: '#6b7280',
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
        {(['all', 'open', 'resolved'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '0.375rem 0.75rem',
              border: 'none',
              borderRadius: '0.375rem',
              backgroundColor: filter === f ? accentColor : '#f3f4f6',
              color: filter === f ? '#fff' : '#374151',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</p>}

      {!loading && tickets.length === 0 && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No tickets found.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            onClick={() => onSelect?.(ticket)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect?.(ticket)}
            style={{
              padding: '0.875rem',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              cursor: onSelect ? 'pointer' : 'default',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              transition: 'background-color 0.15s',
            }}
          >
            <div>
              <div style={{ fontWeight: 500, fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                {ticket.title}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                {ticket.type} &middot; {new Date(ticket.createdAt).toLocaleDateString()}
              </div>
            </div>
            <span
              style={{
                display: 'inline-block',
                padding: '0.125rem 0.5rem',
                borderRadius: '9999px',
                fontSize: '0.6875rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                backgroundColor: statusColor[ticket.status] ?? '#6b7280',
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {ticket.status.replace('_', ' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
