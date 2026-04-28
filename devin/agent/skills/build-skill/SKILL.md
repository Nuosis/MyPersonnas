---
name: build-skill
description: Guide for spec'ing a new Pi skill package with triggers, scripts, and documentation
triggers:
  - "build a skill"
  - "forge a skill"
  - "create skill spec"
tools:
  - read
  - write
  - edit
---

# Build Skill Spec

When spec'ing a skill, you need to define:

## 1. Intentions/Context
- **Purpose**: What capability does this skill add?
- **Trigger phrases**: What phrases activate this skill?
- **Target users**: Who benefits?

## 2. Decisions to Articulate

### Triggers
- What phrases should activate this skill?
- Be specific: avoid vague triggers
- List 3-5 concrete trigger phrases

### Tools
- Which Pi tools does this skill use?
- Tools available: read, write, edit, bash, grep, find, ls, subagent, eval_*

### Scripts
- What script files are needed?
- Node.js execution context
- Tool access via params.context.tools

### Structure
```
skills/{name}/
├── SKILL.md         # Required: definition + triggers + doc
└── script.ts         # Optional: main implementation
```

## 3. Required Files & Locations

```
skills/
└── {name}/
    ├── SKILL.md       # Skill definition
    └── script.ts      # Optional script
```

## 4. How to Eval
- How to test the skill works?
- Trigger phrase tests?
- Script execution tests?

## 5. SKILL.md Format

```yaml
---
name: {skill-name}
description: What this skill does
triggers:
  - "trigger phrase 1"
  - "trigger phrase 2"
tools:
  - read
  - bash
---

## Usage

Describe how to use this skill and what it does.
```

## 6. Script Format

```typescript
// skills/{name}/script.ts
export async function run(params: { context: { tools: { read, write, bash, ... }, cwd: string } }) {
  const { tools, cwd } = params.context;
  
  // Your implementation
  const result = await tools.read({ path: "file.txt" });
  
  return { result: "done" };
}
```

## Output Structure

Create a spec file at `specs/skill/{name}/SPEC.md`:

```markdown
# Skill: {name}

## Intentions
- Purpose: ...
- Triggers: [list]
- Users: ...

## Tools Used
- [list]

## Files
- `skills/{name}/SKILL.md`
- `skills/{name}/script.ts` (if needed)

## How to Eval
- Test 1: ...
- Test 2: ...
```

## Skill Discovery

Skills are discovered from:
- `~/.pi/agent/skills/` (user-level)
- Project `.pi/skills/` (project-level)

Activated when user message matches a trigger phrase.
