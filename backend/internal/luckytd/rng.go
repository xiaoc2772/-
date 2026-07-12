// 幸运塔防确定性 RNG 与状态哈希原语。契约见 docs/lucky-td-engine-spec.md §2。
// 必须与 TS 参考实现（src/lib/lucky-td/engine/rng.ts）逐位一致：
// 全部运算在 uint32 上自然回绕，对应 TS 侧的 >>>0 归一化与 Math.imul。

package luckytd

const (
	fnvOffsetBasis uint32 = 0x811c9dc5
	fnvPrime       uint32 = 0x01000193
)

func fnv1a32Bytes(data []byte) uint32 {
	hash := fnvOffsetBasis
	for _, b := range data {
		hash ^= uint32(b)
		hash *= fnvPrime
	}
	return hash
}

// fnv1a32String 按 UTF-8 字节折叠，与 TS 侧 TextEncoder 编码一致。
func fnv1a32String(input string) uint32 {
	return fnv1a32Bytes([]byte(input))
}

// seedToRngState 由种子字符串派生 RNG 初始状态；结果为 0 时取黄金比常数兜底。
func seedToRngState(seed string) uint32 {
	value := fnv1a32String(seed)
	if value == 0 {
		return 0x9e3779b9
	}
	return value
}

// xorshift32 返回新状态；新状态本身即随机输出值。
func xorshift32(state uint32) uint32 {
	x := state
	x ^= x << 13
	x ^= x >> 17
	x ^= x << 5
	return x
}

func hashInit() uint32 {
	return fnvOffsetBasis
}

// hashMixUint32 将一个 uint32 按小端 4 字节（低位在前）折叠进 FNV-1a 哈希。
func hashMixUint32(hash, value uint32) uint32 {
	h := hash
	for shift := 0; shift < 32; shift += 8 {
		h ^= (value >> shift) & 0xff
		h *= fnvPrime
	}
	return h
}
