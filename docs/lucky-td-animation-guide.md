# 幸运塔防 逐帧动画制作指南（ChatGPT 生图版）

> 本文是 `docs/lucky-td-art-guide.md` 的**升级篇**：把原决策「纯静态精灵 + 程序化动画」升级为
> 「**逐帧序列动画 + 程序化混合**」。art-guide 中的风格块（§5.1）、朝向/质检规则（§4.3）、
> webp 转换（§4.4）全部继续沿用；程序化层（粒子、飘字、闪白、阴影、插值）也保留，
> 逐帧动画只替换「主体本身的动作」。
>
> 读者假设：**没有美术基础，只有 ChatGPT 生图**。所有动画专业知识（关键帧姿势、时间表、
> 循环设计）已在本文编码成可直接复制的提示词，照着做即可。

---

## 0. 先看结论：做多少、按什么顺序做

### 0.1 总量核算（已按引擎数值砍掉无用功）

| 优先级 | 内容 | 套数 | 约帧数 | 说明 |
| --- | --- | --- | --- | --- |
| **P0 上线线** | 单位待机 ×8、单位攻击 ×7、敌人行走 ×6 | 21 套 | ~110 帧 | koi 攻击力为 0，无攻击动画 |
| **P1 完整感** | 技能 ×2（仅 defender/ranger 有主动技能）、敌人攻击 ×5（coin 除外）、敌人死亡 ×6 | 13 套 | ~75 帧 | 其余单位的"技能"都是被动，无释放动作 |
| **P2 锦上添花** | 单位死亡 ×8、单位生成 ×8、敌人生成 ×2（boss/coin，其余=走出传送门）、敌人待机 ×6、coin 攻击 | 25 套 | ~110 帧 | 程序化动画已覆盖这些场景，做了更好，不做不裂 |

生图预算参考：每套动画 1~3 次生成（含重 roll），P0 约 **40~70 次生成**，P0+P1 约 100 次。
这是几个下午的量，不是几天的量——因为我们按「动作条」整张生成，不是一帧一帧生成。

### 0.2 制作顺序（严格按此执行，能少走一半弯路）

1. **风格锚点**：按 art-guide §5.2 生成吉祥物锦鲤（若已完成则跳过）。
2. **14 张静态精灵先全部完成**（art-guide §5.3/5.4）——它们本来就是上线硬需求（托盘头像、
   加载兜底），同时是每个角色动画的「设定参考图」，动画的每次生成都要附带它。
3. **试点一套跑通全流程**：推荐 `grunt 行走`（形体最简单、场上数量最多、行走循环最容易看出问题）。
   走完「生成 → 切片 → 预览 → 交给开发接入」全流程，确认管线可行后再量产。
4. **按动作类型横向量产**（一口气做完所有角色的同一种动作，再换下一种），顺序：
   敌人行走 ×6 → 单位待机 ×8 → 单位攻击 ×7 → （P1）敌人攻击 → 敌人死亡 → 技能 ×2 → （P2）其余。
   同类动作的提示词和手感是连贯的，横向做效率最高、风格最齐。

### 0.3 硬性分工

- **你**：生成动作条 PNG → 质检 → 交付（切片、打包可以交给我，见 §6）。
- **我（开发侧）**：切片/打包脚本、渲染器 SpriteAnimator 扩展（strip 播放 + 程序化混合 +
  缺资产自动回退静态图/几何占位）、开发用循环预览页。**第一套试点图到位后我开始接**。

---

## 1. 动画片制作流程 → 我们的流程

完整动画工业管线和我们的对应关系——每一步都没跳过，只是执行工具换成了 AI：

| 动画片工序 | 行业内容 | 我们的做法 |
| --- | --- | --- |
| 企划 / 美术设定 | 世界观、画风圣经 | art-guide §5.1 风格块 + 吉祥物锚点图（已定稿） |
| 角色设定（model sheet） | 三视图、比例表 | **14 张静态精灵**充当每个角色的设定图，之后每次生成都附带 |
| 分镜 / Layout | 镜头与构图设计 | 游戏内没有镜头，跳过；对应物是 §3 的「动作规格总表」 |
| 原画（关键帧） | 动作的关键姿势 | §4 姿势脚本——每个动作每一帧的姿势已用英文写好，直接拼进提示词 |
| 中割（补间帧） | 关键帧之间的过渡 | 游戏精灵 4~8 帧即成立（相当于动画片的"一拍三"），**关键帧本身就是全部帧**；确实缺帧时用 §5.3 补帧提示词 |
| 上色 / 清稿 | 统一线条与色彩 | 风格块 + 锚点图引用保证；漂移帧删掉或重 roll（§8） |
| 律表（exposure sheet） | 每帧停留时长 | §2.2 播放速率表，写死在代码里，你不用管 |
| 摄影 / 合成 | 分层合成特效 | 渲染器：逐帧主体 + 程序化粒子/闪白/阴影叠加（我负责） |
| 线拍 / 样片检查 | 铅笔稿连播找问题 | Piskel 在线预览（§6.2）或等我的预览页，循环看 3 遍再定稿 |

**动画十二原则里你唯一需要知道的三个**（姿势脚本里已替你用上，看懂即可）：
- **预备（Anticipation）**：出手前先反向蓄力——攻击帧 1~2 永远是"收回武器/下蹲"。
- **挤压与拉伸（Squash & Stretch）**：落地压扁、跳起拉长——走路循环的"下沉帧"角色略矮胖。
- **跟随（Follow-through）**：动作结束后披风/耳朵/武器再晃半拍——回位帧不是直接回到待机。

---

## 2. 全局技术规格

### 2.1 画布与交付格式

- **生成**：一条动作 = 一张「水平单行动作条（sprite strip）」，1536×1024 或 1024×1024，
  透明背景，帧与帧等宽等距排列（提示词已固定这些要求）。
- **交付**：切片对齐后重新拼成**水平 strip webp**，每帧 **256×256**（boss 每帧 320×320），
  质量 88。帧数 = 图宽 ÷ 帧宽，代码据此自动识别，无需额外配置文件。
- **锚点**：脚底中心。同一条 strip 里所有帧的**脚底基线必须在同一水平线**、角色比例一致
  ——这是切片后唯一需要人工核对的事（§6.2）。
- **朝向**：沿用 art-guide——我方单位一律朝右，敌人一律朝左。

### 2.2 播放速率表（律表，代码侧写死，供你理解节奏）

| 动作 | 帧数 | 播放 | 循环方式 |
| --- | --- | --- | --- |
| 单位待机 | 4 | 5 fps | ping-pong（1-2-3-4-3-2 往返） |
| 敌人行走 | 6（golem/puppet/coin 为 4） | 10 fps，随移速缩放 | 顺序循环 |
| 单位/敌人攻击 | 6 | 15 fps | 单次播放，播完回待机 |
| 技能 | 6~8 | 15 fps | 单次播放 |
| 死亡 | 5 | 12 fps | 单次播放后移除（代码叠加渐隐） |
| 生成 | 4 | 12 fps | 单次播放 |
| 敌人待机（被阻挡时） | 2 | 3 fps | 往返（P2，可直接复用行走第 1 帧 + 微调帧） |

### 2.3 交付命名（新增约定，与 art-guide 静态图并存）

```
public/images-optimized/ui/games/lucky-td/anim/<角色id>/<动作>.webp

角色id：vanguard defender ranger flameblade archer caster medic koi
        grunt wolf golem puppet boss coin
动作：  idle | attack | skill | walk | death | spawn
例：    anim/grunt/walk.webp（6 帧 → 1536×256）
        anim/boss/walk.webp （6 帧 → 1920×320）
```

静态图（`units/*.webp`、`enemies/*.webp`）继续保留：托盘/编队头像用它，动画缺失时战场也回退用它。

---

## 3. 动作规格总表

| 角色 | idle | attack | skill | walk | death | spawn |
| --- | --- | --- | --- | --- | --- | --- |
| vanguard 疾风哨卫 | P0·4帧 | P0·6帧 矛刺 | —（被动回费） | — | P2·5帧 | P2·4帧 |
| defender 磐石重盾 | P0·4帧 | P0·6帧 盾击 | **P1·6帧 盾墙** | — | P2·5帧 | P2·4帧 |
| ranger 双刃游侠 | P0·4帧 | P0·6帧 双刀斩 | **P1·8帧 三连斩** | — | P2·5帧 | P2·4帧 |
| flameblade 烈焰剑士 | P0·4帧 | P0·6帧 大剑挥 | —（被动溅射） | — | P2·5帧 | P2·4帧 |
| archer 鹰眼射手 | P0·4帧 | P0·6帧 弓射 | —（无） | — | P2·5帧 | P2·4帧 |
| caster 星辉法师 | P0·4帧 | P0·6帧 施法 | —（AOE 即普攻） | — | P2·5帧 | P2·4帧 |
| medic 月光医师 | P0·4帧 | P0·6帧 治疗施法 | —（治疗即普攻） | — | P2·5帧 | P2·4帧 |
| koi 幸运锦鲤 | P0·4帧（光环脉动） | **—（攻击力 0）** | —（被动光环） | — | P2·5帧 | P2·4帧 |
| grunt 碎星杂兵 | P2·2帧 | P1·6帧 撞击 | — | P0·6帧 双足小跑 | P1·5帧 晶体碎裂 | —（走出传送门） |
| wolf 疾影狼 | P2·2帧 | P1·6帧 扑咬 | — | P0·6帧 四足疾奔 | P1·5帧 影散 | — |
| golem 重甲卫 | P2·2帧 | P1·6帧 双臂砸 | — | P0·4帧 沉重踏步 | P1·5帧 装甲崩解 | — |
| puppet 咒盾傀儡 | P2·2帧 | P1·6帧 符能冲击 | — | P0·4帧 漂浮摇摆 | P1·5帧 木偶散架 | — |
| boss 深渊魔王 | P2·2帧 | P1·6帧 魔爪横扫 | — | P0·6帧 威压阔步 | P1·6帧 王者陨落 | P2·4帧（登场已有程序化震屏） |
| coin 幸运金币怪 | P2·2帧 | P2·6帧 软身撞 | — | P0·4帧 弹跳滚动 | P1·5帧 金币爆散 | P2·4帧 |

> 死亡/生成当前已有像样的程序化效果（缩放+灰度+粒子 / 落地压扁+尘土），所以排 P1/P2；
> 逐帧版做好后程序化效果自动变成"叠加层"（粒子照发），观感只增不减。

---

## 4. 姿势脚本（原画关键帧——逐帧英文描述，直接拼提示词）

> 用法：§5.1 模板里的 `{每帧姿势}` 槽位，逐帧粘贴对应行。英文姿势行可原样使用，
> 中文只是给你核对的。**帧序号必须写进提示词**，这是 AI 排列正确的关键。

### 4.1 单位待机 idle（4 帧，通用于全部 8 单位）

```
Frame 1: neutral relaxed stance, weapon held loosely, calm expression.
Frame 2: chest rises slightly mid-breath, shoulders up a tiny bit, weapon tip lifts subtly.
Frame 3: peak of inhale, body very slightly taller, cape/hair drifts up gently.
Frame 4: settling exhale, body relaxes just below neutral, cape/hair drifts down.
```
（呼吸循环；koi 把 weapon 换成 `golden aura ring pulses gently brighter then dimmer`）

### 4.2 单位攻击 attack（6 帧；帧 3 恒为「命中帧」）

通用骨架——所有单位共享这个节奏，只换武器句：

```
Frame 1: anticipation — pulls {武器} back, slight crouch, body coils up.
Frame 2: deeper wind-up — maximum pull-back, body squashes slightly lower, eyes locked forward.
Frame 3: STRIKE — {命中动作}, full extension toward the right, 2-3 white motion smear lines along the swing path.
Frame 4: follow-through — weapon slightly past full extension, cape/scarf whips forward.
Frame 5: recovery — pulling weapon back toward guard position.
Frame 6: nearly back to neutral idle stance.
```

各单位的 `{武器}` / `{命中动作}` 替换句：

| 单位 | 武器句 | 命中句（Frame 3） |
| --- | --- | --- |
| vanguard | his short spear | thrusts the spear straight forward at chest height |
| defender | his massive tower shield | slams the shield edge forward like a ram |
| ranger | both curved blades | slashes both blades forward in a crossing X cut |
| flameblade | his huge flaming greatsword | swings the greatsword in a wide horizontal arc, small flame trail |
| archer | his longbow with a golden arrow | releases the arrow — bowstring snapped forward, arrow just leaving frame, arm recoil |
| caster | his star-tipped staff | thrusts the staff forward, star crystal flashes with a starburst |
| medic | her lantern staff | raises the staff high, a soft green-cyan glow bursts upward gently |

> archer 的 1~2 帧改为 `draws the bowstring / full draw, aiming`（拉弓即蓄力）；
> medic 全程柔和，不要 smear lines，把 STRIKE 理解为「治疗光爆发」。

### 4.3 技能（仅 2 套）

**defender 盾墙（6 帧，单次）**
```
Frame 1: hoists the tower shield up high with both arms, knees bent.
Frame 2: shield raised to the highest point above his head, body stretched tall.
Frame 3: SLAMS the shield down into the ground in front of him, body squashed low, dust burst at the base.
Frame 4: impact hold — shield planted, a golden translucent barrier dome flashes into existence around him.
Frame 5: braced behind the planted shield, golden barrier glowing steady.
Frame 6: holding the fortress pose, barrier glow softening.
```

**ranger 三连斩（8 帧，单次）**
```
Frame 1: crouches with both blades crossed behind, coiled like a spring.
Frame 2: FIRST SLASH — right blade sweeps forward horizontally, motion smear.
Frame 3: momentum carries through, body twisting.
Frame 4: SECOND SLASH — left blade sweeps upward diagonally, motion smear.
Frame 5: gathers into a spin, blades tucked in.
Frame 6: THIRD SLASH — spinning double-blade cut, both blades extended, strongest smear lines.
Frame 7: lands from the spin, blades swept behind, scarf whipping.
Frame 8: settles back toward ready stance.
```

### 4.4 敌人行走 walk（帧 1 与帧 4 是两次「触地」，循环闭合）

**双足小跑（grunt，6 帧）**
```
Frame 1: left stubby leg planted forward touching ground, right leg lifted behind, body leaning forward.
Frame 2: body at lowest point, squashed slightly shorter and wider, both knees bent.
Frame 3: pushing off, body stretched slightly taller, right leg swinging forward.
Frame 4: right leg planted forward touching ground, left leg lifted behind (mirror of frame 1).
Frame 5: body at lowest point again, squashed (mirror of frame 2).
Frame 6: pushing off, stretched, left leg swinging forward (mirror of frame 3).
```

**四足疾奔（wolf，6 帧）**
```
Frame 1: full gallop stretch — front legs reaching far forward, hind legs extended far back, body long and low.
Frame 2: front paws touch ground, body starting to compress.
Frame 3: fully gathered — all four legs bunched under the body, back arched high, body squashed.
Frame 4: hind paws touch ground, body starting to extend, head rising.
Frame 5: launching — hind legs pushing off, front legs lifting, body extending.
Frame 6: airborne moment, all paws off ground, body at full stretch, speed-line markings glowing.
```

**沉重踏步（golem，4 帧）**
```
Frame 1: left massive foot stomps down, whole body tilts left, arms swinging heavily.
Frame 2: dragging forward, body upright, both feet grounded, dust puff at feet.
Frame 3: right massive foot stomps down, whole body tilts right (mirror of frame 1).
Frame 4: dragging forward, upright again (mirror of frame 2).
```

**漂浮摇摆（puppet 与 coin，4 帧）**
```
Frame 1: floating at highest point of the bob, strings/wings relaxed, tilted 3 degrees left.
Frame 2: drifting down to middle height, upright.
Frame 3: lowest point of the bob, slightly squashed, tilted 3 degrees right.
Frame 4: rising back to middle height, upright.
```
（coin 把 strings 换成 tiny angel wings flapping；boss 用 golem 骨架但 6 帧、披风飘动、更威严）

### 4.5 敌人攻击 attack（6 帧，被阻挡时对我方单位出手；帧 3 命中）

通用骨架同 4.2，替换句：

| 敌人 | 蓄力句（Frame 1-2） | 命中句（Frame 3） |
| --- | --- | --- |
| grunt | rears back, crystal body glowing brighter | headbutt lunge to the LEFT, crack lines flaring purple |
| wolf | crouches low, fangs bared, ready to pounce | pouncing bite to the LEFT, jaws snapping, cyan streaks |
| golem | raises both massive arms overhead | slams both arms down to the LEFT, ground impact burst |
| puppet | rune ring spins faster, strings pull taut | thrusts forward, magenta rune ring flares in a shockwave |
| boss | raises a huge clawed hand, magma veins flare | sweeping claw slash to the LEFT, red motion smear |

（注意敌人朝左，所有出手方向写 LEFT）

### 4.6 死亡 death（5 帧，单次；按材质区分崩解方式）

通用骨架：
```
Frame 1: hit recoil — knocked back, eyes turn to X (or closed), body tilted away.
Frame 2: collapsing — body crumples downward, squashed.
Frame 3: {崩解方式 A}
Frame 4: {崩解方式 B — 更碎}
Frame 5: last remnant — small pile/wisp, barely recognizable.
```

| 角色 | 崩解方式 |
| --- | --- |
| grunt | crystal body cracking into large purple shards → shards scattering, glow fading |
| wolf | body dissolving into dark wisps of shadow → wisps scattering, cyan lines flickering out |
| golem | armor plates falling off, core exposed → plates piled up, red core glow dying |
| puppet | strings snap, limbs disassembling → wooden parts scattered, rune ring shattering |
| boss | falls to one knee, crown tumbling off → collapsing forward, magma veins going dark |
| coin | deflating like a punctured balloon → bursting into a shower of gold coins |
| 我方单位 | slumping down, weapon dropping → fading kneeling silhouette（悲壮不血腥） |

### 4.7 生成 spawn（P2，4 帧）

```
Frame 1: a column of soft golden light, character silhouette barely visible inside.
Frame 2: landing crouch — character touches down, squashed, light dispersing.
Frame 3: rising with a slight overshoot, taller than normal, light motes scattering.
Frame 4: settling into ready idle stance, last sparkles fading.
```
（敌人生成不需要：普通敌人从传送门走出来 = walk；boss 登场已有程序化震屏+冲击环）

---

## 5. 提示词模板

### 5.1 动作条主模板（每套动画一次生成）

发给 ChatGPT 时：**附上该角色的静态精灵图**，然后：

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly {N} frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME baseline height.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces {right/left} in every frame.

This is a {动作名} animation, from left to right:
Frame 1: ...（从 §4 复制对应姿势行）
Frame 2: ...
...
Frame {N}: ...

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 5.2 修帧话术（整张里只有个别帧不对时）

实践中「只重画第 3 帧」很难保真，按成本从低到高：

1. **删帧**：6 帧里坏 1 帧 → 切片时扔掉它变 5 帧，循环类动作通常无感（优先用这招）。
2. **整张重 roll**：同一提示词再生成一次，两张里挑好帧拼一套（同一对话内漂移很小）。
3. **单帧补生**：`Using the attached reference, draw ONLY ONE frame of this character:
   {那一帧的姿势行}. Same size and baseline as the reference. Transparent background.`
   然后自己切下来替换。

### 5.3 补帧模板（中割——两帧之间太跳时）

```
Attached are frame A and frame B of an animation of this character.
Draw the exact in-between frame: the pose halfway between A and B.
Same character, same size, same baseline, transparent background, single frame.
```

### 5.4 生成参数备忘

- 动作条用 **1536×1024 横版**（6 帧以上必须横版；4 帧可用 1024×1024）。
- 一次对话专注一个角色的所有动作，开头先发静态图定锚。
- 背景不透明/出现地面阴影 → 追加 art-guide §4.2 的透明底重生话术。

---

## 6. 后处理流水线（生成 → 交付）

### 6.1 切片

AI 排的格子不会像素级均分，切片按「目测等分 + 微调」：

```bash
# 例：6 帧条，先均分成 6 块（宽度 1536/6=256）
magick strip.png -crop 6x1@ +repage frame_%d.png
# 某帧切歪了就单独手动裁：
magick strip.png -crop 300x1024+520+0 +repage frame_2.png
```

懒人方案：把整条发给我，**切片对齐我来做**（我有脚本；你只负责生成和挑图）。

### 6.2 对齐质检（唯一需要你目测把关的环节）

- [ ] 每帧角色**大小一致**（最重要——大小跳变比姿势不顺眼 10 倍）
- [ ] 脚底基线同一高度（行走类允许 ±5px 的起伏，那是 bob，正常）
- [ ] 角色配色/描边没有漂移（和静态参考图并排对比）
- [ ] 循环类动作首尾帧衔接（帧 6 接回帧 1 不跳）
- [ ] 命中帧（攻击帧 3）出手方向正确：我方朝右、敌人朝左

不合格帧 → §5.2 三招。微调对齐可用免费在线工具 Piskel（<https://www.piskelapp.com>）：
导入帧 → 开启 onion skin（洋葱皮）逐帧对齐 → 直接预览循环播放（这一步就是动画片的「线拍检查」）。

### 6.3 打包交付

```bash
# 每帧统一 256×256（居中、脚底约在 88% 高度处）后水平拼接：
magick frame_*.png -resize 236x236 -gravity center -background none -extent 256x256 miff:- |
magick miff:- +append -quality 88 walk.webp
```

或者：**把挑好的单帧 PNG 按顺序命名发我，打包我来做**。
交付路径按 §2.3 命名放入仓库；原始 PNG 不入库。

---

## 7. 开发侧接入（我的承诺清单，你不用做）

试点动画（grunt walk）到位后我会依次交付：

1. `scripts/slice-lucky-td-strip.mjs` — 切片/对齐/打包辅助脚本（配 npm script）。
2. 渲染器 `SpriteAnimator`：strip 加载与播放（帧数自动 = 宽÷高）、§2.2 律表、
   ping-pong/单次/循环三种模式、行走速率随移速缩放、**攻击帧 3 对齐逻辑命中帧**、
   缺资产自动回退「静态图 + 现有程序化动画」——所以你可以一套一套慢慢交，随时可上线。
3. 开发预览页（本地路由）：拖 strip 进去循环播放看效果，不用等接入战场。
4. 程序化层保留项：阴影、闪白受击、死亡渐隐+粒子、飘字、部署尘土——这些继续叠加在
   逐帧动画上，等于「摄影合成」层。

---

## 8. 风险与省力心法

- **帧间漂移是常态不是失败**：战场绘制只有 72~96px，缩小后 80% 的漂移看不见。
  质检时把帧缩到 96px 高再判断（Piskel 预览就是小尺寸），别在 1024px 原图上追求完美。
- **别追高帧数**：4~8 帧就是动画片「一拍三」的密度，专业像素游戏也这么做。
  帧数翻倍 = 生成/质检/漂移风险全翻倍，观感提升却很小。
- **循环闭合 > 单帧精美**：行走/待机是玩家盯着看时间最长的动画，首尾衔接顺滑最重要。
- **能删帧就不重 roll，能重 roll 就不补帧**（§5.2 的成本顺序）。
- **每完成一个角色就存档归档**：本地按 `原始PNG/角色/动作/` 目录留档，AI 对话会过期，图不会。
- 卡住三次以上的动作 → 降级用程序化动画兜底（它一直都在），先保进度再回头补。
