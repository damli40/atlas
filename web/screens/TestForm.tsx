// E3: the person writes (or edits) a test themselves. The form can only express what the gate's allow-list has
// ("call-function": JSON arguments and stand-in functions with return / throw / never-answer steps), and the
// server's gate (src/gate.ts) still checks every field before anything runs. A test the gate refuses is shown
// with its reason and never runs.

import { useId, useState } from "react";
import { BOUNDS, CALL_DEFAULT_WATCH_LIMIT_MS } from "../../src/gate";
import { PASTE_WORDS as W } from "../../src/paste-words";

type StepForm = { do: "return"; value: string; afterMs: string } | { do: "throw"; errorName: string; message: string } | { do: "never_settle" };
export type ArgForm =
  | { kind: "json"; value: string }
  | { kind: "stand-in"; name: string; async: boolean; steps: StepForm[]; then: "repeat_last" | "throw_exhausted" };
export interface TestFormState {
  args: ArgForm[];
  watchLimitMs: string;
  /**
   * U3: what the form cannot edit but an edited test keeps unchanged: the fake network and a sequence's earlier calls
   * (the form edits the LAST call's arguments; before U3 these were silently dropped on "Edit").
   */
  kept?: { network?: unknown; earlier?: unknown[]; lastWaitMs?: number };
}

const rec = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const asText = (v: unknown) => (v === undefined ? "" : JSON.stringify(v));

/** A form filled from a proposal's params (whatever shape they have: anything unreadable becomes an empty field). */
export function formFromParams(params: unknown): TestFormState {
  const p = rec(params);
  const args = Array.isArray(p.args) ? p.args : [];
  const calls = Array.isArray(p.calls) && p.calls.length > 1 ? p.calls : null;
  const lastWait = calls ? rec(calls[calls.length - 1]).waitMs : undefined;
  const kept = p.network !== undefined || calls ? { ...(p.network !== undefined ? { network: p.network } : {}), ...(calls ? { earlier: calls.slice(0, -1), ...(typeof lastWait === "number" ? { lastWaitMs: lastWait } : {}) } : {}) } : undefined;
  return {
    ...(kept ? { kept } : {}),
    watchLimitMs: typeof p.watchLimitMs === "number" ? String(p.watchLimitMs) : "",
    args: args.map((a0): ArgForm => {
      const a = rec(a0);
      if (a.kind !== "stand-in") return { kind: "json", value: asText(a.value) };
      const calls = Array.isArray(a.calls) ? a.calls : [];
      return {
        kind: "stand-in",
        name: typeof a.name === "string" ? a.name : "",
        async: a.async === true,
        then: a.then === "throw_exhausted" ? "throw_exhausted" : "repeat_last",
        steps: calls.map((s0): StepForm => {
          const s = rec(s0);
          if (s.do === "throw") return { do: "throw", errorName: typeof s.errorName === "string" ? s.errorName : "", message: typeof s.message === "string" ? s.message : "" };
          if (s.do === "never_settle") return { do: "never_settle" };
          return { do: "return", value: asText(s.value), afterMs: typeof s.afterMs === "number" ? String(s.afterMs) : "" };
        }),
      };
    }),
  };
}

/** The params the form describes, or the first problem a person can fix (JSON that does not parse, a non-number). */
export function paramsFromForm(exportName: string, f: TestFormState): { ok: true; params: unknown } | { ok: false; reason: string } {
  const json = (text: string, where: string): { ok: true; v: unknown } | { ok: false; reason: string } => {
    try {
      return { ok: true, v: JSON.parse(text) };
    } catch {
      return { ok: false, reason: W.formNotJson(where, text) };
    }
  };
  const args: unknown[] = [];
  for (let i = 0; i < f.args.length; i++) {
    const a = f.args[i]!;
    if (a.kind === "json") {
      const v = json(a.value, `argument ${i + 1}`);
      if (!v.ok) return v;
      args.push({ kind: "json", value: v.v });
      continue;
    }
    const calls: unknown[] = [];
    for (let j = 0; j < a.steps.length; j++) {
      const s = a.steps[j]!;
      if (s.do === "return") {
        const v = json(s.value, `${a.name || `stand-in ${i + 1}`}, call ${j + 1}`);
        if (!v.ok) return v;
        const after = s.afterMs.trim();
        if (after !== "" && !/^\d+$/.test(after)) return { ok: false, reason: W.formNotWholeMs(`${a.name}, call ${j + 1}`) };
        calls.push({ do: "return", value: v.v, ...(after !== "" ? { afterMs: Number(after) } : {}) });
      } else if (s.do === "throw") calls.push({ do: "throw", errorName: s.errorName, message: s.message });
      else calls.push({ do: "never_settle" });
    }
    args.push({ kind: "stand-in", name: a.name, async: a.async, calls, then: a.then });
  }
  const w = f.watchLimitMs.trim();
  if (w !== "" && !/^\d+$/.test(w)) return { ok: false, reason: W.formWatchNotWhole };
  const k = f.kept;
  // U3: the edited call is the sequence's last call; the earlier calls and the fake network are kept as they were.
  const calls = k?.earlier?.length ? [...k.earlier, { exportName, args, ...(k.lastWaitMs ? { waitMs: k.lastWaitMs } : {}) }] : null;
  return { ok: true, params: { shape: "call-function", exportName, args, ...(w !== "" ? { watchLimitMs: Number(w) } : {}), ...(k?.network !== undefined ? { network: k.network } : {}), ...(calls ? { calls } : {}) } };
}

export const emptyForm = (): TestFormState => ({ args: [], watchLimitMs: "" });

/** The same choices as a row of buttons, never the browser's own dropdown. */
export function Segments({ label, value, onChange, options, testid }: { label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]; testid?: string }) {
  return (
    <div className="u1-segs" role="radiogroup" aria-label={label} {...(testid ? { "data-testid": testid } : {})}>
      {options.map(([v, words]) => (
        <button type="button" role="radio" key={v} className="u1-seg" aria-checked={value === v} onClick={() => onChange(v)} {...(testid ? { "data-testid": `${testid}-${v}` } : {})}>
          {words}
        </button>
      ))}
    </div>
  );
}

export function TestForm({ exportName, initial, onSubmit, busy, note, required = null }: { exportName: string; initial: TestFormState; onSubmit: (params: unknown) => void; busy: boolean; note?: string; /** What the function needs, from its signature. Null: can't be told. */ required?: string[] | null }) {
  const [f, setF] = useState<TestFormState>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const setArg = (i: number, a: ArgForm) => setF((x) => ({ ...x, args: x.args.map((y, k) => (k === i ? a : y)) }));
  const submit = () => {
    // An empty test on a function that needs arguments only shows it failing on nothing, and would pay the AI bettors to say so.
    if (f.args.length === 0 && required && required.length > 0) return setProblem(W.formEmpty(exportName, required));
    const r = paramsFromForm(exportName, f);
    if (!r.ok) return setProblem(r.reason);
    setProblem(null);
    onSubmit(r.params);
  };
  return (
    <section className="card model-panel" aria-label="your test" data-testid="test-form">
      <h3>{W.formHeading}</h3>
      <p className="muted small">
        {W.formHint} {W.formCallsOnce(exportName)}
      </p>
      {note && <p className="small label">{note}</p>}
      {f.kept && <p className="small label" data-testid="form-kept">{W.formKept(f.kept.network !== undefined, f.kept.earlier?.length ?? 0)}</p>}
      <fieldset disabled={busy}>
        <legend className="small">{W.formArgs}</legend>
        {f.args.map((a, i) => (
          <div key={i} className="arg" data-testid={`arg-${i}`}>
            {a.kind === "json" ? (
              <div className="row">
                <label htmlFor={`${id}-a${i}`}>{W.formJsonArg(i + 1)}</label>
                <input id={`${id}-a${i}`} className="link" value={a.value} onChange={(e) => setArg(i, { ...a, value: e.target.value })} placeholder={W.formJsonPlaceholder} />
                <button type="button" onClick={() => setF((x) => ({ ...x, args: x.args.filter((_, k) => k !== i) }))}>
                  {W.formRemove}
                </button>
              </div>
            ) : (
              <StandInForm id={`${id}-a${i}`} n={i + 1} a={a} onChange={(b) => setArg(i, b)} onRemove={() => setF((x) => ({ ...x, args: x.args.filter((_, k) => k !== i) }))} />
            )}
          </div>
        ))}
        <div className="row">
          <button type="button" onClick={() => setF((x) => ({ ...x, args: [...x.args, { kind: "json", value: "" }] }))} disabled={f.args.length >= BOUNDS.callArgs}>
            {W.formAddJson}
          </button>
          <button
            type="button"
            onClick={() => setF((x) => ({ ...x, args: [...x.args, { kind: "stand-in", name: `fn${x.args.filter((y) => y.kind === "stand-in").length + 1}`, async: true, steps: [{ do: "return", value: "null", afterMs: "" }], then: "repeat_last" }] }))}
            disabled={f.args.length >= BOUNDS.callArgs}
          >
            {W.formAddStandIn}
          </button>
        </div>
        <p className="muted small">{W.formStandInHelp}</p>
        <div className="row">
          <label htmlFor={`${id}-w`}>{W.formWatch}</label>
          <input id={`${id}-w`} type="number" min={1} max={BOUNDS.watchLimitMs.max} value={f.watchLimitMs} placeholder={String(CALL_DEFAULT_WATCH_LIMIT_MS)} onChange={(e) => setF((x) => ({ ...x, watchLimitMs: e.target.value }))} />
        </div>
      </fieldset>
      {problem && (
        <p className="notice" role="alert" data-testid="form-problem">
          {problem}
        </p>
      )}
      <button type="button" className="primary" onClick={submit} disabled={busy} data-testid="form-submit">
        {W.formSubmit}
      </button>
    </section>
  );
}

function StandInForm({ id, n, a, onChange, onRemove }: { id: string; n: number; a: Extract<ArgForm, { kind: "stand-in" }>; onChange: (a: Extract<ArgForm, { kind: "stand-in" }>) => void; onRemove: () => void }) {
  const setStep = (j: number, s: StepForm) => onChange({ ...a, steps: a.steps.map((x, k) => (k === j ? s : x)) });
  return (
    <div className="standin">
      <div className="row">
        <label htmlFor={`${id}-name`}>{W.formStandInArg(n)}</label>
        <input id={`${id}-name`} className="link short" value={a.name} onChange={(e) => onChange({ ...a, name: e.target.value })} />
        <label className="choice">
          <input type="checkbox" checked={a.async} onChange={(e) => onChange({ ...a, async: e.target.checked })} /> {W.formAsync}
        </label>
        <button type="button" onClick={onRemove}>
          {W.formRemove}
        </button>
      </div>
      <ol className="steps">
        {a.steps.map((s, j) => (
          <li key={j}>
            <div className="row">
              <span className="small">{W.formCall(j + 1)}</span>
              <Segments
                label={W.formCall(j + 1)}
                value={s.do}
                onChange={(d) => setStep(j, d === "throw" ? { do: "throw", errorName: "Error", message: "" } : d === "never_settle" ? { do: "never_settle" } : { do: "return", value: "null", afterMs: "" })}
                options={[["return", W.formReturns], ["throw", W.formThrows], ...(a.async ? ([["never_settle", W.formNeverAnswers]] as const) : [])]}
              />
              {s.do === "return" && (
                <>
                  <label htmlFor={`${id}-s${j}-v`} className="small">
                    {W.formValue}
                  </label>
                  <input id={`${id}-s${j}-v`} className="link short" value={s.value} onChange={(e) => setStep(j, { ...s, value: e.target.value })} />
                  {a.async && (
                    <>
                      <label htmlFor={`${id}-s${j}-t`} className="small">
                        {W.formAfter}
                      </label>
                      <input id={`${id}-s${j}-t`} type="number" min={0} className="tiny" value={s.afterMs} onChange={(e) => setStep(j, { ...s, afterMs: e.target.value })} />
                    </>
                  )}
                </>
              )}
              {s.do === "throw" && (
                <>
                  <label htmlFor={`${id}-s${j}-e`} className="small">
                    {W.formErrorName}
                  </label>
                  <input id={`${id}-s${j}-e`} className="link short" value={s.errorName} onChange={(e) => setStep(j, { ...s, errorName: e.target.value })} />
                  <label htmlFor={`${id}-s${j}-m`} className="small">
                    {W.formMessage}
                  </label>
                  <input id={`${id}-s${j}-m`} className="link short" value={s.message} onChange={(e) => setStep(j, { ...s, message: e.target.value })} />
                </>
              )}
              <button type="button" onClick={() => onChange({ ...a, steps: a.steps.filter((_, k) => k !== j) })} disabled={a.steps.length <= 1}>
                {W.formRemove}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" onClick={() => onChange({ ...a, steps: [...a.steps, { do: "return", value: "null", afterMs: "" }] })} disabled={a.steps.length >= BOUNDS.standInSteps.max}>
          {W.formAddStep}
        </button>
        <span className="small">{W.formThen}</span>
        <Segments label={W.formThen} value={a.then} onChange={(v) => onChange({ ...a, then: v === "throw_exhausted" ? "throw_exhausted" : "repeat_last" })} options={[["repeat_last", W.formThenRepeat], ["throw_exhausted", W.formThenThrow]]} />
      </div>
    </div>
  );
}
