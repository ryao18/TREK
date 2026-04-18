export interface AssistantHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantQueryContext {
  selected_day_id?: number | null;
  selected_place_id?: number | null;
  selected_assignment_id?: number | null;
  active_tab?: string | null;
}

export interface AssistantQueryInput {
  tripId: number;
  userId: number;
  message: string;
  history?: AssistantHistoryMessage[];
  context?: AssistantQueryContext;
}

export interface AssistantCitation {
  type: string;
  id?: number | string | null;
  label: string;
  meta?: Record<string, unknown>;
}

export interface AssistantSuggestedAction {
  type: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface AssistantResponse {
  message: {
    role: 'assistant';
    content: string;
  };
  citations: AssistantCitation[];
  suggested_actions: AssistantSuggestedAction[];
  warnings: string[];
  missing_data: string[];
  follow_up_prompts: string[];
  meta: {
    provider: string;
    model: string;
    tools_used: string[];
  };
}

