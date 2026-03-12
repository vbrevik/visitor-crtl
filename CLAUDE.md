# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Defense/government visitor management system (Norwegian context) with air-gapped RESTRICTED infrastructure. Bidirectional XML data diodes between UNCLASSIFIED and RESTRICTED classification levels. RESTRICTED side is the authority for all access decisions.

## Commands

```bash
# Install dependencies (npm workspaces)
npm install

# Build shared package first (other packages depend on it)
npm run build -w packages/shared

# Build all packages
npm run build

# Lint / typecheck all packages
npm run lint
npm run typecheck

# Run tests (shared package has vitest)
npm test -w packages/shared          # run once
npm run test:watch -w packages/shared # watch mode

# Dev servers (run individually)
npm run dev:portal           # visitor self-service UI (port 5173)
npm run dev:guard-ui         # reception guard station UI
npm run dev:security-ui      # security officer review UI
npm run dev:sponsor          # sponsor/host approval UI
npm run dev:management-ui    # admin management UI
npm run dev:convex-unclass   # Convex UNCLASSIFIED backend (port 3210)
npm run dev:convex-restricted # Convex RESTRICTED backend (port 3211)
npm run dev:mocks            # all mock services (OnGuard, registers, notifications)
npm run dev:gateway          # NATS-based diode gateway

# Infrastructure (Docker Compose)
docker compose -f docker-compose.dev.yml up --build  # NATS, Keycloak, delay-proxy
./scripts/setup.sh compose   # full setup
./scripts/teardown.sh        # cleanup
```

## Architecture

### Monorepo Layout (`packages/`)

| Package | Purpose |
|---------|---------|
| `shared` | TypeScript library: types, identity scoring engine, XML/diode helpers. All other packages depend on this. |
| `convex-unclass` | Convex backend for UNCLASSIFIED side. Visit requests, sponsor actions, diode outbox/inbox, company cache, course completions. |
| `convex-restricted` | Convex backend for RESTRICTED side. Visit state machine, register verification (FREG/NKR/SAP HR), badge provisioning, scoring pipeline. |
| `portal` | React + Vite. Multi-step visitor wizard with identity scoring UI. OIDC auth via oidc-client-ts. |
| `guard-ui` | React + Vite. Reception guard station interface. |
| `security-ui` | React + Vite. Security officer review/approval interface. |
| `sponsor` | React + Vite. Sponsor/host approval interface. |
| `management-ui` | React + Vite. System administration interface. |
| `mocks` | Hono-based mock services for OnGuard (port 3000), FREG/NKR/SAP HR registers (port 3001), notifications (port 3002). |
| `diode-gateway` | Polls Convex outbox tables, publishes XML envelopes via NATS. Bridges the two classification levels. |
| `diode-delay-proxy` | NATS subscriber that adds configurable latency to simulate real diode hardware. |

### Data Flow

```
Portal (React) → Convex UNCLASSIFIED → diode-gateway → NATS → diode-delay-proxy → Convex RESTRICTED
                 (visitRequests table)   (XML envelope)                              (verification, state machine)
```

Responses flow back via the reverse path (r2u channel).

### Key Domain Concepts

- **Identity Scoring**: Australia-style 100-point model. Categories A (government/federation), B (physical/biometric), C (possession/knowledge). Three stages: portal base score → restricted verified score (register modifiers) → access tier resolution. Implementation in `packages/shared/src/identity-scoring.ts`.
- **Visit State Machine**: `registered` → `submitted` → `approved`/`denied` → `admitted` → `checked_out`/`cancelled`
- **Register Verification** (`convex-restricted/convex/verification.ts`): Checks FREG (alive/deceased/emigrated), NKR (security clearance), SAP HR (employment), Brønnøysund (company validation). Can block or modify identity scores.
- **Diode Outbox/Inbox Pattern**: Messages persist in Convex tables for retry/audit. Gateway polls outbox, delivers to inbox on other side.

### Convex Specifics

- Two independent Convex deployments (unclass on port 3210, restricted on 3211)
- Schema defined in `convex/schema.ts` within each Convex package
- Auto-generated files in `convex/_generated/` — do not edit these
- Queries are reactive (real-time subscriptions), mutations are transactional
- Actions handle side effects (HTTP calls to mock registers)

### Authentication

Keycloak (port 8180) mocks two OIDC realms: ID-porten and Mil Feide. Portal uses oidc-client-ts for OIDC flows.

## Tech Stack

- TypeScript 5.7 (strict mode, strict null checks) end-to-end
- React 19 + Vite 6 (frontends)
- Convex 1.17 (backends)
- Hono 4.6 (mock HTTP services)
- NATS 2.x (diode message transport)
- Vitest (testing)
- Keycloak 24 (mock IdP)

## Planning Documents

Comprehensive architecture docs in `docs/plan/` (00-overview through 12-mock-infrastructure). Key ones:
- `03-identity-verification.md` — scoring model design
- `04-access-control.md` — access tiers, state machines
- `05-diode-messaging.md` — XML message format, diode protocol
- `12-mock-infrastructure.md` — mock service specifications

## Conventions

- RESTRICTED side is always the authority — never make access decisions on the UNCLASSIFIED side
- Shared types/logic go in `packages/shared`, not duplicated across packages
- Convex schema changes require rebuilding generated files (`npx convex dev` in the relevant package)
- Norwegian regulatory context: NSM, NIST CSF 2.0, ISO 27001, sikkerhetsloven, GDPR

## Context Priorities

When loading context, prioritize in this order:
1. `packages/shared/src/types/` + `identity-scoring.ts` — core types and scoring engine used everywhere
2. `packages/convex-restricted/convex/verification.ts` + `visits.ts` — RESTRICTED-side state machine and register checks
3. `packages/convex-restricted/convex/schema.ts` + `packages/convex-unclass/convex/schema.ts` — database schemas
4. `packages/mocks/` — only when working on mock services or debugging register responses
5. Frontend packages (`portal`, `guard-ui`, `security-ui`, `sponsor`, `management-ui`) — only when working on that specific UI

Avoid loading all packages into context simultaneously. Focus on the classification side relevant to the task.

## Compact Instructions

When compacting context, preserve:
1. Current implementation plan progress (task number, what's done vs remaining)
2. Identity scoring model changes (score values, category assignments, modifier logic)
3. Active test failures and their root causes
4. Any in-progress register verification changes (FREG/NKR/SAP/Breg interactions)
5. Diode message format changes that affect both sides

## Skill Preferences

- When executing plans, use the local `executing-plans` skill (not `superpowers:executing-plans`). The local version requires prompt-contracts for every non-trivial task before writing code.
