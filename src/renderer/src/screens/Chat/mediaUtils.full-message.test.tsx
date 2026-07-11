import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { normalizeAgentMarkdown } from "./mediaUtils";
import { AgentMarkdown } from "../../components/AgentMarkdown";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));
vi.mock("../../components/ThemeProvider", () => ({
  useTheme: () => ({
    theme: "dark",
    resolved: "dark",
    setTheme: vi.fn(),
    rounded: true,
    setRounded: vi.fn(),
  }),
}));
vi.mock("../../components/MediaImage", () => ({
  MediaImage: () => null,
  DownloadChip: () => null,
}));

const raw = `## 重新审视：为什么推荐跨境电商？

坦白说，我之前的推荐**可能有问题**。让我重新分析。

---

## 我推荐跨境电商的逻辑（可能有偏差）

**我的假设**：
1. Hermes 的多平台能力（20+ gateway）在跨境电商有价值
2. 跨境电商卖家数量多（100万+），市场大
3. 卖家习惯为工具付费
4. 现有工具分散，有整合机会

**但这个逻辑的问题**：
1. **跨境电商是红海**：现有工具（Jungle Scout、Helium 10、Gorgias）已经很成熟
2. **行业壁垒高**：需要深度理解亚马逊规则、物流、供应链，不是纯技术问题
3. **销售周期长**：卖家决策谨慎，需要大量 demo 和试用
4. **你可能没有行业资源**：如果没有跨境电商经验，很难做出真正好用的产品

---

## 更诚实的分析：你真正适合什么？

### 你的优势（从对话中推断）
1. **技术背景强**：能做 Electron、Hermes 二开、理解 AI Agent
2. **有 hermes-desktop 基础**：已经有编辑器 + Agent 的产品雏形

---

## 重新评估：4 个方向对比

| 方向 | 技术匹配度 | 行业壁垒 | 获客难度 | 竞争格局 | 适合你吗？ |
|------|-----------|---------|---------|---------|-----------|
| **跨境电商** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐（高） | ⭐⭐⭐⭐（难） | ⭐⭐（红海） | ❓ 不确定 |
| **开发者工具** | ⭐⭐⭐⭐⭐ | ⭐⭐（低） | ⭐⭐⭐（中） | ⭐⭐⭐（有空间） | ✅ 很可能 |

---

## 最终建议

**如果你没有跨境电商经验** → 做**开发者工具**
- 你最懂这个群体
- 技术优势最大
- 获客渠道清晰

**如果你有跨境电商经验或资源** → 可以做**跨境电商**
- 但需要深度理解行业
- 需要独特的获客渠道

**关键问题**：
1. 你有跨境电商经验吗？
2. 你有跨境电商的获客渠道吗？
3. 你对哪个方向更有热情？

**如果没有明确答案** → 先做**开发者工具**（风险最低、优势最大）`;

describe("full user message", () => {
  it("does not corrupt a clean final-advice arrow row", () => {
    const block = [
      "## 最终建议",
      "",
      "**如果你没有跨境电商经验** → 做**开发者工具**",
      "- 你最懂这个群体",
      "- 技术优势最大",
    ].join("\n");
    const out = normalizeAgentMarkdown(block);
    expect(out).toContain("**如果你没有跨境电商经验** → 做**开发者工具**");
    expect(out).not.toContain("```text");
    expect(out).not.toMatch(/\n\*\* → 做\n/);
  });

  it("normalizes without corrupting final advice lists", () => {
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("## 最终建议");
    expect(out).toContain("**如果你没有跨境电商经验**");
    expect(out).toContain("**开发者工具**");
    expect(out).not.toMatch(/^\*\* -> /m);
  });

  it("renders final advice with bold and list items", () => {
    const finalOnly = raw.slice(raw.indexOf("## 最终建议"));
    const { container } = render(<AgentMarkdown>{finalOnly}</AgentMarkdown>);
    const html = container.innerHTML;
    expect(container.querySelector(".chat-code-block")).toBeNull();
    expect(container.querySelectorAll("strong").length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(6);
    expect(html).toContain("如果你没有跨境电商经验");
    expect(html).toContain("开发者工具");
    expect(html).not.toContain("**如果你没有");
  });
});
