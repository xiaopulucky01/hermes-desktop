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

/** True when a trimmed line is part of a pipe-delimited markdown table. */
function isTableContentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.includes("|", 1);
}

/** Char ranges of ``` fenced blocks and `inline` code spans. */
function codeRanges(
  content: string,
  opts?: { protectInlineInTableLines?: boolean },
): Array<[number, number]> {
  const protectInlineInTableLines = opts?.protectInlineInTableLines ?? true;
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const fenced = /```[\s\S]*?```/g;
  while ((m = fenced.exec(content)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  if (!protectInlineInTableLines) {
    let offset = 0;
    for (const line of content.split("\n")) {
      const lineStart = offset;
      const lineEnd = lineStart + line.length;
      offset = lineEnd + 1;
      if (isTableContentLine(line)) continue;
      const inline = /`[^`\n]+`/g;
      inline.lastIndex = 0;
      const slice = content.slice(lineStart, lineEnd);
      while ((m = inline.exec(slice)) !== null) {
        ranges.push([lineStart + m.index, lineStart + m.index + m[0].length]);
      }
    }
    return ranges;
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
  // Keep inline backticks inside table rows intact — otherwise transforms
  // run on fragments and corrupt cells like `` 创建 `/.well-known/...` ``.
  const ranges = codeRanges(content, { protectInlineInTableLines: false });
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

/** Count cells in a pipe-delimited table row, including empty cells. */
function countTableColumns(row: string): number {
  return parseTableCells(row).length;
}

/** GFM separator with spaced dash cells, e.g. `| --- | --- |`. */
function isStandardSeparatorFormat(trimmed: string): boolean {
  return /^\|\s+[-:]{3,}\s+(\|\s+[-:]{3,}\s+)+\|$/.test(trimmed);
}

/** Expand a one-cell `|------|` separator to match the header column count. */
function fixMalformedSeparatorRows(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const isSeparator =
      TABLE_SEPARATOR_RE.test(trimmed) ||
      /^\|[-:\s|]+\|$/.test(trimmed);
    if (isSeparator) {
      const prev = previousNonBlankLine(out, out.length - 1);
      if (prev && TABLE_ROW_RE.test(prev.trim())) {
        const cols = countTableColumns(prev);
        const sepCols = countTableColumns(trimmed);
        if (
          cols >= 2 &&
          (sepCols !== cols || !isStandardSeparatorFormat(trimmed))
        ) {
          out.push(`|${" --- |".repeat(cols)}`);
          continue;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Drop a stray leading/trailing `||` before splitting glued table rows. */
function prepareGluedTableLine(line: string): string {
  const leading = line.match(/^\s*/)?.[0] ?? "";
  let trimmed = line.trim();
  if (!trimmed.startsWith("|")) return line;
  if (trimmed.startsWith("||")) trimmed = trimmed.replace(/^\|\|/, "|");
  trimmed = trimmed.replace(/\|\|\s*$/, "|");
  return `${leading}${trimmed}`;
}

/** Remove orphan `|` rows left after glued-table splitting. */
function stripOrphanTableRows(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return t !== "|" && t !== "||";
    })
    .join("\n");
}

/** Parse pipe-delimited cells, preserving empty cells from `| |` row glue. */
function parseTableCells(row: string): string[] {
  const trimmed = row.trim();
  if (!trimmed.startsWith("|")) return [];
  const parts = trimmed.split("|");
  if (parts.length <= 2) return [];
  return parts.slice(1, -1).map((cell) => cell.trim());
}

/** Split cell list on empty entries created by `| |` row boundaries. */
function splitCellsOnRowBoundaries(cells: string[]): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  for (const cell of cells) {
    if (cell === "") {
      if (current.length > 0) {
        rows.push(current);
        current = [];
      }
      continue;
    }
    current.push(cell);
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/** Fit one row's cells to the table width by merging overflow into the last column. */
function fitTableRowCells(cells: string[], columns: number): string[] {
  if (columns <= 0 || cells.length <= columns) return cells;
  return [
    ...cells.slice(0, columns - 1),
    cells.slice(columns - 1).join(" "),
  ];
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/** Pad or split a merged header label like `Skill Agent` to the table width. */
function expandMergedHeaderLabel(label: string, columns: number): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= columns) {
    return [...Array(columns - words.length).fill(""), ...words];
  }
  return [label.trim()];
}

/** Expand a header row when its cells were glued (`Skill Agent`) or too narrow. */
function fixMergedTableHeaders(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const next = lines[i + 1]?.trim() ?? "";
    if (trimmed.startsWith("|") && isPureTableSeparatorLine(next)) {
      const headerCols = countTableColumns(trimmed);
      const sepCols = countTableColumns(next);
      if (headerCols > 0 && headerCols < sepCols) {
        const cells = parseTableCells(trimmed);
        if (cells.length === 1) {
          out.push(formatTableRow(expandMergedHeaderLabel(cells[0], sepCols)));
          continue;
        }
        if (cells.length === 2 && cells[0] === "" && cells[1].includes(" ")) {
          out.push(formatTableRow(expandMergedHeaderLabel(cells[1], sepCols)));
          continue;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Turn glued dash separators like `||---|---|---|` into a GFM separator row. */
function expandGluedDashSeparators(line: string): string {
  return line.replace(
    /\|\|((?:\s*[-:|]+\s*)+)\|\|\s*/g,
    (_match, sep: string) => {
      const cols =
        sep
          .split("|")
          .map((part: string) => part.trim())
          .filter((part: string) => /[-:]{3,}/.test(part)).length ||
        sep.match(/[-:]{3,}/g)?.length ||
        0;
      if (cols < 2) return _match;
      return `|\n|${" --- |".repeat(cols)}\n| `;
    },
  );
}

/** Expand compact trailing separators such as `||-------|----------|-----|`. */
function expandInlineDashSeparators(text: string): string {
  return text.replace(
    /\|\|((?:[-:]{3,}\|)+[-:]{3,})\|/g,
    (match, sep: string) => {
      const cols = sep.split("|").filter(Boolean).length;
      if (cols < 2) return match;
      return `\n|${" --- |".repeat(cols)}`;
    },
  );
}

/** Pre-split repairs for one-line tables: leading `||`, glued separators. */
function normalizeSingleLineTableBlock(line: string): string {
  let s = prepareGluedTableLine(line);
  if (!s.trim().startsWith("|")) return expandInlineDashSeparators(line);
  s = expandGluedDashSeparators(s);
  return s;
}

/** Split one glued table line using `| |` boundaries and the active column count. */
function splitGluedTableRowByStructure(line: string, columns: number): string | null {
  if (columns < 2) return null;
  const cells = parseTableCells(line);
  if (cells.length <= columns) return null;

  const rowGroups = splitCellsOnRowBoundaries(cells);
  let rows: string[];

  if (rowGroups.length > 1) {
    rows = rowGroups.map((group) =>
      formatTableRow(fitTableRowCells(group, columns)),
    );
  } else if (cells.length % columns === 0) {
    rows = [];
    for (let i = 0; i < cells.length; i += columns) {
      rows.push(formatTableRow(cells.slice(i, i + columns)));
    }
  } else {
    rows = [formatTableRow(fitTableRowCells(cells, columns))];
  }

  const result = rows.join("\n");
  return result !== line.trim() ? result : null;
}

function isPureTableSeparatorLine(trimmed: string): boolean {
  return /^\|\s*[-:][-:|\s]+\|\s*$/.test(trimmed);
}

/** Split glued table rows line-by-line, tracking the active header width. */
function splitGluedTableLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let tableColumns = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pipeSplit = splitGluedTableRowsInLine(line).split("\n");

    for (let j = 0; j < pipeSplit.length; j++) {
      const splitLine = pipeSplit[j];
      const trimmed = splitLine.trim();

      if (isPureTableSeparatorLine(trimmed)) {
        tableColumns = countTableColumns(trimmed);
        const prevIdx = out.length - 1;
        if (prevIdx >= 0) {
          const prevTrimmed = out[prevIdx].trim();
          const headerCells = parseTableCells(prevTrimmed);
          if (
            headerCells.length === 1 &&
            tableColumns > headerCells.length
          ) {
            out[prevIdx] = formatTableRow(
              expandMergedHeaderLabel(headerCells[0], tableColumns),
            );
          } else if (
            headerCells.length === 2 &&
            headerCells[0] === "" &&
            headerCells[1].includes(" ")
          ) {
            out[prevIdx] = formatTableRow(
              expandMergedHeaderLabel(headerCells[1], tableColumns),
            );
          }
        }
        out.push(splitLine);
        continue;
      }

      if (TABLE_ROW_RE.test(trimmed) && looksLikeTableHeader(trimmed)) {
        const next =
          pipeSplit[j + 1]?.trim() ??
          lines[i + 1]?.trim() ??
          "";
        if (
          isPureTableSeparatorLine(next) ||
          TABLE_SEPARATOR_RE.test(next) ||
          isTableDataOrHeaderRow(next)
        ) {
          tableColumns = countTableColumns(trimmed);
        }
      }

      const structured =
        tableColumns >= 2
          ? splitGluedTableRowByStructure(splitLine, tableColumns)
          : null;
      if (structured) out.push(...structured.split("\n"));
      else out.push(splitLine);
    }
  }

  return out.join("\n");
}

/** Split table rows glued on one line: "| a | b | || c | d |" → newline boundary. */
function splitGluedTableRowsInLine(line: string): string {
  const prepared = prepareGluedTableLine(line);
  const trimmed = prepared.trim();
  if (!trimmed.startsWith("|")) return line;
  let s = prepared;
  let prev: string;
  do {
    prev = s;
    // Row glue uses consecutive pipes `||` (no space) — distinct from an empty
    // cell `| |`. Splitting on `\S` before `||` breaks inside words ("Agent").
    s = s.replace(/\|\|(\s*)/g, "|\n|$1");
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

const MISLABELED_FENCE_LANGS = new Set([
  "yaml",
  "yml",
  "json",
  "text",
  "plaintext",
  "plain",
  "markdown",
  "md",
  "",
]);

/** True when a fenced block's body is markdown prose mislabeled as yaml/json/etc. */
function fenceContentIsMarkdown(body: string, lang: string): boolean {
  const trimmed = body.trim();
  if (!trimmed || !MISLABELED_FENCE_LANGS.has(lang)) return false;

  const lines = trimmed.split("\n").filter((line) => line.trim() !== "");
  const tableRows = lines.filter((line) => isTableLine(line.trim())).length;
  const hasMarkdownHeader = /^#{1,6}\s+\S/m.test(trimmed);
  const hasMarkdownBold = /\*\*[^*]+\*\*/.test(trimmed);

  if (hasMarkdownHeader && tableRows >= 1) return true;
  if (tableRows >= 2 && (hasMarkdownHeader || hasMarkdownBold)) return true;
  if (lines.length >= 2 && tableRows * 2 >= lines.length) return true;
  return false;
}

/** Strip fences around markdown the model wrongly wrapped in yaml/json/text blocks. */
function unwrapMislabeledFences(content: string): string {
  return content.replace(
    /^```(\w*)\r?\n([\s\S]*?)\r?\n```/gm,
    (match, lang: string, body: string) => {
      if (fenceContentIsMarkdown(body, lang.trim().toLowerCase())) {
        return `\n\n${body.trim()}\n\n`;
      }
      return match;
    },
  );
}

const BARE_CODE_PATTERNS = [
  /^\s*\/\/(?:\s|$)/,
  /^\s*\/\*/,
  /^\s*\*\//,
  /^\s*#include\b/,
  /^\s*import\s+(?:\{|\w)/,
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)/,
  /^\s*(?:const|let|var)\s+\w/,
  /^\s*(?:async\s+)?function\s+\w/,
  /^\s*class\s+\w/,
  /^\s*app\.(?:get|post|put|delete|patch|use|listen)\b/,
  /^\s*router\./,
  /^\s*module\.exports/,
  /^\s*require\s*\(/,
  /^\s*res\.(?:json|send|status|end)\b/,
  /^\s*req\./,
  /^\s*\}\s*\)\s*;?\s*$/,
  /^\s*\}\s*;?\s*$/,
  /^\s*\)\s*=>\s*\{/,
  /^\s*\w+\s*\(\s*(?:req|res|err)\b/,
  /^\S['"]\s*,\s*\(\s*(?:req|res)\b/,
  /^\s*\w+\.\w+\([^)]*\)\s*;?\s*$/,
  /^\s*\}\)\s*;?\s*$/,
];

/** True when a prose line looks like source code rather than markdown/table text. */
function looksLikeCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (TABLE_ROW_RE.test(trimmed)) return false;
  if (/^[-*+]\s/.test(trimmed)) return false;
  if (/^>\s/.test(trimmed)) return false;
  if (/^```/.test(trimmed)) return false;
  return BARE_CODE_PATTERNS.some((pattern) => pattern.test(line) || pattern.test(trimmed));
}

function detectBareCodeLanguage(block: string): string {
  const sample = block.trim().slice(0, 4000);
  if (
    /app\.(?:get|post|put|delete|patch|use|listen)\b/.test(sample) ||
    /res\.(?:json|send|status)\b/.test(sample) ||
    /\(\s*(?:req|res)\s*,/.test(sample)
  ) {
    return "javascript";
  }
  if (/^\s*(?:def|class)\s+\w+.*:|^\s*from\s+\w+\s+import/m.test(sample)) {
    return "python";
  }
  if (/^\s*(?:interface|type|enum)\s+\w+/m.test(sample)) {
    return "typescript";
  }
  return "javascript";
}

/** Wrap consecutive bare code lines in a fenced block so Prism can highlight them. */
function wrapBareCodeBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!looksLikeCodeLine(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const start = i;
    let codeLineCount = 0;
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (trimmed === "") {
        const next = nextNonBlankLine(lines, i + 1);
        if (next && looksLikeCodeLine(next)) {
          out.push(lines[i]);
          i++;
          continue;
        }
        break;
      }
      if (!looksLikeCodeLine(lines[i])) break;
      codeLineCount++;
      i++;
    }

    const block = lines.slice(start, i).join("\n");
    if (codeLineCount >= 2) {
      const lang = detectBareCodeLanguage(block);
      out.push(`\`\`\`${lang}`, block, "```");
    } else {
      out.push(...lines.slice(start, i));
    }
  }

  return out.join("\n");
}

/** Close an opening fence before trailing prose when the model omitted the closing ```. */
function closeUnclosedFences(content: string): string {
  const lines = content.split("\n");
  let openIndex = -1;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) {
      if (depth === 0) openIndex = i;
      depth = depth === 0 ? 1 : 0;
    }
  }

  if (depth !== 1 || openIndex < 0) return content;

  for (let i = openIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (!looksLikeCodeLine(lines[i]) && !/^```/.test(trimmed)) {
      lines.splice(i, 0, "```");
      return lines.join("\n");
    }
  }

  return `${content}\n\`\`\``;
}

// Tree/box connectors in LLM output — Unicode box drawing, tree glyphs, or
// em/en dashes the model uses instead of └──.
const TREE_CONNECTOR_RE = /[\u2500-\u259F]|(?:└|├|│)|(?:-{2,}|—{1,2})/;

/** True when a prose line glues a tree diagram onto one row with `|` separators. */
function isGluedTreeDiagramLine(trimmed: string): boolean {
  if (!trimmed || trimmed.startsWith("|") || isTableLine(trimmed)) return false;
  const pipeCount = trimmed.match(/\|/g)?.length ?? 0;
  if (pipeCount < 2) return false;
  if (!TREE_CONNECTOR_RE.test(trimmed)) return false;
  // Require tree-ish annotations so "A | B | C" prose does not match.
  return /(?:←|\(\s*Agent\s*\)|\/[\w.-]+\/?)/.test(trimmed);
}

/** Split one-line tree diagrams into a fenced plain-text block for pre rendering. */
function normalizeGluedTreeDiagrams(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!isGluedTreeDiagramLine(trimmed)) return [line];

      const segments = trimmed
        .split(/\s*\|\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (segments.length < 2) return [line];

      return ["", "```text", ...segments, "```", ""];
    })
    .join("\n");
}

// Box Drawing (U+2500–U+257F) plus Block Elements (U+2580–U+259F).
const BOX_DRAWING_RE = /[\u2500-\u259F]/;

// Arrows, repeated pipes/underscores, em-dash connectors.
const ASCII_DIAGRAM_RE =
  /(?:[|_]{3,}|[-=~─—]{4,}|[→←↑↓↔↕⟶⟵▶▷►]|[-─—]{2,}\s*[>→]|(?:→|←)\s*Agent\s+[A-Z]\b|Agent\s+[A-Z]\b.*(?:→|←|─|—|委托|协作))/;

// Layer-stack triangles and bracket labels like [A2A 层] / [Agent A].
const LAYER_DIAGRAM_RE =
  /[\u25BC-\u25BF\u25B2-\u25B5]|^\s*\[(?:Agent\s+[A-Z]|[^\]]*(?:层|Layer))\]\s*$|\[[^\]]+\].*(?:→|←|↓|↑|─|—|│|\||▼|▲)|^\s*[|│]\s*$|\+[-=+]+\+/;

const LAYER_MARKER_RE = new RegExp(
  String.raw`[\u25BC-\u25BF\u25B2-\u25B5]|^\[(?:Agent\s+[A-Z]|[^\]]*(?:层|Layer))\]$|[\u250c\u2510\u2514\u2518\u251c\u2524\u2534\u252c]|^\s*\+[-=+]+\+\s*$`,
  "i",
);

function looksLikeGluedTableLine(trimmed: string): boolean {
  if (isTableLine(trimmed)) return true;
  return (
    /[^|]+\|[^|]+\|/.test(trimmed) &&
    /\|\s*[-:][-:|\s]+\|/.test(trimmed)
  );
}

/** True when a line carries box-drawing, flowchart, or layer-stack diagram glyphs. */
export function isDiagramLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || isTableLine(trimmed) || looksLikeGluedTableLine(trimmed)) {
    return false;
  }
  if (/^```/.test(trimmed)) return false;
  return (
    BOX_DRAWING_RE.test(line) ||
    ASCII_DIAGRAM_RE.test(line) ||
    LAYER_DIAGRAM_RE.test(trimmed)
  );
}

// A fenced block is a diagram when diagram glyphs dominate, or when layer
// markers (brackets, triangles, box borders) appear alongside any diagram line.
// @lat: [[code-blocks#Box diagrams render plain, not highlighted]]
export function isPlainDiagram(code: string): boolean {
  const lines = code.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return false;

  const diagramLines = lines.filter((line) => isDiagramLine(line)).length;
  const hasLayerMarker = lines.some((line) => LAYER_MARKER_RE.test(line.trim()));

  if (hasLayerMarker && diagramLines >= 1) return true;
  if (diagramLines >= 2) return true;
  return diagramLines * 2 >= lines.length;
}

/** Short caption/label line that may sit inside a bare ASCII diagram block. */
function isDiagramContinuationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isDiagramLine(trimmed)) return true;
  if (looksLikeCodeLine(line)) return false;
  if (isTableLine(trimmed)) return false;
  if (isPipeComparisonLine(trimmed)) return false;
  if (/^```/.test(trimmed)) return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (/^[-*+]\s/.test(trimmed)) return false;
  if (/^>\s/.test(trimmed)) return false;
  if (trimmed.length > 72 || /[.!?。！？]$/.test(trimmed)) return false;
  return /(?:层|Agent|MCP|A2A|工具|数据|委托|协作|互补|竞争)/i.test(trimmed);
}

function qualifiesAsDiagramBlock(blockLines: string[]): boolean {
  const nonBlank = blockLines.filter((line) => line.trim() !== "");
  if (nonBlank.length === 0) return false;

  const diagramCount = nonBlank.filter((line) => isDiagramLine(line)).length;
  const hasLayerMarker = nonBlank.some((line) =>
    LAYER_MARKER_RE.test(line.trim()),
  );

  if (hasLayerMarker && diagramCount >= 1) return true;
  if (diagramCount >= 2) return true;
  if (
    diagramCount >= 1 &&
    nonBlank.length <= 10 &&
    nonBlank.every(
      (line) =>
        isDiagramLine(line) || isDiagramContinuationLine(line),
    )
  ) {
    return true;
  }
  return false;
}

/** Wrap bare multi-line layer/flow diagrams in a `text` fence for monospace pre. */
function wrapBareDiagramBlocks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  let inFence = false;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      out.push(lines[i]);
      i++;
      continue;
    }
    if (inFence) {
      out.push(lines[i]);
      i++;
      continue;
    }

    if (!isDiagramLine(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }

    const start = i;
    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (trimmed === "") {
        const next = nextNonBlankLine(lines, i + 1);
        if (
          next &&
          (isDiagramLine(next) || isDiagramContinuationLine(next))
        ) {
          out.push(lines[i]);
          i++;
          continue;
        }
        break;
      }
      if (!isDiagramLine(lines[i]) && !isDiagramContinuationLine(lines[i])) {
        break;
      }
      i++;
    }

    const blockLines = lines.slice(start, i);
    if (qualifiesAsDiagramBlock(blockLines)) {
      out.push("", "```text", ...blockLines, "```", "");
    } else {
      out.push(...blockLines);
    }
  }

  return out.join("\n");
}

/** True when a line uses `| |` column glue instead of a valid GFM table row. */
function isPipeComparisonLine(trimmed: string): boolean {
  if (isTableLine(trimmed)) return false;
  if (TABLE_SEPARATOR_RE.test(trimmed)) return false;
  if (/\|[-:][-:|\s]+\|/.test(trimmed)) return false;
  if (!/\|\s*\|/.test(trimmed)) return false;
  const segments = trimmed
    .split(/\s*\|\s*\|/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (segments.length < 2) return false;
  return segments.slice(1).some((part) => /^-\s+\S/.test(part));
}

/** Turn pseudo-table tier lines ("Title | | - item | | - item") into heading + list. */
function normalizePipeComparisonBlocks(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const trimmed = line.trim();
      if (!isPipeComparisonLine(trimmed)) return [line];

      const segments = trimmed
        .split(/\s*\|\s*\|/)
        .map((part) => part.replace(/\s*\|\s*$/, "").trim())
        .filter(Boolean);
      const title = segments[0];
      const items = segments
        .slice(1)
        .map((part) => `- ${part.replace(/^-\s*/, "")}`)
        .filter((part) => part !== "-");

      if (!title || items.length === 0) return [line];
      return ["", `### ${title}`, "", ...items, ""];
    })
    .join("\n");
}

/**
 * Repair common LLM markdown glitches so remark-gfm can render tables and
 * headings. Scoped to prose only — code fences are never touched.
 */
// @lat: [[code-blocks#LLM markdown normalization]]
export function normalizeAgentMarkdown(content: string): string {
  if (!content) return content;

  let s = unwrapMislabeledFences(content);
  s = closeUnclosedFences(s);

  return transformOutsideCode(s, (text) => {
    let t = normalizeGluedTreeDiagrams(text);
    t = wrapBareDiagramBlocks(t);
    t = wrapBareCodeBlocks(t);
    t = normalizePipeComparisonBlocks(t);

    // Expand glued dash separators (`||---|---|---| ||`) before other pipe fixes.
    t = t
      .split("\n")
      .map((line) => normalizeSingleLineTableBlock(line))
      .join("\n");

    // "...文字## 标题" → break before the heading marker.
    t = t.replace(/([^\n#])(#{1,6}\s+)/g, "$1\n\n$2");

    // Header row glued to its separator: "| a | b | |---|---|" → newline.
    t = t.replace(/(\|[^|\n]+\|[^|\n]+\|[^|\n]*\|)\s*(\|[-:][-:| ]+\|)/g, "$1\n$2");

    // Empty-cell boundary before a separator row: "原因 | |---|" → "原因 |\n|---|".
    // Do not match consecutive `||` — that form is handled by expandGluedDashSeparators.
    t = t.replace(/\|\s+\|(?=[-:])/g, "|\n|");

    // Blank line before a table when it immediately follows prose.
    t = t.replace(
      /([^\n|][^\n]*)\n(\|[^|\n]+\|[^|\n]+\|)/g,
      (match, before: string, row: string) => {
        if (TABLE_SEPARATOR_RE.test(row.trim())) return match;
        return `${before}\n\n${row}`;
      },
    );

    // Ensure each table row sits on its own line when rows were concatenated.
    t = t.replace(
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
    // Insert separators first so column width is known when splitting glued rows.
    t = compactTableBlocks(t);
    t = insertMissingTableSeparators(t);
    t = fixMergedTableHeaders(t);
    t = stripOrphanTableRows(splitGluedTableLines(t));
    t = fixMergedTableHeaders(t);
    t = fixMalformedSeparatorRows(t);
    t = normalizeTableRowPipes(t);

    return t;
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
