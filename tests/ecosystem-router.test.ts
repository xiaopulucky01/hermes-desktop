import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetEcosystemRootCache } from "../src/main/ecosystem/paths";

describe("ecosystem capability router", () => {
  const prevEco = process.env.HERMES_ECOSYSTEM_ROOT;
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `hermes-eco-router-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    process.env.HERMES_ECOSYSTEM_ROOT = root;
    resetEcosystemRootCache();
  });

  afterEach(() => {
    if (prevEco === undefined) delete process.env.HERMES_ECOSYSTEM_ROOT;
    else process.env.HERMES_ECOSYSTEM_ROOT = prevEco;
    resetEcosystemRootCache();
    rmSync(root, { recursive: true, force: true });
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Capability router]]
  it("ranks capabilities by when_to_use and tag overlap", async () => {
    writeFileSync(
      join(root, "capabilities.json"),
      JSON.stringify(
        {
          schema: "hermes.ecosystem/v1",
          capabilities: [
            {
              kind: "skill",
              id: "sql-helper",
              name: "SQL Helper",
              description: "Write SQL queries",
              when_to_use: "database queries and SQL optimization",
              tags: ["sql", "postgres"],
              origin: "ecosystem",
            },
            {
              kind: "mcp",
              id: "weather",
              name: "Weather MCP",
              description: "Forecast API",
              when_to_use: "weather forecasts",
              tags: ["weather"],
              origin: "ecosystem",
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );

    const { rankCapabilities, formatRouterHint } = await import(
      "../src/main/ecosystem/router"
    );

    const ranked = rankCapabilities("help me write postgres SQL", 3);
    expect(ranked[0]?.id).toBe("sql-helper");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);

    const hint = formatRouterHint("postgres SQL query");
    expect(hint).toContain("SQL Helper");
  });

  // @lat: [[lat.md/ecosystem#Hermes ecosystem#Capability router]]
  it("wraps hint as a system message for chat injection", async () => {
    writeFileSync(
      join(root, "capabilities.json"),
      JSON.stringify(
        {
          schema: "hermes.ecosystem/v1",
          capabilities: [
            {
              kind: "skill",
              id: "sql-helper",
              name: "SQL Helper",
              description: "Write SQL queries",
              when_to_use: "database queries and SQL optimization",
              tags: ["sql"],
              origin: "ecosystem",
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );

    const { capabilityRouterSystemMessage } = await import(
      "../src/main/ecosystem/router"
    );
    const msg = capabilityRouterSystemMessage("write a SQL query");
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("SQL Helper");
    expect(capabilityRouterSystemMessage("zzzz-no-match")).toBeNull();
  });
});
