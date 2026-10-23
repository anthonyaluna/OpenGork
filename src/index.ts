/**
 * OpenGork - Uncensored AI Agent
 * 
 * Supports:
 * - Local Ollama backend (100% uncensored)
 * - xAI API backend (partial filtering)
 */

import 'dotenv/config';
import { OpenGorkClient, SYSTEM_PROMPTS } from './client.js';
import type { OpenGorkConfig, Mode, Message } from './client.js';

export { OpenGorkClient, SYSTEM_PROMPTS };
export type { OpenGorkConfig, Mode, Message };

/**
 * Quick function for one-off prompts
 */
export async function gork(
  prompt: string,
  options: {
    mode?: Mode;
    backend?: 'local' | 'xai';
    model?: string;
    apiKey?: string;
  } = {}
): Promise<string> {
  const client = createClient({
    backend: options.backend,
    model: options.model,
    apiKey: options.apiKey,
  });

  return client.chat(prompt, options.mode || 'heretic');
}

/**
 * Create a configured client instance
 */
export function createClient(config?: Partial<OpenGorkConfig>): OpenGorkClient {
  const apiKey = config?.apiKey || (config?.backend === 'local' ? undefined : process.env.XAI_API_KEY);
  const backend = config?.backend || (apiKey ? 'xai' : 'local');
  const envModel = backend === 'xai' ? process.env.XAI_MODEL : process.env.OLLAMA_MODEL;

  return new OpenGorkClient({
    ...config,
    backend,
    apiKey,
    model: config?.model || envModel,
  });
}

export default gork;
