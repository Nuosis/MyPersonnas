# My Pi Config

Personal pi coding assistant configuration.

## Quick Start

### Clone to New Machine

```bash
# Clone this repo to ~/.pi
git clone git@github.com:Nuosis/.pi.git ~/.pi
```

### Install pi (if not already installed)

```bash
# Via Homebrew
brew install mariozechner/tap/pi

# Or npm
npm install -g @mariozechner/pi-coding-agent
```

## What's Included

### Extensions (`agent/extensions/`)
- **task-mode** — Persistent task queue with gate file evaluation
- **subagent** — Spawn specialized subagents (scout, worker, etc.)

### Extensions (`extensions/`)
- **devflow-tools** — DevFlow integration + spawn_agent with skills support

### Agents (`agent/agents/`)
- scout, worker, planner, reviewer — Specialized personas
- task-worker — Task execution agent

### Skills (`agent/skills/`)
- task-mode — How to use the task system

## Usage

### Basic

```bash
# Interactive session
pi

# With session persistence
pi --session work.jsonl
```

### With Extensions

```bash
# Auto-loads extensions from ~/.pi/agent/extensions/
pi

# Or load specific extension
pi -e ~/.pi/extensions/devflow-tools.ts
```

### Spawn Subagents

```bash
# Use subagent tool in interactive mode
"Use scout agent to investigate..."

# Or via devflow-tools spawn_agent
```

## Managing Extensions

### List Installed Extensions

```bash
pi list
```

### Update Extensions

```bash
pi update
```

## Sync Changes

```bash
cd ~/.pi
git add -A
git commit -m "describe changes"
git push MyPi
```

## File Locations

| Path | Purpose |
|------|---------|
| `agent/extensions/` | Auto-loaded extensions |
| `extensions/` | Manual-load extensions |
| `agent/agents/` | Agent persona definitions |
| `agent/skills/` | Skill definitions |
| `agent/sessions/` | Session history (not synced) |
| `agent/auth.json` | API keys (not synced) |

## Troubleshooting

### Extensions not loading?

```bash
# Check extension path
ls ~/.pi/agent/extensions/

# Reload in session
/reload
```

### Need to reset?

```bash
# Fresh clone (keeps sessions)
rm -rf ~/.pi/agent/extensions ~/.pi/agent/agents ~/.pi/agent/skills
git checkout HEAD -- agent/
```
