---
name: 手写作业生成器
description: 把一段文字排成一页以假乱真的中国作业本手写稿，完全本地运行
colors:
  paper: "#f4f1e8"
  paper-2: "#ebe6d8"
  desk: "#e3ddcc"
  ink: "#1e2328"
  ink-2: "#4a4436"
  ink-3: "#5f5849"
  vermilion: "#b0342a"
  vermilion-soft: "#cd7568"
  vermilion-tint: "rgba(176,52,42,.08)"
  grass-green: "#5c7748"
  grass-green-soft: "#a7c096"
  dark-paper: "#23272b"
  dark-paper-2: "#1b1f23"
  dark-desk: "#131518"
  dark-ink: "#e7e4da"
  dark-vermilion: "#e06a5c"
  dark-grass-green: "#8fae7a"
typography:
  display:
    fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans SC, Source Han Sans SC, Hiragino Sans GB, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.05em"
  brand:
    fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans SC, Source Han Sans SC, Hiragino Sans GB, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "0.06em"
  body:
    fontFamily: "Microsoft YaHei, PingFang SC, Hiragino Sans GB, Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: "Cascadia Mono, Consolas, ui-monospace, SFMono-Regular, monospace"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.02em"
rounded:
  none: "0px"
spacing:
  xs: "8px"
  sm: "13px"
  md: "20px"
  lg: "26px"
  xl: "44px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 13px"
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "8px 13px"
  button-good:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.vermilion}"
    rounded: "{rounded.none}"
    padding: "8px 13px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
  paper-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "7px"
  tag-cn:
    backgroundColor: "{colors.vermilion}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "1px 7px"
  tag-en:
    backgroundColor: "{colors.grass-green}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "1px 7px"
---

# Design System: 手写作业生成器

## Overview

**Creative North Star: "田字格练习簿"（The Exercise Book）**

这个界面不是一块 SaaS 面板，而是一册翻开的中国练字本。整个视觉系统只有一个主张：**预览页本身就是一张排好的作业本纸，而界面长得像那页纸**。骨架纸底、墨黑文字、淡朱横线、草绿田字格、页边细线与印好的页码——所有颜色、线条和控件都是从"作业本"这一件实物里拆出来的零件，不是从设计系统的调色板里挑的。

因此这里**刻意拒绝**了工具类产品最顺手的那套默认手法：左侧一排参数仪表盘、右侧一张浮起来的白色预览卡片、再配一堆圆角阴影。它的控件像"页边装置"——细线、无圆角、实心=按下的印迹、朱砂红只落在唯一的主动作和红头标记上。它看起来应该像一册练习簿，而不是一个被套了米色主题的后台。

**Key Characteristics:**
- 骨白纸底 + 墨黑文字，暖而不黄、稳而不闷。
- 淡朱（vermilion）只做主动作、红头、页码与选中印迹；草绿只做田字格与英文标签。两个彩色各自克制。
- 无圆角、无渐变、无玻璃拟态；所有分隔都是 1px 细线，像印刷的格线。
- 预览纸由一个 canvas 现场绘制（田字格 / 横线 / 页边页码），是"产品在干活"的可见证据。
- 标题与引导用大而清楚的黑体，正文同样用结实的黑体保证可读，读数用等宽字。楷体只留在品牌印章「写」上。

## Colors

调色板来自一件实物——用过的作业本：骨白的纸、墨黑的字、红笔勾画的朱砂、草稿本上那层淡淡的绿。

### Primary
- **朱砂红 Vermilion** (`#b0342a`): 唯一的强色。用在主动作「生成预览」、品牌封头的印章「写」、当前选中的纸张/字体边框、页码与页边印刷标记、焦点环、输入光标、以及 `::selection` 的底色。它出现在任何给定屏幕上不超过约 10% 的面积——**它的稀少就是它的力量**。
- **淡朱 Vermilion Soft** (`#cd7568`): 只做装饰性的横线（封头下方的朱线、装订边的页边线、空状态里的排线）。是不出现即无妨、出现即定调的一层。

### Secondary
- **草绿 Grass Green** (`#5c7748`): 用于「英文」标签底与田字格的中心虚线。是朱砂红的冷调平衡，不是第二个主色。

### Neutral
- **纸白 Paper** (`#f4f1e8`): 正文纸面。所有面板、按钮、输入框的底色。
- **装订边 Paper-2** (`#ebe6d8`): 左栏（装订边）与折叠面板的底色，比纸面略深一档，像本子内侧的衬纸。
- **桌面 Desk** (`#e3ddcc`): 右侧预览区的背景，是"纸"下面的"桌面"，刻意比纸面更暖更深，让预览纸看起来是躺在上面的。
- **墨黑 Ink** (`#1e2328`): 正文与标题文字。
- **暖灰墨 Ink-2 / Ink-3** (`#4a4436` / `#5f5849`): 次级文字与更弱的注释、readout。两者都已加深到满足 WCAG AA。

### Named Rules
**朱砂不外扩规则 (The Vermilion Rarity Rule).** 朱砂红只出现在：主动作、品牌印章、选中态、页码/页边标记、焦点环、光标。它**从不**用来给区块上色、做背景填充或装饰一整片区域。
**线即分隔规则 (The Hairline Rule).** 结构分隔一律用 1px 细线（`--hair` / `--hair-2`）；没有第二层级的"卡片边框+阴影"。
**灯关规则 (The Lights-Off Rule).** 暗夜模式（`[data-theme="dark"]`）是同一册练习簿把灯关了，不是另一套配色：把 `--paper/--paper-2/--desk` 整体压暗（仍按亮→暗分层）、`--ink` 翻成暖白、朱砂与草绿提亮保持对比。**预览纸与导出永不随主题改变**——那是实物白纸，暗夜下仍是白纸黑字。

## Theme

界面支持白天 / 暗夜双模，由封头右侧的方形切换按钮（日/月图形 + 文字）驱动，选择记在 `localStorage.hw_theme`，刷新保持。**只有显式点击才改变主题，默认恒为白天**（不跟随系统，避免用户首次打开被"惊喜"到）。主题只切换界面外壳；预览画布与导出的 PNG/PDF 始终是白纸黑字。见 Colors 里的暗色令牌与「灯关规则」。

## Typography

**Display / Brand Font:** Microsoft YaHei（回落 PingFang SC / Noto Sans SC / Source Han Sans SC / system-ui）
**Body Font:** Microsoft YaHei（回落 PingFang SC / Hiragino Sans GB / system-ui）
**Seal Font:** HW_KaiDisplay（自托管的楷体子集，仅用于品牌印章「写」）
**Label / Mono Font:** Cascadia Mono（回落 Consolas / ui-monospace）

**Character:** 标题、步骤名、预览标题、引导文案统一用**大而清楚的黑体**：作业本是给自己写字的，界面上的引导要一眼看清，楷体的细笔画在小字号下吃亏，所以标题也交给黑体。楷体只留在品牌印章「写」这一枚朱砂章上——它是唯一的装饰性手写痕迹。读数、页码、DPI 用等宽字，因为它是在测量数据，这正是等宽字的正当用途，不是"技术感"的装饰。

### Hierarchy
- **Brand** (700, 20px, lh 1.2, ls .06em): 封头产品名「手写作业生成器」，紧跟一枚朱砂印章「写」（印章内的「写」用楷体子集）。
- **Display** (700, 15px, lh 1.2, ls .05em): 步骤标题（一/二/三 文字内容·字体·纸张）、「预览」标题、「高级设置」摘要。黑体，清楚为主。
- **Body** (400, 15px, lh 1.62): 正文、按钮、输入框、说明。
- **Label** (500, 12px, ls .02em, 等宽): 状态读数、页码、DPI、种子、「调参台」注释。

### Named Rules
**标题一律清楚的规则 (The Legible-Headings Rule).** 标题、步骤名、引导文案一律用大而清楚的黑体，**不用楷体**——楷体笔画细，小字号看不清。楷体只保留给品牌印章「写」这一枚装饰章。自托管的 `HW_KaiDisplay` 只含界面所需字形，未覆盖的字由回落字体承担。

## Layout

两栏骨架，比例刻意不对称——这是"作业本"而不是"控制台"的关键：

- **封头条 (`.masthead`)**：高 54px，吸顶。左起品牌 + 印章，接本地版徽标，右侧是等宽状态读数。底部一条淡朱细线压边。
- **装订边 (`.bind`)**：固定宽 352px、独立滚动。三步输入（① 文字 ② 字体 ③ 纸张）从顶部堆下，高级设置折叠成一个"附录页"，主操作按钮组固定在流程末尾、以一条朱砂分隔线起头。它**刻意窄于内容区**，因为参数是配角、纸面才是主角。
- **纸面 (`.desk`)**：占据剩余宽度，是预览的本体。顶部一条 `deskbar` 放「预览」标题、压缩提示与页数/DPI 读数，下方是一列居中堆叠的 `.page-holder`（画布 + 页码说明），间距 26px。

响应式：`max-width:900px` 时两栏改纵向堆叠，装订边在上、纸面在下，封头允许换行（`min-height:54px` + `flex-wrap`）。

间距节奏：8px（紧邻控件）→ 13px（控件内边距）→ 20px（面板内边距）→ 26px（预览区/页间距）→ 44px（装订边底部留白）。

## Elevation & Depth

这是一个**平铺 + 纸感阴影**的混合系统，不是"层级卡片"系统。界面本身完全不抬升：面板之间靠 1px 细线和底色深浅（纸面 → 装订边 → 桌面）区分，不用阴影。

唯一的阴影语言留给**纸**：预览画布用一个低强度的双层阴影，模拟纸张压在桌面上的浮起感。

### Shadow Vocabulary
- **纸浮起 (`0 1px 2px rgba(34,39,45,.14), 0 14px 34px rgba(34,39,45,.20)`)**: 只用于 `.page-holder` 的预览画布。模拟纸张的实感。
- **纸张色板 (`0 1px 3px rgba(34,39,45,.28)`)**: 只用于纸张选择器里 30×40 的小色板缩略图。
- **空状态纸 (`0 1px 2px rgba(34,39,45,.1), 0 18px 40px rgba(34,39,45,.16)`)**: 只用于未生成时空状态那张"空白练习页"。
- **吐司 (`0 10px 30px rgba(34,39,45,.28)`)**: 只用于右下角提示浮层。

### Named Rules
**纸才配阴影规则 (The Paper-Only Shadow Rule).** 阴影只属于"一张纸"这个物件——预览画布、纸张缩略图、空状态页、吐司。控件、面板、导航一律不用阴影，靠细线和底色分层。

## Shapes

**形语言：印刷品。圆角恒为 0。** `--r: 0px` 贯穿所有按钮、输入框、卡片、标签。这个世界里没有圆角，因为作业本上的格子和印章都是方的。

- **分隔**：1px 细线（`--hair` / `--hair-2`）。当前选中用 1px 朱砂**内描边**（`inset 0 0 0 1px`）或 1px 朱砂外框，从不用左侧色条。
- **网格**：纸张选择器与操作按钮组用 2 列 grid。
- **纸张比例**：空状态与预览页是 A4 纵向（210:297）。
- **印章**：品牌印章是一个 26px 的实心朱砂方块，内嵌白色楷体「写」，`box-shadow: 0 0 0 1px` 描同色边。
- **墨点 (`.inkdot`)**：24px 正圆，是唯一的圆形元件（它代表一滴墨，不是 UI 圆角）。

## Components

### Buttons
- **Shape:** 方形（radius 0），1px 细线边框，`padding: 8px 13px`。
- **Primary**（`.btn.primary`）: 朱砂底 + 白字，700 字重，字距 .08em。唯一的主行动「生成预览」，占满一行、高 13px 内边距放大到 15px 字号。
- **Hover / Focus:** hover 时边框转深墨（`--ink-2`）底色转 #fff；active 时底色转 `--verm-tint`、边框转朱砂。焦点环统一是 `2px solid var(--verm)`、偏移 2px。
- **Good**（`.btn.good`）: 纸底 + 朱砂字 + 朱砂边框（「下载 PDF」）。次级但仍是正色。
- **Small**（`.btn.sm`）: `padding: 6px 11px`、13px，用于导入/存草稿这类附随动作。

### Tags (`.ftag`)
- **Style:** 方形色块，白字，12px 700，字距 .06em。中文标签朱砂底、英文标签草绿底——用两种印刷色区分字库来源。

### Cards / Containers
- **Corner Style:** 方形。
- **Background:** 纸面 `--paper`。
- **Shadow Strategy:** 见 Elevation——容器不用阴影。
- **Border:** 1px `--hair-2`；选中态叠 1px 朱砂内描边。
- **Internal Padding:** 7px（纸张卡片）/ 11–13px（列表项、输入）。
- **纸张卡片 (`.paper-card`)**：左侧 30×40 色板 + 名称；右上角细线方形「×」删除键（`removable` 的纸才有），hover 才显朱砂——删除是页边装置，平时不抢眼。内置纸删掉即从主表移除，可在别处复原；用户自建的纸（含上传）删掉即彻底消失。

### Collapsible Groups (`.more-toggle`)
- **Style:** 全宽细线按钮，前置一枚朱砂三角，展开时旋转 90°；右侧等宽字标注被折起来的纸张数量 `（N）`。
- **Purpose:** 「更多纸张」——把低频纸张（米色/牛皮/做旧纹理、草稿纸及各种可打印页型）折起来，默认收起，不占版面。配套的小标题 `.paper-sect-h`（如「自定义纸张」）用 1px 细线拉通右侧。

### Drop Zone (`.drop-zone`)
- **Style:** 虚线细边框、纸底，居中两行文案（主行 13px 600 墨黑、附行 12px 墨灰）；hover/拖入时边框与底色转朱砂。
- **Purpose:** 自定义纸张的添加入口——点击或把图片拖进来，整页铺满。下方配名称输入与「长期保存」勾选。

### Inputs / Fields
- **Style:** 纸面底、1px 细线边框、方形。文本域 `min-height:150px`、`padding:11px 13px`，并铺一层 1.9em 的行距横线（像稿纸的行）。下拉与单行输入 `padding:8px 10px`。
- **Focus:** 靠全局 `:focus-visible` 的朱砂焦点环。
- **Ink dots:** 一排 24px 墨点做快捷选色，选中时叠一圈朱砂环。

### Navigation
无独立导航。吸顶封头承担品牌与状态；流程靠左栏三步在纵向上推进。

### Sliders
轨道是 3px 细线，滑块是 14px 朱砂圆点（白底描边、朱砂外环）。两端有 12px 的注释刻度。

### Signature Component: 预览纸 Canvas
整个产品的可见心脏。每生成一页，canvas 现场绘制：纸张底（可铺内嵌的真实纸张照片）、田字格（实线格墙 + 每格的虚线中心十字）、或横线，再逐字叠上手写笔迹（按行整体缓漂、笔画抖动、逐字墨色深浅）。页边底部印一条淡朱细线 + 居中页码「N / 总」（**可选**，见「页边印页码」开关，默认开；关掉即保持纸张原貌）。这是"产品在干活"的证据，也是本方向唯一被写进合同的标志动作。

## Do's and Don'ts

### Do:
- **Do** 把朱砂红留给主动作、印章、选中态、页码、焦点环、光标——面积控制在屏幕的约 10% 以内。
- **Do** 用 1px 细线和底色深浅（纸面 → 装订边 → 桌面）做分层，而不是卡片 + 阴影。
- **Do** 保持圆角恒为 0；用 1px 内描边或外框表示选中。
- **Do** 标题与引导用大而清楚的黑体、正文用 UI 黑体、读数用等宽字——黑体给可读性，楷体只留给印章「写」。
- **Do** 让预览纸只承载"纸"这一种物件该有的阴影。
- **Do** 用等宽字承载真正的测量数据（页数、DPI、种子）。

### Don't:
- **Don't** 引入渐变文字、玻璃拟态或模糊装饰。
- **Don't** 用左侧色条（`border-left` / `border-right` 超过 1px）标记任何卡片、列表项或提示——选中一律用 1px 内描边或字重。
- **Don't** 给控件、面板、导航加阴影；阴影只属于"纸"。
- **Don't** 把朱砂红当背景大面积铺开。
- **Don't** 用圆角、圆角卡片或"仪表盘 + 浮卡"的通用工具布局——它正是这个世界刻意拒绝的默认。
