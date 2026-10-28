// The Atlas MCP server for Muse Code: newline-delimited JSON-RPC 2.0 over stdin/stdout (MCP's stdio transport).
//
// Plain words: Muse Code starts this program when a session begins (plugin.json, "mcpServers"), asks it which
// tools it has, and calls them when the /atlas command (or the person) asks. Written with no dependency beyond
// Node itself, so installing the plugin fetches nothing. Run with Node 22.18+ (it reads the .ts files directly).
//
// stdout carries only protocol messages. Nothing is logged: no code, no invite, no answers. A crash in one tool
// becomes that tool's error answer, never a dead server.

import { createAtlasClient, type Fetch } from "./atlas-client.ts";
import { loadConfig } from "./config.ts";
import { createTools, type AtlasTools, type ToolText } from "./tools.ts";

export const SERVER_INFO = { name: "atlas", version: "0.1.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const str = (description: string) => ({ type: "string", description });

/** The tools, as Muse Code's model sees them. The descriptions carry the rules the model must follow. */
export const TOOL_LIST = [
  {
    name: "atlas_status",
    description: "Say which Atlas server this plugin talks to, whether it answers, whether an invite code is set (never the code), and where pasted code goes. Use when another Atlas tool reports a connection or invite problem.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "atlas_read_file_function",
    description: "Send ONE JavaScript, TypeScript or Python file from this workspace (normally the file you just edited) to the Atlas server and list its exported functions, as Atlas's plain code reads them. Refuses other file kinds, files outside the workspace and files over 64 KB, and sends nothing then.",
    inputSchema: { type: "object", properties: { path: str("Path of the file, relative to the workspace") }, required: ["path"], additionalProperties: false },
  },
  {
    name: "atlas_propose_tests",
    description: "Ask Atlas for tests of one exported function: Muse Wonder (Meta) proposes up to 3, Atlas's gate allows or refuses each. Show every proposal to the person, refused ones too, and let the PERSON pick.",
    inputSchema: { type: "object", properties: { path: str("The file, as given to atlas_read_file_function"), function: str("The exported function's name") }, required: ["path", "function"], additionalProperties: false },
  },
  {
    name: "atlas_start_round",
    description: "Open a betting round on the allowed test the PERSON picked. Returns the questions and the exact text every bettor sees; show that text to the person unchanged. Meta's betting models start betting on the same text.",
    inputSchema: { type: "object", properties: { path: str("The file"), proposal_id: str("The id of the allowed test the person picked, e.g. p_abc") }, required: ["path", "proposal_id"], additionalProperties: false },
  },
  {
    name: "atlas_seal_bet",
    description: "Seal the PERSON's bets. Each answer's `typed` must be the person's own words, copied exactly from what they typed in reply to the question; never write, guess, complete or correct a bet yourself, and never call this before the person has answered. Plain code reads the words; if it cannot, nothing is sealed and you must ask the person again.",
    inputSchema: {
      type: "object",
      properties: {
        experiment_id: str("The round id from atlas_start_round"),
        answers: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: { measures: str("The question's [measures] key"), typed: str("The person's reply, verbatim") }, required: ["measures", "typed"], additionalProperties: false },
        },
      },
      required: ["experiment_id", "answers"],
      additionalProperties: false,
    },
  },
  {
    name: "atlas_run",
    description: "Run the round: Atlas runs the code in its sandbox, records what happened, and its plain-code judge says for every sealed bet: matched, didn't match, or can't check. Returns the facts, each bettor's result and a proof card link. Show the result as it is; never call a bet right or wrong.",
    inputSchema: { type: "object", properties: { experiment_id: str("The round id") }, required: ["experiment_id"], additionalProperties: false },
  },
] as const;

type Handler = (args: Record<string, unknown>) => Promise<ToolText>;

export function handlersOf(tools: AtlasTools): Record<string, Handler> {
  return {
    atlas_status: () => tools.status(),
    atlas_read_file_function: (a) => tools.readFileFunction(a),
    atlas_propose_tests: (a) => tools.proposeTests(a),
    atlas_start_round: (a) => tools.startRound(a),
    atlas_seal_bet: (a) => tools.sealBet(a),
    atlas_run: (a) => tools.run(a),
  };
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Answers one JSON-RPC message (or returns null for a notification). `handlers` is null when the plugin is not set
 * up: every tool call then answers with the set-up reason, so the person sees it in Muse instead of a silent failure.
 */
export async function handleMessage(msg: RpcMessage, handlers: Record<string, Handler> | null, setupProblem: string | null): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined || msg.id === null) return null; // a notification (e.g. notifications/initialized)
  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Atlas: bet on what code will do before you trust it. AI proposes; plain code decides. Bets come from the person's own words.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOL_LIST });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (!TOOL_LIST.some((t) => t.name === name)) return error(-32602, `unknown tool: ${name}`);
      if (!handlers) return reply({ content: [{ type: "text", text: setupProblem ?? "Atlas is not set up" }], isError: true });
      try {
        const out = await handlers[name]!(args);
        return reply({ content: [{ type: "text", text: out.text }], ...(out.isError ? { isError: true } : {}) });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `The Atlas plugin hit an internal error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    default:
      return error(-32601, `method not found: ${msg.method ?? ""}`);
  }
}

/** Starts the stdio loop. `fetch` is injectable for tests; the real one is Node's. */
export function startStdio(opts: { env?: Record<string, string | undefined>; fetch?: Fetch } = {}): void {
  const cfg = loadConfig(opts.env ?? process.env);
  const handlers = cfg.ok ? handlersOf(createTools({ client: createAtlasClient(cfg.config, opts.fetch ? { fetch: opts.fetch } : {}), config: cfg.config })) : null;
  const setupProblem = cfg.ok ? null : cfg.reason;
  let buf = "";
  let chain = Promise.resolve();
  const send = (o: object) => process.stdout.write(JSON.stringify(o) + "\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line === "") continue;
      let msg: RpcMessage;
      try {
        msg = JSON.parse(line) as RpcMessage;
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        continue;
      }
      // One message at a time, in order: a round's steps depend on each other.
      chain = chain.then(async () => {
        const out = await handleMessage(msg, handlers, setupProblem);
        if (out) send(out);
      });
    }
  });
  process.stdin.on("end", () => void chain.then(() => process.exit(0)));
}
