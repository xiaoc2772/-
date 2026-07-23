import { describe, expect, it } from 'vitest';
import {
  preparePianoStartAttempt,
  startPianoTilesWithRetry,
  type PianoStartAttempt,
} from '@/lib/piano-tiles/start-recovery';

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('钢琴块开局请求恢复', () => {
  it('同一曲目和模式复用未确认尝试的 requestId，换曲或换模式则新建', () => {
    const first = preparePianoStartAttempt(null, 'song-1', 'classic', 'checksum-1', () => 'request-1');
    const reused = preparePianoStartAttempt(first, 'song-1', 'classic', 'checksum-1', () => 'request-2');
    const changedSong = preparePianoStartAttempt(reused, 'song-2', 'classic', 'checksum-1', () => 'request-3');
    const changedMode = preparePianoStartAttempt(reused, 'song-1', 'rush', 'checksum-1', () => 'request-4');
    const changedChecksum = preparePianoStartAttempt(
      reused,
      'song-1',
      'classic',
      'checksum-2',
      () => 'request-5',
    );

    expect(first.requestId).toBe('request-1');
    expect(reused).toBe(first);
    expect(changedSong.requestId).toBe('request-3');
    expect(changedMode.requestId).toBe('request-4');
    expect(changedChecksum.requestId).toBe('request-5');
  });

  it('网络中断后最多补发一次，并在两次请求中复用同一个 ID', async () => {
    const requestIds: string[] = [];
    let calls = 0;
    const result = await startPianoTilesWithRetry({
      requestId: 'request-1',
      send: async (requestId) => {
        requestIds.push(requestId);
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('timeout'), { name: 'AbortError' });
        return response(200, { success: true, data: { sessionId: 'session-1' } });
      },
    });

    expect(calls).toBe(2);
    expect(requestIds).toEqual(['request-1', 'request-1']);
    expect(result).toEqual({ sessionId: 'session-1', automaticRetryUsed: true });
  });

  it.each([
    [500, { success: false, message: '服务器错误' }],
    [200, { success: true, data: {} }],
    [200, { success: true }],
  ])('不确定的 %s 响应会触发一次同 ID 重试', async (status, payload) => {
    let calls = 0;
    const result = await startPianoTilesWithRetry({
      requestId: 'request-2',
      send: async () => {
        calls += 1;
        return calls === 1 ? response(status, payload) : response(200, { data: { sessionId: 'session-2' } });
      },
    });

    expect(calls).toBe(2);
    expect(result.sessionId).toBe('session-2');
  });

  it.each([
    [400, { success: false, message: '你已有正在进行的游戏' }],
    [401, { success: false, message: '未登录' }],
    [429, { success: false, message: '请求过于频繁，请稍后再试' }],
  ])('明确的 %s 响应不重试', async (status, payload) => {
    let calls = 0;
    const request = startPianoTilesWithRetry({
      requestId: 'request-3',
      send: async () => {
        calls += 1;
        return response(status, payload);
      },
    });

    await expect(request).rejects.toMatchObject({
      uncertain: false,
      status,
      automaticRetryUsed: false,
    });
    expect(calls).toBe(1);
  });

  it('自动重试后仍无法确认时只发两次，并标记为不确定', async () => {
    let calls = 0;
    const request = startPianoTilesWithRetry({
      requestId: 'request-4',
      send: async () => {
        calls += 1;
        throw new Error('network down');
      },
    });

    await expect(request).rejects.toMatchObject({
      uncertain: true,
      automaticRetryUsed: true,
    });
    expect(calls).toBe(2);
  });

  it('用户再次点击时可关闭自动补发，避免后台无限重试', async () => {
    let calls = 0;
    const request = startPianoTilesWithRetry({
      requestId: 'request-5',
      allowAutomaticRetry: false,
      send: async () => {
        calls += 1;
        throw new Error('network down');
      },
    });

    await expect(request).rejects.toMatchObject({
      uncertain: true,
      automaticRetryUsed: false,
    });
    expect(calls).toBe(1);
  });

  it('保留 attempt 的重试状态，下一次仍使用同一个 ID', () => {
    const attempt: PianoStartAttempt = {
      requestId: 'request-6',
      chartId: 'song-1',
      mode: 'classic',
      checksum: 'checksum-1',
      automaticRetryUsed: true,
    };

    expect(preparePianoStartAttempt(attempt, 'song-1', 'classic', 'checksum-1')).toBe(attempt);
    expect(attempt.automaticRetryUsed).toBe(true);
  });
});
