/**
 * OpenGork Client Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { OpenGorkClient, SYSTEM_PROMPTS } from '../src/client.js';

async function captureRequests(check: (requests: { url: string; init?: RequestInit }[]) => Promise<void>) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'test response' } }],
      message: { content: 'test response' },
    }), { status: 200 });
  };
  try {
    await check(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('OpenGorkClient', () => {
  describe('initialization', () => {
    it('should default to local backend without API key', () => {
      const client = new OpenGorkClient({});
      assert.ok(client);
    });

    it('should use xai backend when API key provided', () => {
      const client = new OpenGorkClient({ apiKey: 'test-key' });
      assert.ok(client);
    });
  });

  describe('system prompts', () => {
    it('should have all required modes', () => {
      const modes = ['heretic', 'savage', 'based', 'genius', 'chaos'];
      modes.forEach(mode => {
        assert.ok(SYSTEM_PROMPTS[mode as keyof typeof SYSTEM_PROMPTS]);
      });
    });

    it('should have non-empty prompts', () => {
      Object.values(SYSTEM_PROMPTS).forEach(prompt => {
        assert.ok(prompt.length > 50);
      });
    });
  });

  describe('request routing', () => {
    it('uses xAI endpoint and model when only an API key is provided', () => captureRequests(async (requests) => {
      const client = new OpenGorkClient({ apiKey: 'synthetic-test-key' });

      assert.equal(await client.chat('test prompt'), 'test response');
      assert.equal(requests[0].url, 'https://api.x.ai/v1/chat/completions');
      assert.equal(new Headers(requests[0].init?.headers).get('Authorization'), 'Bearer synthetic-test-key');
      assert.equal(JSON.parse(String(requests[0].init?.body)).model, 'grok-3');
    }));

    it('uses the xAI health endpoint when only an API key is provided', () => captureRequests(async (requests) => {
      const client = new OpenGorkClient({ apiKey: 'synthetic-test-key' });

      assert.equal(await client.healthCheck(), true);
      assert.equal(requests[0].url, 'https://api.x.ai/v1/models');
      assert.equal(new Headers(requests[0].init?.headers).get('Authorization'), 'Bearer synthetic-test-key');
    }));

    it('keeps default local requests unauthenticated', () => captureRequests(async (requests) => {
      const client = new OpenGorkClient();

      await client.chat('test prompt');
      await client.healthCheck();
      assert.deepEqual(requests.map(request => request.url), [
        'http://localhost:11434/api/chat',
        'http://localhost:11434/api/tags',
      ]);
      assert.equal(JSON.parse(String(requests[0].init?.body)).model, 'dolphin-mixtral:8x7b');
      for (const request of requests) {
        assert.equal(new Headers(request.init?.headers).get('Authorization'), null);
      }
    }));

    it('honors explicit local selection without sending a supplied key', () => captureRequests(async (requests) => {
      const client = new OpenGorkClient({ backend: 'local', apiKey: 'synthetic-test-key' });

      await client.chat('test prompt');
      await client.healthCheck();
      assert.deepEqual(requests.map(request => request.url), [
        'http://localhost:11434/api/chat',
        'http://localhost:11434/api/tags',
      ]);
      for (const request of requests) {
        assert.equal(new Headers(request.init?.headers).get('Authorization'), null);
      }
    }));

    it('preserves explicit xAI defaults', () => captureRequests(async (requests) => {
      const client = new OpenGorkClient({ backend: 'xai', apiKey: 'synthetic-test-key' });

      await client.chat('test prompt');
      assert.equal(requests[0].url, 'https://api.x.ai/v1/chat/completions');
      assert.equal(JSON.parse(String(requests[0].init?.body)).model, 'grok-3');
    }));

    it('preserves caller-selected xAI endpoint and model overrides', () => captureRequests(async (requests) => {
      const client = new OpenGorkClient({
        apiKey: 'synthetic-test-key',
        baseUrl: 'https://proxy.example.test/v1',
        model: 'custom-model',
      });

      await client.chat('test prompt');
      await client.healthCheck();
      assert.deepEqual(requests.map(request => request.url), [
        'https://proxy.example.test/v1/chat/completions',
        'https://proxy.example.test/v1/models',
      ]);
      assert.equal(JSON.parse(String(requests[0].init?.body)).model, 'custom-model');
      for (const request of requests) {
        assert.equal(new Headers(request.init?.headers).get('Authorization'), 'Bearer synthetic-test-key');
      }
    }));
  });
});

describe('Integration', () => {
  it('should be importable', async () => {
    const { gork, createClient } = await import('../src/index.js');
    assert.ok(typeof gork === 'function');
    assert.ok(typeof createClient === 'function');
  });

  it('uses xAI defaults through both SDK wrappers when supplied a key', () => captureRequests(async (requests) => {
    const { gork, createClient } = await import('../src/index.js');

    await gork('test prompt', { apiKey: 'synthetic-test-key' });
    await createClient({ apiKey: 'synthetic-test-key', model: undefined }).chat('test prompt');
    assert.deepEqual(requests.map(request => request.url), [
      'https://api.x.ai/v1/chat/completions',
      'https://api.x.ai/v1/chat/completions',
    ]);
  }));
});
