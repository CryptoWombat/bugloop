// ---------------------------------------------------------------------------
// Bugloop Triage Engine
// ---------------------------------------------------------------------------
// Classifies user messages into question / bug / feature and produces
// structured reports. Provider-agnostic — uses the Vercel AI SDK's
// `generateObject` when available, falls back to raw fetch + JSON parse.
// ---------------------------------------------------------------------------

import type {
  AIProviderConfig,
  Attachment,
  ProjectContext,
  TriageResult,
} from './types.js'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildTriagePrompt(project: ProjectContext): string {
  const lines = [
    `You are the triage agent for "${project.name}".`,
    project.description,
    '',
    'Your job is to classify the user\'s message into one of three types:',
    '- "question" — the user wants help, information, or a how-to answer.',
    '- "bug" — the user is reporting something broken, an error, or unexpected behavior.',
    '- "feature" — the user is requesting new functionality or an improvement.',
    '',
    'Respond with a JSON object matching this schema (no markdown fences):',
    '{',
    '  "type": "question" | "bug" | "feature",',
    '  "severity": "low" | "medium" | "high" | "critical",',
    '  "title": "short summary (under 80 chars)",',
    '  "answer": "direct answer if type is question, otherwise omit",',
    '  "structuredReport": {',
    '    "description": "clear description of the issue or request",',
    '    "stepsToReproduce": ["step 1", "step 2"] (bugs only, omit if unknown),',
    '    "expected": "what should happen" (bugs only),',
    '    "actual": "what actually happens" (bugs only)',
    '  }',
    '}',
    '',
    'Severity guide:',
    '- critical: app is down, data loss, security issue',
    '- high: core feature broken, blocks user workflow',
    '- medium: feature partially broken, workaround exists',
    '- low: cosmetic, minor annoyance, nice-to-have',
    '',
    'For questions: provide a helpful, concise answer. If the knowledge base below has relevant info, use it.',
    'For bugs: extract as much structure as possible from the user\'s message and any screenshots.',
    'For features: summarize the request clearly.',
  ]

  if (project.knowledgeBase) {
    lines.push('', '--- Knowledge Base ---', project.knowledgeBase)
  }

  if (project.customTriageInstructions) {
    lines.push('', '--- Additional Instructions ---', project.customTriageInstructions)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Build user message content (text + image attachments for vision)
// ---------------------------------------------------------------------------

interface UserInput {
  text: string
  attachments?: Attachment[]
}

function buildUserContent(input: UserInput): string {
  // For now, text-only. Vision support (passing image URLs to multimodal
  // models) will be added when we wire up the AI SDK's multimodal message
  // format. Attachment URLs are still referenced in the text.
  let content = input.text

  if (input.attachments?.length) {
    const fileList = input.attachments
      .map((a) => `- [${a.name}](${a.url}) (${a.type})`)
      .join('\n')
    content += `\n\nAttached files:\n${fileList}`
  }

  return content
}

// ---------------------------------------------------------------------------
// LLM call — raw fetch (no hard dependency on AI SDK at runtime)
// ---------------------------------------------------------------------------

interface LLMEndpoint {
  url: string
  headers: Record<string, string>
  buildBody: (system: string, user: string) => unknown
  extractText: (json: unknown) => string
}

function getEndpoint(config: AIProviderConfig): LLMEndpoint {
  const model = config.model

  if (config.provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      buildBody: (system, user) => ({
        model: model ?? 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      extractText: (json: unknown) => {
        const msg = json as { content: Array<{ text: string }> }
        return msg.content[0].text
      },
    }
  }

  if (config.provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      buildBody: (system, user) => ({
        model: model ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      }),
      extractText: (json: unknown) => {
        const resp = json as {
          choices: Array<{ message: { content: string } }>
        }
        return resp.choices[0].message.content
      },
    }
  }

  if (config.provider === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model ?? 'gemini-2.0-flash'}:generateContent?key=${config.apiKey}`,
      headers: { 'content-type': 'application/json' },
      buildBody: (system, user) => ({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
      extractText: (json: unknown) => {
        const resp = json as {
          candidates: Array<{ content: { parts: Array<{ text: string }> } }>
        }
        return resp.candidates[0].content.parts[0].text
      },
    }
  }

  throw new Error(`Unsupported AI provider: ${config.provider}`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function triage(
  input: UserInput,
  project: ProjectContext,
  aiConfig: AIProviderConfig,
): Promise<TriageResult> {
  const system = buildTriagePrompt(project)
  const userContent = buildUserContent(input)
  const endpoint = getEndpoint(aiConfig)

  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: endpoint.headers,
    body: JSON.stringify(endpoint.buildBody(system, userContent)),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Triage LLM call failed (${response.status}): ${body}`)
  }

  const json = await response.json()
  const text = endpoint.extractText(json)

  // Strip markdown fences if the model wraps the JSON
  const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')

  const result = JSON.parse(cleaned) as TriageResult

  // Validate required fields
  if (!result.type || !result.severity || !result.title) {
    throw new Error(`Triage returned incomplete result: ${cleaned}`)
  }

  return result
}
