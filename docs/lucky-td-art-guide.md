# 幸运塔防 美术资源与程序化动画指南

> 配套 `plans/幸运塔防_20260704.md`（决策 #3：程序化动画 + AI 生成静态精灵）。
> 本文三个作用：
> 1. 解释「程序化动画」怎么做（第 2 节，同时是 M3 渲染器的实现参数表）；
> 2. 给出最终美术资源清单与获取流程（第 3、4 节，项目所有者用 ChatGPT 生图执行）；
> 3. 提供每张图的现成提示词（第 5 节，直接复制使用）。

---

## 1. 总原则：为什么一张静态图就够

- 战场上单位实际绘制尺寸只有 **72~96px**（Boss 约 140px）。这个尺寸下逐帧动画的收益极低，而「静态精灵 + 代码驱动的变换 + 粒子」已经能表达出生动的动作感——参考项目「无聊塔防」全程序化绘制也能成立，我们比它多一层 AI 精灵，观感只会更好。
- 程序化动画的本质：**图不动，代码动**。每一帧渲染时，代码根据实体状态（待机/攻击/受击/死亡）计算出这张静态图的缩放、位移、旋转、闪白、透明度，再配合独立的粒子系统与飘字。
- 硬边界：所有动画只存在于**渲染层**，由渲染时钟驱动，绝不读写逻辑层状态、不消耗逻辑 RNG（引擎规格的逻辑/视觉分离原则）。

最终只需要 **16 张必需图**（8 单位 + 6 敌人 + 封面 + 吉祥物），可选再加 2 张地图装饰背景。棋盘地块、弹道、特效、图标全部不需要生成图。

---

## 2. 程序化动画技术手册（M3 渲染器实现规格）

### 2.1 通用机制

| 机制 | 实现 |
| --- | --- |
| 锚点 | 所有精灵以**脚底中心**为锚点绘制，变换（缩放/挤压）围绕锚点进行 |
| 阴影 | 不用美术阴影：代码在锚点画椭圆（宽 = 精灵宽 × 0.55，alpha 0.25），跳起/落下时椭圆随高度缩放 |
| 缓动函数 | `linear`、`easeOutQuad(t)=1-(1-t)^2`、`easeOutBack`（回弹）、`sin` 循环（呼吸） |
| 视觉相位 | 每个实体 `visualPhase = hash(entityId)`，让呼吸/摆动错开，避免全场同步鬼畜 |
| 插值 | 逻辑 30Hz、渲染 rAF：`renderPos = lerp(上一逻辑帧位置, 当前逻辑帧位置, 累积器/步长)` |
| 闪白（tint）缓存 | 每张精灵预生成一张纯白剪影（离屏 canvas：画精灵 → `globalCompositeOperation='source-in'` 填白）；受击时按 alpha 叠加绘制，不每帧重算 |
| 灰度缓存 | 同法预生成灰度版，用于阵亡瞬间 |
| reduced-motion | `prefers-reduced-motion` 时：关粒子、关呼吸/摆动、闪白改为无抖动的短暂变暗；飘字保留（属于信息） |

### 2.2 单位动画参数表

| 动画 | 触发 | 时长 | 具体变换 |
| --- | --- | --- | --- |
| 部署落地 | deploy 生效帧 | 350ms | 从 y-40px 落下（easeOutQuad）→ 落地压扁 scaleX 1.15 / scaleY 0.85 → 回弹到 1.0（easeOutBack）+ 尘土环粒子 ×6 |
| 待机呼吸 | 常态循环 | 2000ms/周期 | `scaleY = 1 + 0.02 × sin(2πt/T + visualPhase)` |
| 近战攻击 | 逻辑攻击帧 | 140ms | 朝目标方向顶身 6px（前 40ms easeOutQuad）→ 回位（后 100ms）；命中粒子出现在目标处 |
| 远程攻击 | 逻辑攻击帧 | 120ms | 向后坐 3px 回位；武器端 8px 白色闪光圆 80ms 淡出；同帧生成弹道 |
| 技能触发 | 技能释放帧 | 500ms | 脚底光环扩散（描边圆半径 0→1.2 格，淡出）+ 精灵短暂增亮；光环颜色按职业 |
| 受击 | 受伤帧 | 90ms | 白色 tint alpha 0.7→0 + 位置随机抖动 ±2px |
| 治疗接收 | 受疗帧 | 600ms | 3~5 个绿色光点从脚底上升 24px 淡出 |
| 阵亡 | HP 归零 | 400ms | scale 1→0.6 + alpha 1→0 + 切灰度版精灵 + 星屑粒子 ×10，结束后移除 |
| 撤退 | retreat 生效帧 | 300ms | 上浮 20px + alpha→0 + 少量上升粒子 + 「+N 费用」飘字 |

### 2.3 敌人动画参数表

| 动画 | 触发 | 时长 | 具体变换 |
| --- | --- | --- | --- |
| 行走摆动 | 移动中 | 连续 | `rotate ±3° × sin` + 纵向 bob 2px，频率与移速成正比；疾影狼 ±5° 并拖 2 帧残影（低 alpha 重绘） |
| 受击 | 受伤帧 | 90ms | 白闪同单位 |
| 被阻挡 | 阻挡中 | 连续 | 停止 bob，改为攻击顶身（同近战攻击 140ms，节奏跟逻辑攻击帧） |
| 死亡 | HP 归零 | 300ms | scaleY→0.2（压扁）+ alpha→0 + 碎片粒子 ×6 |
| Boss 登场 | 生成帧 | 600ms | scale 0.5→1（easeOutBack）+ 全屏震动 4px/200ms + 冲击环 |
| 金币怪光效 | 常态 | 每 200ms | 尾迹掉 1 粒金色闪光粒子；死亡时金币粒子 ×12 + 金色飘字 |
| 到达终点 | 进终点帧 | 300ms | 淡出 + 基地门红闪 + 「-1 生命」红色飘字 |

### 2.4 弹道（全程序绘制，无素材）

| 弹道 | 画法 |
| --- | --- |
| 箭矢（狙击/先锋远程） | 12px 线段 + 三角头，旋转朝向速度向量；命中火花粒子 ×4 |
| 法术弹（术师） | 6px 发光圆（径向渐变）+ 4 段渐隐拖尾；命中时 AOE 冲击环：描边圆 0→AOE 半径 200ms 淡出 + 范围内所有目标白闪 |
| 治疗束（医师） | 医师→目标的浅弧贝塞尔线上 3 个流动光点，持续期间循环 |

### 2.5 粒子系统与飘字

- 对象池上限 **150**，每粒子 `{pos, vel, life, size, color, gravity}`；超限丢弃最旧。粒子种类：火花、尘土、星屑、金光、治疗光点、冲击环（环是描边圆特例）。
- 飘字：伤害白色（物理）/ 紫色（法术）/ 绿色（治疗）/ 金色（幸运分）/ 红色（生命扣减）；上升 24px、600ms、easeOutQuad；同一目标连续飘字横向错开 8px。

### 2.6 棋盘与 HUD 的程序化绘制（无地块素材）

- **地面**：双色微差棋盘格平铺（每主题一组配色：草原 = 两档草绿；峡谷 = 两档砂岩）。
- **路径**：浅色石板色带 + 深色描边；路径上叠加缓慢向基地方向流动的 chevron 箭头（低 alpha，提示进攻方向）。
- **近战位**：路径格四角画蓝色角标；**远程位**：比地面亮一档的台面色 + 底边 2px 投影（造「高台」感）。
- **出怪口**：右侧红色发光拱门（程序绘制：圆拱 + 径向渐变红光）；**基地**：左侧蓝色水晶门 + 呼吸光晕，受击时红闪。
- 部署交互反馈：合法格呼吸高亮（alpha 0.25↔0.5）、选中单位射程圈（描边圆 alpha 脉冲）、费用条平滑填充、波次横幅滑入-停留-滑出 1.6s。
- 可选装饰背景图（第 3 节）垫在棋盘层下方，暗化 20%，不参与任何逻辑。

---

## 3. 美术资源清单（最终版）

| # | 资源 | 数量 | 生成尺寸 | 交付规格 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 1 | 单位战场精灵 | 8 | 1024×1024 透明 PNG | 256×256 webp | 战场绘制 ~84px；部署托盘/编队直接复用同图缩小，**不需要单独头像** |
| 2 | 敌人精灵（普通 ×5） | 5 | 1024×1024 透明 PNG | 256×256 webp | 战场 56~88px |
| 3 | Boss 精灵 | 1 | 1024×1024 透明 PNG | 320×320 webp | 战场 ~140px |
| 4 | 游戏中心封面 | 1 | 1536×1024 | 裁剪至与 `covers/` 现有文件一致尺寸的 webp | 游戏中心卡片 |
| 5 | 吉祥物 | 1 | 1024×1024 透明 PNG | 与 `mascots/` 现有文件一致尺寸的 webp | 游戏中心卡片角标 |
| 6 | 地图装饰背景（可选） | 2 | 1536×1024 | ≤1280 宽 webp | 棋盘底衬，可后补 |

**不需要生成**：地块/棋盘（2.6 程序绘制）、弹道与特效（2.4/2.5 程序绘制）、功能图标（暂停/倍速/关闭用 `lucide-react`，祝福卡与属性图标用 Emoji，延续平台惯例）。

### 交付文件命名（与代码约定一致）

```
public/images-optimized/ui/games/covers/lucky-td.webp
public/images-optimized/ui/games/mascots/lucky-td.webp
public/images-optimized/ui/games/lucky-td/units/vanguard.webp     疾风哨卫
public/images-optimized/ui/games/lucky-td/units/defender.webp     磐石重盾
public/images-optimized/ui/games/lucky-td/units/ranger.webp       双刃游侠
public/images-optimized/ui/games/lucky-td/units/flameblade.webp   烈焰剑士
public/images-optimized/ui/games/lucky-td/units/archer.webp       鹰眼射手
public/images-optimized/ui/games/lucky-td/units/caster.webp       星辉法师
public/images-optimized/ui/games/lucky-td/units/medic.webp        月光医师
public/images-optimized/ui/games/lucky-td/units/koi.webp          幸运锦鲤
public/images-optimized/ui/games/lucky-td/enemies/grunt.webp      碎星杂兵
public/images-optimized/ui/games/lucky-td/enemies/wolf.webp       疾影狼
public/images-optimized/ui/games/lucky-td/enemies/golem.webp      重甲卫
public/images-optimized/ui/games/lucky-td/enemies/puppet.webp     咒盾傀儡
public/images-optimized/ui/games/lucky-td/enemies/boss.webp       深渊魔王
public/images-optimized/ui/games/lucky-td/enemies/coin.webp       幸运金币怪
public/images-optimized/ui/games/lucky-td/bg/grassland.webp       （可选）
public/images-optimized/ui/games/lucky-td/bg/canyon.webp          （可选）
```

原始 PNG 不入库（体积大），本地留档即可；仓库只提交 webp。

---

## 4. ChatGPT 生图操作流程

### 4.1 保持风格一致的关键：锚点图 + 引用

1. **开一个新对话专门生图**，先生成「风格锚点」：用 5.2 的吉祥物提示词生成幸运锦鲤，反复重roll到满意为止——这张图定义整个游戏的画风。
2. 之后**每一张新图都把锚点图附在消息里**，提示词开头加一句：`Match the exact art style of the attached reference image (same outline weight, same shading style, same color saturation).`
3. 单位/敌人尽量在**同一个对话里连续生成**，风格漂移会明显变小。
4. 每张图建议生成 2~3 个候选再挑，总预算约 30~50 次生成，属正常范围。

### 4.2 生成参数

- 精灵类：**方形 1024×1024**，务必在提示词里写透明背景（见风格块）。
- 封面/背景：**横版 1536×1024**。
- 若返回的图背景不透明：追加一句 `The background must be fully transparent alpha PNG, absolutely no background color, no scenery, no ground.` 重新生成。

### 4.3 每张图的质检清单（生成后逐项核对）

- [ ] 角色完整居中，四肢无裁切，脚部可见（锚点在脚底）
- [ ] **朝向正确：我方单位朝右，敌人朝左**（横屏战场：敌人从右侧进攻，基地在左）
- [ ] 背景完全透明，无残留色块/地面/阴影（阴影由代码绘制）
- [ ] 无文字、无水印、无边框
- [ ] 描边粗细与锚点图接近，饱和度一致
- [ ] 敌我可读性：缩小到 80px 看缩略图，敌我一眼可分（我方明快、敌方暗紫基调）

### 4.4 后处理（PNG → webp）

任选其一：

**方式 A：ImageMagick 命令行**（安装 <https://imagemagick.org>）：

```bash
# 裁掉透明边 → 居中放到留白 8% 的方形画布 → 缩到 256 → 转 webp
magick vanguard.png -trim +repage -gravity center -background none \
  -resize 236x236 -extent 256x256 -quality 88 vanguard.webp
# Boss 用 -resize 296x296 -extent 320x320
```

**方式 B：在线工具**（图少，手动完全可行）：用 <https://squoosh.app> 逐张缩放并导出 webp（quality ~85）。

统一要求：所有单位精灵**角色高度占画布比例接近**（约 80%），否则战场上会显得大小失调；不一致时用裁边+统一画布的方式对齐。

---

## 5. 提示词库（直接复制）

> 提示词用英文（生成质量更稳），每条前面拼上 5.1 的通用风格块。中文说明仅供你核对内容。

### 5.1 通用风格块（每条精灵提示词的公共前缀）

```
Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.
```

### 5.2 吉祥物（先生成，作为风格锚点）

幸运锦鲤 · `mascots/lucky-td.webp` 与 `units/koi.webp` 共用设计：

```
[风格块] +
A cheerful lucky koi fish spirit mascot, front-facing mascot pose, white
body with bold red and gold koi patterns, tiny fairy-like translucent fins,
floating above a small golden water orb, winking and waving one fin,
surrounded by three sparkling gold coins and a four-leaf clover charm,
joyful expression.
```

战场版（units/koi.webp，让它朝右）在上面基础上把姿势句换成：
`facing right in a floating support pose, both fins spread as if casting a cheering aura`。

### 5.3 我方单位 ×8（全部 facing right）

**疾风哨卫 vanguard**（先锋，回费）
```
[风格块] +
A nimble young scout warrior facing right, teal and white light leather
armor with flowing wind-ribbon accents, holding a short spear pointed
forward and a small round buckler, confident agile stance, small stylized
swirling wind lines around the boots.
```

**磐石重盾 defender**（重装，阻挡 3）
```
[风格块] +
A stout heavily-armored knight facing right, slate gray plate armor with
gold trim, planting a massive rectangular tower shield firmly in front of
his body, sturdy immovable stance, helmet visor glowing warm yellow.
```

**双刃游侠 ranger**（近卫，高单体）
```
[风格块] +
A swift dual-wielding swordsman facing right, crimson and charcoal light
armor with a tattered scarf, two curved blades held ready in a crossed
stance, sharp confident eyes, poised to strike.
```

**烈焰剑士 flameblade**（近卫，溅射）
```
[风格块] +
A fiery knight facing right, black armor with glowing orange ember cracks,
resting a huge greatsword wreathed in small stylized cartoon flames on his
shoulder, tiny embers floating around him.
```

**鹰眼射手 archer**（狙击）
```
[风格块] +
A hooded archer facing right, forest green cloak and brown leather gear,
drawing a longbow with a glowing golden arrow, quiver on the back, one
focused eye visible under the hood, a small feather charm on the bow.
```

**星辉法师 caster**（术师，AOE 法术）
```
[风格块] +
A starlight mage facing right, deep blue and violet robe scattered with
tiny star patterns, wide wizard hat, holding up a staff topped with a
bright four-pointed star crystal, small sparkles orbiting the staff tip.
```

**月光医师 medic**（医疗）
```
[风格块] +
A gentle healer facing right, white and mint robe with crescent moon
motifs, holding a lantern staff glowing soft cyan, small healing light
motes rising around her, kind warm smile.
```

**幸运锦鲤 koi** —— 见 5.2 战场版。

### 5.4 敌人 ×6（全部 facing left，暗紫基调、可爱反派感）

**碎星杂兵 grunt**
```
[风格块] +
A small round mischievous imp made of cracked dark purple star-shard
crystal, stubby little legs, facing left in a marching pose, faint purple
glow seeping from the cracks, goofy grumpy face. Enemy unit: darker,
slightly desaturated purple palette.
```

**疾影狼 wolf**
```
[风格块] +
A sleek shadow wolf facing left, dark indigo body with glowing cyan
speed-line markings along its flanks, low sprinting posture, streamlined
silhouette suggesting high speed. Enemy unit: darker palette.
```

**重甲卫 golem**
```
[风格块] +
A bulky slow armored golem facing left, thick overlapping dark iron plates
with rivets, a tiny head sunk between huge shoulders, massive arms, a mossy
stone core glowing faint red between the plates. Enemy unit: darker palette.
```

**咒盾傀儡 puppet**
```
[风格块] +
A creepy-cute wooden marionette facing left, cracked doll body floating
slightly above the ground with loose strings, surrounded by a translucent
glowing magenta rune barrier ring, stitched grin. Enemy unit: darker palette.
```

**深渊魔王 boss**
```
[风格块] +
An imposing but stylized cute-evil abyss demon lord facing left, large
horned silhouette about twice the bulk of a normal minion, dark violet body
with glowing magma-red vein patterns, tattered royal cape, a small floating
golden crown above the horns, menacing toothy grin.
```

**幸运金币怪 coin**
```
[风格块] +
A shiny golden coin-shaped slime with tiny white angel wings facing left,
sparkling star glints on its surface, blissful happy face, a few tiny gold
coins dripping off its body.
```

### 5.5 游戏中心封面（1536×1024）

```
Landscape key art illustration for a cute chibi tower defense mobile game.
A vibrant grassy battlefield with a winding stone path; on the left, chibi
defenders hold the line in front of a glowing blue crystal gate: a stout
knight with a tower shield, a hooded archer drawing a bow, and a starlight
mage raising a star-tipped staff; from the right, a horde of cute dark
purple star-shard imps and a shadow wolf charge along the path; in the sky,
a white-and-red lucky koi fish spirit flies prominently, scattering golden
coins and four-leaf clovers; warm afternoon light, vibrant candy colors,
clean thick outlines, cel shading, dynamic composition, no text, no
watermark, no logo.
```

### 5.6 地图装饰背景 ×2（可选，1536×1024）

**草原 grassland**
```
Top-down-ish decorative background for a chibi tower defense game board,
bright grassy meadow theme, soft rolling grass texture with scattered tiny
flowers, a few cartoon trees and rocks around the OUTER EDGES only, the
large center area kept plain and uncluttered (a game board will be drawn on
top of it), vibrant candy colors, cel shading, soft lighting, no text, no
watermark, no characters.
```

**峡谷 canyon**
```
Top-down-ish decorative background for a chibi tower defense game board,
warm sandstone canyon theme, layered rock texture with a few cartoon cacti
and glowing crystals around the OUTER EDGES only, the large center area
kept plain and uncluttered (a game board will be drawn on top of it),
orange-teal color scheme, cel shading, no text, no watermark, no characters.
```

---

## 6. 与开发的交接顺序

1. **随时可开始**：吉祥物（锚点）→ 封面 —— 这两张是游戏中心上架卡片的硬需求。
2. **M3 前端中期前**：8 单位 + 6 敌人精灵到位即可；此前渲染器用内置几何占位皮肤开发，不阻塞。
3. **可以最后补**：2 张装饰背景（没有也能上线，棋盘是程序绘制的）。
4. 每张图按 4.3 质检、按 4.4 转 webp、按第 3 节路径命名放入仓库，前端读取路径在配置中写死为上述约定。
