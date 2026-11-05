const response = await fetch('http://127.0.0.1:8787/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-keyless-credential': 'anthropic',
    'x-api-key': 'local-spike-placeholder-not-a-real-key'
  },
  body: JSON.stringify({
    model: 'claude-test',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Please reply with a short greeting.' }]
  })
});

console.log('status:', response.status);
console.log('mock:', response.headers.get('x-keyless-spike'));
console.log(await response.json());
