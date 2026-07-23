// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  applyDashboardStreamEvent,
  hasGluedNumberedBoldLists,
  looksGarbledMarkdown,
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

  // Lossy re-assembly: the content stream dropped chunks (e.g. alternate
  // chunks mis-tagged as `reasoning` upstream), so the streamed bubble is a
  // garbled subsequence of the final answer. The final must REPLACE it —
  // concatenating stacked the partial above the clean answer in one bubble.
  it("replaces a lossy chunk-dropped stream with the final text", () => {
    expect(
      mergeStreamedWithFinal(
        "! What are we working on?",
        "Hey! What are we working on today?",
      ),
    ).toBe("Hey! What are we working on today?");
  });

  it("replaces a longer garbled stream that interleaves into the final", () => {
    expect(
      mergeStreamedWithFinal(
        "Sat planet from the Sun — ring system made ice and rock particles.",
        "Saturn is the sixth planet from the Sun — a gas giant famous for its stunning ring system made of ice and rock particles.",
      ),
    ).toBe(
      "Saturn is the sixth planet from the Sun — a gas giant famous for its stunning ring system made of ice and rock particles.",
    );
  });

  it("still concatenates a short lead-in even if it is a subsequence", () => {
    // Guard: a tiny streamed fragment is a subsequence of almost anything;
    // treat it as the pre-tool-call text it usually is.
    expect(mergeStreamedWithFinal("On it.", "Onwards — it is done.")).toBe(
      "On it.\n\nOnwards — it is done.",
    );
  });

  it("preserves pre-tool-call text that embeds only as scattered characters", () => {
    // Review regression: the streamed text is a plain character subsequence
    // of the final (every char appears in order as 1-char fragments), long
    // enough to pass the length/coverage guards — but it is NOT a
    // chunk-dropped copy, so it must stack, not be erased.
    expect(
      mergeStreamedWithFinal("abcdefghijkl", "a1b2c3d4e5f6g7h8i9j0k1l2"),
    ).toBe("abcdefghijkl\n\na1b2c3d4e5f6g7h8i9j0k1l2");
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

  it("prefers clean final when streamed text looks garbled", () => {
    const garbled = [
      '"object", "properties": {} }, "required" ] } }, handler=self.handle_a2a',
      "async def handle_a2a_send(url, args):",
      '    result = .dumps(card, ensure_三=False)',
      "",
      "| 维度 | MCP | A2A |",
      "|------|-----|| **连接对象 ↔ 工具/数据 | Agent ↔ Agent |",
    ].join("\n");
    const clean = [
      "```python",
      "async def handle_a2a_send(url, args):",
      '    result = json.dumps(card, ensure_ascii=False)',
      "```",
      "",
      "| 维度 | MCP | A2A |",
      "| --- | --- | --- |",
      "| **连接对象** | 模型 ↔ 工具/数据 | Agent ↔ Agent |",
    ].join("\n");

    expect(looksGarbledMarkdown(garbled)).toBe(true);
    expect(looksGarbledMarkdown(clean)).toBe(false);
    expect(mergeStreamedWithFinal(garbled, clean)).toBe(clean);
  });

  it("prefers final when garbled partial stream shares the same document opener", () => {
    const garbled = [
      "**不需要手动输入命令。** 那只是一种最基础的 CLI 用法。",
      "",
      "## 实际使用方式（从简单到）",
      "",
      "### 方式 1：手动 CLI（测试用，不推荐日常用）",
      "```手动执行",
      'g决定了：用 Monaco Editor"',
      "```",
      "这只是让你验证 GBrain 是否正常工作日常不需要这样用**。",
      "",
      "---",
      "",
      "### 方式 2：Hermes Agent 自动调用（推荐）",
      "",
      "安装 GBrain 后43 个 Skills**到 Hermes。这些 会教 Agent：",
      "- 什么时候- 什么时候该- 如何自动建图",
    ].join("\n");
    const clean = [
      "**不需要手动输入命令。** 那只是一种最基础的 CLI 用法。",
      "",
      "## 实际使用方式（从简单到高级）",
      "",
      "### 方式 1：手动 CLI（测试用，不推荐日常用）",
      "```bash",
      "# 在终端里手动执行",
      'gbrain capture "今天决定了：用 Monaco Editor"',
      "```",
      "这只是让你验证 GBrain 是否正常工作，**日常不需要这样用**。",
      "",
      "---",
      "",
      "### 方式 2：Hermes Agent 自动调用（推荐）",
      "",
      "安装 GBrain 后，它会加载 **43 个 Skills** 到 Hermes。这些 Skill 会教 Agent：",
      "- 什么时候该 capture",
      "- 什么时候该 search/think",
      "- 如何自动建图",
      "",
      "**你只需要正常对话，Agent 会自动判断：**",
      "",
      "## 总结",
      "",
      "| 使用方式 | 是否需要手动输入命令 | 适用场景 |",
      "|---------|-------------------|---------|",
      "| CLI 手动 | ✅ 需要 | 测试、调试、批量导入 |",
      "",
      "**最终目标：你正常说话，Agent 自动处理一切。**",
    ].join("\n");

    expect(mergeStreamedWithFinal(garbled, clean)).toBe(clean);
  });

  it("prefers clean final when stream glued numbered bold lists mid-line", () => {
    const streamed = [
      "我在 Hermes Agent / Hermes Desktop 代码库里没有找到名叫 **Agent Reach** 的功能。你可能想找的是这些近的：",
      "",
      "**Gateway（多平台网关）** — 让 Hermes Agent 连接 Telegram、Discord、Slack、WhatsApp、iMessage、Signal 等 20+ 消息平",
      "台的网关。2. **A2A（Agent-to-Agent）** — Hermes Desktop 里已经接入的 A2A 协议支持，可以让 Agent 发现、调用本地 Hermes",
      "实例（`a2a_discover` / `a2a_call` 等工具）。3. **远程连接（Remote/SSH）** — 通过 SSH 隧道连到远程 Hermes。Hermes4. **Webhook** — 外",
      "部服务通过 webhook 触发 Hermes Agent。",
      "",
      "你能哪里",
    ].join("\n");
    const finalText = [
      "我在 Hermes Agent / Hermes Desktop 代码库里没有找到名叫 **Agent Reach** 的功能。你可能想找的是这些相近的：",
      "",
      "1. **Gateway（多平台网关）** — 让 Hermes Agent 连接 Telegram、Discord、Slack、WhatsApp、iMessage、Signal 等 20+ 消息平台的网关。",
      "2. **A2A（Agent-to-Agent）** — Hermes Desktop 里已经接入的 A2A 协议支持，可以让 Agent 发现、调用本地 Hermes 实例（`a2a_discover` / `a2a_call` 等工具）。",
      "3. **远程连接（Remote/SSH）** — 通过 SSH 隧道连到远程 Hermes。",
      "4. **Webhook** — 外部服务通过 webhook 触发 Hermes Agent。",
      "",
      '你能描述一下是在哪里看到 "Agent Reach" 这个名字的吗？这样我可以帮你更准确定位。',
    ].join("\n");

    expect(hasGluedNumberedBoldLists(streamed)).toBe(true);
    expect(hasGluedNumberedBoldLists(finalText)).toBe(false);
    expect(looksGarbledMarkdown(streamed)).toBe(true);
    expect(mergeStreamedWithFinal(streamed, finalText)).toBe(finalText);
  });

  it("prefers clean copy when the other side has mashed code fences", () => {
    const clean = [
      "✅ **Dashboard 已经启动**",
      "",
      "地址：http://127.0.0.1:9119",
      "",
      "要修复 TUI 组件吗？运行：",
      "",
      "```bash",
      "git restore -- ui-tui",
      "npm install --silent --no-fund --no-audit --progress=false",
      "```",
      "",
      "或者一次性强制：",
      "",
      "```bash",
      "hermes update --force",
      "```",
      "",
      "(`ui-tui` 目录被删了，需要恢复后才能使用嵌入式聊天窗口)",
    ].join("\n");
    const mashed = [
      "✅ **Dashboard 已经启动**",
      "",
      "地址：http://127.0.0.1:9119",
      "",
      "要修复 TUI 组件吗？运行：",
      "",
      "bash git restore -- ui-tui npm install --silent --no-fund --no-audit --progress=false",
      "",
      "或者一次性强制 ```bash hermes update --force",
      "",
      "(`ui-tui` 目录被删了，需要恢复后才能使用嵌入式聊天窗口)",
      "",
      "```text",
      "```",
    ].join("\n");

    expect(looksGarbledMarkdown(mashed)).toBe(true);
    expect(looksGarbledMarkdown(clean)).toBe(false);
    expect(mergeStreamedWithFinal(clean, mashed)).toBe(clean);
    expect(mergeStreamedWithFinal(mashed, clean)).toBe(clean);
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
