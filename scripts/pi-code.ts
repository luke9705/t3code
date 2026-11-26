#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off
// Pi Code against one profile: the same data directory and origin for dev, start and ship.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeHttp from "node:http";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const home = NodeOS.homedir();
const profileDir = NodePath.join(home, "Library", "Application Support", "Pi code");
const releaseDir = NodePath.join(profileDir, "release", "server");
const serverLog = NodePath.join(profileDir, "server.log");
const stageRoot = NodePath.join(home, ".pi", "tmp");

const host = "127.0.0.1";
const webPort = 3773;
const serverPort = 13773;
const origin = `http://${host}:${webPort}`;

const node = NodeChildProcess.execSync("command -v node", { encoding: "utf8" }).trim();
const vp = NodePath.join(repoRoot, "node_modules", ".bin", "vp");

const modes = ["desktop", "desktop:build", "dev", "start", "ship", "stop", "status"] as const;
type Mode = (typeof modes)[number];
const mode = process.argv[2] as Mode | undefined;
if (mode === undefined || !modes.includes(mode)) {
  console.log(`Usage: node scripts/pi-code.ts <${modes.join("|")}>`);
  process.exit(2);
}

// Pi Code shares ~/.pi/agent/sessions with the Pi CLI; PI_CODING_AGENT_SESSION_DIR stays unset.
const profileEnv = (): NodeJS.ProcessEnv => ({
  HOME: home,
  USER: NodeOS.userInfo().username,
  LOGNAME: NodeOS.userInfo().username,
  PATH: `${NodePath.join(repoRoot, "node_modules", ".bin")}:${home}/.local/bin:${NodePath.dirname(node)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  TMPDIR: NodePath.join(home, ".pi", "tmp"),
  T3CODE_TELEMETRY_ENABLED: "false",
});

const portOwner = (port: number): number | undefined => {
  const found = NodeChildProcess.spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  }).stdout.trim();
  return found === "" ? undefined : Number(found.split("\n")[0]);
};

const stopPort = async (port: number): Promise<void> => {
  const pid = portOwner(port);
  if (pid === undefined) return;
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100 && portOwner(port) === pid; i++) await NodeTimersPromises.setTimeout(200);
  if (portOwner(port) === pid) throw new Error(`Port ${port} owner ${pid} did not stop`);
  console.log(`Stopped ${pid} on ${port}`);
};

// The dev runner is the parent of both dev servers; stopping it takes them down cleanly.
const stopDevRunner = async (): Promise<void> => {
  const found = NodeChildProcess.spawnSync("pgrep", ["-f", "scripts/dev-runner.ts dev"], {
    encoding: "utf8",
  }).stdout.trim();
  for (const pid of found === "" ? [] : found.split("\n").map(Number)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  for (let i = 0; i < 100 && portOwner(serverPort) !== undefined; i++)
    await NodeTimersPromises.setTimeout(200);
};

const activeRunCount = (): number => {
  const db = new NodeSqlite.DatabaseSync(NodePath.join(profileDir, "userdata", "statev2.sqlite"), {
    readOnly: true,
  });
  try {
    return db
      .prepare(
        "select 1 from orchestration_v2_projection_runs where status in ('preparing','starting','running','waiting') limit 1",
      )
      .all().length;
  } finally {
    db.close();
  }
};

const waitForIdle = async (): Promise<void> => {
  if (!NodeFS.existsSync(NodePath.join(profileDir, "userdata", "statev2.sqlite"))) return;
  if (activeRunCount() === 0) return;
  console.log("Waiting for the active turns to finish...");
  while (activeRunCount() > 0) await NodeTimersPromises.setTimeout(1000);
};

const httpOk = (url: string): Promise<number | undefined> =>
  new Promise((resolve) => {
    const req = NodeHttp.request(url, { timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode);
      req.destroy();
    });
    req.on("error", () => resolve(undefined));
    req.on("timeout", () => {
      req.destroy();
      resolve(undefined);
    });
    req.end();
  });

const waitForOrigin = async (path: string): Promise<void> => {
  for (let i = 0; i < 150; i++) {
    if ((await httpOk(`${origin}${path}`)) === 200) return;
    await NodeTimersPromises.setTimeout(200);
  }
  throw new Error(`${origin}${path} did not answer`);
};

const status = () => {
  const web = portOwner(webPort);
  const api = portOwner(serverPort);
  if (web === undefined && api === undefined) return console.log("Pi Code is not running.");
  const command = (pid: number | undefined) =>
    pid === undefined
      ? "-"
      : NodeChildProcess.spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
          encoding: "utf8",
        })
          .stdout.trim()
          .slice(0, 110);
  console.log(`profile: ${profileDir}`);
  console.log(`web  ${webPort}: ${web ?? "-"} ${command(web)}`);
  console.log(`api ${serverPort}: ${api ?? "-"} ${command(api)}`);
};

const dev = async (): Promise<void> => {
  await waitForIdle();
  await stopDevRunner();
  await stopPort(webPort);
  await stopPort(serverPort);
  const child = NodeChildProcess.spawn(
    node,
    [
      NodePath.join(repoRoot, "scripts", "dev-runner.ts"),
      "dev",
      "--home-dir",
      profileDir,
      "--host",
      host,
      "--port",
      String(serverPort),
      "--web-port",
      String(webPort),
    ],
    { cwd: repoRoot, env: profileEnv(), stdio: "inherit" },
  );
  const stop = () => {
    child.kill("SIGINT");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
};

const start = async (): Promise<void> => {
  if (portOwner(webPort) !== undefined) throw new Error(`Port ${webPort} is already in use.`);
  NodeFS.mkdirSync(NodeFS.realpathSync.native(profileDir), { recursive: true });
  const log = NodeFS.openSync(serverLog, "a");
  const child = NodeChildProcess.spawn(
    node,
    [
      NodePath.join(releaseDir, "bin.mjs"),
      "serve",
      "--host",
      host,
      "--port",
      String(webPort),
      "--base-dir",
      profileDir,
    ],
    {
      cwd: profileDir,
      env: { ...profileEnv(), NODE_ENV: "production" },
      stdio: ["ignore", log, log],
      detached: true,
    },
  );
  child.unref();
  await waitForOrigin("/");
  console.log(`Started Pi Code release ${child.pid} on ${origin}`);
};

const ship = async (): Promise<void> => {
  await waitForIdle();
  await stopDevRunner();
  console.log("Building web and server...");
  NodeChildProcess.execFileSync(vp, ["run", "--filter", "@t3tools/web", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  NodeChildProcess.execFileSync(vp, ["run", "--filter", "t3", "build:bundle"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const stage = NodeFS.mkdtempSync(NodePath.join(stageRoot, "pi-code-ship-"));
  const next = NodePath.join(stage, "next");
  NodeFS.cpSync(NodePath.join(repoRoot, "apps", "server", "dist"), next, { recursive: true });
  NodeFS.cpSync(NodePath.join(repoRoot, "apps", "web", "dist"), NodePath.join(next, "client"), {
    recursive: true,
  });
  await stopPort(webPort);
  await stopPort(serverPort);
  NodeFS.renameSync(releaseDir, NodePath.join(stage, "previous"));
  NodeFS.renameSync(next, releaseDir);
  await start();
  console.log(`Previous release kept at ${NodePath.join(stage, "previous")}`);
};

const desktopDir = NodePath.join(repoRoot, "apps", "desktop");
const desktopMain = NodePath.join(desktopDir, "dist-electron", "main.cjs");
const stopDesktopApp = (): void => {
  const found = NodeChildProcess.spawnSync("pgrep", ["-f", desktopMain], {
    encoding: "utf8",
  }).stdout.trim();
  for (const pid of found === "" ? [] : found.split("\n").map(Number)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
};

// The built desktop app is the production flavor (T3 Code (Beta), t3code://) on this profile, so it
// holds the same threads, settings and ports as the dev runner. The dev flavor exists only behind
// Vite (`pnpm dev:desktop`).
const desktop = async (): Promise<void> => {
  if (!NodeFS.existsSync(desktopMain)) {
    throw new Error("No desktop build. Run `node scripts/pi-code.ts desktop:build` first.");
  }
  await waitForIdle();
  await stopDevRunner();
  stopDesktopApp();
  await stopPort(webPort);
  await stopPort(serverPort);
  const env = {
    ...profileEnv(),
    T3CODE_PORT: String(serverPort),
    T3CODE_HOME: profileDir,
  };
  const bundle = NodePath.resolve(desktopDir, ".electron-runtime", "T3 Code (Beta).app");
  if (!NodeFS.existsSync(bundle)) {
    // The launcher builds the runtime bundle; a non-dev environment selects the production flavor.
    NodeChildProcess.execFileSync(
      node,
      [
        "-e",
        `import(${JSON.stringify(NodePath.join(desktopDir, "scripts", "electron-launcher.mjs"))}).then((m) => m.resolveElectronLaunchCommand([desktopMain]))`,
      ],
      { cwd: desktopDir, env, stdio: "inherit" },
    );
  }
  // open(1) detaches the app from this shell, so it outlives the command that started it.
  NodeChildProcess.execFileSync(
    "open",
    [
      "-n",
      "-a",
      bundle,
      "--env",
      `T3CODE_PORT=${env.T3CODE_PORT}`,
      "--env",
      `T3CODE_HOME=${env.T3CODE_HOME}`,
      "--args",
      desktopMain,
    ],
    { stdio: "inherit" },
  );
  for (let i = 0; i < 150 && portOwner(serverPort) === undefined; i++)
    await NodeTimersPromises.setTimeout(200);
  if (portOwner(serverPort) === undefined)
    throw new Error("The desktop app did not start its backend.");
  console.log(`Pi Code desktop is running with profile ${profileDir} (API on ${serverPort})`);
};

const actions: Record<Mode, () => Promise<void>> = {
  desktop,
  "desktop:build": async () => {
    NodeChildProcess.execFileSync(
      vp,
      ["run", "--filter", "@t3tools/desktop", "--filter", "t3", "build"],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
  },
  dev,
  start,
  ship,
  stop: async () => {
    await stopDevRunner();
    stopDesktopApp();
    await stopPort(webPort);
    await stopPort(serverPort);
  },
  status: async () => status(),
};

await actions[mode]();
