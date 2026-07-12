# 幸运塔防 生图提示词总表（按角色 · 完整拼接版）

> 配套 `docs/lucky-td-animation-guide.md`（流程/质检/切片交付）与 `docs/lucky-td-art-guide.md`（风格体系）。
> 本文把所有提示词按角色逐条拼接完整——**每条整段复制即可用，无需再拼装**。
>
> 使用规则（只有 4 条）：
> 1. 顺序：先用 §0 吉祥物锚点定风格 → 生成该角色「静态参考图」定稿 → 再做该角色的动画条。
> 2. **每条动画提示词发送时必须附上该角色定稿的静态图**（静态图提示词则附吉祥物锚点图）。
> 3. 尺寸：静态图 1024×1024；动作条一律 1536×1024 横版。
> 4. P0/P1/P2 = 制作优先级（P0=上线必需，P1=完整感，P2=锦上添花）。背景必须透明，返图不透明就按 art-guide §4.2 追话术重生。

---

## 0. 风格锚点：吉祥物幸运锦鲤（最先做这张；已有则跳过）

```
Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A cheerful lucky koi fish spirit mascot, front-facing mascot pose, white
body with bold red and gold koi patterns, tiny fairy-like translucent fins,
floating above a small golden water orb, winking and waving one fin,
surrounded by three sparkling gold coins and a four-leaf clover charm,
joyful expression.
```

---

## 1. vanguard 疾风哨卫（我方 · 朝右 · 短矛+小圆盾）

### 1.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A nimble young scout warrior facing right, teal and white light leather
armor with flowing wind-ribbon accents, holding a short spear pointed
forward and a small round buckler, confident agile stance, small stylized
swirling wind lines around the boots.
```

### 1.1 待机 idle · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (breathing) animation, frames from left to right:
Frame 1: neutral relaxed guard stance, short spear held loosely at his side,
buckler lowered, calm confident expression.
Frame 2: chest rises slightly mid-breath, shoulders lift a tiny bit, the spear
tip rises subtly.
Frame 3: peak of the inhale, body very slightly taller, wind ribbons drifting
upward gently.
Frame 4: settling exhale, body relaxes just below neutral, wind ribbons
drifting back down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 1.2 攻击 attack · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPEAR ATTACK animation, frames from left to right:
Frame 1: anticipation — pulls the short spear back beside his hip, slight
crouch, body coiling up, buckler raised in front.
Frame 2: deeper wind-up — spear fully drawn back, body squashed slightly
lower, eyes locked to the right.
Frame 3: STRIKE — thrusts the spear straight forward to the right at chest
height, full arm extension, 2-3 white motion smear lines along the spear path.
Frame 4: follow-through — spear slightly past full extension, wind ribbons
whipping forward.
Frame 5: recovery — pulling the spear back toward the guard position.
Frame 6: nearly back to the neutral guard stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 1.3 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (heroic, not gory), frames from left
to right:
Frame 1: hit recoil — knocked backward to the left, eyes closed tight, spear
arm dropping.
Frame 2: collapsing — body crumples downward, squashed, the spear slipping
from his hand.
Frame 3: down on one knee, the spear clattering on the ground beside him,
head bowed.
Frame 4: slumped forward into a kneeling silhouette, wind ribbons falling limp.
Frame 5: faint fading kneeling silhouette, barely recognizable, last wind
wisps drifting away.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 1.4 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light, the scout's silhouette barely visible
inside.
Frame 2: landing crouch — he touches down, body squashed, golden light
dispersing.
Frame 3: rising with a slight overshoot, standing taller than normal, light
motes scattering.
Frame 4: settling into his ready guard stance, spear and buckler up, last
sparkles fading.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 2. defender 磐石重盾（我方 · 朝右 · 巨型塔盾）

### 2.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A stout heavily-armored knight facing right, slate gray plate armor with
gold trim, planting a massive rectangular tower shield firmly in front of
his body, sturdy immovable stance, helmet visor glowing warm yellow.
```

### 2.1 待机 idle · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (breathing) animation, frames from left to right:
Frame 1: neutral immovable stance, the massive tower shield planted in front
of him, both hands braced on it, visor glowing warm yellow.
Frame 2: chest rises slightly mid-breath, shoulders lift a tiny bit.
Frame 3: peak of the inhale, body very slightly taller, visor glow a touch
brighter.
Frame 4: settling exhale, body relaxes just below neutral, visor glow
softening.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 2.2 攻击 attack · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SHIELD BASH attack animation, frames from left to
right:
Frame 1: anticipation — pulls the tower shield back toward his body, slight
crouch, coiling up.
Frame 2: deeper wind-up — shield fully drawn back, body squashed slightly
lower, stance wide.
Frame 3: STRIKE — slams the shield edge forward to the right like a ram, full
extension, 2-3 white motion smear lines behind the shield.
Frame 4: follow-through — shield slightly past full extension, gold trim
glinting.
Frame 5: recovery — pulling the shield back toward the planted position.
Frame 6: nearly back to the neutral planted stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 2.3 技能「盾墙」skill · 6 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SHIELD WALL skill animation, frames from left to
right:
Frame 1: hoists the tower shield up high with both arms, knees bent.
Frame 2: shield raised to the highest point above his head, body stretched
tall.
Frame 3: SLAMS the shield down into the ground in front of him, body squashed
low, dust burst at the base.
Frame 4: impact hold — shield planted, a golden translucent barrier dome
flashing into existence around him.
Frame 5: braced behind the planted shield, the golden barrier dome glowing
steady.
Frame 6: holding the fortress pose, barrier glow softening.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 2.4 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (heroic, not gory), frames from left
to right:
Frame 1: hit recoil — knocked backward to the left, visor glow flickering,
shield arm sagging.
Frame 2: collapsing — body crumples downward, squashed, the tower shield
tipping over.
Frame 3: down on one knee behind the fallen shield, head bowed.
Frame 4: slumped kneeling silhouette, visor glow almost out.
Frame 5: faint fading kneeling silhouette beside the flat shield, barely
recognizable.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 2.5 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light, the knight's bulky silhouette barely
visible inside.
Frame 2: landing crouch — he touches down heavily, body squashed, golden
light dispersing.
Frame 3: rising with a slight overshoot, standing taller than normal, light
motes scattering.
Frame 4: settling into his immovable stance, the tower shield slamming down
in front of him, last sparkles fading.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 3. ranger 双刃游侠（我方 · 朝右 · 双弯刀）

### 3.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A swift dual-wielding swordsman facing right, crimson and charcoal light
armor with a tattered scarf, two curved blades held ready in a crossed
stance, sharp confident eyes, poised to strike.
```

### 3.1 待机 idle · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (breathing) animation, frames from left to right:
Frame 1: neutral ready stance, both curved blades held low and relaxed, the
tattered scarf hanging calm, sharp eyes forward.
Frame 2: chest rises slightly mid-breath, blade tips lift subtly.
Frame 3: peak of the inhale, body very slightly taller, scarf drifting up
gently.
Frame 4: settling exhale, body relaxes just below neutral, scarf drifting
back down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 3.2 攻击 attack · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DUAL BLADE attack animation, frames from left to
right:
Frame 1: anticipation — both blades pulled back and crossed behind him,
slight crouch, coiling like a spring.
Frame 2: deeper wind-up — maximum pull-back, body squashed slightly lower,
eyes locked to the right.
Frame 3: STRIKE — slashes both blades forward in a crossing X cut to the
right, full extension, 2-3 white motion smear lines along both blade paths.
Frame 4: follow-through — blades slightly past full extension, scarf whipping
forward.
Frame 5: recovery — drawing both blades back toward the ready cross.
Frame 6: nearly back to the neutral ready stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 3.3 技能「三连斩」skill · 8 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 8 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's TRIPLE SLASH skill animation, frames from left to
right:
Frame 1: crouches with both blades crossed behind, coiled like a spring.
Frame 2: FIRST SLASH — right blade sweeps forward horizontally to the right,
motion smear lines.
Frame 3: momentum carries through, body twisting.
Frame 4: SECOND SLASH — left blade sweeps upward diagonally, motion smear
lines.
Frame 5: gathers into a spin, blades tucked in close.
Frame 6: THIRD SLASH — spinning double-blade cut, both blades extended, the
strongest smear lines of all.
Frame 7: lands from the spin, blades swept behind, scarf whipping.
Frame 8: settles back toward the ready stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 3.4 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (heroic, not gory), frames from left
to right:
Frame 1: hit recoil — knocked backward to the left, eyes closing, both blades
sagging.
Frame 2: collapsing — body crumples downward, squashed, one blade slipping
from his hand.
Frame 3: down on one knee, both blades dropped on the ground, scarf falling
limp.
Frame 4: slumped kneeling silhouette, head bowed.
Frame 5: faint fading kneeling silhouette between the two fallen blades,
barely recognizable.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 3.5 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light, the swordsman's silhouette barely
visible inside.
Frame 2: landing crouch — he touches down, body squashed, golden light
dispersing.
Frame 3: rising with a slight overshoot, standing taller than normal, light
motes scattering.
Frame 4: settling into his ready stance with both blades crossed, last
sparkles fading.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 4. flameblade 烈焰剑士（我方 · 朝右 · 燃焰巨剑）

### 4.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A fiery knight facing right, black armor with glowing orange ember cracks,
resting a huge greatsword wreathed in small stylized cartoon flames on his
shoulder, tiny embers floating around him.
```

### 4.1 待机 idle · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (breathing) animation, frames from left to right:
Frame 1: neutral heavy stance, the huge flaming greatsword resting on his
shoulder, tiny embers floating around him.
Frame 2: chest rises slightly mid-breath, the ember cracks glowing a touch
brighter.
Frame 3: peak of the inhale, body very slightly taller, the small flames on
the blade rising.
Frame 4: settling exhale, body relaxes just below neutral, embers drifting
back down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 4.2 攻击 attack · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's GREATSWORD SWING attack animation, frames from left
to right:
Frame 1: anticipation — swings the greatsword off his shoulder and back
behind him, slight crouch, coiling up.
Frame 2: deeper wind-up — greatsword fully wound back, body squashed slightly
lower, ember cracks flaring bright.
Frame 3: STRIKE — swings the greatsword in a wide horizontal arc to the
right, full extension, a small flame trail and 2-3 white motion smear lines
along the arc.
Frame 4: follow-through — sword slightly past full extension, flames
streaming behind the blade.
Frame 5: recovery — hauling the greatsword back up.
Frame 6: nearly back to the shoulder-rest stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 4.3 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (heroic, not gory), frames from left
to right:
Frame 1: hit recoil — knocked backward to the left, the ember cracks dimming.
Frame 2: collapsing — body crumples downward, squashed, the greatsword
dropping point-first.
Frame 3: down on one knee, the greatsword stuck in the ground beside him, its
flames going out.
Frame 4: slumped kneeling silhouette leaning against the sword, embers dying.
Frame 5: faint fading kneeling silhouette, the last ember winking out.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 4.4 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light, the knight's silhouette barely
visible inside.
Frame 2: landing crouch — he touches down heavily, body squashed, golden
light dispersing.
Frame 3: rising with a slight overshoot, standing taller than normal, light
motes scattering.
Frame 4: settling into his heavy stance, the greatsword landing on his
shoulder, its flames reigniting.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 5. archer 鹰眼射手（我方 · 朝右 · 长弓金箭）

### 5.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A hooded archer facing right, forest green cloak and brown leather gear,
drawing a longbow with a glowing golden arrow, quiver on the back, one
focused eye visible under the hood, a small feather charm on the bow.
```

### 5.1 待机 idle · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (breathing) animation, frames from left to right:
Frame 1: neutral watchful stance, the longbow held loosely at his side, one
focused eye under the hood scanning right.
Frame 2: chest rises slightly mid-breath, the bow tip lifts subtly.
Frame 3: peak of the inhale, body very slightly taller, the cloak drifting up
gently.
Frame 4: settling exhale, body relaxes just below neutral, the cloak drifting
back down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 5.2 攻击 attack · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's BOW SHOT attack animation, frames from left to right:
Frame 1: draws the bowstring — nocking a glowing golden arrow, the bow rising
to aim to the right.
Frame 2: full draw — string pulled to his cheek, aiming steady, body still,
cloak taut.
Frame 3: RELEASE — the string snapped forward, the golden arrow just leaving
the frame to the right, arm recoil, 2-3 white motion smear lines along the
arrow path.
Frame 4: follow-through — bow arm still extended, the string vibrating, cloak
settling.
Frame 5: recovery — lowering the bow, his other hand reaching toward the
quiver.
Frame 6: nearly back to the watchful stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 5.3 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (heroic, not gory), frames from left
to right:
Frame 1: hit recoil — knocked backward to the left, the hood falling back
slightly.
Frame 2: collapsing — body crumples downward, squashed, the longbow slipping
from his hand.
Frame 3: down on one knee, the bow dropped beside him, head bowed.
Frame 4: slumped kneeling silhouette, the cloak draping around him.
Frame 5: faint fading cloaked silhouette, the small feather charm drifting
down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 5.4 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light, the hooded silhouette barely visible
inside.
Frame 2: landing crouch — he touches down lightly, body squashed, golden
light dispersing.
Frame 3: rising with a slight overshoot, standing taller than normal, light
motes scattering.
Frame 4: settling into his watchful stance, longbow in hand, last sparkles
fading.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 6. caster 星辉法师（我方 · 朝右 · 星辉法杖）

### 6.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A starlight mage facing right, deep blue and violet robe scattered with
tiny star patterns, wide wizard hat, holding up a staff topped with a
bright four-pointed star crystal, small sparkles orbiting the staff tip.
```

### 6.1 待机 idle · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (breathing) animation, frames from left to right:
Frame 1: neutral standing pose, holding the staff upright, the star crystal
glowing softly, small sparkles orbiting the tip.
Frame 2: chest rises slightly mid-breath, the star glow pulsing a touch
brighter.
Frame 3: peak of the inhale, body very slightly taller, the robe hem drifting
up gently, sparkles rising.
Frame 4: settling exhale, body relaxes just below neutral, sparkles drifting
back down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 6.2 攻击 attack · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPELL CAST attack animation, frames from left to
right:
Frame 1: anticipation — draws the staff back and low, slight crouch, the star
crystal gathering light.
Frame 2: deeper wind-up — staff fully drawn back, body squashed slightly
lower, the star crystal glowing intensely bright.
Frame 3: CAST — thrusts the staff forward to the right, the star crystal
flashing with a four-pointed starburst, 2-3 white motion smear lines along
the thrust.
Frame 4: follow-through — staff slightly past full extension, sparkles
scattering forward.
Frame 5: recovery — drawing the staff back upright.
Frame 6: nearly back to the neutral pose, sparkles settling into orbit.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 6.3 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (heroic, not gory), frames from left
to right:
Frame 1: hit recoil — knocked backward to the left, the wizard hat tipping.
Frame 2: collapsing — body crumples downward, squashed, the staff slipping
from his grip.
Frame 3: down on one knee, the staff fallen beside him, the star crystal
dimming.
Frame 4: slumped kneeling silhouette, the hat slid down over his face.
Frame 5: faint fading kneeling silhouette, the last sparkle blinking out.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 6.4 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light, the mage's hatted silhouette barely
visible inside.
Frame 2: landing crouch — he touches down, body squashed, golden light
dispersing.
Frame 3: rising with a slight overshoot, standing taller than normal, light
motes scattering.
Frame 4: settling upright with the staff raised, sparkles returning to orbit
the star crystal.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 7. medic 月光医师（我方 · 朝右 · 提灯法杖 · 动作全程柔和无杀气）

### 7.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A gentle healer facing right, white and mint robe with crescent moon
motifs, holding a lantern staff glowing soft cyan, small healing light
motes rising around her, kind warm smile.
```

### 7.1 待机 idle · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (breathing) animation, frames from left to right:
Frame 1: neutral gentle stance, holding the lantern staff, its soft cyan glow
steady, small healing motes rising slowly around her.
Frame 2: chest rises slightly mid-breath, the lantern glow warming a touch.
Frame 3: peak of the inhale, body very slightly taller, the robe drifting up
gently, motes rising.
Frame 4: settling exhale, body relaxes just below neutral, motes drifting
back down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 7.2 攻击（治疗施法）attack · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's HEALING CAST animation (soft and gentle, no harsh
motion lines), frames from left to right:
Frame 1: gathers energy — draws the lantern staff close to her chest, eyes
closing gently, the glow building.
Frame 2: deeper focus — body lowering slightly, the lantern shining brighter,
healing motes swirling inward.
Frame 3: HEAL BURST — raises the staff high, a soft green-cyan glow bursting
upward and outward, gentle light ribbons flowing toward the right.
Frame 4: follow-through — staff held high, light ribbons streaming, the robe
lifted slightly by the glow.
Frame 5: recovery — lowering the staff gracefully.
Frame 6: nearly back to the gentle neutral stance, motes settling.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 7.3 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (peaceful, not gory), frames from
left to right:
Frame 1: hit recoil — knocked back softly to the left, eyes closing.
Frame 2: collapsing — sinking downward, squashed, the lantern staff lowering.
Frame 3: kneeling, the lantern staff standing beside her, its glow
flickering.
Frame 4: slumped kneeling silhouette, the lantern light fading to a single
spark.
Frame 5: faint fading kneeling silhouette, one last healing mote rising away.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 7.4 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light, the healer's silhouette barely
visible inside.
Frame 2: landing — she touches down lightly, body slightly squashed, golden
light dispersing.
Frame 3: rising with a slight overshoot, standing taller than normal, light
motes scattering.
Frame 4: settling into her gentle stance, the lantern staff relighting with a
soft cyan glow.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 8. koi 幸运锦鲤（我方 · 朝右 · 漂浮辅助 · **无攻击动画**（攻击力为 0））

### 8.0 静态参考图（附吉祥物锚点图；与吉祥物同设计、战场姿势版）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A cheerful lucky koi fish spirit, white body with bold red and gold koi
patterns, tiny fairy-like translucent fins, floating above a small golden
water orb, facing right in a floating support pose, both fins spread as if
casting a cheering aura, surrounded by a few sparkling gold coins.
```

### 8.1 待机 idle · 4 帧 · P0（漂浮起伏+光环脉动；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's IDLE (floating bob) animation, frames from left to
right:
Frame 1: floating at the highest point of a gentle bob above the golden water
orb, fins relaxed, a golden aura ring glowing softly around it.
Frame 2: drifting down to middle height, fins spreading slightly, the aura
ring pulsing a touch brighter.
Frame 3: at the lowest point of the bob, body very slightly squashed, the
aura ring at its brightest.
Frame 4: rising back to middle height, fins trailing, the aura ring dimming
back to soft.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 8.2 死亡 death · 5 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's DEATH animation (gentle, not gory), frames from left
to right:
Frame 1: hit recoil — knocked sideways to the left, eyes closing, sparkles
scattering.
Frame 2: drooping — fins falling limp, the golden water orb wobbling.
Frame 3: sinking down gently, body dimming, the orb shrinking.
Frame 4: resting low in a faint curled silhouette, the last gold sparkles
rising away.
Frame 5: barely visible pale silhouette, a single four-leaf clover drifting
down.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 8.3 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces RIGHT in every frame.

This is the character's SPAWN (deploy entrance) animation, frames from left
to right:
Frame 1: a column of soft golden light with tiny gold coins swirling inside,
a fish silhouette barely visible.
Frame 2: the koi spirit pops out, body squashed, the light dispersing into
sparkles.
Frame 3: rising with a playful overshoot, fins flared wide, coins scattering.
Frame 4: settling into its floating pose above the golden water orb, the aura
ring lighting up.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 9. grunt 碎星杂兵（敌方 · 朝左 · 紫晶小鬼）

### 9.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A small round mischievous imp made of cracked dark purple star-shard
crystal, stubby little legs, facing left in a marching pose, faint purple
glow seeping from the cracks, goofy grumpy face. Enemy unit: darker,
slightly desaturated purple palette.
```

### 9.1 行走 walk · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent ground
  baseline and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's WALK cycle animation (it loops: frame 6 leads back
into frame 1), frames from left to right:
Frame 1: left stubby leg planted forward touching the ground, right leg
lifted behind, round body leaning forward.
Frame 2: body at its lowest point, squashed slightly shorter and wider, both
knees bent, the purple crack glow flaring.
Frame 3: pushing off, body stretched slightly taller, right leg swinging
forward.
Frame 4: right stubby leg planted forward touching the ground, left leg
lifted behind (mirror of frame 1).
Frame 5: body at the lowest point again, squashed (mirror of frame 2).
Frame 6: pushing off, stretched, left leg swinging forward (mirror of
frame 3).

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 9.2 攻击 attack · 6 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's HEADBUTT attack animation, frames from left to right:
Frame 1: anticipation — rears back to the right, the crystal body glowing
brighter, grumpy face scrunching up.
Frame 2: deeper wind-up — squashed low, crack lines flaring bright purple.
Frame 3: STRIKE — headbutt lunge to the LEFT, full extension, crack lines
flaring, 2-3 white motion smear lines behind it.
Frame 4: follow-through — slightly past full extension, purple glow trailing.
Frame 5: recovery — wobbling back upright.
Frame 6: nearly back to its marching stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 9.3 待机 idle · 2 帧 · P2（被阻挡时；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 2 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's IDLE (blocked, breathing) animation, frames from left
to right:
Frame 1: standing still facing left, glaring grumpily, the purple crack glow
breathing dim.
Frame 2: the same pose risen a tiny bit with a breath, the crack glow
slightly brighter.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 9.4 死亡 death · 5 帧 · P1（晶体碎裂；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's DEATH animation (cartoon shattering, not gory),
frames from left to right:
Frame 1: hit recoil — knocked backward to the right, eyes turning to X marks,
body tilted away.
Frame 2: collapsing — body crumpling downward, squashed, the first cracks
spreading wide.
Frame 3: the crystal body cracking apart into large purple shards.
Frame 4: shards scattering outward, the inner glow fading.
Frame 5: a small pile of dim purple shards, barely recognizable.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 10. wolf 疾影狼（敌方 · 朝左 · 四足疾奔）

### 10.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A sleek shadow wolf facing left, dark indigo body with glowing cyan
speed-line markings along its flanks, low sprinting posture, streamlined
silhouette suggesting high speed. Enemy unit: darker palette.
```

### 10.1 行走（疾奔）walk · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent ground
  baseline and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's GALLOP run cycle animation (it loops: frame 6 leads
back into frame 1), frames from left to right:
Frame 1: full gallop stretch — front legs reaching far forward to the left,
hind legs extended far back, body long and low.
Frame 2: front paws touching the ground, body starting to compress.
Frame 3: fully gathered — all four legs bunched under the body, back arched
high, body squashed.
Frame 4: hind paws touching the ground, body starting to extend, head rising.
Frame 5: launching — hind legs pushing off, front legs lifting, body
extending forward.
Frame 6: airborne moment — all paws off the ground, body at full stretch, the
cyan speed-line markings glowing.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 10.2 攻击（扑咬）attack · 6 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's POUNCE BITE attack animation, frames from left to
right:
Frame 1: anticipation — crouches low leaning to the right, fangs bared, the
cyan markings charging up.
Frame 2: deeper wind-up — body fully gathered, haunches coiled, ready to
pounce.
Frame 3: STRIKE — pouncing bite to the LEFT, jaws snapping at full extension,
cyan streaks and 2-3 white motion smear lines.
Frame 4: follow-through — body stretched past the bite, tail whipping.
Frame 5: recovery — landing and pulling back.
Frame 6: nearly back to its low prowling stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 10.3 待机 idle · 2 帧 · P2（被阻挡时；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 2 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's IDLE (blocked, tense breathing) animation, frames
from left to right:
Frame 1: standing low and tense facing left, hackles up, the cyan markings
glowing dim.
Frame 2: the same pose with a breath — chest rising slightly, the markings
pulsing brighter.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 10.4 死亡（影散）death · 5 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's DEATH animation (dissolving into shadow, not gory),
frames from left to right:
Frame 1: hit recoil — knocked sideways to the right, eyes closing, legs
buckling.
Frame 2: collapsing — body crumpling down, squashed low.
Frame 3: the body dissolving into dark wisps of shadow from the tail forward.
Frame 4: wisps scattering, the cyan speed-lines flickering out one by one.
Frame 5: a faint fading wisp of shadow, barely recognizable.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 11. golem 重甲卫（敌方 · 朝左 · 沉重踏步）

### 11.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A bulky slow armored golem facing left, thick overlapping dark iron plates
with rivets, a tiny head sunk between huge shoulders, massive arms, a mossy
stone core glowing faint red between the plates. Enemy unit: darker palette.
```

### 11.1 行走（踏步）walk · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent ground
  baseline and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's HEAVY STOMP walk cycle animation (it loops: frame 4
leads back into frame 1), frames from left to right:
Frame 1: the left massive foot stomps down forward, the whole body tilting
left, arms swinging heavily.
Frame 2: dragging forward, body upright, both feet grounded, a small dust
puff at the feet.
Frame 3: the right massive foot stomps down forward, the whole body tilting
right (mirror of frame 1).
Frame 4: dragging forward, upright again (mirror of frame 2).

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 11.2 攻击（双臂砸）attack · 6 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's DOUBLE ARM SLAM attack animation, frames from left to
right:
Frame 1: anticipation — raises both massive arms overhead, the tiny head
sinking between the shoulders.
Frame 2: deeper wind-up — arms at their highest point, body stretched tall,
the red core glow flaring.
Frame 3: STRIKE — slams both arms down to the LEFT, a ground impact burst,
2-3 white motion smear lines along the swing.
Frame 4: follow-through — arms buried low past the impact, plates rattling.
Frame 5: recovery — heaving the arms back up slowly.
Frame 6: nearly back to its hulking stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 11.3 待机 idle · 2 帧 · P2（被阻挡时；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 2 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's IDLE (blocked, breathing) animation, frames from left
to right:
Frame 1: hulking still facing left, arms hanging heavy, the red core glow
breathing dim.
Frame 2: the same pose, shoulders risen a tiny bit, the core glow slightly
brighter.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 11.4 死亡（装甲崩解）death · 5 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's DEATH animation (armor falling apart, not gory),
frames from left to right:
Frame 1: hit recoil — staggering backward to the right, plates rattling
loose.
Frame 2: collapsing — sinking down, squashed, the first plates falling off.
Frame 3: armor plates falling away, the mossy stone core exposed.
Frame 4: plates piling up around it, the red core glow dying.
Frame 5: a small mound of dark plates, the core dark, barely recognizable.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 12. puppet 咒盾傀儡（敌方 · 朝左 · 漂浮木偶）

### 12.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A creepy-cute wooden marionette facing left, cracked doll body floating
slightly above the ground with loose strings, surrounded by a translucent
glowing magenta rune barrier ring, stitched grin. Enemy unit: darker palette.
```

### 12.1 行走（漂浮摇摆）walk · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's FLOATING drift cycle animation (it loops: frame 4
leads back into frame 1), frames from left to right:
Frame 1: floating at the highest point of the bob, strings relaxed, body
tilted 3 degrees to the left.
Frame 2: drifting down to middle height, upright.
Frame 3: at the lowest point of the bob, slightly squashed, body tilted 3
degrees to the right.
Frame 4: rising back to middle height, upright.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 12.2 攻击（符能冲击）attack · 6 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's RUNE SHOCKWAVE attack animation, frames from left to
right:
Frame 1: anticipation — drifts back to the right, the magenta rune ring
spinning faster, strings pulling taut.
Frame 2: deeper wind-up — body coiled back, the rune ring glowing intensely.
Frame 3: STRIKE — thrusts forward to the LEFT, the magenta rune ring flaring
outward in a shockwave, 2-3 white motion smear lines.
Frame 4: follow-through — body slightly past extension, strings whipping.
Frame 5: recovery — drifting back, the ring slowing.
Frame 6: nearly back to its floating sway.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 12.3 待机 idle · 2 帧 · P2（被阻挡时；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 2 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's IDLE (blocked, hovering) animation, frames from left
to right:
Frame 1: floating still facing left, strings slack, the rune ring rotating
slowly and dim.
Frame 2: the same pose risen a tiny bit, the rune ring a touch brighter.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 12.4 死亡（木偶散架）death · 5 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's DEATH animation (a puppet falling apart, not gory),
frames from left to right:
Frame 1: hit recoil — jolted backward to the right, the stitched grin
cracking.
Frame 2: collapsing — the strings snapping one by one, body sagging.
Frame 3: limbs disassembling, wooden parts coming loose in the air.
Frame 4: wooden parts scattered and falling, the rune ring shattering into
magenta fragments.
Frame 5: a small heap of wooden pieces, barely recognizable.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 13. boss 深渊魔王（敌方 · 朝左 · 战场 ~140px，交付帧 320×320）

### 13.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

An imposing but stylized cute-evil abyss demon lord facing left, large
horned silhouette about twice the bulk of a normal minion, dark violet body
with glowing magma-red vein patterns, tattered royal cape, a small floating
golden crown above the horns, menacing toothy grin.
```

### 13.1 行走（威压阔步）walk · 6 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent ground
  baseline and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's IMPOSING STRIDE walk cycle animation (it loops: frame
6 leads back into frame 1), frames from left to right:
Frame 1: the left clawed foot planted forward, body tilted left, the tattered
cape swinging back, crown steady above the horns.
Frame 2: dragging forward at the lowest point, slightly squashed, the
magma-red veins pulsing bright.
Frame 3: pushing off taller, the right leg swinging forward, cape lifting.
Frame 4: the right clawed foot planted forward, body tilted right (mirror of
frame 1).
Frame 5: the lowest point again, squashed, veins pulsing (mirror of frame 2).
Frame 6: pushing off taller, the left leg swinging forward, cape billowing
(mirror of frame 3).

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 13.2 攻击（魔爪横扫）attack · 6 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's SWEEPING CLAW attack animation, frames from left to
right:
Frame 1: anticipation — raises a huge clawed hand back to the right, the
magma veins flaring.
Frame 2: deeper wind-up — the claw at its highest, body coiled, cape flaring
wide.
Frame 3: STRIKE — sweeping claw slash to the LEFT, full extension, a red
motion smear and 2-3 white smear lines along the arc.
Frame 4: follow-through — the claw past full extension, cape whipping
forward.
Frame 5: recovery — drawing the claw back with menace.
Frame 6: nearly back to its towering stance.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 13.3 待机 idle · 2 帧 · P2（被阻挡时；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 2 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's IDLE (blocked, menacing breathing) animation, frames
from left to right:
Frame 1: towering still facing left, arms loose, the magma veins breathing
dim, toothy grin.
Frame 2: the same pose risen slightly with a slow breath, the veins glowing
brighter, cape stirring.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 13.4 死亡（王者陨落）death · 6 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's DEATH animation (a dramatic fall, not gory), frames
from left to right:
Frame 1: hit recoil — staggering backward to the right, the little golden
crown wobbling.
Frame 2: falling to one knee, the crown tumbling off.
Frame 3: clutching its chest, the magma veins dimming section by section.
Frame 4: collapsing forward onto both hands, the cape draping over the body.
Frame 5: flattened low, the last magma glow fading, the crown resting beside
it.
Frame 6: a dark motionless silhouette under the cape, the dull crown on the
ground beside it.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 13.5 生成（登场）spawn · 4 帧 · P2（附本角色静态图；游戏内另叠程序化震屏）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent ground
  baseline and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's SPAWN (dramatic entrance) animation, frames from left
to right:
Frame 1: a swirling dark violet portal, a huge horned silhouette looming
inside.
Frame 2: stepping out — one clawed foot forward through the portal, the cape
emerging.
Frame 3: fully emerged and rising to full height, cape flaring wide, the
crown gleaming, magma veins igniting.
Frame 4: planted in its towering stance, the portal closing into sparks
behind it.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 14. coin 幸运金币怪（敌方 · 朝左 · 弹跳金币史莱姆）

### 14.0 静态参考图（附吉祥物锚点图）

```
Match the exact art style of the attached reference image (same outline
weight, same shading style, same color saturation).

Chibi fantasy game character sprite for a cute tower defense mobile game.
Cute proportions (big head, small body, about 2.5 heads tall), clean thick
dark outlines, cel shading with soft gradient accents, vibrant candy-like
colors, subtle rim lighting, slight 3/4 top-down camera angle, full body
with feet visible, dynamic idle pose, centered composition, isolated on a
fully transparent background (PNG with alpha), no ground, no shadow, no
text, no watermark, no border, crisp edges, high detail.

A shiny golden coin-shaped slime with tiny white angel wings facing left,
sparkling star glints on its surface, blissful happy face, a few tiny gold
coins dripping off its body.
```

### 14.1 行走（弹跳）walk · 4 帧 · P0（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent ground
  baseline and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's BOUNCING hop cycle animation (it loops: frame 4 leads
back into frame 1), frames from left to right:
Frame 1: squashed flat on the ground at the contact of a bounce, wings folded
up.
Frame 2: launching upward and to the left, body stretched tall, wings
snapping open.
Frame 3: airborne at the peak of the hop, round and relaxed, wings spread,
star glints sparkling.
Frame 4: descending, body stretching downward, wings tilted back, about to
land.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 14.2 攻击（软身撞）attack · 6 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 6 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent ground
  baseline and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's SOFT BODY SLAM attack animation, frames from left to
right:
Frame 1: anticipation — leans back to the right, the jelly body wobbling,
sparkles gathering.
Frame 2: deeper wind-up — compressed into a squashed disc, glowing brighter.
Frame 3: STRIKE — soft body slam lunging to the LEFT, fully stretched, tiny
gold coins spraying, 2-3 white motion smear lines.
Frame 4: follow-through — wobbling past extension like jelly.
Frame 5: recovery — jiggling back into shape.
Frame 6: nearly back to its blissful hover.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 14.3 待机 idle · 2 帧 · P2（被阻挡时；附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 2 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's IDLE (blocked, hovering) animation, frames from left
to right:
Frame 1: hovering still facing left, wings fluttering lazily, blissful face,
tiny coins dripping slowly.
Frame 2: the same pose risen a tiny bit, the star glints twinkling brighter.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 14.4 死亡（金币爆散）death · 5 帧 · P1（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 5 frames, evenly spaced, equal width cells.
- The character is the SAME SIZE in every frame, feet on the SAME ground baseline.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's DEATH animation (bursting into coins, cheerful not
gory), frames from left to right:
Frame 1: hit recoil — knocked backward to the right, the blissful face
turning dizzy, coins spraying.
Frame 2: deflating like a punctured balloon, wings drooping.
Frame 3: crumpling into a wobbly half-flat blob, the gold glow concentrating.
Frame 4: BURSTING into a shower of gold coins flying outward.
Frame 5: a small pile of gold coins with two tiny white feathers, the body
gone.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

### 14.5 生成 spawn · 4 帧 · P2（附本角色静态图）

```
Using the attached character reference image, create a sprite animation strip
of EXACTLY this same character (same design, same colors, same outline weight,
same proportions, same art style).

Layout requirements (critical):
- A single horizontal row of exactly 4 frames, evenly spaced, equal width cells.
- The character is the SAME SCALE in every frame; keep one consistent baseline
  and let the body rise or fall only as the frames below describe.
- Fully transparent background (PNG with alpha). No ground, no shadow, no grid
  lines, no frame borders, no numbers, no text, no watermark.
- The character faces LEFT in every frame.

This is the character's SPAWN (pop-in) animation, frames from left to right:
Frame 1: a burst of golden sparkles hanging in the air.
Frame 2: the coin slime pops into existence, squashed, sparkles scattering.
Frame 3: overshoot stretch — bouncing up taller than normal, wings unfurling.
Frame 4: settling into its blissful hover, tiny coins beginning to drip.

Cute chibi tower defense game style, cel shading, clean thick dark outlines,
vibrant candy-like colors, crisp edges.
```

---

## 附：提示词清点

| 类别 | 数量 |
| --- | --- |
| 风格锚点（吉祥物） | 1 |
| 静态参考图 | 14（8 单位 + 6 敌人） |
| 单位动画 | 33（idle×8 + attack×7 + skill×2 + death×8 + spawn×8） |
| 敌人动画 | 26（walk×6 + attack×6 + idle×6 + death×6 + spawn×2） |
| **合计** | **74 条** |

> 敌人 grunt/wolf/golem/puppet 不需要 spawn（从传送门走出即 walk）。
> 制作顺序与每档取舍见 `docs/lucky-td-animation-guide.md` §0；
> 切片、对齐、打包交付见同文 §6（也可以把生成图直接发给开发处理）。
