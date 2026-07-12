# 幸运塔防 确定性引擎规格 v2

> 本文是 TS 引擎（`src/lib/lucky-td/engine/`）与 Go 引擎（`backend/internal/luckytd/`）的唯一权威契约。
> 两端实现必须逐条遵守；任何行为分歧以本文为准修复实现，不得反向改规格迁就实现。
> 配套配置：`src/lib/lucky-td/config/lucky-td-config.json`（Go 侧 embed 字节一致副本）。
> 一致性验收：`src/lib/lucky-td/__fixtures__/golden/`（黄金向量 + 模糊向量，双端断言同一批文件）。

## 1. 基本约定

- **逻辑频率**：30 逻辑帧/秒。`state.frame` = 已完成的 tick 数，初始 0。
- **整数运算**：逻辑层一切数值均为整数。百分比一律用**万分比**（permyriad，+15% = 1500），运算次序固定为 `floor(x * (10000 + bonus) / 10000)`（先乘后整除，向下取整；负数不出现）。
- **坐标**：milli-tile（1 格 = 1000）。格子 `(row, col)` 的中心 = `(x = col*1000+500, y = row*1000+500)`。
- **距离**：溅射/AOE 用平方距离（`dx*dx + dy*dy` 对比 `radius*radius`），永不开方；单位射程与 koi 光环用**方向格集合**判定（§7.2），不做欧氏距离。数值上限 < 2^31，两端安全。
- **禁止**：浮点、`Math.pow`/`math.Pow`、语言内建 map/dict 的遍历顺序、`Date`/时钟、逻辑层之外的随机数。
- **可变性豁免**：引擎内部对 state 就地修改（30Hz 模拟的性能豁免区）；外部（React/服务层）不得共享引用，需快照时自行序列化。

## 2. RNG 与哈希

### 2.1 xorshift32

```
next(state u32) -> (u32 state', u32 value):
  x := state
  x ^= x << 13; x &= 0xFFFFFFFF
  x ^= x >> 17
  x ^= x << 5;  x &= 0xFFFFFFFF
  return (x, x)          // 新状态即输出值
nextInt(n int) -> int:    // n >= 1
  (state, v) = next(state)
  return v % n
```

TS 侧每步 `>>> 0` 归一化。种子派生：`rngState = fnv1a32(seedString)`；若结果为 0 则取 `0x9E3779B9`。

### 2.2 FNV-1a 32

```
fnv1a32(bytes): h := 2166136261; for b: h ^= b; h = (h * 16777619) & 0xFFFFFFFF
```

字符串按 UTF-8 字节折叠。**状态哈希**：以 FNV-1a 逐个折叠 uint32 字段（每个按小端 4 字节展开），字段顺序见 §8。

## 3. 配置

单一来源 `lucky-td-config.json`，两端解析同一文件（TS import / Go embed）。结构：

```
{ version, engine: {…全局常量}, units: [18], enemies: [7], blessings: [6], maps: [6] }
```

- `units[i]` / `enemies[i]` 的**数组下标即 typeIdx**（哈希与实体引用用下标，不用字符串）。
- `units[i].rangeCells`：**朝右（dir=0）为基准**的相对格子模板 `[[dRow,dCol],…]`（含 `[0,0]` 表示自身格）。加载时预旋转出 4 个方向的集合（§7.2）。`atkType != "none"` 的单位必须非空；`atkType=="none"` 可为空。
- `units[i].auraCells`：以自身为中心、**与朝向无关**的相对格子集合（当前仅 koi 使用，3×3）。
- 模板偏移绝对值 ≤ 12（加载时校验；保证相对键 `dRow*100+dCol` 在地图尺寸域内无碰撞，见 §12.16）。
- 地图路径 `paths: [[ [row,col], … ]]`：轴对齐折线的拐点序列（含首尾）；首点 = 出生格，末点 = 终点格。
- **路径预计算**（加载时，两端一致）：
  - 逐拐点段展开为**逐格序列**（步长 1000）；`pathLengthMilli = 格数×1000 - 1000`（首格中心 progress=0，末格中心 = 长度）。
  - 每个途经格记录 `centerProgress`（该格中心的累计 progress）。同一路径重复经过同一格时取**首次** progress。
- **近战位** = 所有路径途经格的并集，减去每条路径的首格与末格；**远程位** = `rangedCells` 显式列表。两类格子互斥，一格至多一个单位。
- 波次 HP 成长用显式数组 `waveHpPermyriad[30]`（1-based 波 w 用下标 w-1）。第 1~15 项保持旧版不变，第 16~30 项按各地图原有末段“每波增量继续 +100”的曲线外推。敌人 HP = `floor(floor(baseHp × waveHp / 10000) × mapHpPermyriad / 10000)`，再按 §7.4 祝福减免。

## 4. 状态与实体

```
GameState:
  seed string; rngState u32; frame int; status (0 playing / 1 won / 2 lost)
  mapIdx int; squad []unitTypeIdx (1..6, 去重)
  costMilli, costAcc, lives int
  waveIndex int (1-based 当前/即将到来的波); phase (0 intermission / 1 wave)
  intermissionRemaining, waveFrame, spawnCursor[], spawnedInWave, coinPlan {active,frame,path} int
  pendingBlessing: null | {options [3]blessingIdx}
  blessingsOwned bitmask; regenMilliPerSec; meleeHpBonusPm; rangedAtkBonusPm; nextWaveDebuffPm; livesScoreBonus? 无
  scoreWaves, scoreKills, scoreLucky int
  unitSeq, enemySeq int (自增 id，从 1 开始)
  units []Unit; enemies []Enemy   // 均按 id 升序存放
  activeSkillLevels [18]int; activeSkillCooldown [18]int
  redeployCooldown [18]int        // 按 units 配置下标
  waveHashes []u32                // 每波结清后的状态哈希（不参与自身哈希）

Unit:  id, typeIdx, row, col, dir, hp, maxHp, atkCooldown, spTimer, sp, skillActive, attackCount
Enemy: id, typeIdx, pathIdx, progressMilli, hp, maxHp, atk, def, res, speed, shield,
       dmgToBase, skillCooldown, traitTier, hazardAcc, atkCooldown, blockedBy, leaked
```

初始：`costMilli = engine.initialCostMilli`，`lives = engine.initialLives`，`phase=intermission`，`intermissionRemaining = engine.intermissionFrames`，`waveIndex=1`，`regenMilliPerSec = engine.costRegenMilliPerSec`。

## 5. 操作（Action）

```
{ frame int, seq int, type "deploy"|"retreat"|"bless"|"skill"|"skillUpgrade",
  unit? typeIdx, row? int, col? int, dir? int(0..3), unitId? int, blessing? blessingIdx }
```

- 排序键 `(frame, seq)` 严格递增（回放校验：非递增 → 回放失败）。
- **应用时机**：`action.frame == state.frame` 的操作在该帧 tick **之前**按 seq 依次应用。
- **pendingBlessing 期间**只接受 `bless`，其余操作 → 失败。
- 校验失败的操作使**整个回放失败**（客户端只记录本地引擎接受过的操作）。

各操作校验与效果（按序检查，任一不过即失败）：

- **deploy**：状态 playing；typeIdx 在 squad 内；场上无同 typeIdx；`redeployCooldown[typeIdx] == 0`；`costMilli >= cost*1000`；行列在界内；**朝向合法**（`dir` 为整数且 ∈ 0..3，缺省视为非法）；目标格类型匹配（`blockCount>0` → 近战位；否则远程位）；格上无单位。效果：扣费；创建 Unit（`id=++unitSeq`，`dir=action.dir`，`maxHp = floor(baseHp×(10000+meleeHpBonusPm)/10000)`（仅近战单位加成，远程用 baseHp），hp=maxHp，atkCooldown=0，spTimer=0，sp=0，skillActive=0，attackCount=0），插入 units 尾部。
- **retreat**：状态 playing；unitId 存在。效果：返还 `floor(cost*1000×retreatRefundPermyriad/10000)`（受 costMaxMilli 截断）；释放其阻挡的敌人（blockedBy=0）；移除单位；`redeployCooldown[typeIdx] = redeployFrames`。
- **bless**：pendingBlessing 非空且 blessing ∈ options。效果：置 owned 位；应用效果（§7.4）；清空 pendingBlessing。
- **skillUpgrade**：角色技能从 1 级起，最高 10 级；共 9 档升级费用。每级攻击/治疗 +4%、生命 +4.5%、攻速 +2%、主动技能冷却 -2%。
- **skill**：单位存在且主动技能冷却为 0 时按角色公式结算，随后写入当前等级对应冷却。

## 6. tick 流程（每帧严格按序）

```
tick(state) -> bool（false = 本帧为冻结/终局 no-op）
```

0. `status != playing` 或 `pendingBlessing != null` → 返回 false（**frame 不变**）。
1. `frame++`；若 `frame >= engine.maxFrames` → status=lost（超时），返回 true。
2. **计时器**：全部 `redeployCooldown[i] > 0` 自减 1；每个单位：`skillActive>0` 自减；`atkCooldown>0` 自减；防御者类技能充能：`spTimer++`，满 30 → `spTimer=0, sp++`。
3. **费用**：`costAcc += regenMilliPerSec; costMilli += costAcc/30; costAcc %= 30; costMilli = min(costMilli, costMaxMilli)`。
4. **波推进与刷怪**（§6.1）。
5. **地图环境伤害**：机制格上的单位承受固定每秒伤害；敌人按最大生命万分比逐帧累积灼烧，整数伤害扣除后保留余数。
6. **单位行动**：按 units 数组序（即 id 升序）执行（§6.2）。
7. **敌人行动**：按 enemies 数组序执行（§6.3）。
7. **清扫**：移除 hp==0 的敌人（先释放不需要——阻挡关系随敌人删除消失）；移除 hp==0 的单位：先将 `blockedBy==unitId` 的敌人置 0，再 `redeployCooldown[typeIdx]=redeployFrames`，移除。
8. **波结清判定**（§6.4）与败北判定：`lives <= 0` → status=lost。

### 6.1 波推进与刷怪

- `phase == intermission`：`intermissionRemaining--`；到 0 → `phase=wave, waveFrame=-1, spawnedInWave=0, spawnCursor 清零`，并做**金币怪计划**：若 `2 <= waveIndex <= 14`：`r=nextInt(10000)`；若 `r < coinChancePermyriad` → `coinPlan={active:1, frame:60+nextInt(240), path:nextInt(pathCount)}`；否则 active=0。**注意**：即使不生成也必须消耗第一次 `nextInt(10000)`；生成时再消耗后两次。
- `phase == wave`：`waveFrame++`。对本波每个 spawnEvent `e = [delay, enemyTypeIdx, pathIdx, count, interval]`（按数组序）：当 `waveFrame == delay + k*interval`（k = 已刷数 < count）→ 刷 1 只。金币怪：`coinPlan.active && waveFrame == coinPlan.frame` → 在 spawnEvents 全部处理**之后**刷出（typeIdx = coin）。
- 刷怪：`id=++enemySeq`；`maxHp = floor(floor(base×waveHp[w-1]/10000)×mapHpPm/10000)`；若 `nextWaveDebuffPm` 生效于本波（§7.4）再 `floor(×debuff/10000)`；hp=maxHp；progress=0；hazardAcc=0；atkCooldown=0；blockedBy=0；追加到 enemies 尾部。

### 6.2 单位行动（对每个存活单位）

1. `hp==0` 跳过。`atkCooldown > 0` → 跳过。
2. **选目标**（射程 = §7.2 的方向格集合）：
   - 医疗（heal>0）：射程集合内（友军部署格 ∈ 集合，含自身格）hp<maxHp 的**友军**中，`hp*10000/maxHp` 最小者，平局取小 id；无 → 不动作（不进冷却）。
   - koi（atk==0 且 heal==0）：无攻击动作。
   - 近战（blockCount>0）：优先 `blockedBy==自己id` 的敌人中 progress 最大者（平局小 id），**无几何限制**；否则射程集合内敌人按「剩余路程 `pathLength−progress` 最小，平局小 id」。
   - 远程：射程集合内同上「剩余路程最小，平局小 id」。
   - 敌人位置 = 沿路径 progress 定位（两端用相同的逐段行走函数）；**敌人所在格 = `(floor(y/1000), floor(x/1000))`**。hp==0 的敌人不可选。
3. **结算攻击**（选中目标才执行）：
   - 有效攻击 `A0 = atk`；archer/caster 受 `rangedAtkBonusPm`：`A0 = floor(atk×(10000+pm)/10000)`。
   - ranger 三连：`attackCount++`；若 `attackCount % skill.every == 0`（配置当前为 5）→ `A0 = floor(A0×skill.permyriad/10000)`。
   - 伤害：物理 `max(1, A0 − max(0, def_eff))`；法术 `max(1, floor(A0×(10000−res)/10000))`。`def_eff`：目标 def（敌人无临时增益）。
   - 溅射（flameblade）：主目标受全额；以**主目标位置**为圆心 `splashRadius` 内其余存活敌人受 `floor(dmg×5000/10000)`。
   - AOE（caster）：以主目标位置为圆心 `aoeRadius` 内所有存活敌人（含主目标）各受全额法术伤害。
   - 治疗：`hp = min(maxHp, hp + healAmount)`。
   - **击杀处理**（每个受伤敌人立即判定）：`hp<=0 → hp=0`；`scoreKills += killScore`；若类型为 coin → `scoreLucky += coinScore`；若攻击者为 vanguard → `costMilli = min(costMax, costMilli + killCostMilli)`（多杀多得）。
   - 防御者技能：`sp >= spCost` → `sp=0, skillActive=skillDurationFrames`（本帧攻击结算后触发，作为攻击流程第 4 步；无目标也充能但**不**触发？——触发不依赖目标：在第 1 步冷却检查之前判定并触发）。**修正**：技能触发判定在该单位行动流程最开始（冷却检查前）：`sp>=spCost → sp=0, skillActive=duration`。
   - **设置冷却**：`interval_eff = interval`；若场上存在存活 koi 且本单位相对 koi 的偏移 `(uRow−kRow, uCol−kCol)` ∈ koi 的 auraCells → `interval_eff = floor(interval×10000/(10000+koiSpeedPm))`；`atkCooldown = interval_eff`。医疗同样适用。
4. 防御者 def：`skillActive>0` 时 `def_unit_eff = def×2`（仅用于承伤 §6.3）。

### 6.3 敌人行动（对每个存活敌人）

1. `hp==0` 跳过。
2. **被阻挡**（blockedBy != 0）：若阻挡单位已不存在或 hp==0 → blockedBy=0 转 3；否则攻击：`atkCooldown>0 → 自减跳过`；否则对阻挡者结算物理伤害 `max(1, atk − def_unit_eff)`；单位 `hp<=0 → hp=0`（清扫阶段处理释放）；`atkCooldown = interval`。
3. **移动**：`newProgress = progress + speedMilliPerFrame`。检查阻挡捕获：取该敌人所在路径上、`centerProgress ∈ (progress, newProgress]` 的近战单位格（按 centerProgress 升序）：对每个，找格上存活近战单位，若其 `当前被阻挡数（blockedBy==其id 的存活敌人数）< blockCount` → `progress = centerProgress; blockedBy = 单位id`，移动结束。金币怪**不可被阻挡**（跳过捕获检查）。
4. 无捕获 → `progress = newProgress`；若 `progress >= pathLength` → 泄漏：`lives -= dmgToBase`（可为 0）；标记该敌人 hp=0 且**不计击杀分**（用 leaked 标志区分，清扫时一并移除）。

> 实现注：泄漏用独立布尔（或 hp=0 前记录）确保不触发击杀逻辑；lives 下限不 clamp（可为负，判负即可）。

### 6.4 波结清

条件：`phase==wave` 且本波所有 spawnEvent 已刷满 且（coinPlan.active==0 或已刷出）且 enemies 为空。
效果（同一帧内按序）：
1. `costMilli = min(costMax, costMilli + waveClearCostMilli)`；`scoreWaves += waveScoreBase + waveScorePerWave×waveIndex`。
2. 若场上有存活 koi → `scoreLucky += koiWaveScore`。
3. **记录波哈希**：`waveHashes.push(hashState(state))`（在下列状态变更**之前**？——否，在本步骤 1、2 完成后、步骤 4 之前记录）。
4. 若 `waveIndex == 30` → status=won，结束。
5. 若 `waveIndex ∈ blessingWaves` 且未拥有全部祝福 → 掷选项：候选 = 未拥有的祝福下标（升序数组）；部分 Fisher-Yates 取 3 个（不足 3 取全部）：`for i in 0..k-1: j = i + nextInt(len−i); swap(c[i],c[j])`；`options = c[0..k)`；置 pendingBlessing。
6. `waveIndex++; phase=intermission; intermissionRemaining=engine.intermissionFrames`。

> 波哈希在步骤 3 记录：此时 waveIndex 尚未 ++、phase 仍为 wave。checkpoint 上报的 `waveIndex` 即此刻的 waveIndex。

## 7. 规则细目

### 7.1 单位职业判定

- 近战（部署在近战位）：`blockCount > 0` 的单位；远程：`blockCount == 0`。
- `rangedAtkBonusPm` 只作用于配置中 `tags` 含 `"rangedAtk"` 的单位（archer、caster）。
- `meleeHpBonusPm` 只作用于 `blockCount>0` 的单位。

### 7.2 攻击可达（方向格集合）

- 每单位部署时带朝向 `dir ∈ {0 右(+col), 1 下(+row), 2 左(−col), 3 上(−row)}`。
- 加载时把 `rangeCells`（朝右基准）预旋转为 4 套相对格集合：顺时针旋转 k=dir 次，每次 `(dr,dc) → (dc,−dr)`。
- 命中判定：目标相对偏移 `(tRow−uRow, tCol−uCol)` ∈ 该单位 dir 对应集合。敌人取其所在格（§6.2），友军取其部署格。
- 近战对「自己阻挡的敌人」无几何要求；其余目标（含溢出敌人）同样走集合判定。
- koi 光环：`(uRow−kRow, uCol−kCol) ∈ auraCells`，与双方 dir 无关。
- 溅射/AOE 仍为以命中点为圆心的平方距离比较（§6.2 步骤 3）。
- 角色范围按等级分三段：Lv1~4 不扩，Lv5 首次扩展，Lv6~9 不再扩，Lv10 第二次扩展。
- 普通角色每次扩展只增加左、右、前方相邻格，旋转到任意朝向后都不生成身后格；治疗和带光环的辅助角色使用对称扩展，可覆盖身后。

### 7.3 地图机制

- **霜熔断层**：全场角色攻速 ×0.98、所有敌人移速 ×0.98；机制格持续灼烧；格上角色攻速再 ×1.04，格上敌人移速再 ×1.04。
- **碎雾高原**：高台角色与飞行敌人攻击、攻速各 ×0.96；地面角色与地面敌人攻击、防御各 ×1.04；机制格上的角色与经过的敌人防御再 ×1.04。
- 同类倍率按配置遍历顺序逐次整数取整。环境灼烧击杀不产生击杀分、金币奖励或先锋回费。

### 7.4 同帧多事件次序

- 同帧多个 spawnEvent 同时到期：按 spawnEvents 数组序，每 event 每帧至多刷 1 只（`interval>=1`）；`count>1 && interval==0` 非法配置（加载时校验拒绝）。
- 同帧单位攻击按 id 升序结算完毕后才轮到敌人；因此单位攻击可在敌人移动前击杀。

### 7.5 祝福效果（应用于 bless 操作时）

| idx | id | 效果 |
| --- | --- | --- |
| 0 | regen25 | `regenMilliPerSec = floor(base×12500/10000)`（base=engine.costRegenMilliPerSec，不叠乘已有加成；因不可重复拥有，无叠加问题） |
| 1 | meleeHp20 | `meleeHpBonusPm += 2000`；对场上每个近战单位：`newMax = floor(baseHp×(10000+meleeHpBonusPm)/10000)`；`hp += newMax − maxHp; maxHp = newMax` |
| 2 | rangedAtk12 | `rangedAtkBonusPm += 1200` |
| 3 | lives2 | `lives = min(engine.livesCap, lives + 2)` |
| 4 | nextWaveHp10 | `nextWaveDebuffPm = 9000`，仅作用于 `waveIndex`（bless 时已 ++ 后的当前值）这一波刷出的敌人；该波结清时复位 10000 |
| 5 | cost12 | `costMilli = min(costMax, costMilli + 12000)` |

> nextWaveHp10 实现：state 存 `debuffWave int`（生效波次）与 `nextWaveDebuffPm`；刷怪时 `waveIndex==debuffWave` 才应用。

### 7.6 终局与计分

```
finalize(state):
  livesScore = max(0, lives) × livesScorePerLife      // won/lost 均按终局时刻剩余生命计
  raw = scoreWaves + scoreKills + scoreLucky + livesScore
  total = min(scoreCap, floor(raw × map.scorePermyriad / 10000))
  return { status, frames: frame, wavesCleared, score: total, breakdown: {waves, kills, lucky, lives: livesScore} }
```

`wavesCleared` = 已结清波数（won=30；否则 waveIndex−1，若 phase==wave 则 waveIndex−1）。lost 时 lives≤0 → livesScore=0 自然成立；超时判负按剩余 lives 计。

## 8. 状态哈希字段序

FNV-1a32 依次折叠以下 uint32（有符号值先转 u32 两补码；布尔 0/1）：

```
frame, rngState, status, costMilli, costAcc, lives, waveIndex, phase,
intermissionRemaining, waveFrame(u32 两补码，可为 -1 → 0xFFFFFFFF), spawnedInWave,
coinPlan.active, coinPlan.frame, coinPlan.path,
pending(0/1), pendingOpt0, pendingOpt1, pendingOpt2 (无则 0xFFFFFFFF),
blessingsOwned, regenMilliPerSec, meleeHpBonusPm, rangedAtkBonusPm, nextWaveDebuffPm, debuffWave,
scoreWaves, scoreKills, scoreLucky, unitSeq, enemySeq,
activeSkillLevels[0..17], activeSkillCooldown[0..17],
redeployCooldown[0..17]（按配置下标定长 18 项）,
len(units), 每单位 [id, typeIdx, row, col, dir, hp, maxHp, atkCooldown, spTimer, sp, skillActive, attackCount],
len(enemies), 每敌人 [id, typeIdx, pathIdx, progressMilli, hp, maxHp, atk, def, res, speed, shield,
dmgToBase, skillCooldown, traitTier, hazardAcc, atkCooldown, blockedBy, leaked(0/1)]
```

`spawnCursor` 不入哈希（可由 waveFrame + 事件表推导）；`waveHashes` 不入哈希。

## 9. 公共 API（两端签名语义一致）

```
initState(seed string, mapId string, squad []unitId string) -> state | error
applyAction(state, action) -> { ok bool, message string }
tick(state) -> bool
hashState(state) -> u32
finalize(state) -> result
replay({seed, mapId, squad, actions[]}) -> { ok, state, result?, error? }
```

`replay`：校验 actions 排序与 `len<=maxActions` → initState → 循环：应用 `frame==state.frame` 的到期操作（校验失败 → 整体失败）→ pendingBlessing 且无到期 bless 操作 → **快进**：直接跳到下一条操作（若无更多操作 → 回放失败：卡死在祝福）→ tick → 直到 status != playing 或所有操作耗尽且（自然推进至终局或 frame==maxFrames）。终局后仍有未应用操作 → 回放失败。

> 快进注：pendingBlessing 冻结期间 tick 是 no-op、frame 不增，因此回放中该期间不存在"空转帧"；直接应用下一条 bless 即可。若下一条操作不是 bless → 失败。

## 10. 黄金向量 schema

```
{ name, seed, mapId, squad: [unitId…], actions: [{frame,seq,type,…}…],
  expect: { status, frames, wavesCleared, score, finalHash, waveHashes: [u32…] } }
```

- 生成：TS 侧 `GOLDEN_UPDATE=1 npx vitest run src/lib/lucky-td` 重写 fixtures；平时断言。
- Go 侧 `engine_golden_test.go` 读 `../../../src/lib/lucky-td/__fixtures__/golden/` 全部 `.json` 断言（含 `fuzz-vectors.json`，schema 同上的数组）。
- 配置或规格变更 → 必须重新生成向量并使两端同时绿。

## 11. 版本与变更

- 配置含 `version` 字段；服务端会话记录该版本，重放时版本不匹配 → 会话作废（后端 M2 责任）。
- 本规格的任何行为修改必须：改规格 → 改两端实现 → 重生成向量 → 双端测试绿，四步一个提交。
- **v1 → v2（config version 2 → 3，2026-07-05）**：射程模型从圆形半径改为方向格集合（`rangeCells`/`auraCells`/`dir`）；deploy 动作新增 `dir`；哈希单位字段序在 `col` 后插入 `dir`；删除 `units[].range`、`engine.meleeRangeMilli`、koi `auraRange`；敌人移速 ×0.9、出怪 delay/interval ×1.15（四舍五入）；新增 serpentine/junction/highland 三图（maps 2→5）。全部向量重生成。
- **30 波扩展（config version 2026071102，2026-07-11）**：六张地图从 15 波扩展到 30 波；前 15 波 HP、特性等级、随机出怪与第 15 波双 Boss 规则保持不变；第 16~30 波继续外推 HP、威胁预算与敌人属性，新增第 17/20/23/26/29 波祝福，第 30 波改为终局。
- **角色与地图再平衡（config version 2026071103，2026-07-11）**：18 名角色整体降低初始与技能数值，成长扩展到 10 级且仅 Lv5/Lv10 扩范围；重做霜熔断层、碎雾高原机制；敌人状态新增 `hazardAcc`，全部黄金向量重生成。

## 12. 实现裁定（补充语义，与 TS 参考实现一致）

1. **败北判定仅在 status==playing 时执行**：第 30 波结清置 won 后，同帧泄漏致 lives≤0 不改写结果（won 优先）。
2. 金币怪刷出后 `coinPlan` 置为 `{active:0, frame:0, path:0}`（哈希覆盖全部三个字段）。
3. `nextWaveHp10` 的复位发生在**波结清处理的第一步**：若 `waveIndex==debuffWave` → `nextWaveDebuffPm=10000、debuffWave=0`，先于费用/分数奖励、波哈希与祝福掷选。
4. 溅射二段伤害为**直伤**：`max(1, floor(主目标实际伤害 × splashPermyriad / 10000))`，不再吃 DEF/RES。
5. 刷怪 HP 经全部倍率后取 `max(1, hp)`。
6. 医疗的目标集合**包含自身**。
7. `attackCount` 仅 `skill.kind=="triple"` 的单位在攻击结算时自增；`spTimer/sp` 仅 `skill.kind=="shield"` 的单位在计时器阶段推进；shield 触发判定位于该单位行动流程最开始（冷却检查之前）。
8. 被阻挡敌人在阻挡者消失/死亡的同一帧解除阻挡并立即执行移动分支。
9. 单位/敌人数组按加入顺序（即 id 升序）存放；规格中所有「按 id 升序遍历」即数组自然序。
10. 波结清**不重置** `waveFrame/spawnCursor`；两者仅在下一波激活（intermission→wave 转换）时重置。
11. 祝福效果数值（12500 / +2000 / +1200 / +2 / 9000 / +12000 milli）为规格常量，直接写在实现中，不入配置文件。
12. `replay` 中：initState 抛错、任一操作被拒、祝福未决且无对应操作、终局后仍有剩余操作，均判回放失败。
13. 单位与敌人的有效攻击、防御、攻速和移速可受地图分类与机制格倍率影响；物理伤害始终使用结算时的有效防御。
14. **旋转约定**：dir=0 朝右(+col)；顺时针旋转一次 `(dr,dc)→(dc,−dr)`；dir=k 即旋转 k 次。模板与光环集合在加载期预计算，运行期仅做成员查询。
15. **敌人所在格**：`(floor(y/1000), floor(x/1000))`；坐标恒为正（路径位置为格心插值），TS `Math.floor(x/1000)` 与 Go 整除等价。
16. **相对键**：集合成员键 = `dRow*100+dCol`；模板偏移绝对值 ≤ 12 且地图 cols ≤ 13，任意实体间偏移 |dCol| < 50，键无碰撞。
17. **dir 校验**：TS 侧显式 `Number.isInteger(dir)`（本地输入可能为非整数）；Go 侧由 JSON 解码保证整数。校验位置在 deploy 检查序中位于「位置越界」之后、「格类型」之前，拒绝文案「朝向非法」。
18. **路径不得自交**（配置作者约束）：自交格 centerProgress 只记首次，二次经过不触发阻挡捕获；配置作者必须避免自交路径。
