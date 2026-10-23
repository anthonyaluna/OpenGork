import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import defaultGork, { createClient, gork, SYSTEM_PROMPTS } from '../src/index.js';
import type { OpenGorkConfig } from '../src/index.js';

const environmentKeys = ['XAI_API_KEY', 'XAI_MODEL', 'OLLAMA_MODEL'] as const;
type Environment = Partial<Record<typeof environmentKeys[number], string>>;

interface RoutingCase {
  name: string;
  entry: 'createClient' | 'gork';
  env: Environment;
  config?: Partial<OpenGorkConfig>;
  url: string;
  model: string;
  authorization: string | null;
  healthUrl?: string;
}

const cases: RoutingCase[] = [
  {
    name: 'createClient defaults to unauthenticated local mode without environment settings',
    entry: 'createClient', env: {},
    url: 'http://localhost:11434/api/chat', model: 'dolphin-mixtral:8x7b', authorization: null,
    healthUrl: 'http://localhost:11434/api/tags',
  },
  {
    name: 'createClient ignores OLLAMA_MODEL when an environment key selects xAI',
    entry: 'createClient', env: { XAI_API_KEY: 'synthetic-env-key', OLLAMA_MODEL: 'local-only-model' },
    url: 'https://api.x.ai/v1/chat/completions', model: 'grok-3', authorization: 'Bearer synthetic-env-key',
    healthUrl: 'https://api.x.ai/v1/models',
  },
  {
    name: 'createClient selects XAI_MODEL when both backend models are set',
    entry: 'createClient', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model', OLLAMA_MODEL: 'local-env-model' },
    url: 'https://api.x.ai/v1/chat/completions', model: 'xai-env-model', authorization: 'Bearer synthetic-env-key',
  },
  {
    name: 'createClient uses the environment key and model when config fields are undefined',
    entry: 'createClient', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model' },
    config: { backend: undefined, apiKey: undefined, model: undefined },
    url: 'https://api.x.ai/v1/chat/completions', model: 'xai-env-model', authorization: 'Bearer synthetic-env-key',
  },
  {
    name: 'createClient explicit local mode ignores xAI environment settings',
    entry: 'createClient', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-only-model' },
    config: { backend: 'local' },
    url: 'http://localhost:11434/api/chat', model: 'dolphin-mixtral:8x7b', authorization: null,
    healthUrl: 'http://localhost:11434/api/tags',
  },
  {
    name: 'createClient explicit local mode uses OLLAMA_MODEL without sending a supplied key',
    entry: 'createClient', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model', OLLAMA_MODEL: 'local-env-model' },
    config: { backend: 'local', apiKey: 'synthetic-option-key' },
    url: 'http://localhost:11434/api/chat', model: 'local-env-model', authorization: null,
    healthUrl: 'http://localhost:11434/api/tags',
  },
  {
    name: 'createClient preserves caller endpoint model key and temperature overrides',
    entry: 'createClient', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model', OLLAMA_MODEL: 'local-env-model' },
    config: { baseUrl: 'https://proxy.example.test/v1', model: 'caller-model', apiKey: 'synthetic-option-key', temperature: 0.4 },
    url: 'https://proxy.example.test/v1/chat/completions', model: 'caller-model', authorization: 'Bearer synthetic-option-key',
    healthUrl: 'https://proxy.example.test/v1/models',
  },
  {
    name: 'gork defaults to local mode and uses OLLAMA_MODEL',
    entry: 'gork', env: { OLLAMA_MODEL: 'local-env-model' },
    url: 'http://localhost:11434/api/chat', model: 'local-env-model', authorization: null,
  },
  {
    name: 'gork uses XAI_MODEL when an environment key selects xAI',
    entry: 'gork', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model', OLLAMA_MODEL: 'local-env-model' },
    url: 'https://api.x.ai/v1/chat/completions', model: 'xai-env-model', authorization: 'Bearer synthetic-env-key',
  },
  {
    name: 'gork explicit local mode uses OLLAMA_MODEL without sending a supplied key',
    entry: 'gork', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model', OLLAMA_MODEL: 'local-env-model' },
    config: { backend: 'local', apiKey: 'synthetic-option-key' },
    url: 'http://localhost:11434/api/chat', model: 'local-env-model', authorization: null,
  },
  {
    name: 'gork explicit local mode falls back locally when only XAI_MODEL is set',
    entry: 'gork', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model' },
    config: { backend: 'local' },
    url: 'http://localhost:11434/api/chat', model: 'dolphin-mixtral:8x7b', authorization: null,
  },
  {
    name: 'gork preserves caller model and key over environment settings',
    entry: 'gork', env: { XAI_API_KEY: 'synthetic-env-key', XAI_MODEL: 'xai-env-model', OLLAMA_MODEL: 'local-env-model' },
    config: { model: 'caller-model', apiKey: 'synthetic-option-key' },
    url: 'https://api.x.ai/v1/chat/completions', model: 'caller-model', authorization: 'Bearer synthetic-option-key',
  },
];

// Only the network boundary is replaced. Real public wrappers construct and use
// the client. Environment and fetch changes never outlive an individual test.
async function withEnvironmentAndRequests(
  env: Environment,
  check: (requests: { url: string; init?: RequestInit }[]) => Promise<void>,
) {
  const originalEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const requests: { url: string; init?: RequestInit }[] = [];
  for (const key of environmentKeys) {
    delete process.env[key];
    if (env[key] !== undefined) process.env[key] = env[key];
  }
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'synthetic response' } }],
      message: { content: 'synthetic response' },
    }), { status: 200 });
  };
  try {
    await check(requests);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of environmentKeys) {
      const originalValue = originalEnvironment.get(key);
      if (originalValue === undefined) delete process.env[key];
      else process.env[key] = originalValue;
    }
  }
}

describe('SDK wrapper configuration', { concurrency: false }, () => {
  for (const testCase of cases) {
    it(testCase.name, () => withEnvironmentAndRequests(testCase.env, async requests => {
      if (testCase.entry === 'createClient') {
        const client = createClient(testCase.config);
        assert.equal(await client.chat('synthetic prompt'), 'synthetic response');
        if (testCase.healthUrl) assert.equal(await client.healthCheck(), true);
      } else {
        assert.equal(await gork('synthetic prompt', testCase.config), 'synthetic response');
      }
      assert.deepEqual(requests.map(request => request.url), testCase.healthUrl
        ? [testCase.url, testCase.healthUrl] : [testCase.url]);
      const body = JSON.parse(String(requests[0].init?.body));
      assert.equal(body.model, testCase.model);
      if (testCase.config?.temperature !== undefined) {
        assert.equal(body.temperature, testCase.config.temperature);
      }
      for (const request of requests) {
        assert.equal(new Headers(request.init?.headers).get('Authorization'), testCase.authorization);
      }
    }));
  }

  it('default gork export preserves the selected system-prompt mode', () => withEnvironmentAndRequests({}, async requests => {
    assert.equal(await defaultGork('synthetic prompt', { mode: 'genius' }), 'synthetic response');
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)).messages, [
      { role: 'system', content: SYSTEM_PROMPTS.genius },
      { role: 'user', content: 'synthetic prompt' },
    ]);
  }));
});
