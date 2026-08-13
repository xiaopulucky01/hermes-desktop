import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { normalizeAgentMarkdown } from "./mediaUtils";

// Exact content from local state.db message id=3058
const raw = `以下是 **2026年8月13日** 的热门科技新闻汇总（来源：TechCrunch、The Verge、Ars Technica）：

---

## 🤖 AI 与模型

| # | 新闻 | 来源 |
|---|------|------|
| 1 | **Claude 用户不满新增水印功能** — Anthropic 推出的新水印会标记 AI 生成内容，部分用户认为这像是在"抓作弊" | TechCrunch |
| 2 | **AI 核能公司 Fermi 迎来新 CEO** | TechCrunch |
| 3 | **Lovable 确认新一轮 4 亿美元融资，估值达 133 亿美元** | TechCrunch |

## 📱 硬件与消费电子

| # | 新闻 | 来源 |
|---|------|------|
| 4 | **Google Pixel 11 系列发布** — 硬件变化不大，但 Gemini AI 集成大幅增强 | TechCrunch |
| 5 | **Amazon 的 Panos Panay 在 Disrupt 大会上谈智能手机之外的战略** | TechCrunch |
`;

describe("real news message from state.db", () => {
  it("renders multiple tables from clean DB markdown", () => {
    const normalized = normalizeAgentMarkdown(raw);
    expect(normalized).toContain("| # | 新闻 | 来源 |");
    expect(normalized).not.toMatch(/^# \| 新闻/m);
    expect(normalized).not.toContain("||");

    const { container } = render(<AgentMarkdown>{raw}</AgentMarkdown>);
    const tables = container.querySelectorAll(".chat-table-wrap table");
    expect(tables.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain("Claude 用户不满新增水印功能");
    expect(container.textContent).not.toContain("|---|");
    expect(container.textContent).not.toContain("||");
  });
});
