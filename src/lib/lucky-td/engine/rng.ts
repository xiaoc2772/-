// 幸运塔防 确定性 RNG 与哈希原语。契约见 docs/lucky-td-engine-spec.md §2。
// 与 Go 实现（backend/internal/luckytd/rng.go）必须逐位一致。

export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

export function fnv1a32Bytes(bytes: Uint8Array): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = (hash ^ bytes[i]) >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function fnv1a32String(input: string): number {
  return fnv1a32Bytes(new TextEncoder().encode(input));
}

export function seedToRngState(seed: string): number {
  const value = fnv1a32String(seed);
  return value === 0 ? 0x9e3779b9 : value;
}

/** xorshift32：返回新状态；新状态本身即随机输出值。 */
export function xorshift32(state: number): number {
  let x = state >>> 0;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return x >>> 0;
}

export function hashInit(): number {
  return FNV_OFFSET;
}

/** 将一个 uint32 按小端 4 字节折叠进 FNV-1a 哈希。 */
export function hashMixUint32(hash: number, value: number): number {
  let h = hash >>> 0;
  const v = value >>> 0;
  for (let shift = 0; shift < 32; shift += 8) {
    h = (h ^ ((v >>> shift) & 0xff)) >>> 0;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** 有符号安全折叠：负数经 >>>0 按两补码转 uint32 后折叠。 */
export function hashMixInt(hash: number, value: number): number {
  return hashMixUint32(hash, value >>> 0);
}
