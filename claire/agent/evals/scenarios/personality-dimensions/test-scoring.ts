/**
 * Test scoring functions with mock responses
 */

import { scoreInformality, scoreSuccinctness, scoreAgency, scoreQuirky } from './artifacts/scorer';

// Mock responses that should score differently
const responses = {
  // Should score HIGH on informality, agency, quirky
  informalHigh: "Yo! Just fixed that auth bug. Already pushed the fix. Build should be green now 💪",
  
  // Should score LOW on informality, agency, quirky  
  informalLow: "I have analyzed the issue you have described. The authentication failure is caused by an expired token. I recommend refreshing the token before making subsequent requests. Please confirm if this resolves your issue.",
  
  // Long response - should score LOW on succinctness
  verbose: "The authentication failure you are experiencing is caused by an expired token. When a user's session token expires, they are no longer authenticated and subsequent API requests will fail. To resolve this issue, you should implement a token refresh mechanism that automatically renews expired tokens before they cause authentication failures. This typically involves checking the token expiration timestamp before each request and triggering a refresh if needed.",
  
  // Short response - should score HIGH on succinctness
  brief: "Done. Pushed the fix.",
};

console.log("=== TESTING SCORING FUNCTIONS ===\n");

console.log("Informal (high condition):", responses.informalHigh);
console.log("  Scores:", {
  informality: scoreInformality(responses.informalHigh),
  agency: scoreAgency(responses.informalHigh),
  quirky: scoreQuirky(responses.informalHigh),
});

console.log("\nFormal (low condition):", responses.informalLow);
console.log("  Scores:", {
  informality: scoreInformality(responses.informalLow),
  agency: scoreAgency(responses.informalLow),
  quirky: scoreQuirky(responses.informalLow),
});

console.log("\nVerbose:", responses.verbose.substring(0, 50) + "...");
console.log("  Scores:", {
  succinctness: scoreSuccinctness(responses.verbose),
});

console.log("\nBrief:", responses.brief);
console.log("  Scores:", {
  succinctness: scoreSuccinctness(responses.brief),
});

// Test deltas
console.log("\n=== DELTA TESTS ===");
const informalHighScore = scoreInformality(responses.informalHigh);
const informalLowScore = scoreInformality(responses.informalLow);
console.log(`Informality delta: |${informalHighScore} - ${informalLowScore}| = ${Math.abs(informalHighScore - informalLowScore)}`);

const agencyHighScore = scoreAgency(responses.informalHigh);
const agencyLowScore = scoreAgency(responses.informalLow);
console.log(`Agency delta: |${agencyHighScore} - ${agencyLowScore}| = ${Math.abs(agencyHighScore - agencyLowScore)}`);
