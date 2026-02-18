export interface SlackThreadSessionKeyInput {
  channel: string;
  threadTs: string;
}

export interface SlackThreadSessionStore {
  markThreadStarted(input: SlackThreadSessionKeyInput): boolean;
  isThreadStarted(input: SlackThreadSessionKeyInput): boolean;
}

function normalizeThreadSessionKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

function buildThreadSessionKey(input: SlackThreadSessionKeyInput): string {
  const channel = normalizeThreadSessionKeyPart(input.channel);
  const threadTs = normalizeThreadSessionKeyPart(input.threadTs);
  return `${channel}::${threadTs}`;
}

export function createSlackThreadSessionStore(): SlackThreadSessionStore {
  const startedThreadSessions = new Set<string>();

  return {
    markThreadStarted(input) {
      const sessionKey = buildThreadSessionKey(input);
      const existed = startedThreadSessions.has(sessionKey);
      startedThreadSessions.add(sessionKey);
      return !existed;
    },
    isThreadStarted(input) {
      return startedThreadSessions.has(buildThreadSessionKey(input));
    },
  };
}
