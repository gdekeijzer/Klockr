# CLAUDE.md — Project operating instructions

This file is the primary instruction set for Claude Code when working in this repository.

## 1. Read first

Before changing code or architecture, read these documents in order:

1. `README.md`
2. `PROJECT_STATUS.md`
3. `docs/PRODUCT_PRINCIPLES.md`
4. `docs/FUNCTIONAL_DESIGN.md`
5. `docs/DOMAIN_MODEL.md`
6. The specific domain document relevant to the task
7. For UI/UX work: `docs/DESIGN_SYSTEM.md`, `docs/UI_COMPONENTS.md`, `docs/UX_PATTERNS.md`, `docs/UI_REQUIREMENTS.md`
8. `docs/TECHNICAL_ARCHITECTURE.md`
9. `docs/IDENTITY_AUTH_LIFECYCLE.md` when auth/sharing/lifecycle is involved
10. `docs/DEPLOYMENT_RUNTIME.md` and `docs/CI_CD_RELEASE.md` when runtime/release work is involved
11. `docs/ACCEPTANCE_CRITERIA.md`
12. Relevant ADRs in `docs/adr/`

`docs/FUNCTIONAL_DESIGN.md` is the product source of truth. Technical documents may refine implementation, but must not silently change product behavior.

## 2. Product in one sentence

Build a stage timer that can understand a complete show, while remaining simple enough that a first-time user can start a useful timer within seconds.

The product is **not** an event-management suite with a timer bolted on.

## 3. Non-negotiable product principles

- Complexity is opt-in.
- A Quick Timer must remain extremely low-friction.
- Data and presentation are separate: Queue Items hold data/state; Boards decide what and how to render.
- A Queue is the operational source. An agenda is a view over available data, not a separate agenda database.
- Keep the domain model flat. Do not introduce Session -> Cue -> Timer nesting unless an explicit product decision changes this.
- Queue Items are universal objects with optional capabilities/properties.
- Multiple parallel Queues are peers, not nested technical subtrees.
- The software calculates and signals; the operator remains in final control.
- Never silently shorten a speaker or rewrite a live show unless an explicitly configured automation requires it.
- Integrations must never hold the core timer engine hostage.
- Locks improve safety, but permitted emergency override must remain possible.
- A brief network outage must not turn a live Speaker Board into a loading spinner.
- KLOCKR is dark-first for live-production environments.
- Color communicates state; do not use green/amber/red as decoration.
- Normal Speaker/Confidence Board timer output is white/light gray by default; warning/critical/overtime color is configurable.
- Generated UI mockups are visual references, not a license to invent behavior that contradicts product docs.

## 4. V1 boundaries

In V1, prioritize the core show/timer experience, realtime Boards, scheduling, sharing/devices, Event/Room organization and the external HTTP API.

Do **not** add the following merely because they seem useful:

- OSC
- native Bitfocus Companion integration
- QLab integration
- Local Agent
- MIDI
- unrestricted free-form Board Designer
- automatic schedule recovery
- elaborate analytics
- advanced subscription/billing flows

Interfaces may be prepared for these features, but do not implement them without an explicit request.

## 5. Architecture rules

### Domain logic

- Keep timer, schedule, queue, relation, permission and lock logic in pure domain modules where possible.
- UI components must not contain authoritative timer math.
- Route handlers/controllers must not contain business rules that belong in domain/application services.
- `packages/application` is mandatory; all state-changing use cases converge there.
- Do not make database schema details the domain API.

### Time

- Never persist per-second timer ticks.
- Persist timer transitions and timestamps; derive display time from them.
- Store absolute timestamps in UTC.
- Store an IANA timezone on an Event/Show when human schedule times require it.
- Test all timer logic with a controllable/fake clock.
- Treat countdown overtime as a derived state of the same timer, not a second timer.

### Realtime

- Server Show State is authoritative.
- Broadcast state transitions, not clock ticks.
- Clients derive the visible running timer locally from an authoritative timestamp/snapshot.
- Every realtime snapshot/event must support version/sequence ordering so stale updates can be rejected.
- Reconnection must obtain/verify an authoritative snapshot.

### Offline behavior

- Already-open display Boards continue rendering running timers from the last authoritative state during brief disconnects.
- In V1, disconnected Operator/Master clients must not pretend centrally mutating commands succeeded.
- Make connectivity state explicit on operational interfaces and unobtrusive on presenter/public outputs.

### Commands

- All state-changing operations go through named application commands/services.
- Commands that may be retried must support idempotency.
- External API and internal UI should converge on the same application command layer.
- `STOP` and `END/NEXT` are semantically different; never merge them for convenience.

### Identity and permissions

- Anonymous Show management, temporary role links, Board shares, Device credentials and API credentials are separate grant types.
- Primary account login/claim flow is email magic link; concrete provider remains an adapter.
- Board shares are read-only by default and never imply Operator control.
- Platform support impersonation must be explicit, visible and audited.

### Permissions

- Do not hardcode behavior around role names such as `if role === 'operator'`.
- Check permissions/capabilities. Roles are bundles of permissions.
- Board/share access is separate from user RBAC.
- Emergency lock override is permission-gated and audited.

### Security

- No secrets in the repository.
- Share tokens are scoped and revocable.
- A Device ID is an identifier, not by itself a credential.
- Sanitize user-controlled content rendered on Boards.
- Validate every external boundary with shared schemas.

## 6. Inheritance rule

Configurable values use this precedence where applicable:

`Show default -> Queue override -> Queue Item override`

The effective source must remain visible in Master and, where operationally relevant, Operator UI. Do not make an override invisible to the user.

## 7. Scheduling rule

Keep these concepts distinct:

- baseline/planned schedule
- projected/effective schedule
- actual runtime state

`Strict / Operator Controlled` keeps the planned schedule as the reference and reports ahead/behind.

`Sliding / Free` may shift projected future times. Live shifts must be presented calmly; linked queues must not visually jump without context. Use a pending/changed state when appropriate.

Automatic recovery is outside V1.

## 8. Parallel Queue relationship rule

Items in peer Queues may be related with a relative offset. Example:

- Program: Keynote at 10:00
- Audio: Headset live at -01:00 relative to Keynote

Changing the anchor may affect linked items according to timing policy. Never convert this into deep parent/child cue nesting.

## 9. Current and running state

Recommended baseline:

- Each Queue can have its own current item.
- A Show identifies a primary/program Queue for global `current/next` projections.
- Multiple timers may run simultaneously.
- Changing current does not automatically stop unrelated running timers.

If a task requires changing this model, document the decision first.

## 10. UI/design rules

For UI work, `docs/DESIGN_SYSTEM.md` and `docs/UI_COMPONENTS.md` are mandatory.

- Prefer shared semantic design tokens over hard-coded colors.
- Keep `selected`, `current` and `running` visually and semantically distinct.
- Use blue for product/information/selection; green/amber/red for operational state.
- Do not make a running Speaker timer bright green merely because it is running.
- Avoid glassmorphism, decorative gradients, excessive glow and generic consumer-SaaS styling.
- Operator prioritizes live operation; Master may be denser and supports planning/editing.
- Speaker/Public Boards optimize distance legibility and low distraction.
- Preserve keyboard focus, contrast, reduced-motion behavior and safe flashing rules.
- Do not encode authoritative domain state inside visual components.

Reference mockups are under `docs/design/assets/`.

## 11. Definition of Done for every feature

A feature is not done until:

- behavior matches the functional design;
- domain tests cover important state transitions and edge cases;
- API/realtime contracts are validated;
- permission checks are present;
- error/offline behavior is considered;
- relevant documentation is updated;
- no new TODO silently changes product scope;
- formatter/linter/type checks/tests pass.

## 12. Change discipline

Before implementing a substantial feature:

1. Locate the requirement in the docs.
2. State the intended behavior and affected domain objects.
3. Check `docs/OPEN_QUESTIONS.md` and ADRs.
4. If behavior is ambiguous, do not invent a major product decision. Record the question and request a decision.
5. Implement the smallest coherent vertical slice.
6. Add tests.
7. Update docs and `PROJECT_STATUS.md`.

Do not perform broad opportunistic refactors during an unrelated feature unless they are necessary for correctness.

## 13. Runtime/release rules

- Local DEV/TST may run web/server/worker directly via pnpm; use Compose for local infrastructure.
- ACC and PRD are separate Docker Compose projects with separate PostgreSQL volumes/secrets.
- V1 uses one authoritative realtime server instance; do not add Redis preemptively.
- Background cleanup/email/housekeeping belongs in `apps/worker`, not the live timing path.
- Build immutable application images once; PRD promotes the exact images accepted on ACC.
- Never silently deploy PRD. Production promotion is explicit and user-controlled.

## 14. Repository conventions

The target repository structure is described in `docs/TECHNICAL_ARCHITECTURE.md`. Keep domain packages independent of Next.js/Fastify internals.

Use clear names from `docs/GLOSSARY.md`. Prefer `Queue Item`, `Board`, `Show`, `Room`, `Event`, `Audience`, `Device` and `Action` consistently.

## 15. Product safety defaults

When in doubt during a live-show workflow:

- preserve the running show;
- do not silently delete or move content;
- do not silently trigger the next cue;
- display uncertainty/connectivity failures;
- make dangerous actions explicit and reversible where possible;
- favor operator awareness over hidden automation.
