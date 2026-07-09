/**
 * Map fence labels and code shape to a Prism/refractor language id.
 */
// @lat: [[code-blocks#Syntax highlighting palette]]

/** Languages that should always use Prism when the fence declares them. */
export const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, string> = {
  code: "",
  text: "text",
  plaintext: "text",
  plain: "text",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  golang: "go",
  "c++": "cpp",
  hpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  dockerfile: "docker",
  docker: "docker",
  jsonc: "json",
  vb: "vbnet",
  ps1: "powershell",
  ps: "powershell",
  sql: "sql",
  html: "markup",
  xml: "markup",
  svg: "markup",
};

const STRONG_CODE_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "python",
  "java",
  "go",
  "rust",
  "csharp",
  "cpp",
  "c",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "scala",
  "sql",
  "json",
  "yaml",
  "sql",
  "java",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "scala",
]);

/** Guess language from content when the fence has no (or generic) label. */
export function detectLanguageFromCode(code: string): string {
  const sample = code.trim().slice(0, 4000);
  if (!sample) return "text";

  if (
    /^\s*<!DOCTYPE\s/i.test(sample) ||
    /^\s*<(?:html|svg|div|span|root|Project)/im.test(sample)
  ) {
    return "markup";
  }
  if (/^\s*#include\s/m.test(sample) || /^\s*int\s+main\s*\(/m.test(sample)) {
    return "cpp";
  }
  if (/^\s*package\s+[\w.]+\s*;?/m.test(sample) || /^\s*func\s+\w+/m.test(sample)) {
    return "go";
  }
  if (/^\s*(fn|let mut|use|impl|pub)\s+\w+/m.test(sample)) {
    return "rust";
  }
  if (
    /^\s*(def|class)\s+\w+.*:|^\s*from\s+\w+\s+import|^\s*import\s+\w+$/m.test(
      sample,
    )
  ) {
    return "python";
  }
  if (
    /^\s*(interface|type|enum)\s+\w+/m.test(sample) ||
    /:\s*(string|number|boolean|void|never)\b/m.test(sample) ||
    /^\s*import\s+(?:type\s+|\{)/m.test(sample)
  ) {
    return "typescript";
  }
  if (
    /^\s*(const|let|var|function|export|import)\s/m.test(sample) ||
    /=>\s*[{(]/.test(sample)
  ) {
    return "javascript";
  }
  if (/^\s*\{[\s\S]*"[^"]+"\s*:/m.test(sample)) {
    return "json";
  }
  if (/^\s*---\s*$/m.test(sample) || /^\s*[\w.-]+:\s*[^\s]/m.test(sample)) {
    return "yaml";
  }
  if (/^\s*(SELECT|INSERT|CREATE|ALTER|WITH)\s/im.test(sample)) {
    return "sql";
  }
  if (/^\s*(public|private|protected)\s+(static\s+)?(class|void|int)\s/m.test(sample)) {
    return "java";
  }
  if (/^\s*#!/m.test(sample) || /^\s*(sudo\s+)?[\w-]+=/.test(sample)) {
    return "bash";
  }

  return "text";
}

export function resolvePrismLanguage(rawLabel: string, code: string): string {
  const label = rawLabel.trim().toLowerCase();
  if (label in HIGHLIGHT_LANGUAGE_ALIASES) {
    const mapped = HIGHLIGHT_LANGUAGE_ALIASES[label];
    return mapped || detectLanguageFromCode(code);
  }
  if (label) return label;
  return detectLanguageFromCode(code);
}

export function isStrongCodeLanguage(language: string): boolean {
  return STRONG_CODE_LANGUAGES.has(language);
}
