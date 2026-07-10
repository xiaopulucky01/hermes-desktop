import { describe, it, expect } from "vitest";
import {
  parseMediaTokens,
  hasMediaTokens,
  describeImageSrc,
  cleanLeakedToolTags,
  normalizeAgentMarkdown,
  type MediaSegment,
} from "./mediaUtils";

/** Find the first media segment, or fail the assertion if there is none. */
function media(segs: MediaSegment[]): Extract<MediaSegment, { type: "media" }> {
  const hit = segs.find((s) => s.type === "media");
  if (!hit || hit.type !== "media") {
    throw new Error("expected a media segment, got none");
  }
  return hit;
}

describe("parseMediaTokens (issue #299)", () => {
  it("returns a single text segment when there is nothing to extract", () => {
    expect(parseMediaTokens("just a normal reply")).toEqual([
      { type: "text", value: "just a normal reply", start: 0 },
    ]);
  });

  // ── Explicit MEDIA: tokens ─────────────────────────────
  it("extracts an explicit MEDIA: token (Windows path)", () => {
    const segs = parseMediaTokens(
      "Here it is:\n\nMEDIA:C:\\Users\\pmos6\\cat.png",
    );
    expect(segs[0]).toEqual({
      type: "text",
      value: "Here it is:\n\n",
      start: 0,
    });
    expect(segs[1]).toMatchObject({
      type: "media",
      source: "media-token",
      token: { src: "C:\\Users\\pmos6\\cat.png", isImage: true, isUrl: false },
    });
  });

  it("extracts a MEDIA: https token as a URL", () => {
    const segs = parseMediaTokens("MEDIA:https://x.test/p.jpg");
    expect(segs[0]).toMatchObject({
      type: "media",
      source: "media-token",
      token: { isUrl: true, isImage: true },
    });
  });

  it("strips trailing punctuation from a bare MEDIA: token", () => {
    const segs = parseMediaTokens("see MEDIA:/tmp/out.png.");
    expect(media(segs).token.src).toBe("/tmp/out.png");
  });

  it("honours a quoted MEDIA: token containing spaces", () => {
    const segs = parseMediaTokens('MEDIA:"C:\\My Folder\\a file.pdf"');
    expect(media(segs).token).toMatchObject({
      src: "C:\\My Folder\\a file.pdf",
      name: "a file.pdf",
    });
  });

  // ── Whole-line bare paths ──────────────────────────────
  it("detects a whole-line bare absolute path (Windows, non-image)", () => {
    const segs = parseMediaTokens(
      "Criei o PDF aqui:\n\nC:\\Users\\pmos6\\proverbios.pdf\n\nInclui 10.",
    );
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "C:\\Users\\pmos6\\proverbios.pdf",
      token: { src: "C:\\Users\\pmos6\\proverbios.pdf", isImage: false },
    });
  });

  it("detects a whole-line POSIX path", () => {
    const segs = parseMediaTokens("Done:\n/home/me/out.png");
    expect(media(segs)).toMatchObject({
      source: "bare-path",
      token: { src: "/home/me/out.png", isImage: true },
    });
  });

  it("tolerates spaces inside a whole-line path", () => {
    const segs = parseMediaTokens("C:\\My Folder\\a file.pdf");
    expect(segs[0]).toMatchObject({
      type: "media",
      source: "bare-path",
      token: { src: "C:\\My Folder\\a file.pdf", name: "a file.pdf" },
    });
  });

  // ── Inline bare paths (mid-sentence) ───────────────────
  it("detects an inline absolute path mentioned mid-sentence", () => {
    const segs = parseMediaTokens("I saved it to C:\\Users\\me\\x.pdf today.");
    expect(segs[0]).toEqual({
      type: "text",
      value: "I saved it to ",
      start: 0,
    });
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "C:\\Users\\me\\x.pdf",
      token: { src: "C:\\Users\\me\\x.pdf", isImage: false },
    });
    expect(segs[segs.length - 1]).toEqual({
      type: "text",
      value: " today.",
      // 14 ("I saved it to ") + 17 ("C:\\Users\\me\\x.pdf") = 31.
      start: 31,
    });
  });

  it("detects an inline POSIX absolute path", () => {
    const segs = parseMediaTokens("Generated at /home/me/out.png — enjoy.");
    expect(media(segs)).toMatchObject({
      source: "bare-path",
      token: { src: "/home/me/out.png", isImage: true },
    });
  });

  it("detects an inline POSIX path immediately before a markdown table delimiter", () => {
    const segs = parseMediaTokens(
      "| Location | Path |\n| Container | /opt/data/images/toy_duck.png|",
    );
    expect(media(segs)).toMatchObject({
      source: "bare-path",
      token: { src: "/opt/data/images/toy_duck.png", isImage: true },
    });
  });

  it("excludes trailing punctuation from an inline path", () => {
    const segs = parseMediaTokens(
      "The chart is at C:\\d\\chart.png, see above.",
    );
    expect(media(segs).token.src).toBe("C:\\d\\chart.png");
    expect(media(segs).raw).toBe("C:\\d\\chart.png");
  });

  it("keeps the matched path as `raw` so it can be shown verbatim", () => {
    // `raw` is what MediaSegmentView renders until the file is verified.
    const segs = parseMediaTokens("file: /var/data/report.csv done");
    expect(media(segs).raw).toBe("/var/data/report.csv");
  });

  it("detects a labelled Windows image path inside inline code", () => {
    const segs = parseMediaTokens(
      "Done.\n\nFile: `C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png`\nSize: 269,771 bytes",
    );
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png`",
      token: {
        src: "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png",
        isImage: true,
        isUrl: false,
      },
    });
  });

  it("detects a labelled Windows image path when the label is markdown-bold", () => {
    const segs = parseMediaTokens(
      "Image generated successfully.\n\n**File:** `C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png` (345 KB)",
    );
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png`",
      token: {
        src: "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png",
        isImage: true,
        isUrl: false,
      },
    });
  });

  it("detects labelled generated output paths in code spans without matching arbitrary command snippets", () => {
    const labelled = parseMediaTokens("Saved to: `/tmp/toy duck.png`");
    expect(media(labelled)).toMatchObject({
      source: "bare-path",
      token: { src: "/tmp/toy duck.png", isImage: true },
    });

    const command = parseMediaTokens("Run `C:\\tmp\\x.png` to see it.");
    expect(command.every((s) => s.type === "text")).toBe(true);
  });

  it("detects a generated artifact path in a folder-marked code span", () => {
    const folder = "\uD83D\uDCC1";
    const segs = parseMediaTokens(
      `Done! Here's your image:\n\n${folder} \`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png\` -- 293 KB`,
    );
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png`",
      token: {
        src: "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png",
        isImage: true,
      },
    });

    const bold = parseMediaTokens(
      `Done! Here's your image:\n\n${folder} **\`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png\`** -- 293 KB`,
    );
    expect(media(bold)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png`",
      token: {
        src: "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png",
        isImage: true,
      },
    });
  });

  it("detects a standalone generated artifact path in a code span", () => {
    const segs = parseMediaTokens(
      "Done! Here's your image:\n\n**`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png`** (316 KB)\n\nGenerated using DreamShaper 8.",
    );
    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "`C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png`",
      token: {
        src: "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png",
        isImage: true,
      },
    });

    const command = parseMediaTokens("Run `C:\\tmp\\x.png` to see it.");
    expect(command.every((s) => s.type === "text")).toBe(true);
  });

  // ── False-positive guards ──────────────────────────────
  it("does NOT start an inline match mid-token", () => {
    const segs = parseMediaTokens("fooC:\\Users\\me\\x.pdf");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT match an inline http URL as a path", () => {
    const segs = parseMediaTokens("See https://example.com/pic.png for more.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT match an inline relative path", () => {
    const segs = parseMediaTokens("Check output/cat.png please.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a path inside a fenced code block", () => {
    const segs = parseMediaTokens(
      "Example:\n```\nC:\\Users\\me\\x.png\n```\ndone",
    );
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a path inside an inline code span", () => {
    const segs = parseMediaTokens("Run `C:\\tmp\\x.png` to see it.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("extracts an absolute path from a markdown image destination", () => {
    const content =
      "Here it is:\n\n![Toy Duck in Bathtub](/opt/data/images/duck_bathtub.png)\n\nDone.";
    const segs = parseMediaTokens(content);

    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: "![Toy Duck in Bathtub](/opt/data/images/duck_bathtub.png)",
      token: {
        src: "/opt/data/images/duck_bathtub.png",
        isImage: true,
      },
    });
  });

  it("extracts a Windows path from a markdown image destination", () => {
    const content =
      "![duck](C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png)";
    const segs = parseMediaTokens(content);

    expect(media(segs)).toMatchObject({
      type: "media",
      source: "bare-path",
      raw: content,
      token: {
        src: "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png",
        isImage: true,
      },
    });
  });

  it("does not render the same image twice when markdown and file path repeat it", () => {
    const src =
      "C:\\Users\\pmos6\\Documents\\AI-Playground\\media\\toy_duck_bathtub.png";
    const segs = parseMediaTokens(
      `Here it is:\n![duck](${src})\nFile: \`${src}\``,
    );
    const mediaSegs = segs.filter((segment) => segment.type === "media");

    expect(mediaSegs).toHaveLength(1);
    expect(mediaSegs[0]).toMatchObject({
      token: { src, isImage: true },
    });
    expect(
      segs
        .filter((segment) => segment.type === "text")
        .map((segment) => segment.value)
        .join(""),
    ).toContain(src);
  });

  it("does not render a repeated path when a direct markdown image is already present", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const src = "/opt/data/images/duck_bathtub.png";
    const segs = parseMediaTokens(
      `Here it is:\n![duck](${dataUrl})\nFile: \`${src}\``,
    );
    const mediaSegs = segs.filter((segment) => segment.type === "media");

    expect(mediaSegs).toHaveLength(1);
    expect(mediaSegs[0]).toMatchObject({
      source: "media-token",
      token: { src: dataUrl, isImage: true, isUrl: true },
    });
    expect(
      segs
        .filter((segment) => segment.type === "text")
        .map((segment) => segment.value)
        .join(""),
    ).toContain(src);
  });

  it("does NOT extract a path from a markdown link destination", () => {
    const content = "Open [the generated file](/opt/data/images/duck.png).";
    const segs = parseMediaTokens(content);

    expect(segs).toEqual([{ type: "text", value: content, start: 0 }]);
  });

  it("does NOT treat a bare URL line as a path", () => {
    const segs = parseMediaTokens("https://example.com/pic.png");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT detect a relative path line", () => {
    const segs = parseMediaTokens("output/cat.png");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("does NOT match a bare path with an unknown extension", () => {
    const segs = parseMediaTokens("Config at C:\\app\\settings.ini reloaded.");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  // ── Misc ───────────────────────────────────────────────
  it("does not double-count a MEDIA: token as a bare path", () => {
    const hits = parseMediaTokens("MEDIA:/tmp/a.png").filter(
      (s) => s.type === "media",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "media-token" });
  });

  it("detects several inline paths in one reply", () => {
    const segs = parseMediaTokens(
      "First /home/a/one.png and then /home/b/two.pdf are ready.",
    );
    const hits = segs.filter((s) => s.type === "media");
    expect(hits).toHaveLength(2);
    expect(
      hits.every((h) => h.type === "media" && h.source === "bare-path"),
    ).toBe(true);
  });

  it("keeps text after a token", () => {
    const segs = parseMediaTokens("MEDIA:/tmp/a.png\n\nEnjoy!");
    expect(segs[segs.length - 1]).toEqual({
      type: "text",
      value: "\n\nEnjoy!",
      // "MEDIA:/tmp/a.png" is 16 chars — trailing text begins at offset 16.
      start: 16,
    });
  });

  it("hasMediaTokens detects explicit tokens only", () => {
    expect(hasMediaTokens("MEDIA:/tmp/a.png")).toBe(true);
    expect(hasMediaTokens("see /tmp/a.png")).toBe(false);
    expect(hasMediaTokens("no media")).toBe(false);
  });

  it("describeImageSrc classifies a plain image src", () => {
    expect(describeImageSrc("https://x.test/p.png")).toMatchObject({
      isUrl: true,
      isImage: true,
      name: "p.png",
    });
  });

  it("describeImageSrc sets isImage:false for a non-image src so the caller can route to DownloadChip", () => {
    // markdown allows ![alt](file.pdf) — that parses as an image tag but the
    // actual file is a PDF. Hardcoding isImage:true here caused MediaImage
    // to try to load it as an image and surface "could not load file.pdf"
    // to the user. Honouring IMAGE_EXT lets the caller route non-images to
    // the download chip instead. (Follow-up from PR #303 review.)
    expect(describeImageSrc("./report.pdf")).toMatchObject({
      isImage: false,
      name: "report.pdf",
    });
    expect(describeImageSrc("https://x.test/data.csv")).toMatchObject({
      isUrl: true,
      isImage: false,
      name: "data.csv",
    });
  });

  it("emits stable `start` offsets on every segment for use as React keys", () => {
    // The map() in MessageRow used the array index as key. When a MEDIA:
    // token appears mid-stream, every subsequent segment shifts index,
    // re-mounting downstream MediaSegmentView instances and re-firing
    // their `mediaFileExists` probes. Keying on `start` instead is
    // streaming-stable. (Follow-up from PR #303 review.)
    const segs = parseMediaTokens(
      "intro MEDIA:/tmp/a.png tail MEDIA:/tmp/b.png end",
    );
    // Every segment carries its origin offset.
    for (const s of segs) {
      expect(typeof s.start).toBe("number");
      expect(s.start).toBeGreaterThanOrEqual(0);
    }
    // Offsets are strictly increasing across the segment stream.
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBeGreaterThan(segs[i - 1].start);
    }
    // Used as React keys, the values are unique.
    const keys = segs.map((s) => `${s.type}-${s.start}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("cleanLeakedToolTags", () => {
  it("extracts the answer from a leaked skill_view tag", () => {
    const raw =
      '<skill_view name="hermes-agent-skill-authoring">{"answer": "To develop an AI agent, start by defining its purpose."}</skill_view>';
    expect(cleanLeakedToolTags(raw)).toBe(
      "To develop an AI agent, start by defining its purpose.",
    );
  });

  it("handles a leaked tag embedded in surrounding prose", () => {
    const raw =
      'Here you go:\n<some_tool>{"content": "the body"}</some_tool>\nThanks!';
    expect(cleanLeakedToolTags(raw)).toBe("Here you go:\nthe body\nThanks!");
  });

  it("recovers multiple leaked tags", () => {
    const raw =
      '<a_tool>{"answer": "first"}</a_tool> and <b_tool>{"text": "second"}</b_tool>';
    expect(cleanLeakedToolTags(raw)).toBe("first and second");
  });

  it("leaves normal prose untouched", () => {
    const text = "Just a normal reply with no tags.";
    expect(cleanLeakedToolTags(text)).toBe(text);
  });

  it("leaves a single-word tag (no underscore, e.g. real HTML) untouched", () => {
    // `terminal` has no underscore, so it's treated as markup, not a tool leak.
    expect(
      cleanLeakedToolTags('<terminal>{"command": "ls -la"}</terminal>'),
    ).toBe('<terminal>{"command": "ls -la"}</terminal>');
    expect(cleanLeakedToolTags("<b>bold</b> and <code>x = 1</code>")).toBe(
      "<b>bold</b> and <code>x = 1</code>",
    );
  });

  it("strips a prose-bodied leaked wrapper (skills_list) and keeps the body", () => {
    const raw =
      '<skills_list category="">We have:\n1. claude-code: delegate coding\n</skills_list>';
    expect(cleanLeakedToolTags(raw)).toBe(
      "We have:\n1. claude-code: delegate coding",
    );
  });

  it("converts inline <b>/<i> inside a leaked wrapper body to markdown", () => {
    const raw =
      '<skills_list category="">1. <b>Autonomous AI Agents</b>\n2. <i>Creative</i></skills_list>';
    expect(cleanLeakedToolTags(raw)).toBe(
      "1. **Autonomous AI Agents**\n2. *Creative*",
    );
  });

  it("does not convert inline HTML outside a leaked wrapper", () => {
    // No snake_case wrapper → the <b> is left exactly as the model wrote it.
    expect(cleanLeakedToolTags("plain <b>bold</b> text")).toBe(
      "plain <b>bold</b> text",
    );
  });

  it("does not transform an example inside a fenced code block", () => {
    const raw =
      '```\n<skill_view name="x">{"answer": "example"}</skill_view>\n```';
    expect(cleanLeakedToolTags(raw)).toBe(raw);
  });

  it("is a no-op (same reference path) when there is no closing tag", () => {
    const text = "no closing tag here";
    expect(cleanLeakedToolTags(text)).toBe(text);
  });
});

describe("normalizeAgentMarkdown", () => {
  it("breaks mid-line headings before remark-gfm parses them", () => {
    const raw = "你问到了核心问题。让我## 之前的方案能解决吗？";
    expect(normalizeAgentMarkdown(raw)).toBe(
      "你问到了核心问题。让我\n\n## 之前的方案能解决吗？",
    );
  });

  it("inserts a blank line before a table that follows prose", () => {
    const raw = "目标如下\n| 目标 | 能否解决 | 原因 |";
    expect(normalizeAgentMarkdown(raw)).toBe(
      "目标如下\n\n| 目标 | 能否解决 | 原因 |",
    );
  });

  it("splits a header row glued to its separator", () => {
    const raw = "| 目标 | 能否解决 | 原因 ||-------|----------|-----|";
    expect(normalizeAgentMarkdown(raw)).toBe(
      "| 目标 | 能否解决 | 原因 |\n| --- | --- | --- |",
    );
  });

  it("leaves fenced code untouched", () => {
    const raw = "prose\n```\n| a | b ||---|\n```";
    expect(normalizeAgentMarkdown(raw)).toBe(raw);
  });

  it("splits multiple table data rows glued on one line", () => {
    const raw =
      "| 编辑器 | Monaco Editor | VS Code 核心 | ~5MB | | 桌面壳 | Electron | 跨平台 | ~80MB |";
    expect(normalizeAgentMarkdown(raw)).toBe(
      [
        "| 编辑器 | Monaco Editor | VS Code 核心 | ~5MB |",
        "| 桌面壳 | Electron | 跨平台 | ~80MB |",
      ].join("\n"),
    );
  });

  it("inserts a separator row when the model omits it", () => {
    const raw = [
      "## 技术栈选择",
      "",
      "| 组件 | 选择 | 理由 | 体积 |",
      "| 编辑器 | Monaco Editor | 成熟 | ~5MB |",
    ].join("\n");
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("| --- | --- | --- | --- |");
    expect(out.split("\n").indexOf("| --- | --- | --- | --- |")).toBe(
      out.split("\n").indexOf("| 组件 | 选择 | 理由 | 体积 |") + 1,
    );
  });

  it("removes blank lines between table rows so GFM keeps one table", () => {
    const raw = [
      "| 维度 | Cursor | Hermes Code | 优势 |",
      "| --- | --- | --- | --- |",
      "| 多平台 | 只有 IDE | 20+ IM 平台 | 更灵活 |",
      "",
      "| 学习系统 | 无 | Memory + Skills | 越用越好 |",
    ].join("\n");
    const out = normalizeAgentMarkdown(raw);
    expect(out).not.toMatch(/\|\n\n\|/);
    expect(out.split("\n").filter((l) => l.trim().startsWith("|")).length).toBe(
      4,
    );
  });

  it("unwraps markdown tables wrongly fenced as yaml", () => {
    const raw = [
      "```yaml",
      "### 可发布的 Agent 类型",
      "",
      "| Agent 名称 | 对应方案 | 能力描述 |",
      "| **Hermes Developer** | 方案 2 | 全栈开发 | 开发者 |",
      "```",
    ].join("\n");
    const out = normalizeAgentMarkdown(raw);
    expect(out).not.toContain("```yaml");
    expect(out).toContain("### 可发布的 Agent 类型");
    expect(out).toContain("| Agent 名称 | 对应方案 | 能力描述 |");
  });

  it("wraps bare JavaScript in a fenced block", () => {
    const raw = [
      "示例端点：",
      "app.get('/.well-known/agent.json', (req, res) => {",
      "  res.json({ name: 'Hermes Code Developer' });",
      "});",
      "app.listen(3000);",
    ].join("\n");
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("```javascript");
    expect(out).toContain("app.get('/.well-known/agent.json'");
    expect(out).toMatch(/```\s*$/m);
  });

  it("closes an unclosed fence before trailing prose", () => {
    const raw = [
      "```javascript",
      "const agent = new HermesAgent();",
      "agent.run();",
      "",
      "上面的代码可以直接部署。",
    ].join("\n");
    const out = normalizeAgentMarkdown(raw);
    expect(out).toMatch(/```[\s\S]*上面的代码可以直接部署。/);
    expect(out.match(/```/g)?.length).toBe(2);
  });

  it("turns pipe-comparison tier lines into heading plus bullet list", () => {
    const raw =
      "Hermes Agent 基础功能 | | - 3 个默认角色 | | - 基础 Skills | | 开源核心 (免费) | |";
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("### Hermes Agent 基础功能");
    expect(out).toContain("- 3 个默认角色");
    expect(out).toContain("- 基础 Skills");
    expect(out).not.toMatch(/\|\s*\|\s*- 3 个默认角色/);
  });

  it("leaves real yaml fenced blocks untouched", () => {
    const raw = ["```yaml", "server:", "  port: 3000", "  host: localhost", "```"].join(
      "\n",
    );
    expect(normalizeAgentMarkdown(raw)).toBe(raw);
  });

  it("splits a one-line tree diagram into a fenced plain-text block", () => {
    const raw =
      'TypeScript 大师 (Agent) └── SOUL.md ← "我是谁" | "你是一个有 10 年经验的 TypeScript 架构师..." | └── skills/ ← "我会什么" | └── review/ (代码审查技能) | model: claude-sonnet-4';
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("```text");
    expect(out).toContain('TypeScript 大师 (Agent) └── SOUL.md ← "我是谁"');
    expect(out).toContain('└── skills/ ← "我会什么"');
    expect(out).toContain("model: claude-sonnet-4");
    expect(out.split("\n").filter((l) => l.includes("```")).length).toBe(2);
  });

  it("does not wrap normal prose that uses single pipes", () => {
    const raw = "Choose A | B | C for the answer.";
    expect(normalizeAgentMarkdown(raw)).toBe(raw);
  });

  it("splits a glued OpenClaw vs Hermes table with double pipes", () => {
    const raw =
      "| 维度 | OpenClaw | Hermes Agent || ------ || 定位 | 个人 AI 助手（消费者） | 自主 agent 基础设施部署 || 架构 | Gateway daemon + nodes | Agent + 多后端 || 协作 | 多 agent 路由 | 开发者、研究者、高级用户 || 社区规模背景 | OpenAI 支持 | Nous Research |";
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("| 维度 | OpenClaw | Hermes Agent |");
    expect(out).toContain("| --- | --- | --- |");
    expect(out).toContain("| 定位 | 个人 AI 助手（消费者） | 自主 agent 基础设施部署 |");
    expect(out).toContain("| 社区规模背景 | OpenAI 支持 | Nous Research |");
    expect(out).not.toContain("||");
  });

  it("splits glued table rows without breaking words before double pipes", () => {
    const raw = "| 维度 | OpenClaw | Hermes Agent ||------|| 定位 | 测试 |";
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("Hermes Agent |");
    expect(out).not.toContain("Agento |");
    expect(out).not.toContain("||");
  });

  it("preserves inline code inside a table cell", () => {
    const raw = "| Agent Card | ❌ 无 | 创建 `/.well-known/agent.json` |";
    expect(normalizeAgentMarkdown(raw)).toBe(raw);
  });

  it("splits rows glued with empty-cell boundaries on one line", () => {
    const raw = [
      "| 要求 | Hermes 现状 | 适配方案 |",
      "| --- | --- | --- |",
      "| 任务管理 API | ❌ 无标准 REST API | 封装 delegate_task 为 HTTP 端点 | | 输入/输出 Schema | ❌ 无 | 为每个角色定义 JSON Schema | | 认证机制 | ✅ 已有 API key | 扩展为 OAuth2 或 Bearer Token |",
    ].join("\n");
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("| 任务管理 API | ❌ 无标准 REST API | 封装 delegate_task 为 HTTP 端点 |");
    expect(out).toContain("| 输入/输出 Schema | ❌ 无 | 为每个角色定义 JSON Schema |");
    expect(out).toContain("| 认证机制 | ✅ 已有 API key | 扩展为 OAuth2 或 Bearer Token |");
  });

  it("expands a merged Skill Agent header and glued dash separator", () => {
    const raw =
      "|| Skill Agent ||---|---|---| || 是什么 | 一项能力 | 一个角色 || 有无灵魂 | ❌ 无 | ✅ 有 (SOUL.md) || 卖给用户 | 工具 | 专家 |";
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("| Skill | Agent |");
    expect(out).toMatch(/\| --- \| --- \| --- \|/);
    expect(out).toContain("| 是什么 | 一项能力 | 一个角色 |");
    expect(out).not.toContain("||");
    expect(out).not.toContain("Skill Agent |");
  });

  it("splits a table that starts with a stray leading double pipe", () => {
    const raw =
      "|| Skill | Agent || --- | --- || 是什么 | 一项能力 | 一个角色 || 有无灵魂 | ❌ 无 | ✅ 有 (SOUL.md) || 有无记忆 | ❌ 无 | ✅ 有 || 独立性 | 不能独立运行 | 独立运行 || 组合 | 1 个 | N 个 Skills || 卖给用户 | 工具 | 专家 |";
    const out = normalizeAgentMarkdown(raw);
    expect(out).toContain("| Skill | Agent |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| 是什么 | 一项能力 | 一个角色 |");
    expect(out).toContain("| 卖给用户 | 工具 | 专家 |");
    expect(out).not.toContain("||");
    expect(out.split("\n").some((line) => line.trim() === "|")).toBe(false);
  });
});
