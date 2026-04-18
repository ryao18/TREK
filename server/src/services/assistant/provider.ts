export interface AssistantCompletionInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface AssistantProviderResult {
  provider: string;
  model: string;
  content: string;
}

export async function completeWithLocalModel(input: AssistantCompletionInput): Promise<AssistantProviderResult> {
  const baseUrl = (process.env.AI_ASSISTANT_LOCAL_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
  const model = process.env.AI_ASSISTANT_LOCAL_MODEL || '';
  const apiKey = process.env.AI_ASSISTANT_LOCAL_API_KEY || '';

  if (!model) {
    throw new Error('Local assistant model is not configured. Set AI_ASSISTANT_LOCAL_MODEL.');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Local assistant request failed (${response.status}): ${body || 'unknown error'}`);
  }

  const data = await response.json() as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Local assistant returned an empty response.');
  }

  return {
    provider: 'local',
    model,
    content: content.trim(),
  };
}

