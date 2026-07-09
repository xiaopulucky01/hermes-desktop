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
});
