import { useState, useEffect, memo, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy } from "lucide-react";
import { useI18n } from "./useI18n";
import { MediaImage, DownloadChip } from "./MediaImage";
import {
  describeImageSrc,
  isPlainDiagram,
  normalizeAgentMarkdown,
  shouldRenderMislabeledFenceAsMarkdown,
} from "../screens/Chat/mediaUtils";
import { THEMES } from "../constants";
import { useTheme } from "./ThemeProvider";
import {
  resolvePrismLanguage,
} from "./prismLanguage";

// Lazy-load the heavy syntax highlighter — only imported when a code block renders
let _highlighterMod: typeof import("react-syntax-highlighter") | null = null;
let _prismStyleDark: Record<string, React.CSSProperties> | null = null;
let _prismStyleLight: Record<string, React.CSSProperties> | null = null;
let _loadingDark: Promise<void> | null = null;
let _loadingLight: Promise<void> | null = null;

function themeAppearance(resolved: string): "light" | "dark" {
  return THEMES.find((t) => t.id === resolved)?.appearance ?? "dark";
}

function loadHighlighter(appearance: "light" | "dark"): Promise<void> {
  if (_highlighterMod) {
    if (appearance === "light" && _prismStyleLight) return Promise.resolve();
    if (appearance === "dark" && _prismStyleDark) return Promise.resolve();
  }
  const loadingRef = appearance === "light" ? _loadingLight : _loadingDark;
  if (loadingRef) return loadingRef;

  const styleImport =
    appearance === "light"
      ? import("react-syntax-highlighter/dist/esm/styles/prism/one-light")
      : import("react-syntax-highlighter/dist/esm/styles/prism/one-dark");

  const promise = Promise.all([
    _highlighterMod
      ? Promise.resolve(_highlighterMod)
      : import("react-syntax-highlighter"),
    styleImport,
  ]).then(([mod, style]) => {
    _highlighterMod = mod as typeof import("react-syntax-highlighter");
    if (appearance === "light") _prismStyleLight = style.default;
    else _prismStyleDark = style.default;
  });

  if (appearance === "light") _loadingLight = promise;
  else _loadingDark = promise;
  return promise;
}

function prismStyleFor(appearance: "light" | "dark"): Record<string, React.CSSProperties> | null {
  return appearance === "light" ? _prismStyleLight : _prismStyleDark;
}

const PLAIN_PRE_STYLE: React.CSSProperties = {
  margin: 0,
  borderRadius: 0,
  fontSize: "13px",
  lineHeight: 1.5,
  padding: "12px",
  background: "transparent",
  color: "inherit",
  overflowX: "auto",
  whiteSpace: "pre",
  fontVariantLigatures: "none",
  unicodeBidi: "isolate",
};
const PLAIN_CODE_STYLE: React.CSSProperties = {
  background: "transparent",
  padding: 0,
  whiteSpace: "pre",
};

// Diff viewer with colored +/- lines
function DiffView({ code }: { code: string }): React.JSX.Element {
  const lines = code.split("\n");
  return (
    <div className="chat-diff-content">
      {lines.map((line, i) => {
        let cls = "chat-diff-line";
        if (line.startsWith("+")) cls += " chat-diff-add";
        else if (line.startsWith("-")) cls += " chat-diff-remove";
        else if (line.startsWith("@@")) cls += " chat-diff-hunk";
        return (
          <div key={i} className={cls}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

function PlainCodeView({ code }: { code: string }): React.JSX.Element {
  return (
    <pre className="chat-code-plain" style={PLAIN_PRE_STYLE}>
      <code style={PLAIN_CODE_STYLE}>{code}</code>
    </pre>
  );
}

// Source-position ids of code blocks the user has expanded. Kept at module
// scope so the choice survives the remounts react-markdown causes while a
// message is still streaming (index-based keys shift as the AST grows, which
// would otherwise reset a per-component useState back to collapsed).
const expandedCodeBlocks = new Set<string>();

// Code block with syntax highlighting and copy button (lazy-loaded highlighter)
function CodeBlock({
  className,
  children,
  blockId,
}: {
  className?: string;
  children?: React.ReactNode;
  blockId?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const { resolved } = useTheme();
  const appearance = themeAppearance(resolved);
  const prismStyle = prismStyleFor(appearance);
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() =>
    blockId ? !expandedCodeBlocks.has(blockId) : true,
  );
  const [highlighterReady, setHighlighterReady] = useState(
    () => _highlighterMod !== null && prismStyle !== null,
  );
  const code = String(children).replace(/\n$/, "");
  const match = /language-(\S+)/.exec(className || "");
  const rawLanguage = match ? match[1] : "";
  const prismLanguage = resolvePrismLanguage(rawLanguage, code);
  const isDiff = prismLanguage === "diff";
  const mislabeledMarkdown =
    !isDiff &&
    shouldRenderMislabeledFenceAsMarkdown(code, rawLanguage);
  // Diffs win over the box-diagram check: DiffView is already a plain per-line
  // renderer (no Prism), so it has no fragmentation risk, and a patch touching
  // a tree diagram must keep its colored +/- view.
  const boxDiagram =
    !isDiff && !mislabeledMarkdown && isPlainDiagram(code);

  const linesCount = code.split("\n").length;
  const isLong = linesCount > 15 || code.length > 800;

  // Load the palette-matching Prism theme (one-light / one-dark).
  useEffect(() => {
    if (boxDiagram || isDiff) return;
    if (prismStyleFor(appearance)) {
      setHighlighterReady(true);
      return;
    }
    loadHighlighter(appearance).then(() => setHighlighterReady(true));
  }, [appearance, boxDiagram, isDiff]);

  function handleCopy(): void {
    void window.hermesAPI.copyToClipboard(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (mislabeledMarkdown) {
    return <AgentMarkdown>{code}</AgentMarkdown>;
  }

  const codeContent = isDiff ? (
    <DiffView code={code} />
  ) : boxDiagram ? (
    <PlainCodeView code={code} />
  ) : highlighterReady && _highlighterMod && prismStyle ? (
    <_highlighterMod.Prism
      style={prismStyle}
      language={prismLanguage}
      PreTag="div"
      customStyle={{
        margin: 0,
        borderRadius: 0,
        fontSize: "13px",
        lineHeight: 1.5,
        padding: "12px",
        background: "transparent",
      }}
      codeTagProps={{
        className: `language-${prismLanguage}`,
      }}
    >
      {code}
    </_highlighterMod.Prism>
  ) : (
    <PlainCodeView code={code} />
  );

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span className="chat-code-lang">
          {/* Keep the fence's declared language even when a box diagram
              renders plain — the header describes the fence, not the
              renderer. Only default to "text" when none was declared. */}
          {isDiff
            ? "diff"
            : rawLanguage || (boxDiagram ? "text" : prismLanguage)}
        </span>
        <button className="chat-code-copy" onClick={handleCopy}>
          {copied ? t("common.copied") : <Copy size={13} />}
        </button>
      </div>
      <div className={isLong && isCollapsed ? "chat-code-collapsed" : ""}>
        {codeContent}
      </div>
      {isLong && (
        <button
          type="button"
          className="chat-code-expand-btn"
          onClick={() =>
            setIsCollapsed((prev) => {
              const next = !prev;
              if (blockId) {
                if (next) expandedCodeBlocks.delete(blockId);
                else expandedCodeBlocks.add(blockId);
              }
              return next;
            })
          }
        >
          {isCollapsed
            ? t("common.showMore") || "Show more"
            : t("common.showLess") || "Show less"}
        </button>
      )}
    </div>
  );
}

// Shared Markdown renderer that opens links externally
const AgentMarkdown = memo(function AgentMarkdown({
  children,
}: {
  children: string;
}): React.JSX.Element {
  const normalized = useMemo(() => normalizeAgentMarkdown(children), [children]);
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (!href) return;
              try {
                const url = new URL(href, "https://placeholder.invalid");
                if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                  return;
                }
                if (url.protocol === "http:" || url.protocol === "https:") {
                  const event = new CustomEvent("web-preview:navigate", {
                    detail: href,
                  });
                  document.dispatchEvent(event);
                  return;
                }
              } catch {
                return;
              }
              window.hermesAPI.openExternal(href);
            }}
          >
            {children}
          </a>
        ),
        img: ({ src }) => {
          if (typeof src !== "string" || src.length === 0) return null;
          // ![alt](file.pdf) parses as a markdown image but isn't an image —
          // route those to the download chip instead of letting MediaImage
          // try to load a non-image MIME and fail. (Follow-up from #303.)
          const token = describeImageSrc(src);
          return token.isImage ? (
            <MediaImage token={token} />
          ) : (
            <DownloadChip token={token} />
          );
        },
        table: ({ children }) => (
          <div className="chat-table-wrap">
            <table>{children}</table>
          </div>
        ),
        code: ({ className, children, node, ...props }) => {
          const isInline =
            !className &&
            typeof children === "string" &&
            !children.includes("\n");
          if (isInline) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          // Source offset of the opening fence is stable as the block streams,
          // so it survives react-markdown's streaming remounts (unlike index
          // keys) and uniquely identifies this block within the message.
          const start = node?.position?.start;
          const blockId =
            start != null
              ? `${start.offset ?? start.line}:${className ?? ""}`
              : undefined;
          return (
            <CodeBlock className={className} blockId={blockId}>
              {children}
            </CodeBlock>
          );
        },
      }}
    >
      {normalized}
    </Markdown>
  );
});

export { AgentMarkdown };
export default AgentMarkdown;
