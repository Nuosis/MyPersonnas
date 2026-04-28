/**
 * Theme Map - Extension defaults
 * This file provides default theming for agent extensions
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function applyExtensionDefaults(_url: string, _ctx: ExtensionAPI): void {
	// Stub - themeMap functionality not implemented
	// Original implementation would apply default theme settings
}

// Default export (required for extension auto-discovery)
export default function (_pi: ExtensionAPI) {
	// No-op: applyExtensionDefaults is called by extensions that need it
}