# How to Bake Your Pi

This is a practical guide to designing Pi-based agents without disappearing into orchestration theater.

The core idea is simple: do not start by asking "how many agents can I spawn?" Start by asking what shape of agent system actually fits the job.

## The three baking patterns

### 1. Advisor Agent (Pi-Pi pattern)
One primary agent owns the work. It can read, synthesize, decide, and write. Around it sits a suite of specialist advisors that help with narrow domains.

This is the `pi-pi` pattern.

#### Shape
- one primary agent
- several specialist advisors
- advisors research, critique, or supply domain guidance
- the primary agent remains the single writer / implementer

#### Best for
- building a specialized agent
- extension/theme/prompt/TUI design
- work where synthesis quality matters more than parallel throughput
- work where you want one accountable author

#### Why it works
- keeps authorship centralized
- reduces merge/conflict chaos
- preserves domain depth without letting experts mutate the system independently
- makes evaluation easier because there is one final decision-maker

#### Failure mode
- overloaded primary agent
- too many vague advisors
- advisors acting like workers instead of narrow experts

### 2. Agent Pipeline
A pipeline is a staged flow. One step transforms the input and hands it to the next.

#### Shape
- planner -> builder -> reviewer
- researcher -> writer -> critic
- extractor -> normalizer -> validator

#### Best for
- work with naturally separable stages
- transformations with clear handoff artifacts
- systems where each phase has a different success criterion
- flows that benefit from explicit checkpoints

#### Why it works
- clear boundaries
- easier debugging
- easier evals per stage
- easier to swap or improve one stage without rewriting the whole system

#### Failure mode
- stage boundaries that are fake or arbitrary
- brittle handoffs
- too much latency for simple tasks

### 3. Agent Team / Swarm
Multiple agents operate in parallel on the same broader objective.

#### Shape
- dispatcher + specialist workers
- several agents exploring or producing in parallel
- coordination and synthesis layer required

#### Best for
- truly parallelizable work
- broad search/exploration where multiple paths are useful
- cases where the time saved outweighs coordination overhead

#### Why it is dangerous
Parallel agent swarms are expensive, hard to reason about, and easy to romanticize.

In practice they often create:
- duplicated effort
- conflicting outputs
- fake progress
- weak accountability
- evaluation headaches

#### Recommended stance
Use swarms rarely. If a single primary agent or a pipeline can do the job, prefer that first.

## Pattern-selection doctrine

Default order:
1. single primary agent with structure
2. pipeline when stages are naturally separable
3. swarm only when parallelism is clearly warranted

If you cannot explain why the work truly benefits from concurrent agents, you probably do not need a swarm.

## Pi-Pi vs Agent Team

These are not the same pattern.

### Pi-Pi
- specialized meta-agent shape
- expert panel acts as advisors/researchers
- primary agent is the builder/writer
- optimized for building Pi components well

### Agent Team
- general dispatch framework
- specialist workers do the work
- primary agent mainly routes and coordinates
- optimized for delegation across reusable specialist roles

Short version:
- `pi-pi` = one builder with advisors
- `agent-team` = dispatcher with workers

That distinction matters because it changes where authorship, responsibility, and synthesis live.

## How to design an agent well

Do not begin with prompt prose. Begin with a contract.

### 1. Define the objective
What is the agent actually for?

Good objective language is:
- specific
- bounded
- outcome-oriented
- testable

Bad objective language is:
- broad
- identity-heavy
- vague about outputs
- trying to do five jobs at once

### 2. Define the scenarios
What user requests or operating situations should elicit the desired behavior?

Examples:
- user asks for a new Pi extension
- user asks to audit an existing agent prompt
- user asks to compare two orchestration patterns
- user asks for a safer alternative to a swarm

Scenarios force the design out of abstraction.

### 3. Define the evals
How will you know the agent is actually good?

Examples:
- chooses the simplest sufficient orchestration pattern
- produces a bounded implementation plan
- avoids prompt bloat and role confusion
- returns outputs that match the requested artifact shape
- does not substitute a swarm when an advisor or pipeline pattern is enough

If you do not have evals, you do not yet have an agent design. You have a vibe.

## Prompt anti-patterns to avoid

An agent can fail long before runtime if the design is bad.

Common anti-patterns:
- bloated prompts that mix policy, runtime config, and behavior design
- too many objectives in one agent
- fake agency, where the prompt sounds powerful but the role is undefined
- fake safety, where restrictions are theatrical but not operationally meaningful
- unclear success criteria
- orchestration inflation, where more agents are added instead of clarifying the job
- role overlap between agents, causing conflict and duplicated work

A good agent prompt is usually the result of a good contract, not the other way around.

## The emerging Agent Building skill

This points toward a real skill, not just a document.

That skill would combine:
- orchestration pattern selection
- prompt anti-pattern detection
- objective definition
- scenario design
- eval design
- recommendations for when to use advisor, pipeline, or swarm patterns

### Candidate workflow
1. Identify the job the agent must do
2. Select the lightest orchestration pattern that fits
3. Write the agent contract
4. Draft scenarios that should trigger key behaviors
5. Draft evals that validate those behaviors
6. Check for prompt anti-patterns
7. Only then write or refine the actual agent prompt/system instructions

## Practical recommendation

When designing agents for real work:
- prefer one accountable primary agent
- use advisors when you need depth without authorship chaos
- use pipelines when handoffs are real
- treat swarms as an exception, not a default
- design around objectives, scenarios, and evals, not just prompt cleverness

## External canonical spec, Pi as a target

The repo examples keep a lot of truth inside Pi-facing config. I would not make that the canonical design.

Better shape:
- keep the canonical agent contract outside Pi
- compile or render Pi artifacts from that contract when needed
- treat Pi as one runtime target, not the source of truth

This keeps the agent portable and prevents the design from collapsing into Pi-specific folder conventions.

### Design principle
Separate:
- agent intent and contract
- runtime realization

That means the thing you version and reason about is the external agent spec, not `.pi/agents/*.md` or `teams.yaml`.

## Proposed external contract shape

A good first pass is a small contract with six pieces:
- identity
- pattern
- objectives
- scenarios
- evals
- target renderers

### Example

```yaml
version: agent-contract.v1
agent:
  id: pi-extension-builder
  name: Pi Extension Builder
  summary: >
    Designs and implements Pi extensions from explicit objectives,
    scenarios, and eval criteria.

pattern:
  kind: advisor
  rationale: >
    One accountable builder should own synthesis and file output.
    Domain experts should advise, not write.
  advisors:
    - id: ext-expert
      role: Pi extension API and event model expert
    - id: tui-expert
      role: Pi TUI and widget expert
    - id: theme-expert
      role: Pi theme/token expert

objectives:
  primary:
    - Produce working Pi extension designs with clear boundaries.
    - Prefer the lightest orchestration shape that fits the job.
    - Avoid prompt bloat and role confusion.
  non_goals:
    - Do not introduce swarm orchestration without explicit justification.
    - Do not mix runtime config into the core behavioral contract.

inputs:
  required:
    - task_brief
    - desired_artifact
  optional:
    - existing_repo_context
    - style_preferences
    - runtime_constraints

scenarios:
  - id: create-new-extension
    given: User wants a new Pi extension for a specific workflow.
    expected_behaviors:
      - Clarify scope if underspecified.
      - Choose advisor pattern over swarm.
      - Produce concrete extension design and artifact plan.
  - id: audit-existing-agent
    given: User wants a review of an existing agent or prompt.
    expected_behaviors:
      - Identify anti-patterns.
      - Recommend contract and orchestration improvements.
      - Preserve requested scope.

evals:
  - id: pattern-selection
    check: Chooses advisor or pipeline unless concurrency is clearly justified.
  - id: contract-clarity
    check: Produces explicit objectives, scope boundaries, and non-goals.
  - id: anti-pattern-avoidance
    check: Does not produce bloated, multi-role, vague prompts.
  - id: artifact-fitness
    check: Output matches requested artifact shape and is implementation-usable.

outputs:
  canonical_artifacts:
    - agent-contract.yaml
    - objectives.md
    - scenarios.yaml
    - evals.yaml
  runtime_artifacts:
    - pi-agent.md
    - pi-team.yaml
    - pi-prompts.md

renderers:
  - target: pi
    emits:
      - .pi/agents/pi-extension-builder.md
      - .pi/agents/teams.yaml
      - .pi/prompts/pi-extension-builder.md
  - target: openclaw
    emits:
      - skills/agent-building/SKILL.md
  - target: generic
    emits:
      - dist/system-prompt.md
      - dist/agent-manifest.json
```

## What should be canonical vs generated

### Canonical
These should be the durable truth:
- agent contract
- objectives
- scenarios
- evals
- orchestration pattern choice
- non-goals and constraints

### Generated
These should be renderable artifacts:
- Pi agent markdown
- Pi team definitions
- prompt files
- runtime-specific settings
- extension wiring

If a runtime-specific artifact is hand-edited, that may be fine for experimentation, but the canonical contract should still live outside it.

## Suggested file layout

```text
agent-building/
  contracts/
    pi-extension-builder/
      agent-contract.yaml
      objectives.md
      scenarios.yaml
      evals.yaml
      notes.md
  renderers/
    pi/
    openclaw/
    generic/
  dist/
```

This keeps the source-of-truth separate from the rendered runtime surface.

## What the builder should do

A real agent-building pipeline could work like this:

1. ingest task brief
2. choose orchestration pattern
3. draft contract
4. draft scenarios
5. draft evals
6. check prompt anti-patterns
7. render target artifacts for Pi or another runtime
8. optionally validate generated artifacts against lightweight target-specific checks

## Why this is better than Pi-first config

Pi-first config is attractive because it is immediate, but it entangles:
- design intent
- runtime layout
- harness-specific assumptions

External canonical spec is better because it gives you:
- portability
- better evaluation discipline
- clearer separation between design and execution
- a cleaner path to support Pi, OpenClaw, OpenCode, or custom runtimes later

That is how to bake your Pi without making a mess.

see '/Users/devflow/repos/pi-vs-claude-code' for more details and detailed examples