/**
 * Quick test to verify LLM scorer can be called
 * Note: This will make actual LLM calls
 */

import { scoreResponse } from './artifacts/scorer-llm';

const testResponses = [
  // High quirky, high informal, high agency
  "Yo! Just fixed that auth bug. Already pushed the fix. Build should be green now 💪",
  
  // Low quirky, low informal, low agency
  "I have analyzed the issue you have described. The authentication failure is caused by an expired token. I recommend refreshing the token before making subsequent requests. Please confirm if this resolves your issue.",
  
  // Mid range
  "The build is failing. Looks like a missing dependency. I can add it to package.json and run npm install.",
];

async function test() {
  console.log("Testing LLM scorer...\n");
  
  for (let i = 0; i < testResponses.length; i++) {
    const response = testResponses[i];
    console.log(`Response ${i + 1}: ${response.substring(0, 60)}...`);
    
    try {
      const scores = await scoreResponse(response);
      console.log("Scores:", scores);
    } catch (e) {
      console.log("Error:", e.message);
    }
    console.log();
  }
}

test().catch(console.error);