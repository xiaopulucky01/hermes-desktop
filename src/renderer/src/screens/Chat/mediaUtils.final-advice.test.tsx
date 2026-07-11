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

const raw = [
  "最终建议",
  "",
  "**如果你没有跨境电商经验",
  "",
  "```text",
  "** -> 做",
  "**开发者工具**",
  "```",
  "",
  "• 你最懂这个群体",
  "• 技术优势最大",
  "",
  "**如果你有跨境电商经验或资源 ** -> 可以做 跨境电商",
  "",
  "**如果你没有明确答案",
  "",
  "```text",
  "** -> 先做",
  "**开发者工具**（风险最低、优势最大）",
  "```",
].join("\n");

const normalized = normalizeAgentMarkdown(raw);
console.log("NORMALIZED:\n", normalized);

describe("final advice render", () => {
  it("renders without code blocks", () => {
    const { container } = render(<AgentMarkdown>{raw}</AgentMarkdown>);
    const html = container.innerHTML;
    if (html.includes("chat-code")) {
      throw new Error(`unexpected code block html: ${html}`);
    }
    expect(container.querySelector(".chat-code-block")).toBeNull();
    expect(container.querySelector(".chat-code-plain")).toBeNull();
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll("strong").length).toBeGreaterThanOrEqual(3);
  });
});
