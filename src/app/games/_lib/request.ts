export const GAME_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchGameRequest(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = GAME_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export function gameRequestErrorMessage(error: unknown, timeoutMessage: string, fallbackMessage: string): string {
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
    return timeoutMessage;
  }
  return error instanceof Error ? error.message : fallbackMessage;
}
