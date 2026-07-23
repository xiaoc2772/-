import type { PianoTilesMode } from './types';

/** 一次开局尝试的客户端幂等标识。 */
export interface PianoStartAttempt {
  requestId: string;
  chartId: string;
  mode: PianoTilesMode;
  checksum: string;
  /** 当前尝试是否已经消耗过一次自动重试额度。 */
  automaticRetryUsed: boolean;
}

export interface PianoStartResult {
  sessionId: string;
  automaticRetryUsed: boolean;
}

export interface PianoStartRetryOptions {
  requestId: string;
  /** 用户再次点击时可关闭自动补发，避免每次点击都产生两次请求。 */
  allowAutomaticRetry?: boolean;
  send: (requestId: string) => Promise<Response>;
}

interface StartPayload {
  message?: unknown;
  data?: {
    sessionId?: unknown;
  } | null;
}

interface UncertainOutcome {
  kind: 'uncertain';
  message: string;
  status: number | null;
}

interface DefinitiveOutcome {
  kind: 'definitive';
  message: string;
  status: number;
}

interface SuccessOutcome {
  kind: 'success';
  sessionId: string;
}

type AttemptOutcome = SuccessOutcome | UncertainOutcome | DefinitiveOutcome;

/** 开局请求失败，uncertain=true 表示服务器是否已落库尚不能确定。 */
export class PianoStartRequestError extends Error {
  readonly uncertain: boolean;
  readonly status: number | null;
  readonly automaticRetryUsed: boolean;

  constructor(
    message: string,
    options: { uncertain: boolean; status?: number | null; automaticRetryUsed: boolean },
  ) {
    super(message);
    this.name = 'PianoStartRequestError';
    this.uncertain = options.uncertain;
    this.status = options.status ?? null;
    this.automaticRetryUsed = options.automaticRetryUsed;
  }
}

export function isPianoStartRequestError(error: unknown): error is PianoStartRequestError {
  return error instanceof PianoStartRequestError;
}

/** 生成不依赖服务端时钟的客户端请求 ID。 */
export function createPianoStartRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return `pt-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  return `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 同一曲目/模式的未确认尝试复用 requestId，换曲或换模式则创建新尝试。 */
export function preparePianoStartAttempt(
  current: PianoStartAttempt | null | undefined,
  chartId: string,
  mode: PianoTilesMode,
  checksum: string,
  requestIdFactory: () => string = createPianoStartRequestId,
): PianoStartAttempt {
  if (
    current &&
    current.chartId === chartId &&
    current.mode === mode &&
    current.checksum === checksum
  ) {
    return current;
  }

  return {
    requestId: requestIdFactory(),
    chartId,
    mode,
    checksum,
    automaticRetryUsed: false,
  };
}

function payloadMessage(payload: StartPayload | null): string | null {
  return typeof payload?.message === 'string' && payload.message.trim() ? payload.message.trim() : null;
}

function fallbackMessage(status: number): string {
  return `开局失败（HTTP ${status}）`;
}

function transportMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
    return '开局请求超时';
  }
  return '网络异常，无法确认开局结果';
}

async function inspectStartResponse(response: Response): Promise<AttemptOutcome> {
  const payload = (await response.json().catch(() => null)) as StartPayload | null;
  const sessionId = typeof payload?.data?.sessionId === 'string' ? payload.data.sessionId.trim() : '';

  if (response.ok && sessionId) {
    return { kind: 'success', sessionId };
  }

  // 4xx 是服务端已经明确拒绝本次请求，不能盲目重复开局。
  if (response.status >= 400 && response.status < 500) {
    const message = response.status === 401
      ? '请先登录后开始游戏'
      : payloadMessage(payload) ?? fallbackMessage(response.status);
    return { kind: 'definitive', message, status: response.status };
  }

  if (response.ok) {
    return {
      kind: 'uncertain',
      message: payloadMessage(payload) ?? '服务器未返回有效游戏会话',
      status: response.status,
    };
  }

  return {
    kind: 'uncertain',
    message: payloadMessage(payload) ?? fallbackMessage(response.status),
    status: response.status,
  };
}

function formatUncertainMessage(message: string, automaticRetryUsed: boolean): string {
  return `${message}${automaticRetryUsed ? '，已自动重试一次' : ''}，请稍后重试`;
}

/**
 * 发起开局并对不确定结果最多自动补发一次。
 *
 * 两次请求始终使用同一个 startRequestId；后端支持幂等时，响应丢失后
 * 的第二次请求会返回第一次已经创建的会话，而不会再占用一局。
 */
export async function startPianoTilesWithRetry(options: PianoStartRetryOptions): Promise<PianoStartResult> {
  const maxAttempts = options.allowAutomaticRetry === false ? 1 : 2;
  let automaticRetryUsed = false;
  let lastUncertain: UncertainOutcome | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let outcome: AttemptOutcome;
    try {
      outcome = await inspectStartResponse(await options.send(options.requestId));
    } catch (error) {
      outcome = {
        kind: 'uncertain',
        message: transportMessage(error),
        status: null,
      };
    }

    if (outcome.kind === 'success') {
      return { sessionId: outcome.sessionId, automaticRetryUsed };
    }

    if (outcome.kind === 'definitive') {
      throw new PianoStartRequestError(outcome.message, {
        uncertain: false,
        status: outcome.status,
        automaticRetryUsed,
      });
    }

    lastUncertain = outcome;
    if (attempt + 1 < maxAttempts) {
      automaticRetryUsed = true;
    }
  }

  const uncertain = lastUncertain ?? {
    kind: 'uncertain' as const,
    message: '无法确认开局结果',
    status: null,
  };
  throw new PianoStartRequestError(formatUncertainMessage(uncertain.message, automaticRetryUsed), {
    uncertain: true,
    status: uncertain.status,
    automaticRetryUsed,
  });
}
