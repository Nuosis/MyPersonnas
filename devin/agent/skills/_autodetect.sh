#!/bin/bash
# Skill Auto-Detector
# Usage: source this in your shell or include in agent startup

check_and_load_skills() {
    local project_dir="${1:-.}"
    local skills_dir="$HOME/.pi/agent/skills"
    
    echo "🔍 Checking project for skill requirements..."
    echo ""
    
    # Check for Playwright
    if [ -f "$project_dir/playwright.config.ts" ] || [ -f "$project_dir/playwright.config.js" ]; then
        echo "✅ Playwright detected"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "📋 PLAYWRIGHT SKILL AUTO-LOADED"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        cat "$skills_dir/playwright-execution/SKILL.md"
        echo ""
        return 0
    fi
    
    echo "No framework-specific skills detected."
    return 1
}

# Run if called directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    check_and_load_skills "${1:-.}"
fi