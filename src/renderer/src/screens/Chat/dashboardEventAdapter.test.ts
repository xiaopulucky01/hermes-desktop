// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  applyDashboardStreamEvent,
  mergeStreamedWithFinal,
  type DashboardEventState,
} from "./dashboardEventAdapter";
import type { ChatMessage } from "./types";

describe("mergeStreamedWithFinal", () => {
  it("uses final when nothing was streamed (remote / suppressed-delta path)", () => {
    expect(mergeStreamedWithFinal("", "Final answer")).toBe("Final answer");
    expect(mergeStreamedWithFinal("   ", "Final answer")).toBe("Final answer");
  });

  it("keeps streamed text when final is empty", () => {
    expect(mergeStreamedWithFinal("Streamed text", "")).toBe("Streamed text");
  });

  it("prefers final when it already contains the streamed text", () => {
    expect(
      mergeStreamedWithFinal("It's sunny.", "Let me check. It's sunny."),
    ).toBe("Let me check. It's sunny.");
  });

  it("prefers streamed when it contains final plus pre-tool-call text", () => {
    expect(
      mergeStreamedWithFinal("Let me check. It's sunny.", "It's sunny."),
    ).toBe("Let me check. It's sunny.");
  });

  it("compares whitespace-insensitively", () => {
    // Differs only by collapsed whitespace ⇒ treated as fully contained.
    expect(mergeStreamedWithFinal("Hello   world", "Hello world")).toBe(
      "Hello world",
    );
  });

  it("concatenates disjoint segments with a blank-line separator", () => {
    expect(
      mergeStreamedWithFinal("Let me check the weather.", "It's sunny."),
    ).toBe("Let me check the weather.\n\nIt's sunny.");
  });

  it("does not mash words when concatenating without trailing punctuation", () => {
    const merged = mergeStreamedWithFinal("Let me check", "It is sunny");
    expect(merged).toBe("Let me check\n\nIt is sunny");
    expect(merged).not.toContain("checkIt");
  });

  it("stitches a re-streamed boundary, dropping the duplicated seam", () => {
    // Tail of streamed repeats the head of final at a word boundary.
    expect(mergeStreamedWithFinal("The answer is 4", "answer is 4.")).toBe(
      "The answer is 4.",
    );
  });

  it("does not stitch a coincidental mid-word overlap", () => {
    // The shared "d" is mid-word ("worl|d") so it must not be spliced.
    expect(mergeStreamedWithFinal("Hello world", "dog runs")).toBe(
      "Hello world\n\ndog runs",
    );
  });

  it("returns trimmed output regardless of branch", () => {
    expect(mergeStreamedWithFinal("  Hello  ", "  Hello there  ")).toBe(
      "Hello there",
    );
  });

  it("prefers final when both texts share a long prefix (full rewrite)", () => {
    const body = [
      "寻找用户痛点和市场需求，核心是**从\"我觉得\"转向\"用户说\"**。几个实用方法：",
      "",
      "## 1. 观察现有用户的抱怨",
      "",
      "- **Reddit、Hacker News、V2EX、即刻**：搜索 \"Cursor sucks\" 等关键词",
      "- **Twitter/X**：关注开发者吐槽 AI 编程工具的帖子",
      " Issues**：看 Cursor、Copilot 等竞品的 issue 列表",
      "- **Product Hunt、G2 评论**：看竞品的 1-3 星评价",
      "",
      "## 2. 直接和目标用户对话",
      "",
      "- 找 1-20 个正在用 Cursor/Copilot 的开发者，做 30 分钟访谈",
      "- 问**行为**而非**意见**：\"你上周用 AI 编程工具时，哪个场景让你想砸键盘？\"",
      "",
      "## 3. 验证付费意愿",
      "",
      "- **Landing page 测试**：做产品页，看 waitlist 转化率",
      "- **Fake door test**：放一个 \"高级功能\" 按钮统计点击量",
    ].join("\n");

    const streamed = `${body}\n\n你现在最该验证的假设是什么？我可以帮你设计`;
    const finalText = `${body.replace(" Issues", "- **GitHub Issues").replace("1-20", "10-20")}\n\n你现在最该验证的假设是什么？我可以帮你设计具体的验证实验。`;

    expect(mergeStreamedWithFinal(streamed, finalText)).toBe(finalText);
  });

  it("prefers final when garbled stream and clean final share the same top heading", () => {
    const heading = "## MCP 与 A2A 的区别";
    const filler =
      "MCP 统一模型与外部工具的连接，A2A 统一 Agent 之间的协作协议，两者互补而非竞争。".repeat(
        8,
      );
    const garbled = [
      heading,
      "",
      filler,
      "",
      "### MCP（Model Context Protocol）",
      "",
      "**提出者**：Anthropic（2024年底发布）",
      "",
      "**核心思想**：",
      "- 定义了一套标准化的方式 能够访问外部工具",
      "",
      "### A2A（Agent-to-Agent Protocol）",
      "",
      "**定位**：代理间通信协议****核心思想**：",
      "- 定义了一套标准化的方式 AI Agent 能够互相发现",
      "",
      "### 核心对比",
      "",
      "| 维度 | MCP | A2A |",
      "|------|-----|| **连接对象 ↔ 工具/数据 | Agent ↔ Agent |",
      "",
      "需要我深入方面吗？",
    ].join("\n");
    const clean = [
      heading,
      "",
      filler,
      "",
      "### MCP（Model Context Protocol）",
      "",
      "**提出者**：Anthropic（2024年底发布）",
      "",
      "**核心思想**：",
      "- 定义了一套标准化的方式，让 LLM 能够访问外部工具",
      "",
      "### A2A（Agent-to-Agent Protocol）",
      "",
      "**定位**：代理间通信协议",
      "",
      "**核心思想**：",
      "- 定义了一套标准化的方式，让不同的 AI Agent 能够互相发现、通信、协作",
      "",
      "### 核心对比",
      "",
      "| 维度 | MCP | A2A |",
      "|------|-----|-----|",
      "| **连接对象** | 模型 ↔ 工具/数据 | Agent ↔ Agent |",
      "",
      "需要我深入某个方面吗？",
    ].join("\n");

    expect(mergeStreamedWithFinal(garbled, clean)).toBe(clean);
  });
});

describe("applyDashboardStreamEvent — message.complete text reconciliation", () => {
  const userTurn = (): ChatMessage => ({
    id: "u1",
    role: "user",
    content: "weather?",
  });

  it("preserves pre-tool-call streamed text on completion (#746)", () => {
    // Model streamed text, called a tool, then finalized with a short
    // last-turn-only final_response. The pre-tool text lives in the last
    // assistant bubble and must not be clobbered.
    const state: DashboardEventState = {
      messages: [
        userTurn(),
        {
          id: "a1",
          role: "agent",
          kind: "assistant",
          content: "Let me check the weather. ",
          pending: true,
        },
        {
          id: "tc1",
          role: "agent",
          kind: "tool_call",
          callId: "c1",
          name: "weather",
          args: "",
        },
        {
          id: "tr1",
          role: "agent",
          kind: "tool_result",
          callId: "c1",
          name: "weather",
          content: "sunny",
        },
      ],
      reasoningSegmentClosed: false,
    };

    const next = applyDashboardStreamEvent(state, {
      type: "message.complete",
      payload: { text: "Done." },
    });

    const bubble = next.messages.find((m) => m.id === "a1");
    expect(bubble).toBeDefined();
    expect((bubble as { content: string }).content).toBe(
      "Let me check the weather.\n\nDone.",
    );
    expect((bubble as { pending?: boolean }).pending).toBe(false);
  });

  it("uses the fuller final_response when it supersets the streamed text", () => {
    const state: DashboardEventState = {
      messages: [
        userTurn(),
        {
          id: "a1",
          role: "agent",
          kind: "assistant",
          content: "Hello",
          pending: true,
        },
      ],
      reasoningSegmentClosed: false,
    };

    const next = applyDashboardStreamEvent(state, {
      type: "message.complete",
      payload: { text: "Hello there, friend." },
    });

    expect(
      (next.messages.find((m) => m.id === "a1") as { content: string }).content,
    ).toBe("Hello there, friend.");
  });

  it("falls back to final_response when deltas are suppressed (remote path)", () => {
    const afterDelta = applyDashboardStreamEvent(
      { messages: [userTurn()], reasoningSegmentClosed: false },
      { type: "message.delta", payload: { text: "ignored stream" } },
      { renderAssistantDeltas: false },
    );
    // No assistant bubble is created while deltas are suppressed.
    expect(afterDelta.messages.some((m) => m.role === "agent")).toBe(false);

    const next = applyDashboardStreamEvent(
      afterDelta,
      { type: "message.complete", payload: { text: "Remote answer" } },
      { renderAssistantDeltas: false },
    );
    const bubble = next.messages.find((m) => m.role === "agent");
    expect(bubble).toBeDefined();
    expect((bubble as { content: string }).content).toBe("Remote answer");
  });
});
