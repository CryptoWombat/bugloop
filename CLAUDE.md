# CLAUDE.md

## Project Overview

**Bugloop** is a generic, self-healing support SDK. It provides AI-powered triage, structured bug tickets, and an optional automated fix-deploy-notify loop. Designed as a drop-in package for any project — install, configure adapters, and get a full support system.

**Key principle:** Generic and standalone. Every feature must work across any host project without modification.

## Tech Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Language:** TypeScript (strict, ESM-only)
- **Packages:**
  - `@bugloop/core` — triage engine, ticket lifecycle, adapter interfaces
  - `@bugloop/next` — Next.js route handlers + React components
  - `@bugloop/adapter-supabase` — Supabase storage + auth adapter
  - `@bugloop/agent-github` — GitHub Actions agent trigger

## Development Commands

```bash
pnpm install           # Install all workspace dependencies
pnpm build             # Build all packages (turbo)
pnpm dev               # Watch mode for all packages
pnpm test              # Run all tests (turbo)
pnpm typecheck         # Type-check all packages
pnpm clean             # Remove dist/ and .turbo/ from all packages
```

## Project Structure

```
packages/
├── core/              @bugloop/core — types, triage, ticket lifecycle
├── next/              @bugloop/next — Next.js handlers + React UI
├── adapter-supabase/  @bugloop/adapter-supabase — Supabase storage/auth
└── agent-github/      @bugloop/agent-github — GitHub Actions agent
apps/
└── demo/              Demo Next.js app (first-party integration test)
```

## Key Architectural Decisions

1. **No hard AI SDK dependency at runtime.** The triage engine uses raw `fetch` against provider APIs (Anthropic, OpenAI, Google). The `ai` peer dep is optional — only needed if the host wants to use Vercel AI SDK features.
2. **Adapter pattern for everything.** Storage, auth, and agent are all interfaces. The SDK ships concrete implementations (Supabase, GitHub) but any host can bring their own.
3. **Supabase adapter creates its own tables** (prefixed `bugloop_`) in the host's database. The host runs the shipped migration SQL — the adapter never touches host tables.
4. **React components use inline styles.** No Tailwind or CSS module dependency — the widget works in any React project regardless of styling setup. Components accept `accentColor` and `className` for theming.
5. **Agent safety by default.** PR-only mode, budget caps, max retries, sanitized reports (raw user input stripped before passing to coding agent).

## Git / Completion

- **Commit and push as part of the job.** When a feature, fix, or change is done, commit and push to `master` in the same unit of work. Do not leave the repo with uncommitted changes.

## Versioning

- **Version format:** `{package.json version}` + git short hash (e.g. `v0.1.0 · d8fe280`).
- Each package has its own `version` in its `package.json`. Keep them in sync for simplicity until there's a reason to diverge.
- **Bump `version` in all `packages/*/package.json`** for: milestone features (minor bump), breaking changes (major bump), bug fixes (patch bump).
- When reporting "done", include the version and git short hash so it's clear what was shipped.
- Root `package.json` does NOT carry a publishable version — only the packages under `packages/` do.

## Definition of Done

Every implementation must follow this sequence before reporting completion:

1. **`pnpm build`** — all packages compile cleanly (zero errors).
2. **`pnpm test`** — all tests pass (add tests for new/changed logic).
3. **`pnpm typecheck`** — no type errors across the workspace.
4. **Commit & push** — commit the changes and push to `master`.
5. **Report done** — include: what was done, test results, version + git hash.

**Critical rules:**
- Do NOT say "done", "complete", or "finished" until steps 1–4 are green.
- **You are the tester.** Run all builds and tests yourself. Never ask the user to verify.
- If something is broken, fix it and rebuild before reporting completion.

## Agent Execution (mandatory for AI assistants)

This environment has a **real terminal and network**. **Do not ask the user to run** builds, tests, git operations, or installs **when you can run them yourself**. Run them, capture output, and fix failures.

**Narrow exceptions:** interactive OAuth, secrets not in the repo, or irreversible actions requiring human approval.

## Testing Discipline

- **You are the tester. The user is NEVER the tester.**
- Test every change by building and running the test suite before reporting done.
- For `@bugloop/core`: unit tests via Vitest covering triage classification, ticket lifecycle, and adapter contract compliance.
- For `@bugloop/next`: type-check is sufficient until a demo app exists for integration testing.
- For adapters: integration tests against real services when credentials are available; otherwise, mock-based unit tests.
