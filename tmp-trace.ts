import { normalizeAgentMarkdown } from "./mediaUtils";

const line = "**如果你没有跨境电商经验** → 做**开发者工具**";
const block = [
  "## 最终建议",
  "",
  line,
  "- 你最懂这个群体",
  "- 技术优势最大",
].join("\n");

console.log("IN:", block);
console.log("OUT:", normalizeAgentMarkdown(block));
