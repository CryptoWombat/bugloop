// ---------------------------------------------------------------------------
// Bugloop GitHub Actions Agent Adapter
// ---------------------------------------------------------------------------
// Triggers a GitHub Actions workflow to run a coding agent (e.g. Claude Code)
// that attempts to fix the reported bug in an isolated branch.
// ---------------------------------------------------------------------------

import type { AgentAdapter, AgentRunStatus, Ticket } from '@bugloop/core'

export interface GitHubAgentOptions {
  /** GitHub personal access token with `actions:write` + `contents:read` scope */
  token: string
  /** Repository owner */
  owner: string
  /** Repository name */
  repo: string
  /** Workflow file name (default: 'bugloop-autofix.yml') */
  workflowFile?: string
  /** Git ref to trigger on (default: 'main') */
  ref?: string
  /** Callback URL the workflow should POST results to */
  callbackUrl: string
}

export class GitHubAgentAdapter implements AgentAdapter {
  private token: string
  private owner: string
  private repo: string
  private workflowFile: string
  private ref: string
  private callbackUrl: string

  constructor(options: GitHubAgentOptions) {
    this.token = options.token
    this.owner = options.owner
    this.repo = options.repo
    this.workflowFile = options.workflowFile ?? 'bugloop-autofix.yml'
    this.ref = options.ref ?? 'main'
    this.callbackUrl = options.callbackUrl
  }

  async trigger(ticket: Ticket): Promise<{ runId: string }> {
    // Sanitize the structured report — strip raw user input before passing
    // to the agent to reduce prompt injection surface
    const sanitizedReport = {
      title: ticket.title,
      type: ticket.type,
      severity: ticket.severity,
      description: ticket.structuredReport.description,
      stepsToReproduce: ticket.structuredReport.stepsToReproduce,
      expected: ticket.structuredReport.expected,
      actual: ticket.structuredReport.actual,
      // Deliberately omit rawInput — agent shouldn't see it
    }

    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/actions/workflows/${this.workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: this.ref,
          inputs: {
            ticket_id: ticket.id,
            report: JSON.stringify(sanitizedReport),
            callback_url: this.callbackUrl,
          },
        }),
      },
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`GitHub dispatch failed (${response.status}): ${body}`)
    }

    // workflow_dispatch doesn't return a run ID directly — we generate a
    // tracking ID from the ticket and let the callback correlate by ticket_id
    const runId = `gh-${ticket.id}-${Date.now()}`
    return { runId }
  }

  async getStatus(runId: string): Promise<AgentRunStatus> {
    // For workflow_dispatch, we can list recent runs and match
    // In practice, the callback mechanism is more reliable
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/actions/runs?per_page=5`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    )

    if (!response.ok) {
      return {
        runId,
        state: 'queued',
        updatedAt: new Date(),
      }
    }

    const data = (await response.json()) as {
      workflow_runs: Array<{
        id: number
        status: string
        conclusion: string | null
        updated_at: string
      }>
    }

    // Best-effort match — in production, use the callback instead
    const latestRun = data.workflow_runs[0]
    if (!latestRun) {
      return { runId, state: 'queued', updatedAt: new Date() }
    }

    const state = mapGitHubStatus(latestRun.status, latestRun.conclusion)

    return {
      runId,
      state,
      updatedAt: new Date(latestRun.updated_at),
    }
  }

  async cancel(runId: string): Promise<void> {
    // Extract GitHub run ID if available — otherwise no-op
    // In practice, cancellation would come via the callback
    void runId
  }
}

function mapGitHubStatus(
  status: string,
  conclusion: string | null,
): AgentRunStatus['state'] {
  if (status === 'queued' || status === 'waiting') return 'queued'
  if (status === 'in_progress') return 'running'
  if (status === 'completed') {
    if (conclusion === 'success') return 'succeeded'
    if (conclusion === 'cancelled') return 'cancelled'
    return 'failed'
  }
  return 'queued'
}

// ---------------------------------------------------------------------------
// Reusable workflow template (host copies this to .github/workflows/)
// ---------------------------------------------------------------------------

export const WORKFLOW_TEMPLATE = `# .github/workflows/bugloop-autofix.yml
# Bugloop auto-fix workflow — triggered by the Bugloop SDK when a bug is reported.
# Requires: ANTHROPIC_API_KEY secret in the repository.

name: Bugloop Autofix

on:
  workflow_dispatch:
    inputs:
      ticket_id:
        description: Bugloop ticket ID
        required: true
      report:
        description: Structured bug report (JSON)
        required: true
      callback_url:
        description: URL to POST results to
        required: true

jobs:
  autofix:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Attempt fix with Claude Code
        uses: anthropics/claude-code-action@v1
        with:
          prompt: |
            A user reported a bug. Here is the structured report:

            \${{ inputs.report }}

            Investigate this bug in the codebase. If you can identify the cause
            and write a fix:
            1. Create a new branch named bugloop/fix-\${{ inputs.ticket_id }}
            2. Make the fix
            3. Run existing tests to verify
            4. Create a pull request

            If you cannot fix it, explain why in your response.
          max_turns: 20
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}

      - name: Report result
        if: always()
        run: |
          STATUS=\${{ job.status }}
          PR_URL=$(gh pr list --head "bugloop/fix-\${{ inputs.ticket_id }}" --json url --jq '.[0].url' 2>/dev/null || echo "")
          curl -s -X POST "\${{ inputs.callback_url }}" \\
            -H "Content-Type: application/json" \\
            -d "{\\"ticket_id\\":\\"\${{ inputs.ticket_id }}\\",\\"state\\":\\"$STATUS\\",\\"pr_url\\":\\"$PR_URL\\"}"
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`
