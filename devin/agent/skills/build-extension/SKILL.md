---
name: build-extension
description: Guide for spec'ing a new Pi extension with tools, commands, events, and TUI components
triggers:
  - "build an extension"
  - "forge an extension"
  - "create extension spec"
tools:
  - read
  - write
  - edit
---

# Build Extension Spec

When spec'ing an extension, you need to define:

## 1. Intentions/Context
- **Purpose**: What capability does this extension add?
- **Trigger**: How is it activated? (tool call, command, event, keyboard)
- **Target users**: Who benefits from this?
- **Owner**: Who maintains this extension?

## 2. Decisions to Articulate

### Tools
- **Name**: kebab-case (e.g., `my-tool`)
- **Label**: Human-readable (e.g., "My Tool")
- **Description**: What does it do?
- **Parameters**: TypeBox schema defining inputs
- **Execute**: What does it do? (async function with params)
- **Render**: Custom call/result rendering? (renderCall, renderResult)

### Commands
- **Name**: kebab-case (e.g., `/my-cmd`)
- **Description**: What does `/my-cmd` do?
- **getArgumentCompletions**: Optional tab completion
- **Handler**: Async function (args, ctx) => void

### Events
- **Which events**: session_start, session_shutdown, tool_execution_start, tool_execution_end, etc.
- **Handler**: What to do when event fires

### TUI Components
- **Widget**: Custom widget above/below editor
- **Footer**: Custom footer rendering
- **Notifications**: What alerts to show?

### State
- **Module-level state**: What persists across calls?
- **Session lifecycle**: What initializes/resets on session_start?

## 3. Required Files & Locations
```
extensions/
└── {name}.ts          # Extension implementation
```

## 4. Extension Template

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  
  // Initialize state
  let myState = { /* ... */ };
  
  // Register tools
  pi.registerTool({
    name: "my-tool",
    label: "My Tool",
    description: "Does something useful",
    parameters: Type.Object({
      input: Type.String(),
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { input } = params as { input: string };
      // Implementation
      return {
        content: [{ type: "text", text: "result" }],
        details: { /* optional metadata */ }
      };
    },
  });

  // Register commands
  pi.registerCommand("my-cmd", {
    description: "Does something",
    getArgumentCompletions: (prefix) => { /* return completions */ },
    handler: async (args, ctx) => {
      ctx.ui.notify("Done", "info");
    },
  });

  // Register event handlers
  pi.on("session_start", async (_event, ctx) => {
    // Initialize state on session start
  });
  
  pi.on("session_shutdown", async () => {
    // Cleanup on session end
  });
}
```

## 5. Extension API Reference

### ctx in execute/handler
```typescript
ctx.cwd          // Current working directory
ctx.model        // Current model { provider, id }
ctx.ui           // UI methods
ctx.abort()      // Abort current agent turn
ctx.sendUserMessage()  // Send message as user
```

### ctx.ui methods
```typescript
ctx.ui.notify(message, type)  // "info", "warning", "error"
ctx.ui.select(title, options)   // Returns selected option
ctx.ui.input(title, placeholder)
ctx.ui.confirm(title, message)
ctx.ui.setWidget(key, component)
ctx.ui.setStatus(key, text)
ctx.ui.setWorkingMessage(message)
ctx.ui.onTerminalInput(handler)
```

## 6. How to Eval
- What test scenarios prove it works?
- Edge cases to test?
- Error conditions?

## Output Structure

Create a spec file at `specs/extension/{name}/SPEC.md`:

```markdown
# Extension: {name}

## Intentions
- Purpose: ...
- Trigger: ...
- Owner: ...

## Tools
- `{name}`: description

## Commands
- `/{name}`: description

## Events
- `{event}`: what happens

## State
- Module-level: ...

## Files
- `extensions/{name}.ts`
```

## Extension Discovery

Extensions are discovered from:
- `~/.pi/agent/extensions/` (user-level)
- Project `.pi/extensions/` (project-level)
- Settings.json `extensions` array (explicit paths)

Also loaded via `--extension` / `-e` CLI flag.