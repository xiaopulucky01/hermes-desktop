export function dashboardCliArgs(
  profile: string | undefined,
  command: string[],
): string[] {
  return profile ? ["--profile", profile, ...command] : command;
}

export interface LocalDashboardCliOptions {
  skipBuild?: boolean;
}

export function buildLocalDashboardCliArgs(
  profile: string | undefined,
  port: number,
  options: LocalDashboardCliOptions = {},
): string[] {
  const args = dashboardCliArgs(profile, [
    "dashboard",
    "--isolated",
    "--no-open",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ]);

  if (options.skipBuild) {
    args.push("--skip-build");
  }

  return args;
}

/**
 * Local chat's preferred `/api/ws` backend. Upstream documents that desktop
 * must spawn `hermes serve` (headless) — never `dashboard` — so we skip the
 * SPA npm install/build that blocked chat when Node/web dist were unavailable.
 */
// @lat: [[main-process#Local TUI gateway]]
export function buildTuiGatewayCliArgs(port: number): string[] {
  return [
    "serve",
    "--no-open",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ];
}
