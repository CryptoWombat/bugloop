import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { triage } from './triage.js'
import type { AIProviderConfig, ProjectContext } from './types.js'

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT: ProjectContext = {
  name: 'TestApp',
  description: 'A test application for unit testing',
}

function anthropicConfig(model?: string): AIProviderConfig {
  return { provider: 'anthropic', apiKey: 'sk-test', model }
}

function openaiConfig(model?: string): AIProviderConfig {
  return { provider: 'openai', apiKey: 'sk-test', model }
}

function googleConfig(model?: string): AIProviderConfig {
  return { provider: 'google', apiKey: 'test-key', model }
}

function mockAnthropicResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ text }] }),
    text: async () => text,
  }
}

function mockOpenAIResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
    text: async () => text,
  }
}

function mockGoogleResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    text: async () => text,
  }
}

const VALID_BUG_JSON = JSON.stringify({
  type: 'bug',
  severity: 'high',
  title: 'Login page crashes',
  structuredReport: {
    description: 'Clicking login causes a white screen',
    stepsToReproduce: ['Go to /login', 'Click submit'],
    expected: 'Should redirect',
    actual: 'White screen',
  },
})

const VALID_QUESTION_JSON = JSON.stringify({
  type: 'question',
  severity: 'low',
  title: 'How to reset password',
  answer: 'Go to Settings > Reset.',
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triage', () => {
  describe('Anthropic provider', () => {
    it('classifies a bug report', async () => {
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse(VALID_BUG_JSON))

      const result = await triage(
        { text: 'Login page crashes when I click submit' },
        PROJECT,
        anthropicConfig(),
      )

      expect(result.type).toBe('bug')
      expect(result.severity).toBe('high')
      expect(result.title).toBe('Login page crashes')
      expect(result.structuredReport?.stepsToReproduce).toHaveLength(2)

      // Verify correct API call
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({ method: 'POST' }),
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('claude-sonnet-4-20250514')
      expect(body.system).toContain('TestApp')
    })

    it('uses custom model when specified', async () => {
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse(VALID_QUESTION_JSON))

      await triage({ text: 'How to reset?' }, PROJECT, anthropicConfig('claude-haiku-4-5-20251001'))

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('claude-haiku-4-5-20251001')
    })
  })

  describe('OpenAI provider', () => {
    it('classifies a question', async () => {
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse(VALID_QUESTION_JSON))

      const result = await triage(
        { text: 'How do I reset my password?' },
        PROJECT,
        openaiConfig(),
      )

      expect(result.type).toBe('question')
      expect(result.answer).toBe('Go to Settings > Reset.')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('gpt-4o-mini')
      expect(body.response_format).toEqual({ type: 'json_object' })
    })
  })

  describe('Google provider', () => {
    it('classifies a bug', async () => {
      mockFetch.mockResolvedValueOnce(mockGoogleResponse(VALID_BUG_JSON))

      const result = await triage({ text: 'App crashes' }, PROJECT, googleConfig())

      expect(result.type).toBe('bug')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.anything(),
      )
    })
  })

  describe('error handling', () => {
    it('throws on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      })

      await expect(
        triage({ text: 'test' }, PROJECT, anthropicConfig()),
      ).rejects.toThrow('Triage LLM call failed (401)')
    })

    it('throws on incomplete result (missing type)', async () => {
      mockFetch.mockResolvedValueOnce(
        mockAnthropicResponse(JSON.stringify({ severity: 'low', title: 'Incomplete' })),
      )

      await expect(
        triage({ text: 'test' }, PROJECT, anthropicConfig()),
      ).rejects.toThrow('Triage returned incomplete result')
    })

    it('throws on invalid JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        mockAnthropicResponse('This is not JSON at all'),
      )

      await expect(
        triage({ text: 'test' }, PROJECT, anthropicConfig()),
      ).rejects.toThrow()
    })

    it('throws for unsupported provider', async () => {
      await expect(
        triage({ text: 'test' }, PROJECT, {
          provider: 'azure' as 'anthropic',
          apiKey: 'key',
        }),
      ).rejects.toThrow('Unsupported AI provider: azure')
    })
  })

  describe('markdown fence stripping', () => {
    it('handles response wrapped in ```json fences', async () => {
      const fenced = '```json\n' + VALID_BUG_JSON + '\n```'
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse(fenced))

      const result = await triage({ text: 'bug' }, PROJECT, anthropicConfig())
      expect(result.type).toBe('bug')
    })

    it('handles response wrapped in ``` fences (no language tag)', async () => {
      const fenced = '```\n' + VALID_QUESTION_JSON + '\n```'
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse(fenced))

      const result = await triage({ text: 'question' }, PROJECT, anthropicConfig())
      expect(result.type).toBe('question')
    })
  })

  describe('project context', () => {
    it('includes knowledge base in system prompt', async () => {
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse(VALID_QUESTION_JSON))

      const projectWithKB: ProjectContext = {
        ...PROJECT,
        knowledgeBase: '## FAQ\n- Reset password at /settings',
      }

      await triage({ text: 'How to reset?' }, projectWithKB, anthropicConfig())

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.system).toContain('FAQ')
      expect(body.system).toContain('Reset password at /settings')
    })

    it('includes custom triage instructions', async () => {
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse(VALID_QUESTION_JSON))

      const projectWithCustom: ProjectContext = {
        ...PROJECT,
        customTriageInstructions: 'Always classify billing issues as critical.',
      }

      await triage({ text: 'Billing problem' }, projectWithCustom, anthropicConfig())

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.system).toContain('Always classify billing issues as critical')
    })
  })

  describe('attachments', () => {
    it('appends attachment list to user content', async () => {
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse(VALID_BUG_JSON))

      await triage(
        {
          text: 'Bug with screenshot',
          attachments: [
            { url: 'https://img.example.com/shot.png', type: 'screenshot', name: 'shot.png' },
          ],
        },
        PROJECT,
        anthropicConfig(),
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      const userMsg = body.messages[0].content
      expect(userMsg).toContain('shot.png')
      expect(userMsg).toContain('Attached files')
    })
  })
})
