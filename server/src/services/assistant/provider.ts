export interface AssistantCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface AssistantToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AssistantCompletionInput {
  systemPrompt?: string;
  userPrompt?: string;
  messages?: AssistantCompletionMessage[];
  tools?: AssistantToolDefinition[];
}

export interface AssistantToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

export interface AssistantProviderResult {
  provider: string;
  model: string;
  content: string;
  toolCalls: AssistantToolCall[];
}

function normalizeMessages(input: AssistantCompletionInput): AssistantCompletionMessage[] {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return input.messages;
  }
  return [
    { role: 'system', content: input.systemPrompt || '' },
    { role: 'user', content: input.userPrompt || '' },
  ];
}

export async function completeWithLocalModel(input: AssistantCompletionInput): Promise<AssistantProviderResult> {
  const baseUrl = (process.env.AI_ASSISTANT_LOCAL_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
  const model = process.env.AI_ASSISTANT_LOCAL_MODEL || '';
  const apiKey = process.env.AI_ASSISTANT_LOCAL_API_KEY || '';
  const requestUrl = `${baseUrl}/chat/completions`;

  if (!model) {
    throw new Error('Local assistant model is not configured. Set AI_ASSISTANT_LOCAL_MODEL.');
  }

  const messages = normalizeMessages(input);
  const payload: Record<string, unknown> = {
    model,
    temperature: 0.2,
    messages,
  };
  if (Array.isArray(input.tools) && input.tools.length > 0) {
    payload.tools = input.tools;
    payload.tool_choice = 'auto';
  }

  console.info('[assistant] local model request:start', {
    requestUrl,
    model,
    messageCount: messages.length,
    toolCount: Array.isArray(input.tools) ? input.tools.length : 0,
  });

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('[assistant] local model request:network_error', {
      requestUrl,
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  console.info('[assistant] local model request:response', {
    requestUrl,
    model,
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error('[assistant] local model request:error_body', {
      requestUrl,
      model,
      status: response.status,
      body,
    });
    throw new Error(`Local assistant request failed (${response.status}): ${body || 'unknown error'}`);
  }

  const data = await response.json() as any;
  const message = data?.choices?.[0]?.message || {};
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
      .filter((toolCall: any) => toolCall?.type === 'function' && toolCall?.function?.name)
      .map((toolCall: any) => ({
        id: String(toolCall.id || ''),
        name: String(toolCall.function.name),
        argumentsText: String(toolCall.function.arguments || '{}'),
      }))
    : [];

  if (!content && toolCalls.length === 0) {
    throw new Error('Local assistant returned an empty response.');
  }

  return {
    provider: 'local',
    model,
    content,
    toolCalls,
  };
}
