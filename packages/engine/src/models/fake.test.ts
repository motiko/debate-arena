import { expect, test } from 'vitest';
import { FakeModelClient } from './fake';

test('records calls and uses the default reply', async () => {
  const client = new FakeModelClient();
  const res = await client.complete({ model: 'a/x', messages: [{ role: 'user', content: 'hi there' }], maxOutputTokens: 10 });
  expect(res.text).toBe('Fake reply from a/x.');
  expect(res.inputTokens).toBe(2);
  expect(res.outputTokens).toBe(5); // "Fake reply from a/x." → Fake, reply, from, a, x
  expect(client.calls).toHaveLength(1);
});

test('streams the reply word by word, cumulatively, when asked', async () => {
  const seen: string[] = [];
  const request = { model: 'a/x', messages: [{ role: 'user' as const, content: 'hi' }], maxOutputTokens: 10 };
  const reply = await new FakeModelClient(() => 'One two  three.').complete(request, { onText: t => seen.push(t) });
  expect(seen).toEqual(['One', 'One two', 'One two  three.']);
  expect(reply.text).toBe('One two  three.');
});

test('uses a scripted responder', async () => {
  const client = new FakeModelClient(() => 'scripted');
  expect((await client.complete({ model: 'a/x', messages: [], maxOutputTokens: 1 })).text).toBe('scripted');
});
