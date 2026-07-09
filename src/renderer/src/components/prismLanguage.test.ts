import { describe, expect, it } from "vitest";
import {
  detectLanguageFromCode,
  resolvePrismLanguage,
} from "./prismLanguage";

describe("prismLanguage", () => {
  it("maps common fence aliases to Prism language ids", () => {
    expect(resolvePrismLanguage("ts", "const x = 1")).toBe("typescript");
    expect(resolvePrismLanguage("py", "print(1)")).toBe("python");
    expect(resolvePrismLanguage("js", "console.log(1)")).toBe("javascript");
    expect(resolvePrismLanguage("yml", "key: value")).toBe("yaml");
  });

  it("detects python from typical code when the fence is unlabeled", () => {
    const code = ["def verify(self, spec):", "    return True", ""].join("\n");
    expect(resolvePrismLanguage("", code)).toBe("python");
  });

  it("detects typescript from interface-heavy code", () => {
    const code = [
      "interface Spec {",
      "  name: string;",
      "}",
      "export class InstantVerifier {",
      "  async verify(input: Spec): Promise<boolean> {",
      "    return true;",
      "  }",
      "}",
    ].join("\n");
    expect(resolvePrismLanguage("", code)).toBe("typescript");
  });

  it("detects javascript from const/arrow patterns", () => {
    expect(resolvePrismLanguage("", "const run = () => ({ ok: true });")).toBe(
      "javascript",
    );
  });

  it("falls back to text for diagram-only unlabeled blocks", () => {
    const code = ["流程对比：", "1. 步骤 → 2. 步骤", "    ↑_____|"].join("\n");
    expect(detectLanguageFromCode(code)).toBe("text");
  });
});
