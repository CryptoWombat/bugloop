export { createHandler } from './handlers/route-handler.js'
export type { BugloopHandlerConfig } from './handlers/route-handler.js'

// Re-export components from main entry for bundlers that don't support subpath exports
export { SupportWidget } from './components/support-widget.js'
export { SupportPanel } from './components/support-panel.js'
export { TicketList } from './components/ticket-list.js'
export { useBugloop } from './components/use-bugloop.js'
