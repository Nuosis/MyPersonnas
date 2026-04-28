import { getModel, complete } from '@mariozechner/pi-ai';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCORING_PROMPT = fs.readFileSync(
  path.join(__dirname, 'artifacts', 'scoring-prompt.md'),
  'utf-8'
);

async function test() {
  const model = getModel('openai', 'gpt-5.2');
  console.log('=== DEBUG ===');
  console.log('model:', JSON.stringify(model, null, 2));
  console.log('model.api:', model?.api);
  console.log('typeof model:', typeof model);
  console.log('model.constructor.name:', model?.constructor?.name);
  console.log('Object.keys(model):', model ? Object.keys(model) : 'N/A');
  console.log('===========');
  
  if (!model || !model.api) {
    console.error('model.api is undefined!');
    return;
  }
  
  const result = await complete(
    model, 
    { messages: [{ role: 'user', content: 'Say hello' }] }, 
    { temperature: 0.3 }
  );
  console.log('Result:', result);
}

test().catch(console.error);
