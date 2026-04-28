# Shell Aliases for Personas

Pi runs bash in non-interactive mode, which doesn't expand shell aliases by default.

## Step 1: Add Functions to Your Shell Config

Add persona launchers to `~/.zshrc` (or `~/.bashrc`):

```bash
# Persona aliases - load only persona's own extensions
pi-claire() {
  cd ~/.pi/personas/claire
  local ext_args=()
  for ext in agent/extensions/*.ts(N); do [ -f "$ext" ] && ext_args+=("-e" "$ext"); done
  for dir in agent/extensions/*/; do [ -f "${dir}index.ts" ] && ext_args+=("-e" "${dir}index.ts"); done
  pi --no-extensions "${ext_args[@]}"
}

pi-devin() {
  cd ~/.pi/personas/devin
  local ext_args=()
  for ext in agent/extensions/*.ts(N); do [ -f "$ext" ] && ext_args+=("-e" "$ext"); done
  for dir in agent/extensions/*/; do [ -f "${dir}index.ts" ] && ext_args+=("-e" "${dir}index.ts"); done
  pi --no-extensions "${ext_args[@]}"
}

pi-pi() {
  cd ~/.pi/personas/pi
  local ext_args=()
  for ext in agent/extensions/*.ts(N); do [ -f "$ext" ] && ext_args+=("-e" "$ext"); done
  for dir in agent/extensions/*/; do [ -f "${dir}index.ts" ] && ext_args+=("-e" "${dir}index.ts"); done
  pi --no-extensions "${ext_args[@]}"
}
```

### What Each Function Does

1. `cd` into the persona directory (pi loads config from current directory)
2. Scans for `.ts` files in `agent/extensions/` (individual extensions)
3. Scans for `index.ts` in subdirectories (extension packages)
4. Launches `pi --no-extensions` with `-e` flags for each found extension

### Why `--no-extensions` + Explicit `-e`?

Each persona runs with **only its own extensions** to prevent cross-contamination. Without `--no-extensions`, pi would also load extensions from `~/.pi/agent/extensions/`.

## Step 2: Enable Alias Expansion in Pi

Add to `~/.pi/agent/settings.json`:

```json
{
  "shellCommandPrefix": "shopt -s expand_aliases\neval \"$(grep '^alias ' ~/.zshrc)\""
}
```

## Usage

Now you can launch a persona with its isolated extensions:

```bash
source ~/.zshrc        # Reload shell config (or open new terminal)
pi-claire             # Launch Claire with only Claire's extensions
pi-devin              # Launch Devin with only Devin's extensions
pi-pi                 # Launch Pi with only Pi's extensions
```

> **Note:** Adjust the path (`~/.zshrc`, `~/.bashrc`) to match your shell config.
