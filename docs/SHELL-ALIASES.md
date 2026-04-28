# Shell Aliases for Personas

Pi runs bash in non-interactive mode, which doesn't expand shell aliases by default.

## Step 1: Add Aliases to Your Shell Config

Add persona aliases to `~/.zshrc` (or `~/.bashrc`):

```bash
# Persona aliases
alias claire="pi --persona claire"
alias devin="pi --persona devin"
alias pi="pi --persona pi"
```

Then reload your shell:
```bash
source ~/.zshrc
```

## Step 2: Enable Alias Expansion in Pi

Add to `~/.pi/agent/settings.json`:

```json
{
  "shellCommandPrefix": "shopt -s expand_aliases\neval \"$(grep '^alias ' ~/.zshrc)\""
}
```

## Usage

Now you can launch a persona directly:

```bash
claire          # Launch Claire persona
devin           # Launch Devin persona  
pi              # Launch Pi persona
```

> **Note:** Adjust the path (`~/.zshrc`, `~/.bashrc`) to match your shell config.
