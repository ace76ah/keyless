const response = await fetch('http://127.0.0.1:8787/c/openai/v1/responses', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer local-spike-placeholder-not-a-real-key'
  },
  body: JSON.stringify({
    model: 'gpt-4.1-mini',
    input: 'Please reply with a short greeting.'
  })
});

console.log('status:', response.status);
console.log('mock:', response.headers.get('x-keyless-spike'));
console.log(await response.json());
