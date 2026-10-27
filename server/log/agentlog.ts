// The agent log: one in-memory event bus per session (D02-05).
//
// In plain words: every step of a round (the human's sealed bet, the gate, the seal check, the
// sandbox run, the judge, and later the Meta models) writes one short line here. The screen's log
// strip reads those lines over SSE (a long-lived HTTP response the server keeps writing to).
//
// Rules the bus enforces, so the screen cannot show a line that breaks them:
// - Every event is checked with zod against the AgentEvent shape in src/types.ts. A bad event throws.
// - A model role (investigator, claimant, adversary, fixer) MUST carry `model` and `usage`. That is
//   the "model names visible" guarantee (D10): no model line can reach the screen without its name
//   and what it cost.
// - A plain-code role (gate, seal, runner, judge) and the human must NOT carry a model: plain code
//   decides, and the log must not suggest a model did it.
// - `action` is one short line (1–160 characters, no line breaks), written in the present tense.
// - History is bounded (500 events per session by default; the oldest drop first), and so is the
//   number of sessions kept (the session touched longest ago drops first, unless someone is watching it).

import { z } from "zod";
import type { AgentEvent } from "../../src/types";

export const MODEL_ROLES = ["investigator", "claimant", "adversary", "fixer"] as const;
export const PLAIN_ROLES = ["gate", "seal", "runner", "judge", "human"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** Session ids: 1–64 of A–Z a–z 0–9 _ -. Anything else is refused, so it is safe in a header and a URL. */
export const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const usageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    usd: z.number().nonnegative().finite(),
  })
  .strict();

export const agentEventSchema = z
  .object({
    t: z.iso.datetime(),
    role: z.enum([...MODEL_ROLES, ...PLAIN_ROLES]),
    model: z.string().min(1).max(120).optional(),
    action: z
      .string()
      .min(1)
      .max(160)
      .refine((s) => !/[\r\n]/.test(s), "action must be one line"),
    ref: z
      .object({ kind: z.enum(["finding", "experiment", "bet", "run", "verdict", "change"]), id: z.string().min(1) })
      .strict()
      .optional(),
    usage: usageSchema.optional(),
  })
  .strict()
  .superRefine((ev, ctx) => {
    const isModelRole = (MODEL_ROLES as readonly string[]).includes(ev.role);
    if (isModelRole) {
      if (ev.model === undefined) ctx.addIssue({ code: "custom", path: ["model"], message: `a ${ev.role} event must name the model that acted` });
      if (ev.usage === undefined) ctx.addIssue({ code: "custom", path: ["usage"], message: `a ${ev.role} event must carry the model's token usage and cost` });
    } else {
      if (ev.model !== undefined) ctx.addIssue({ code: "custom", path: ["model"], message: `a ${ev.role} event is plain code or the human, so it must not name a model` });
      if (ev.usage !== undefined) ctx.addIssue({ code: "custom", path: ["usage"], message: `a ${ev.role} event used no model, so it must not carry usage` });
    }
  });

/** What a caller passes to emit: an AgentEvent whose time may be left out (the bus stamps it). */
export type AgentEventInput = Omit<AgentEvent, "t"> & { t?: string };

/** One event as stored, with its position in the session (used as the SSE event id). */
export interface LoggedEvent {
  seq: number;
  event: AgentEvent;
}

export class AgentEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentEventError";
  }
}

interface Session {
  nextSeq: number;
  history: LoggedEvent[];
  listeners: Set<(e: LoggedEvent) => void>;
}

export interface AgentLog {
  /** Checks the event, stamps the time if absent, stores it, and hands it to every live subscriber. Throws AgentEventError when the event is not well formed. */
  emit(sessionId: string, input: AgentEventInput): AgentEvent;
  /** Calls `fn` for every event emitted from now on. Returns the function that stops it. */
  subscribe(sessionId: string, fn: (e: LoggedEvent) => void): () => void;
  /** The kept events, oldest first (at most `maxHistory`). */
  history(sessionId: string): LoggedEvent[];
  /** How many subscribers this session has right now (tests use it to check SSE cleanup). */
  subscriberCount(sessionId: string): number;
}

export function createAgentLog(opts: { maxHistory?: number; maxSessions?: number; now?: () => Date } = {}): AgentLog {
  const maxHistory = opts.maxHistory ?? 500;
  const maxSessions = opts.maxSessions ?? 200;
  const now = opts.now ?? (() => new Date());
  const sessions = new Map<string, Session>(); // insertion order = least recently touched first

  const checkId = (sessionId: string) => {
    if (!SESSION_ID.test(sessionId)) throw new AgentEventError("the session id must be 1–64 letters, digits, _ or -");
  };

  const session = (sessionId: string): Session => {
    checkId(sessionId);
    let s = sessions.get(sessionId);
    if (s) {
      sessions.delete(sessionId); // re-insert: now the most recently touched
    } else {
      s = { nextSeq: 1, history: [], listeners: new Set() };
    }
    sessions.set(sessionId, s);
    if (sessions.size > maxSessions) {
      for (const [id, old] of sessions) {
        if (sessions.size <= maxSessions) break;
        if (old.listeners.size === 0 && id !== sessionId) sessions.delete(id);
      }
    }
    return s;
  };

  return {
    emit(sessionId, input) {
      const parsed = agentEventSchema.safeParse({ ...input, t: input.t ?? now().toISOString() });
      if (!parsed.success) {
        const why = parsed.error.issues.map((i) => `${i.path.length ? i.path.join(".") : "event"}: ${i.message}`).join("; ");
        throw new AgentEventError(`agent event refused (${input.role ?? "no role"}): ${why}`);
      }
      const event = parsed.data as AgentEvent;
      const s = session(sessionId);
      const logged: LoggedEvent = { seq: s.nextSeq++, event };
      s.history.push(logged);
      if (s.history.length > maxHistory) s.history.splice(0, s.history.length - maxHistory);
      for (const fn of [...s.listeners]) {
        try {
          fn(logged);
        } catch {
          // A subscriber that throws is dropped; it must not stop the round or other subscribers.
          s.listeners.delete(fn);
        }
      }
      return event;
    },
    subscribe(sessionId, fn) {
      const s = session(sessionId);
      s.listeners.add(fn);
      return () => {
        s.listeners.delete(fn);
      };
    },
    history(sessionId) {
      checkId(sessionId);
      return [...(sessions.get(sessionId)?.history ?? [])];
    },
    subscriberCount(sessionId) {
      return sessions.get(sessionId)?.listeners.size ?? 0;
    },
  };
}

// ---------- how a role module emits ----------

/** A model event: `model` and `usage` are required by the type as well as by the check above. */
export interface ModelEventInput {
  role: ModelRole;
  model: string;
  action: string;
  usage: NonNullable<AgentEvent["usage"]>;
  ref?: AgentEvent["ref"];
}

/** What the server hands a role module (for example server/meta/roles/claimant.ts) for one session. */
export interface SessionEmitter {
  /** Emits any well-formed event for this session. */
  emit(input: AgentEventInput): AgentEvent;
  /** Emits a Meta model's event. Use this from role modules: it will not compile without model and usage. */
  model(input: ModelEventInput): AgentEvent;
}

/**
 * Binds the log to one session. A role module takes a SessionEmitter as a parameter and calls
 * `emitter.model({ role: "claimant", model, action: "proposes retry-scenario", usage, ref })`
 * after each Meta call, including a failed one ("no usable answer (<reason>)").
 */
export function sessionEmitter(log: AgentLog, sessionId: string): SessionEmitter {
  return {
    emit: (input) => log.emit(sessionId, input),
    model: (input) => log.emit(sessionId, input),
  };
}
