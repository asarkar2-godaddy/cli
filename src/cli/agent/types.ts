export type NextActionParamValue = string | number | boolean;

export interface NextActionParam {
  description?: string;
  value?: NextActionParamValue;
  default?: NextActionParamValue;
  enum?: Array<string | number>;
  required?: boolean;
}

export interface NextAction {
  command: string;
  description: string;
  params?: Record<string, NextActionParam>;
}

export interface AgentSuccessEnvelope<T = unknown> {
  ok: true;
  command: string;
  result: T;
  next_actions: NextAction[];
}

export interface AgentErrorEnvelope {
  ok: false;
  command: string;
  error: {
    message: string;
    code: string;
  };
  fix: string;
  next_actions: NextAction[];
}

export type AgentEnvelope<T = unknown> =
  | AgentSuccessEnvelope<T>
  | AgentErrorEnvelope;
