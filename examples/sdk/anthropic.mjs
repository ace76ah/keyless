// Spike only. Install the optional SDK with: npm install --no-save @anthropic-ai/sdk
// This fake key is sent only to the local mock. Never replace it with a real key.
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: 'local-spike-placeholder-not-a-real-key',
  baseURL: 'http://127.0.0.1:8787/c/anthropic'
});

const result = await client.messages.create({
  model: 'claude-test',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'Reply with one short sentence.' }]
});

console.log(result.content);
