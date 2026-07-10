import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./src/renderer/src/components/AgentMarkdown";

vi.mock("./src/renderer/src/components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("./src/renderer/src/components/ThemeProvider", () => ({
  useTheme: () => ({ resolved: "dark" }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./src/renderer/src/components/MediaImage", () => ({
  MediaImage: () => null,
  DownloadChip: () => null,
}));

describe("a2a table", () => {
  it("renders full A2A requirements table", () => {
    const markdown = [
      "| 要求 | Hermes 现状 | 适配方案 |",
      "| --- | --- | --- |",
      "| Agent Card | ❌ 无 | 创建 `/.well-known/agent.json` |",
      "| 任务管理 API | ❌ 无标准 REST API | 封装 | delegate_task 为 HTTP 端点 | | 输入/输出 Schema | ❌ 无 | 为每个角色定义 JSON Schema | | 认证机制 | ✅ 已有 API key | 扩展为 OAuth2 或 Bearer Token | | 状态管理 | ✅ Session 机制 | 映射到 A2A 的 Task 状态 |",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    console.log("tables", container.querySelectorAll("table").length);
    console.log("rows", container.querySelectorAll("tr").length);
    console.log("has raw pipes", container.textContent?.includes("| 认证机制 |"));
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("tr").length).toBeGreaterThanOrEqual(5);
  });
});
