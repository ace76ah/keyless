// Spike only. Install the optional SDK with: npm install --no-save openai
// This fake key is sent only to the local mock. Never replace it with a real key.
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'local-spike-placeholder-not-a-real-key',
  baseURL: 'http://127.0.0.1:8787/c/openai/v1'
});

const result = await client.responses.create({
  model: 'gpt-4.1-mini',
  input: 'Reply with one short sentence.'
});

console.log(result.output_text);
