'use client'

import React, { useState, useRef, useCallback, type FormEvent, type DragEvent } from 'react'
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
  /** Max file size in bytes (default: 10MB) */
  maxFileSize?: number
  /** Accepted file types (default: images + common docs) */
  acceptedTypes?: string
}

type WidgetView = 'closed' | 'chat' | 'tickets'

interface ChatState {
  ticket: Ticket | null
  messages: SupportMessage[]
  response: string | null
}

interface PendingFile {
  file: File
  preview: string | null
  id: string
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const DEFAULT_ACCEPTED_TYPES = 'image/*,.pdf,.txt,.log,.json,.csv'

export function SupportWidget({
  position = 'bottom-right',
  basePath,
  appName = 'Support',
  accentColor = '#2563eb',
  className,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  acceptedTypes = DEFAULT_ACCEPTED_TYPES,
}: SupportWidgetProps) {
  const [view, setView] = useState<WidgetView>('closed')
  const [input, setInput] = useState('')
  const [chat, setChat] = useState<ChatState>({ ticket: null, messages: [], response: null })
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { submit, uploadFile, loading, error } = useBugloop({ basePath })

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const newFiles: PendingFile[] = []
      for (const file of Array.from(files)) {
        if (file.size > maxFileSize) {
          continue // silently skip oversized files
        }
        const pf: PendingFile = {
          file,
          preview: null,
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }
        if (file.type.startsWith('image/')) {
          pf.preview = URL.createObjectURL(file)
        }
        newFiles.push(pf)
      }
      setPendingFiles((prev) => [...prev, ...newFiles])
    },
    [maxFileSize],
  )

  const removeFile = useCallback((id: string) => {
    setPendingFiles((prev) => {
      const removed = prev.find((f) => f.id === id)
      if (removed?.preview) URL.revokeObjectURL(removed.preview)
      return prev.filter((f) => f.id !== id)
    })
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      const files: File[] = []
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) {
        addFiles(files)
      }
    },
    [addFiles],
  )

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const message = input.trim()
      if ((!message && pendingFiles.length === 0) || loading || uploading) return

      setInput('')
      const filesToUpload = [...pendingFiles]
      setPendingFiles([])

      // Show user message immediately
      setChat((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: `tmp-${Date.now()}`,
            ticketId: '',
            role: 'user' as const,
            content: message || `[${filesToUpload.length} file(s) attached]`,
            createdAt: new Date(),
          },
        ],
      }))

      try {
        // Upload files first
        let attachments: Array<{ url: string; type: 'image' | 'file' | 'screenshot'; name: string }> = []
        if (filesToUpload.length > 0) {
          setUploading(true)
          attachments = await Promise.all(filesToUpload.map((pf) => uploadFile(pf.file)))
          setUploading(false)
        }

        // Clean up previews
        for (const pf of filesToUpload) {
          if (pf.preview) URL.revokeObjectURL(pf.preview)
        }

        const result = await submit(
          message || `User attached ${filesToUpload.length} file(s)`,
          attachments.length > 0 ? attachments : undefined,
        )
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
        setUploading(false)
        // error is captured in the hook
      }
    },
    [input, loading, uploading, pendingFiles, submit, uploadFile],
  )

  const handleNewChat = useCallback(() => {
    // Clean up any pending file previews
    for (const pf of pendingFiles) {
      if (pf.preview) URL.revokeObjectURL(pf.preview)
    }
    setPendingFiles([])
    setChat({ ticket: null, messages: [], response: null })
  }, [pendingFiles])

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

      {/* Messages area — drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          minHeight: '12rem',
          position: 'relative',
          transition: 'background-color 0.15s',
          backgroundColor: dragOver ? '#eff6ff' : 'transparent',
        }}
      >
        {/* Drag overlay */}
        {dragOver && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(37, 99, 235, 0.08)',
              border: '2px dashed #2563eb',
              borderRadius: '0.5rem',
              margin: '0.5rem',
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            <span style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.875rem' }}>
              Drop files here
            </span>
          </div>
        )}

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
            {msg.attachments && msg.attachments.length > 0 && (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                {msg.attachments.map((a, i) => (
                  <a
                    key={i}
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: '0.7rem',
                      color: msg.role === 'user' ? 'rgba(255,255,255,0.8)' : '#2563eb',
                      textDecoration: 'underline',
                    }}
                  >
                    {a.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}

        {(loading || uploading) && (
          <div
            style={{
              alignSelf: 'flex-start',
              color: '#9ca3af',
              fontSize: '0.875rem',
              fontStyle: 'italic',
            }}
          >
            {uploading ? 'Uploading files...' : 'Analyzing...'}
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

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div
          style={{
            padding: '0.5rem 0.75rem',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
            backgroundColor: '#f9fafb',
          }}
        >
          {pendingFiles.map((pf) => (
            <div
              key={pf.id}
              style={{
                position: 'relative',
                borderRadius: '0.375rem',
                overflow: 'hidden',
                border: '1px solid #d1d5db',
                backgroundColor: '#fff',
              }}
            >
              {pf.preview ? (
                <img
                  src={pf.preview}
                  alt={pf.file.name}
                  style={{
                    width: '3.5rem',
                    height: '3.5rem',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '3.5rem',
                    height: '3.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.6rem',
                    color: '#6b7280',
                    textAlign: 'center',
                    padding: '0.125rem',
                    wordBreak: 'break-all',
                  }}
                >
                  {pf.file.name.length > 12 ? pf.file.name.slice(0, 10) + '...' : pf.file.name}
                </div>
              )}
              <button
                onClick={() => removeFile(pf.id)}
                style={{
                  position: 'absolute',
                  top: '-0.125rem',
                  right: '-0.125rem',
                  width: '1rem',
                  height: '1rem',
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.625rem',
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '0.75rem',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'flex-end',
        }}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedTypes}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(e.target.files)
              e.target.value = '' // reset so same file can be re-selected
            }
          }}
        />

        {/* Attach button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file or screenshot"
          style={{
            background: 'none',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            padding: '0.4rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6b7280',
            flexShrink: 0,
          }}
        >
          {/* Paperclip SVG */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

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
          onPaste={handlePaste}
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
          disabled={loading || uploading || (!input.trim() && pendingFiles.length === 0)}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor:
              loading || uploading || (!input.trim() && pendingFiles.length === 0) ? '#9ca3af' : accentColor,
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            cursor:
              loading || uploading || (!input.trim() && pendingFiles.length === 0) ? 'default' : 'pointer',
            fontSize: '0.875rem',
            fontWeight: 500,
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}
