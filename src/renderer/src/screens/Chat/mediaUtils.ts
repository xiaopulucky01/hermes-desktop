/**
 * Parsing for agent-delivered media (issue #299).
 *
 * Three signals are recognised in agent responses:
 *
 *  1. Explicit `MEDIA:<path-or-url>` tokens — hermes-agent's delivery
 *     protocol. Trusted: rendered eagerly.
 *  2. An inline absolute file path with a known extension, anywhere in the
 *     text. Treated as a *candidate* — the renderer verifies the file
 *     exists before showing it, so a path merely named in prose only turns
 *     into media when it really points at a reachable file.
 *  3. A whole line that is exactly an absolute path — also covers paths
 *     containing spaces, which the inline (no-whitespace) form cannot.
 *
 * Care taken against false positives: the inline matcher is anchored so it
 * cannot start mid-token or inside a URL, and matches inside ``` fenced or
 * `inline` code are skipped.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// Extensions recognised in a bare (untagged) path.
const BARE_PATH_EXT =
  "png|jpe?g|gif|webp|svg|bmp|avif|pdf|txt|md|csv|json|docx?|xlsx?|pptx?|" +
  "odt|rtf|zip|tar|gz|mp4|mov|webm|mkv|avi|mp3|wav|ogg|opus|m4a|flac";

// MEDIA: + optional whitespace + (quoted) | (bare non-whitespace run).
const MEDIA_RE = /MEDIA:[ \t]*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+))/g;

// Markdown image syntax with a raw local/remote filesystem or direct image
// destination.
// React-markdown normalizes Windows backslashes before our image component sees
// them, so intercept these here and let MediaImage resolve them.
const MARKDOWN_IMAGE_PATH_RE =
  /!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\n]+?)(?:\s+["'][^)\n]*["'])?\s*\)/g;

// Inline bare absolute path (no whitespace in the path). The negative
// lookbehind blocks matches that start mid-token or inside a URL (`://`);
// the lookahead requires the extension to be followed by whitespace,
// markdown table punctuation, sentence punctuation, or end-of-string.
const INLINE_PATH_RE = new RegExp(
  String.raw`(?<![\w/\\.:])((?:[A-Za-z]:[\\/]|\\\\|/|~[\\/])\S*?\.(?:` +
    BARE_PATH_EXT +
    String.raw`))(?=[\s|).,;:!?\]}>"']|$)`,
  "gi",
);

// A whole trimmed line that is exactly an absolute path; covers paths with
// spaces. The `^` anchor keeps it from matching URLs (which start with a
// scheme rather than a drive letter / slash).
const ABS_PATH_LINE_RE = new RegExp(
  `^(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/|~[\\\\/]).*\\.(?:${BARE_PATH_EXT})$`,
  "i",
);

const BT = "`";

// Common final-answer shape from agents/tools:
//   File: `C:\path\image.png`
//   Saved to: `/tmp/image.png`
// Inline code is normally ignored to avoid false positives in commands, but
// these labelled output fields are exactly where generated media paths appear.
const LABELLED_CODE_PATH_RE = new RegExp(
  String.raw`(?:^|[\n\r])([^\n\r]*?\b(?:file|path|saved(?:\s+(?:to|at))?|output|result|image)\s*:\s*)` +
    String.raw`(?:[*_]{1,2})?\s*` +
    BT +
    String.raw`([^` +
    BT +
    String.raw`\n\r]+\.(?:` +
    BARE_PATH_EXT +
    String.raw`))` +
    BT,
  "gi",
);

// Some agents format generated artifacts as:
//   [folder icon] `C:\path\image.png` -- 293 KB
// There is no "File:" label, but the line is still clearly artifact metadata.
// Keep this scoped to code spans on lines with output-ish words or a folder
// marker so command snippets remain plain markdown.
const OUTPUT_CODE_PATH_RE = new RegExp(
  String.raw`(?:^|[\n\r])([^\n\r]*(?:\b(?:file|path|saved|output|result|image|location)\b|\uD83D\uDCC1)[^\n\r]*?)` +
    String.raw`(?:[*_]{1,2})?\s*` +
    BT +
    String.raw`([^` +
    BT +
    String.raw`\n\r]+\.(?:` +
    BARE_PATH_EXT +
    String.raw`))` +
    BT,
  "gi",
);

// Some generated answers put the path alone in a code span after a preceding
// sentence ("Done! Here's your image:"). A standalone absolute path in a code
// span is artifact metadata, not a command snippet.
const STANDALONE_CODE_PATH_RE = new RegExp(
  String.raw`(?:^|[\n\r])(\s*(?:[*_]{1,2})?\s*)` +
    BT +
    String.raw`([^` +
    BT +
    String.raw`\n\r]+\.(?:` +
    BARE_PATH_EXT +
    String.raw`))` +
    BT +
    String.raw`(?:[*_]{1,2})?(?=\s*(?:$|[\n\r]|\([^)\n\r]*\)|[–—-]))`,
  "gi",
);

export interface MediaToken {
  /** The resolved path or URL. */
  src: string;
  /** True when `src` is a direct URL/data URI rather than a local path. */
  isUrl: boolean;
  /** True when the extension looks like a displayable image. */
  isImage: boolean;
  /** Last path/URL segment, for download filenames and alt text. */
  name: string;
}

export type MediaSegment =
  | {
      type: "text";
      value: string;
      /** Character offset of this segment in the original content string.
       *  Used as a stable React key during streaming — `start` doesn't shift
       *  when a later MEDIA: token appears mid-stream, whereas an array
       *  index would. (Follow-up item from PR #303 review.) */
      start: number;
    }
  | {
      type: "media";
      token: MediaToken;
      /** Exact original text this segment replaced. Rendered verbatim when
       *  a bare-path candidate turns out not to be a real file. */
      raw: string;
      /** `media-token` — explicit MEDIA: tag, rendered eagerly.
       *  `bare-path` — inferred path, rendered only once verified to exist. */
      source: "media-token" | "bare-path";
      /** Character offset of this segment in the original content string —
       *  same stability rationale as the text segment's `start`. */
      start: number;
    };

interface Hit {
  start: number;
  end: number;
  token: MediaToken;
  raw: string;
  source: "media-token" | "bare-path";
  origin?: "markdown-image";
}

function toToken(raw: string, wasQuoted: boolean): MediaToken | null {
  let src = raw.trim();
  // Bare MEDIA: tokens may swallow trailing sentence punctuation.
  if (!wasQuoted) src = src.replace(/[).,;:!?\]}]+$/, "");
  if (!src) return null;
  const isUrl = /^(?:https?:\/\/|data:image\/)/i.test(src);
  const name = src.split(/[\\/]/).filter(Boolean).pop() || src;
  return {
    src,
    isUrl,
    isImage: /^data:image\//i.test(src) || IMAGE_EXT.test(src),
    name,
  };
}

function isAbsoluteFileLike(src: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(src.trim());
}

function isDirectImageLike(src: string): boolean {
  const trimmed = src.trim();
  return /^(?:https?:\/\/|data:image\/)/i.test(trimmed);
}

function markdownDestination(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

/** Char ranges of ``` fenced blocks and `inline` code spans. */
function codeRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const fenced = /```[\s\S]*?```/g;
  while ((m = fenced.exec(content)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  const inline = /`[^`\n]+`/g;
  while ((m = inline.exec(content)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** Char ranges of markdown link/image destinations: [label](destination). */
function markdownDestinationRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const link =
    /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s\n]+)(?:\s+["'][^)\n]*["'])?\s*\)/g;
  while ((m = link.exec(content)) !== null) {
    const destination = m[1];
    const relativeStart = m[0].indexOf(destination);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    ranges.push([start, start + destination.length]);
  }
  return ranges;
}

function inCode(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => index >= s && index < e);
}

/** Apply `transform` only to prose regions — fenced/inline code is left verbatim. */
function transformOutsideCode(
  content: string,
  transform: (text: string) => string,
): string {
  const ranges = codeRanges(content);
  if (ranges.length === 0) return transform(content);
  ranges.sort((a, b) => a[0] - b[0]);
  let result = "";
  let last = 0;
  for (const [start, end] of ranges) {
    result += transform(content.slice(last, start));
    result += content.slice(start, end);
    last = end;
  }
  result += transform(content.slice(last));
  return result;
}

// A GFM table row: pipe-delimited with at least two interior cells.
const TABLE_ROW_RE = /^\|[^|\n]+\|[^|\n]+\|/;
const TABLE_SEPARATOR_RE = /^\|\s*[-:][-:|\s]+\|/;

function isTableLine(trimmed: string): boolean {
  if (TABLE_SEPARATOR_RE.test(trimmed)) return true;
  return TABLE_ROW_RE.test(trimmed);
}

function isTableDataOrHeaderRow(trimmed: string): boolean {
  return !TABLE_SEPARATOR_RE.test(trimmed) && TABLE_ROW_RE.test(trimmed);
}

function previousNonBlankLine(lines: string[], start: number): string | null {
  for (let i = start; i >= 0; i--) {
    const t = lines[i].trim();
    if (t !== "") return t;
  }
  return null;
}

function nextNonBlankLine(lines: string[], start: number): string | null {
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t !== "") return t;
  }
  return null;
}

/** GFM tables must be contiguous — drop blank lines between table rows. */
function compactTableBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      const prev = previousNonBlankLine(lines, i - 1);
      const next = nextNonBlankLine(lines, i + 1);
      if (prev && next && isTableLine(prev) && isTableLine(next)) {
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** Ensure every table row ends with a closing pipe for stable GFM parsing. */
function normalizeTableRowPipes(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!isTableLine(trimmed) || trimmed.endsWith("|")) return line;
      const leading = line.match(/^\s*/)?.[0] ?? "";
      return `${leading}${trimmed} |`;
    })
    .join("\n");
}

/** Split table rows glued on one line: "| ~5MB | | 桌面壳 |" → newline boundary. */
function splitGluedTableRowsInLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return line;
  let s = line;
  let prev: string;
  do {
    prev = s;
    // Row ends with cell content, next row starts — not an empty cell "| |".
    s = s.replace(/(\S)\s*\|\s*\|(\s*\S)/g, "$1 |\n|$2");
  } while (s !== prev);
  return s;
}

/** Insert a GFM separator after a header when the model skipped it. */
function looksLikeTableHeader(row: string): boolean {
  const cells = row
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean);
  if (cells.length < 2) return false;
  return cells.every(
    (c) =>
      c.length <= 20 &&
      !/[~✅❌✓✗$→%+]/.test(c) &&
      !/\d+\s*(?:MB|KB|GB|ms|s|\/月)\b/i.test(c) &&
      !/^\d+/.test(c),
  );
}

function insertMissingTableSeparators(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    out.push(line);
    if (!TABLE_ROW_RE.test(trimmed) || TABLE_SEPARATOR_RE.test(trimmed)) {
      continue;
    }
    const prev = lines[i - 1]?.trim() ?? "";
    const next = lines[i + 1]?.trim() ?? "";
    const tableStart = !prev || !isTableLine(prev);
    if (
      tableStart &&
      looksLikeTableHeader(trimmed) &&
      next &&
      isTableDataOrHeaderRow(next)
    ) {
      const cells = trimmed.split("|").filter((c) => c.trim().length > 0).length;
      if (cells >= 2) {
        out.push(`|${" --- |".repeat(cells)}`);
      }
    }
  }
  return out.join("\n");
}

/**
 * Repair common LLM markdown glitches so remark-gfm can render tables and
 * headings. Scoped to prose only — code fences are never touched.
 */
// @lat: [[code-blocks#LLM markdown normalization]]
export function normalizeAgentMarkdown(content: string): string {
  if (!content) return content;

  return transformOutsideCode(content, (text) => {
    let s = text;

    // "...文字## 标题" → break before the heading marker.
    s = s.replace(/([^\n#])(#{1,6}\s+)/g, "$1\n\n$2");

    // Header row glued to its separator: "| a | b | |---|---|" → newline.
    s = s.replace(/(\|[^|\n]+\|[^|\n]+\|[^|\n]*\|)\s*(\|[-:][-:| ]+\|)/g, "$1\n$2");

    // Double-pipe before a separator row: "原因 ||---|" → "原因 |\n|---|".
    s = s.replace(/\|\s*\|(?=[-:])/g, "|\n|");

    // Blank line before a table when it immediately follows prose.
    s = s.replace(
      /([^\n|][^\n]*)\n(\|[^|\n]+\|[^|\n]+\|)/g,
      (match, before: string, row: string) => {
        if (TABLE_SEPARATOR_RE.test(row.trim())) return match;
        return `${before}\n\n${row}`;
      },
    );

    // Ensure each table row sits on its own line when rows were concatenated.
    s = s.replace(
      /(\|[^|\n]+\|[^|\n]+\|[^|\n]*\|)\s+(\|[^\n]+)/g,
      (match, row: string, next: string) => {
        const nextRow = next.trim();
        if (TABLE_SEPARATOR_RE.test(nextRow) || TABLE_ROW_RE.test(nextRow)) {
          return `${row}\n${next}`;
        }
        return match;
      },
    );

    // "| ~5MB | | 桌面壳 |" and similar row glue on a single line.
    s = s
      .split("\n")
      .flatMap((line) => splitGluedTableRowsInLine(line).split("\n"))
      .join("\n");

    // Blank lines between rows break GFM tables — compact before inserting separators.
    s = compactTableBlocks(s);

    s = insertMissingTableSeparators(s);
    s = normalizeTableRowPipes(s);

    return s;
  });
}

function overlaps(start: number, end: number, hits: Hit[]): boolean {
  return hits.some((h) => start < h.end && end > h.start);
}

function mediaDedupeKey(token: MediaToken): string {
  if (!token.isImage) return "";
  const src = token.src.trim();
  return token.isUrl ? src : src.replace(/\\/g, "/").toLowerCase();
}

/**
 * Split agent content into ordered text / media segments. Text segments are
 * rendered as markdown; media segments as inline images or download chips.
 */
export function parseMediaTokens(content: string): MediaSegment[] {
  const code = codeRanges(content);
  const markdownDestinations = markdownDestinationRanges(content);
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;

  // 0) Markdown images: ![alt](C:\path\image.png), ![alt](/path),
  // or direct image sources such as data:image/... . Direct markdown images
  // otherwise render through AgentMarkdown while repeated artifact paths render
  // through MediaSegmentView, producing duplicate visible images.
  MARKDOWN_IMAGE_PATH_RE.lastIndex = 0;
  while ((m = MARKDOWN_IMAGE_PATH_RE.exec(content)) !== null) {
    if (inCode(m.index, code)) continue;
    const rawDestination = m[1] ?? "";
    const destination = markdownDestination(rawDestination);
    const directImage = isDirectImageLike(destination);
    if (!directImage && !isAbsoluteFileLike(destination)) continue;
    const token = toToken(destination, true);
    if (!token || !token.isImage) continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      token,
      raw: m[0],
      source: directImage ? "media-token" : "bare-path",
      origin: "markdown-image",
    });
  }

  // 1) Explicit MEDIA: tokens.
  MEDIA_RE.lastIndex = 0;
  while ((m = MEDIA_RE.exec(content)) !== null) {
    if (inCode(m.index, code)) continue;
    const quoted = m[1] ?? m[2] ?? m[3];
    const token = toToken(quoted ?? m[4] ?? "", quoted !== undefined);
    if (!token) continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      token,
      raw: m[0],
      source: "media-token",
    });
  }

  // 1b) Labelled inline-code paths. This intentionally runs before the
  // generic code-span exclusion below, but only for labels that look like
  // generated output fields.
  LABELLED_CODE_PATH_RE.lastIndex = 0;
  while ((m = LABELLED_CODE_PATH_RE.exec(content)) !== null) {
    const rawPath = m[2] ?? "";
    const codeSpan = `${BT}${rawPath}${BT}`;
    const relativeStart = m[0].lastIndexOf(codeSpan);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    const end = start + codeSpan.length;
    if (overlaps(start, end, hits)) continue;
    const token = toToken(rawPath, true);
    if (token) {
      hits.push({
        start,
        end,
        token,
        raw: codeSpan,
        source: "bare-path",
      });
    }
  }

  // 1c) Artifact metadata lines with a path inside a code span but no colon
  // label, e.g. a folder marker followed by `C:\path\image.png`.
  OUTPUT_CODE_PATH_RE.lastIndex = 0;
  while ((m = OUTPUT_CODE_PATH_RE.exec(content)) !== null) {
    const rawPath = m[2] ?? "";
    const codeSpan = `${BT}${rawPath}${BT}`;
    const relativeStart = m[0].lastIndexOf(codeSpan);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    const end = start + codeSpan.length;
    if (overlaps(start, end, hits)) continue;
    const token = toToken(rawPath, true);
    if (token) {
      hits.push({
        start,
        end,
        token,
        raw: codeSpan,
        source: "bare-path",
      });
    }
  }

  // 1d) Standalone absolute paths in code spans.
  STANDALONE_CODE_PATH_RE.lastIndex = 0;
  while ((m = STANDALONE_CODE_PATH_RE.exec(content)) !== null) {
    const rawPath = m[2] ?? "";
    const codeSpan = `${BT}${rawPath}${BT}`;
    const relativeStart = m[0].lastIndexOf(codeSpan);
    if (relativeStart < 0) continue;
    const start = m.index + relativeStart;
    const end = start + codeSpan.length;
    if (overlaps(start, end, hits)) continue;
    const token = toToken(rawPath, true);
    if (token) {
      hits.push({
        start,
        end,
        token,
        raw: codeSpan,
        source: "bare-path",
      });
    }
  }

  // 2) Inline bare absolute paths (no whitespace).
  INLINE_PATH_RE.lastIndex = 0;
  while ((m = INLINE_PATH_RE.exec(content)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (
      inCode(start, code) ||
      inCode(start, markdownDestinations) ||
      overlaps(start, end, hits)
    )
      continue;
    const token = toToken(m[1], true);
    if (token) {
      hits.push({ start, end, token, raw: m[1], source: "bare-path" });
    }
  }

  // 3) Whole-line bare paths (covers paths containing spaces).
  let offset = 0;
  for (const line of content.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1; // include the consumed "\n"
    const trimmed = line.trim();
    if (!trimmed || !ABS_PATH_LINE_RE.test(trimmed)) continue;
    const start = lineStart + line.indexOf(trimmed);
    const end = start + trimmed.length;
    if (
      inCode(start, code) ||
      inCode(start, markdownDestinations) ||
      overlaps(start, end, hits)
    )
      continue;
    const token = toToken(trimmed, true);
    if (token) {
      hits.push({ start, end, token, raw: trimmed, source: "bare-path" });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  const seenImages = new Set<string>();
  const hasDirectMarkdownImage = hits.some(
    (hit) =>
      hit.origin === "markdown-image" && hit.token.isImage && hit.token.isUrl,
  );
  const uniqueHits: Hit[] = [];
  for (const hit of hits) {
    if (
      hasDirectMarkdownImage &&
      hit.origin !== "markdown-image" &&
      hit.token.isImage &&
      !hit.token.isUrl
    ) {
      continue;
    }
    const key = mediaDedupeKey(hit.token);
    if (key && seenImages.has(key)) continue;
    if (key) seenImages.add(key);
    uniqueHits.push(hit);
  }

  const segments: MediaSegment[] = [];
  let last = 0;
  for (const h of uniqueHits) {
    if (h.start > last) {
      segments.push({
        type: "text",
        value: content.slice(last, h.start),
        start: last,
      });
    }
    segments.push({
      type: "media",
      token: h.token,
      raw: h.raw,
      source: h.source,
      start: h.start,
    });
    last = h.end;
  }
  if (last < content.length) {
    segments.push({ type: "text", value: content.slice(last), start: last });
  }
  return segments;
}

/** True when `content` contains at least one explicit MEDIA: token. */
export function hasMediaTokens(content: string): boolean {
  MEDIA_RE.lastIndex = 0;
  return MEDIA_RE.test(content);
}

// A tool/skill invocation that the model "leaked" into its *text* instead of
// issuing a real function call — e.g.
//   <skill_view name="x">{"answer": "the real reply"}</skill_view>
//   <skills_list category="">…markdown prose with <b>headings</b>…</skills_list>
// Weaker models on strict-tool providers (e.g. llama-3.3-70b on Groq) do this;
// the gateway forwards it verbatim, so without cleanup the chat shows the raw
// tag. We only treat tags whose name is snake_case (contains `_`) as leaks —
// no HTML element name contains an underscore, so real markup (`<b>`, `<code>`,
// `<div>`) is never matched.
const LEAKED_TOOL_TAG_RE = /<([a-z][a-z0-9_]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;

// Keys whose string value is the human-readable payload to surface.
const READABLE_JSON_KEYS = [
  "answer",
  "response",
  "content",
  "text",
  "message",
  "result",
] as const;

function readableFromLeakedJson(jsonStr: string): string | null {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const key of READABLE_JSON_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Map the safe inline-HTML subset the model sometimes emits inside leaked tool
 * output to markdown, so AgentMarkdown (react-markdown without rehype-raw, which
 * renders raw HTML literally) shows it as intended. Scoped to leaked-tag bodies
 * only — normal prose/markup elsewhere is left alone.
 */
function inlineHtmlToMarkdown(text: string): string {
  return text
    .replace(/<\/?(?:b|strong)(?:\s[^>]*)?>/gi, "**")
    .replace(/<\/?(?:i|em)(?:\s[^>]*)?>/gi, "*");
}

/**
 * Recover the readable text from leaked tool/skill tags (see
 * {@link LEAKED_TOOL_TAG_RE}). For a leaked tag:
 *   - if its body is JSON with an answer/content/text/etc. string, surface that;
 *   - otherwise strip the wrapper and keep the inner body (converting its inline
 *     HTML to markdown).
 * Non-leaked tags (single-word HTML elements, real prose) are left untouched,
 * as are matches inside fenced/inline code.
 *
 * Returns the original string unchanged when there's nothing to clean — cheap
 * for the common case (no `</…>` in the content).
 */
export function cleanLeakedToolTags(content: string): string {
  if (!content || !content.includes("</")) return content;

  const code = codeRanges(content);
  let result = "";
  let last = 0;
  let changed = false;
  let m: RegExpExecArray | null;
  LEAKED_TOOL_TAG_RE.lastIndex = 0;
  while ((m = LEAKED_TOOL_TAG_RE.exec(content)) !== null) {
    const tag = m[1];
    const body = m[2];
    // snake_case name ⇒ a leaked tool/skill call, not real HTML markup.
    if (!tag.includes("_")) continue;
    if (inCode(m.index, code)) continue;
    const readable = readableFromLeakedJson(body);
    const replacement =
      readable !== null ? readable : inlineHtmlToMarkdown(body).trim();
    if (!replacement) continue; // empty body → leave the tag as-is
    result += content.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
    changed = true;
  }
  if (!changed) return content;
  result += content.slice(last);
  return result;
}

/**
 * Classify a plain `src` from a markdown `![alt](src)` image syntax. The
 * markdown image syntax doesn't actually guarantee an image — the agent
 * may emit `![alt](file.pdf)` or `![alt](report.csv)`. Without checking
 * the extension here the caller would unconditionally try to render it
 * via `MediaImage` → `readMediaAsDataUrl` returns `null` (no MIME map
 * entry) → the user sees an "image failed to load" error. Honour the
 * extension so non-image markdown images can fall through to the
 * download-chip path (follow-up item from PR #303 review).
 */
export function describeImageSrc(src: string): MediaToken {
  const trimmed = src.trim();
  const isUrl = /^(?:https?:\/\/|data:image\/)/i.test(trimmed);
  const name = trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed;
  return {
    src: trimmed,
    isUrl,
    isImage: /^data:image\//i.test(trimmed) || IMAGE_EXT.test(trimmed),
    name,
  };
}
