# Collapsible code blocks

Long fenced code blocks in agent messages render collapsed behind a "Show more" / "Show less" toggle, so a big file dump doesn't bury the rest of the conversation. [[src/renderer/src/components/AgentMarkdown.tsx]]'s `CodeBlock` treats a block as long when it exceeds 15 lines or 800 characters.

## Expansion must survive streaming remounts

The expand/collapse choice is stored in a module-level `Set` keyed by the block's source position, not in plain component state — otherwise it resets to collapsed mid-stream.

While a message is still streaming, react-markdown re-parses the growing markdown on every token. Its index-based child keys shift as the AST grows, so a `CodeBlock` is frequently unmounted and remounted; a per-component `useState(true)` would re-initialize to collapsed on each remount, undoing the user's click.

The fix keys expansion on the opening fence's source offset (`node.position.start.offset`), which is stable as content appends. The `code` component mapper passes it as `blockId`; `CodeBlock` seeds its initial state from `expandedCodeBlocks.has(blockId)` and updates that set on toggle, so an expanded block stays expanded across remounts.

## Box diagrams render plain, not highlighted

Fenced blocks dominated by box-drawing characters, ASCII flowcharts, or layer-stack markers bypass Prism and render via `PlainCodeView`.

Prism fragments each glyph into nested token spans; in Electron renderers with imperfect Unicode metrics that fragmentation visually truncates or misaligns the diagram. Plain rendering also skips the lazy highlighter import and keeps the DOM to one text node. `fontVariantLigatures: "none"` and `unicodeBidi: "isolate"` guard glyph fidelity.

The gate is [[src/renderer/src/screens/Chat/mediaUtils.ts#isPlainDiagram]]: diagram glyphs must dominate the block, or a layer marker (`[A2A 层]`, `▼`, box corners) must appear alongside at least one diagram line. One incidental `│` in source code does not demote the whole file. Mislabeled fence languages (including `yaml`) do not override plain rendering.

Two precedence rules: `diff` blocks always keep the colored `DiffView` (it never uses Prism, so it has no fragmentation risk), and the header label keeps the fence's declared language — only an unlabeled box diagram is labeled `text`.

## Bare layer diagrams wrap in text fences

Bare MCP/A2A stack diagrams without fences are wrapped in `text` by [[src/renderer/src/screens/Chat/mediaUtils.ts#wrapBareDiagramBlocks]] before remark-gfm runs, so they render in monospace `pre` instead of misaligned prose.

Bracket labels, vertical `|` connectors, agent arrows, and short caption lines trigger wrapping. Existing fences and glued-table rows are skipped. Numbered or bullet lists with `**bold**` labels (e.g. `1. **记忆** → …`) stay markdown — they are never wrapped or plain-rendered as diagrams. Bold recommendation rows without list markers (e.g. `**如果追求快速变现** → 方向 5 …`) are treated the same way so `→` does not demote them into a `text` code block.

## LLM markdown normalization

Models often glue headings, table headers, and data rows onto one line (e.g. `让我## 标题` or `| ~5MB | | 桌面壳 |`), join whole tables with consecutive pipes (`| a | b | ||------|| | c |`), prefix a row with a stray leading `||`, glue a header directly to a compact separator (`| 目标 | … | ||-------|----------|-----|`), merge header labels (`Skill Agent`), glue multiple data rows via empty-cell boundaries (`| r1 | | r2 |`), emit a one-cell separator (`|------|`) for a multi-column header, omit the GFM separator row, or insert blank lines between rows (which breaks the table and leaves orphan `| 学习系统 | …` text). [[src/renderer/src/screens/Chat/mediaUtils.ts#normalizeAgentMarkdown]] repairs those patterns in prose only — real fenced code is never touched — so remark-gfm can render one contiguous table before [[src/renderer/src/components/AgentMarkdown.tsx]] parses the message. Compact dash separators are rewritten to spaced GFM form (`| --- | --- | --- |`) when column counts already match. Inline backticks inside table cells are kept intact during repair so cells like `` 创建 `/.well-known/agent.json` `` are not split mid-row.

Additional repair passes run before the prose-only table fixes:

- **Mislabeled fences** — when a `yaml`/`json`/`text` block actually contains markdown headings, bold markers (`**`), pipe-prefixed pseudo-list rows (`|- item`, `| | item`), workflow arrow steps (`-> step`), bold recommendation rows (`**label** → …`), or tables, the fence is stripped so remark-gfm can render the table instead of showing raw pipes inside a code block. If normalization misses a fence, [[src/renderer/src/components/AgentMarkdown.tsx]]'s `CodeBlock` falls back to rendering the body as markdown instead of monospace. Box diagrams inside `text` fences are left fenced.
- **Workflow arrow steps** — `-> step` lines (agent workflow narration, not box diagrams) are unwrapped from `text` fences, converted to markdown bullets, and never plain-rendered as collapsed code blocks. Stray trailing ` ``` ` glued to prose (e.g. a truncated fence marker) is stripped before fence repair runs.
- **Broken bold** — bold markers split across lines (`**标题` + `正文**`) are merged, and dangling `**` on a row are closed so later emphasis parses correctly.
- **Recommendation rows** — vertical-scenario rows like `**如果追求 X** → 方向 N …`, and star-prefixed pseudo rows like `* -> 做 开发者工具`, are split when glued on one line and turned into bullet list items so GFM renders one row per line. Splitting only breaks at row labels followed by an arrow (`**label** →`), not at inline tail emphasis (`→ 做**开发者工具**`), so well-formed conditional advice stays on one line. Split conditional advice (`** -> 做` / `**开发者工具**` text fences, dangling `**如果…` openers, spaced ` **` closers, and `•` bullets) is merged back into markdown list rows before rendering.
- **Glued headings** — `###标题` (no space after hashes) is broken onto its own line with a space inserted before the title text.
- **Entity-relation chains** — knowledge-graph examples that put each `→` on its own line (`Alice` / `→` / `works_at` / `→` / `Acme`) are collapsed into one list row (`- Alice → works_at → Acme`). Lone arrow-only lines are not treated as diagram blocks, so they no longer render as empty `text` code boxes.
- **Bare code** — consecutive lines that look like source (e.g. `app.get(…)`, `res.json(…)` without an opening fence) are wrapped in a detected-language fence so Prism can highlight them.
- **Unclosed fences** — a missing closing ` ``` ` before trailing prose is inserted so later markdown is not swallowed as code.
- **Glued tree diagrams** — one-line agent/skill tree output glued with `|` separators (e.g. `TypeScript 大师 (Agent) └── SOUL.md … | └── skills/ …`) is split onto separate lines and wrapped in a `text` fence so it renders in monospace `pre` instead of wrapping as prose.
- **Bare layer diagrams** — multi-line MCP/A2A stack diagrams with bracket labels, vertical connectors, and agent arrows but no opening fence are wrapped in a `text` fence so they align in monospace `pre`.
- **Pipe-comparison tiers** — product-tier lines that glue columns with `| | - item` (not valid GFM) become a `###` heading plus bullet list.

Tables are wrapped in `.chat-table-wrap` for horizontal scroll only; cell typography matches the original agent-bubble table styles. Parsed `h1`–`h4` inside `.chat-bubble-agent` inherit body `font-weight` (not semibold) so repaired headings like `### 1. …` do not look bolder than surrounding prose. `strong` / `b` use `font-weight: 600` so Tailwind preflight does not make emphasis invisible.

## Syntax highlighting palette

Fenced code blocks with a declared language use Prism via react-syntax-highlighter. [[src/renderer/src/components/prismLanguage.ts#resolvePrismLanguage]] maps fence aliases (`ts`, `py`, `js`, `yml`, …) and auto-detects language for unlabeled fences from code shape before [[src/renderer/src/components/AgentMarkdown.tsx]] renders tokens. The palette follows the active UI theme: **one-light** for light appearances, **one-dark** for dark.

Inline-code pill styles (`background`, `padding`) apply only to bare `` `backtick` `` spans — not to `.chat-code-block code`, because Prism renders `div > code` (not `pre > code`) and the pill background was painting a dark strip behind every line.

Fenced blocks use `--chat-code-bg` (white in light themes, deep `#0f1117` in dark — not muddy gray) with a slightly stronger border so the surface reads clearly against the agent bubble. Code inside blocks stays at 13px `var(--font-mono)` with `-webkit-font-smoothing: auto` for crisp Windows rendering; collapsed blocks fade via a gradient overlay instead of `mask-image`.
