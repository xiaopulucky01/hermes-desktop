import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

vi.mock("./useI18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "common.copied": "Copied",
        "common.showMore": "Show more",
        "common.showLess": "Show less",
      })[key] ?? key,
  }),
}));

vi.mock("./ThemeProvider", () => ({
  useTheme: () => ({
    theme: "dark",
    resolved: "dark",
    setTheme: vi.fn(),
    rounded: true,
    setRounded: vi.fn(),
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./MediaImage", () => ({
  MediaImage: () => <div data-testid="media-image" />,
  DownloadChip: () => <div data-testid="download-chip" />,
}));

// Wait until the lazily-imported Prism highlighter has produced token spans,
// so a later "no .token" assertion is meaningful rather than just observing
// the not-yet-loaded fallback.
async function renderHighlighted(
  markdown: string,
): Promise<ReturnType<typeof render>> {
  const view = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
  await waitFor(
    () => expect(view.container.querySelector(".token")).not.toBeNull(),
    { timeout: 5000 },
  );
  return view;
}

describe("AgentMarkdown", () => {
  it("renders box-drawing tree diagrams as plain text, even with the highlighter loaded", async () => {
    // Control first: prove highlighting works in this environment, and leave
    // the highlighter module loaded so the tree block below would use Prism
    // synchronously if it were ever routed there.
    await renderHighlighted(
      ["```ts", "const answer: number = 42;", "```"].join("\n"),
    );

    const markdown = [
      "```text",
      "project",
      "├── src",
      "│   └── main.ts",
      "└── README.md",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    const plain = container.querySelector(".chat-code-plain");

    expect(plain).not.toBeNull();
    expect(plain?.textContent).toContain("├── src");
    expect(plain?.textContent).toContain("│   └── main.ts");
    expect(plain?.textContent).toContain("└── README.md");
    expect(container.querySelector(".token")).toBeNull();
  });

  it("keeps syntax highlighting for code with an incidental box-drawing character", async () => {
    // One │ in a string literal must not demote the whole file to plain text.
    const markdown = [
      "```python",
      'SEPARATOR = "│"',
      "def greet(name):",
      '    return f"hello {name}"',
      "",
      "def main():",
      "    print(greet('world'))",
      "```",
    ].join("\n");

    const { container } = await renderHighlighted(markdown);
    expect(container.querySelector(".chat-code-plain")).toBeNull();
    expect(container.textContent).toContain("│");
  });

  it("keeps the colored diff view for diffs that touch box-drawing content", () => {
    // DiffView never uses Prism, so a patch on a tree diagram must not lose
    // its +/- coloring to the box-diagram plain path.
    const markdown = [
      "```diff",
      "+├── src",
      "-└── lib",
      "+│   └── main.ts",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-diff-content")).not.toBeNull();
    expect(container.querySelector(".chat-diff-add")).not.toBeNull();
    expect(container.querySelector(".chat-diff-remove")).not.toBeNull();
    expect(container.querySelector(".chat-code-plain")).toBeNull();
  });

  it("renders a vs-Cursor comparison table including the last row", () => {
    const markdown = [
      "**vs Cursor**",
      "",
      "| 维度 | Cursor | Hermes Code | 优势 |",
      "| --- | --- | --- | --- |",
      "| 价格 | $20/月 | $10/月 | → 便宜 50% |",
      "| 多平台 | 只有 IDE | 20+ IM 平台 | 更灵活 |",
      "",
      "| 学习系统 | 无 | Memory + Skills | 越用越好 |",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelectorAll(".chat-table-wrap table").length).toBe(1);
    expect(container.querySelectorAll("tr").length).toBe(4);
    expect(container.textContent).toContain("学习系统");
    expect(container.textContent).not.toMatch(/\| 学习系统 \| 无 \|/);
  });

  it("renders a multi-row tech-stack table after normalization", () => {
    const markdown = [
      "## 技术栈选择",
      "",
      "| 组件 | 选择 | 理由 | 体积 |",
      "| 编辑器 | Monaco Editor | VS Code 核心, 轻量, 成熟 | ~5MB | | 桌面壳 | Electron | 跨平台, 生态成熟 | ~80MB |",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    const rows = container.querySelectorAll("tr");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain("Monaco Editor");
    expect(container.textContent).toContain("Electron");
    expect(container.textContent).not.toMatch(/\| \| 桌面壳/);
  });

  it("renders a repaired GFM table instead of raw pipe syntax", () => {
    const markdown = [
      "你问到了核心问题。让我## 之前的方案能解决吗？",
      "目标 | 能否解决 | 原因 ||-------|----------|-----|",
      "**价格降下来** | ✅ 可以 | 成本结构决定",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("th")?.textContent).toContain("目标");
    expect(container.textContent).not.toContain("||-------");
  });

  it("renders ASCII flowcharts as plain text without Prism", () => {
    const markdown = [
      "```",
      "传统流程                    AI流程",
      "1. 获取需求    →    1. 获取需求",
      "         ↑__________________|",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-code-plain")).not.toBeNull();
    expect(container.querySelector(".token")).toBeNull();
    expect(container.textContent).toContain("→");
  });

  it("highlights typescript and python with distinct Prism tokens", async () => {
    const ts = await renderHighlighted(
      ["```typescript", "const value: number = 42;", "```"].join("\n"),
    );
    expect(ts.container.querySelectorAll(".token").length).toBeGreaterThan(0);
    expect(ts.container.querySelector(".chat-code-lang")?.textContent).toBe(
      "typescript",
    );

    const py = await renderHighlighted(
      ["```py", "def greet(name: str) -> str:", '    return f"hi {name}"', "```"].join(
        "\n",
      ),
    );
    expect(py.container.querySelectorAll(".token").length).toBeGreaterThan(0);
    expect(py.container.querySelector(".chat-code-lang")?.textContent).toBe("py");
  });

  it("auto-detects language for unlabeled code fences", async () => {
    const markdown = [
      "```",
      "interface Spec {",
      "  ok: boolean;",
      "}",
      "export class Verifier {",
      "  async verify(): Promise<boolean> {",
      "    return true;",
      "  }",
      "}",
      "```",
    ].join("\n");

    const { container } = await renderHighlighted(markdown);
    expect(container.querySelectorAll(".token").length).toBeGreaterThan(0);
    expect(container.querySelector(".chat-code-lang")?.textContent).toBe(
      "typescript",
    );
  });

  it("labels an unlabeled box diagram as text but keeps a declared language", () => {
    const bare = render(
      <AgentMarkdown>
        {["```", "├── src", "└── README.md", "```"].join("\n")}
      </AgentMarkdown>,
    );
    expect(bare.container.querySelector(".chat-code-lang")?.textContent).toBe(
      "text",
    );

    const declared = render(
      <AgentMarkdown>
        {["```bash", "├── src", "└── README.md", "```"].join("\n")}
      </AgentMarkdown>,
    );
    expect(
      declared.container.querySelector(".chat-code-lang")?.textContent,
    ).toBe("bash");
    // Box-dominant content still renders plain regardless of the label.
    expect(declared.container.querySelector(".chat-code-plain")).not.toBeNull();
  });

  it("renders markdown unwrapped from a mislabeled yaml fence as a table", () => {
    const markdown = [
      "```yaml",
      "### 可发布的 Agent 类型",
      "",
      "| Agent 名称 | 对应方案 | 能力描述 | 目标用户 |",
      "| **Hermes Developer** | 方案 2 | 全栈开发 | 开发者 |",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-table-wrap table")).not.toBeNull();
    expect(container.textContent).toContain("Hermes Developer");
    expect(container.querySelector(".chat-code-block")).toBeNull();
  });

  it("renders bare JavaScript as a highlighted code block", async () => {
    const markdown = [
      "端点示例：",
      "app.get('/.well-known/agent.json', (req, res) => {",
      "  res.json({ name: 'Hermes Code Developer' });",
      "});",
    ].join("\n");

    const { container } = await renderHighlighted(markdown);
    expect(container.querySelector(".chat-code-block")).not.toBeNull();
    expect(container.querySelector(".chat-code-lang")?.textContent).toBe(
      "javascript",
    );
  });

  it("renders a yaml-labeled tree diagram as plain text, not Prism", () => {
    const markdown = [
      "```yaml",
      "TypeScript 大师 (Agent)",
      "└── SOUL.md ← 我是谁",
      "└── skills/",
      "    └── review/",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-code-plain")).not.toBeNull();
    expect(container.querySelector(".token")).toBeNull();
    expect(container.querySelector(".chat-code-lang")?.textContent).toBe("yaml");
  });

  it("renders a glued one-line tree diagram as a plain fenced block", () => {
    const markdown =
      'TypeScript 大师 (Agent) └── SOUL.md ← "我是谁" | "你是一个有 10 年经验的 TypeScript 架构师..." | └── skills/ ← "我会什么" | └── review/ (代码审查技能)';

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    const plain = container.querySelector(".chat-code-plain");
    expect(plain).not.toBeNull();
    expect(plain?.textContent).toContain('TypeScript 大师 (Agent) └── SOUL.md');
    expect(plain?.textContent).toContain('└── skills/ ← "我会什么"');
    expect(container.querySelector(".token")).toBeNull();
  });

  it("renders a glued OpenClaw vs Hermes comparison table", () => {
    const markdown =
      "| 维度 | OpenClaw | Hermes Agent || ------ || 定位 | 个人 AI 助手（消费者） | 自主 agent 基础设施部署 || 架构 | Gateway daemon + nodes | Agent + 多后端 || 协作 | 多 agent 路由 | 开发者、研究者、高级用户 || 社区规模背景 | OpenAI 支持 | Nous Research |";

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-table-wrap table")).not.toBeNull();
    expect(container.querySelectorAll("tr").length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain("OpenClaw");
    expect(container.textContent).toContain("Hermes Agent");
    expect(container.textContent).not.toContain("||");
  });

  it("renders a Skill vs Agent summary table with a leading double pipe", () => {
    const markdown =
      "|| Skill | Agent || --- | --- || 是什么 | 一项能力 | 一个角色 || 有无灵魂 | ❌ 无 | ✅ 有 (SOUL.md) || 有无记忆 | ❌ 无 | ✅ 有 || 独立性 | 不能独立运行 | 独立运行 || 组合 | 1 个 | N 个 Skills || 卖给用户 | 工具 | 专家 |";

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-table-wrap table")).not.toBeNull();
    expect(container.querySelectorAll("tr").length).toBeGreaterThanOrEqual(5);
    expect(container.textContent).toContain("Skill");
    expect(container.textContent).toContain("Agent");
    expect(container.textContent).not.toContain("||");
  });

  it("renders a Skill vs Agent table when header words are merged", () => {
    const markdown =
      "|| Skill Agent ||---|---|---| || 是什么 | 一项能力 | 一个角色 || 有无灵魂 | ❌ 无 | ✅ 有 (SOUL.md) || 有无记忆 | ❌ 无 | ✅ 有 || 独立性 | 不能独立运行 | 独立运行 || 组合 | 1 个 | N 个 Skills || 卖给用户 | 工具 | 专家 |";

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-table-wrap table")).not.toBeNull();
    expect(container.querySelectorAll("tr").length).toBeGreaterThanOrEqual(5);
    expect(container.textContent).toContain("Skill");
    expect(container.textContent).toContain("Agent");
    expect(container.textContent).not.toContain("||");
  });

  it("renders an A2A requirements table with rows glued via empty cells", () => {
    const markdown = [
      "| 要求 | Hermes 现状 | 适配方案 |",
      "| --- | --- | --- |",
      "| Agent Card | ❌ 无 | 创建 `/.well-known/agent.json` |",
      "| 任务管理 API | ❌ 无标准 REST API | 封装 | delegate_task 为 HTTP 端点 | | 输入/输出 Schema | ❌ 无 | 为每个角色定义 JSON Schema | | 认证机制 | ✅ 已有 API key | 扩展为 OAuth2 或 Bearer Token | | 状态管理 | ✅ Session 机制 | 映射到 A2A 的 Task 状态 |",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-table-wrap table")).not.toBeNull();
    expect(container.querySelectorAll("tr").length).toBeGreaterThanOrEqual(5);
    expect(container.textContent).toContain("认证机制");
    expect(container.textContent).toContain("状态管理");
    expect(container.textContent).toContain("/.well-known/agent.json");
  });

  it("renders pipe-comparison tiers as headings and lists", () => {
    const markdown = [
      "Hermes Agent 基础功能 | | - 3 个默认角色 | | - 基础 Skills | |",
      "↓ 升级",
      "Hermes Code Pro ($10/月) | | - 20+ 专业角色 | | - A2A 平台发布 | |",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector("h3")?.textContent).toContain(
      "Hermes Agent 基础功能",
    );
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toMatch(/\|\s*\|\s*- 3 个默认角色/);
  });

  it("renders a bare MCP/A2A layer diagram as plain monospace", () => {
    const markdown = [
      "它们是互补而非竞争的",
      "",
      "[A2A 层]",
      "    |",
      "Agent A ──委托──> Agent B",
      "    |",
      "[MCP 层]",
      "工具/数据",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-code-plain")).not.toBeNull();
    expect(container.querySelector(".token")).toBeNull();
    expect(container.textContent).toContain("[A2A 层]");
    expect(container.textContent).toContain("工具/数据");
  });

  it("renders a fenced layer diagram with box borders and triangles as plain text", () => {
    const markdown = [
      "```",
      "┌─────────┐",
      "│ A2A 层  │",
      "└─────────┘",
      "    ▼",
      "┌─────────┐",
      "│ MCP 层  │",
      "└─────────┘",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-code-plain")).not.toBeNull();
    expect(container.querySelector(".token")).toBeNull();
    expect(container.textContent).toContain("A2A 层");
  });

  it("renders numbered bold lists as markdown instead of plain code blocks", () => {
    const markdown = [
      "1. **记忆** → 你是谁、你喜欢什么（稳定事实）",
      "2. **技能** → 你经常做什么、怎么做（可复用流程）",
      "3. **会话** → 你最近在做什么（短期上下文）",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    expect(container.querySelector(".chat-code-plain")).toBeNull();
    expect(container.querySelectorAll("strong").length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain("记忆");
    expect(container.textContent).not.toContain("**记忆**");
  });
});
