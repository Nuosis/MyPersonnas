---
name: peekaboo
description: Give me "eyes and hands" on macOS — screen visibility, UI element identification, and mouse/keyboard control.
---

# Peekaboo Skill

Give me "eyes and hands" on macOS — screen visibility, UI element identification, and mouse/keyboard control.

## Installation (if CLI missing)

```bash
# Install via Homebrew
brew install polter/polter/peekaboo

# Or via pip
pip install peekaboo-polter

# Verify installation
peekaboo --version
peekaboo permissions  # Check required permissions
```

## Quick Start

```bash
# Check permissions first
peekaboo permissions

# See what's on screen
peekaboo see

# List windows/apps
peekaboo list windows
peekaboo list apps

# Capture screenshot
peekaboo image capture

# Run automation
peekaboo run my-script.peek
```

## Commands by Category

### Vision & Screen
| Command | Description |
|---------|-------------|
| `peekaboo see` | Capture and analyze UI elements |
| `peekaboo image capture` | Take a screenshot |
| `peekaboo capture` | Capture live screens/windows |
| `peekaboo visualizer` | Visual feedback animations |

### Interacting with UI
| Command | Description |
|---------|-------------|
| `peekaboo click <target>` | Click on UI element or coordinates |
| `peekaboo move <target>` | Move mouse to element/coordinates |
| `peekaboo drag <from> <to>` | Drag and drop |
| `peekaboo scroll <dir> <amount>` | Scroll wheel |
| `peekaboo type "text"` | Type text |
| `peekaboo hotkey cmd v` | Press keyboard shortcut |

### Windows & Apps
| Command | Description |
|---------|-------------|
| `peekaboo list windows` | List open windows |
| `peekaboo list apps` | List running apps |
| `peekaboo app launch "Safari"` | Launch app |
| `peekaboo app quit "Safari"` | Quit app |
| `peekaboo window move <id> <x> <y>` | Move window |
| `peekaboo space list` | List Spaces |

### Clipboard & System
| Command | Description |
|---------|-------------|
| `peekaboo clipboard read` | Read clipboard |
| `peekaboo clipboard write "text"` | Write to clipboard |
| `peekaboo dialog confirm "Are you sure?"` | Show dialog |
| `peekaboo open "https://..."` | Open URL |

### AI Agent
| Command | Description |
|---------|-------------|
| `peekaboo agent "Take a screenshot and describe what you see"` | Run AI agent task |

### MCP Server
| Command | Description |
|---------|-------------|
| `peekaboo mcp start` | Start MCP server |
| `peekaboo mcp status` | Check MCP status |

### Daemon & Config
| Command | Description |
|---------|-------------|
| `peekaboo daemon start` | Start headless daemon |
| `peekaboo daemon stop` | Stop daemon |
| `peekaboo config show` | Show current config |
| `peekaboo learn` | Full AI usage guide |

## Common Workflows

### Screenshot + Analysis
```bash
peekaboo image capture --output /tmp/screen.png
peekaboo see --image /tmp/screen.png
```

### Automate a click sequence
```bash
peekaboo click "Close Button"
peekaboo wait 500
peekaboo click "Save"
```

### Launch and use an app
```bash
peekaboo app launch "Safari"
peekaboo navigate "https://example.com"
```

### Check accessibility tree
```bash
peekaboo list windows --verbose
peekaboo see --interactive
```

## Output Formats

Use `--json` or `-j` for machine-readable output:
```bash
peekaboo list windows --json
peekaboo list apps --json
```

Use `--verbose` or `-v` for detailed logs:
```bash
peekaboo see --verbose
```

## Troubleshooting

```bash
# Check permissions
peekaboo permissions

# Verify daemon is running
peekaboo daemon status

# Clean up if issues
peekaboo clean

# View full help
peekaboo help <command>
peekaboo learn  # AI-focused guide
```

## Notes

- **polter** prefix: Run via `polter peekaboo` for fresh builds
- **Permissions**: macOS permissions required for screen capture and accessibility
- **Daemon**: Start with `peekaboo daemon start` for persistent services
- **JSON output**: Use `-j` flag for scripting/integrations
