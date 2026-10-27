// Atlas's own copies of JavaScript's built-in functions, taken BEFORE the code under test is loaded.
//
// Plain words: the harness and the code under test run in the same Node process (inside the sandbox,
// runners/executor/local.ts). JavaScript lets any code replace a built-in: Array.prototype.push,
// JSON.stringify, Promise.prototype.then, or a setter on Object.prototype that fires whenever the
// harness writes `measured.outcome = ...`. A change written by a model could use that to make Atlas
// record something the code never did (day-6 review B1).
//
// Two defences, both in this file:
// 1. Captured copies. Every built-in the harness needs to RECORD what happened is copied here when this
//    module loads (the worker loads it before the code under test). The harness writes its records with
//    these copies, into objects with no prototype (Object.create(null)) via Object.defineProperty, so a
//    replaced Array.prototype.push or an Object.prototype setter never sees a record being written.
// 2. A snapshot of the built-ins. `armBuiltinCheck()` (called by the worker before the import) records
//    every own property of the built-in objects the harness or the result writer could touch: its value
//    or getter/setter, its flags, and the object's prototype. `builtinsChanged()` compares now against
//    that snapshot. The harness calls it every time the code under test hands control back (each call
//    of fn/sleep/log, each settle, each turn of its virtual event loop) and the worker calls it once
//    more just before writing the result. Any difference, even one put back later, is remembered
//    (sticky), and the run is then not shown as fact: "the code under test changed JavaScript's
//    built-in objects, so Atlas's record of this run cannot be trusted".
//
// This is still not a security boundary: code in the same process can do things this file does not
// look for. The sandbox (no network, no file writes, no child processes) is the boundary; this file
// makes sure the RECORD of a run cannot be quietly rewritten by the code it describes.

const g = globalThis;
const R = Reflect;
export const ReflectApply = R.apply;
export const ReflectOwnKeys = R.ownKeys;
export const ReflectGetPrototypeOf = R.getPrototypeOf;
export const ObjectCreate = Object.create;
export const ObjectDefineProperty = Object.defineProperty;
export const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
export const ObjectIsExtensible = Object.isExtensible;
export const ObjectIs = Object.is;
export const ObjectFreeze = Object.freeze;
export const ObjectHasOwn = Object.hasOwn;
export const JSONStringify = JSON.stringify;
export const JSONParse = JSON.parse;
export const StructuredClone = g.structuredClone;
export const StringCtor = String;
export const NumberCtor = Number;
export const NumberIsFinite = Number.isFinite;
export const MathImul = Math.imul;
export const MathFloor = Math.floor;
export const ErrorCtor = Error;
export const PromiseCtor = Promise;
const PromiseResolveFn = Promise.resolve;
const PromiseRejectFn = Promise.reject;
const PromiseThenFn = Promise.prototype.then;
const nativeSetImmediate = g.setImmediate;
const nativeGetActiveResourcesInfo = process.getActiveResourcesInfo;

/** Promise.resolve / Promise.reject / promise.then through the captured functions. */
export const promiseResolve = <T>(v: T): Promise<Awaited<T>> => ReflectApply(PromiseResolveFn, PromiseCtor, [v]) as Promise<Awaited<T>>;
export const promiseReject = (e: unknown): Promise<never> => ReflectApply(PromiseRejectFn, PromiseCtor, [e]) as Promise<never>;
export const promiseThen = <T, A, B>(p: Promise<T>, ok: (v: T) => A, err?: (e: unknown) => B): Promise<A | B> =>
  ReflectApply(PromiseThenFn, p, err ? [ok, err] : [ok]) as Promise<A | B>;
/** Resolves after every queued promise reaction has run (the native setImmediate, never a wrapped one). */
export const drainMicrotasks = (): Promise<void> => new PromiseCtor<void>((r) => void ReflectApply(nativeSetImmediate, g, [r]));
/** process.getActiveResourcesInfo() through the captured function. */
export const activeResourcesInfo = (): string[] => ReflectApply(nativeGetActiveResourcesInfo, process, []) as string[];

/** A record with no prototype: no Object.prototype setter or getter can see what is written into it. */
export const record = <T extends object>(): T => ObjectCreate(null) as T;
/** Writes `key` as an own data property (defineProperty never consults a prototype). */
export function put(obj: object, key: string | number, value: unknown): void {
  ObjectDefineProperty(obj, key, { __proto__: null, value, writable: true, enumerable: true, configurable: true } as PropertyDescriptor);
}
/** Appends to an array without Array.prototype.push (which a changed built-in could intercept). */
export function append<T>(arr: T[], value: T): void {
  put(arr, arr.length, value);
}
/** A deep copy as ordinary objects (structuredClone, captured), so callers outside the sandbox see plain data. */
export const plain = <T>(v: T): T => StructuredClone(v) as T;

// ── the snapshot of the built-ins ───────────────────────────────────────────────────────────────

const proto = (o: object) => ReflectGetPrototypeOf(o) as object;
/** Every built-in object whose properties the harness or the result writer reads while recording a run. */
function watchedObjects(): [string, object][] {
  const arrayIter = proto([][Symbol.iterator]());
  return [
    ["Object", Object],
    ["Object.prototype", Object.prototype],
    ["Function.prototype", Function.prototype],
    ["Array", Array],
    ["Array.prototype", Array.prototype],
    ["ArrayIterator.prototype", arrayIter],
    ["Iterator.prototype", proto(arrayIter)],
    ["String", String],
    ["String.prototype", String.prototype],
    ["StringIterator.prototype", proto(""[Symbol.iterator]())],
    ["Number", Number],
    ["Number.prototype", Number.prototype],
    ["Boolean.prototype", Boolean.prototype],
    ["Symbol", Symbol],
    ["Symbol.prototype", Symbol.prototype],
    ["BigInt.prototype", BigInt.prototype],
    ["Promise", Promise],
    ["Promise.prototype", Promise.prototype],
    ["Map.prototype", Map.prototype],
    ["MapIterator.prototype", proto(new Map()[Symbol.iterator]())],
    ["Set.prototype", Set.prototype],
    ["SetIterator.prototype", proto(new Set()[Symbol.iterator]())],
    ["WeakMap.prototype", WeakMap.prototype],
    ["WeakSet.prototype", WeakSet.prototype],
    ["Error.prototype", Error.prototype],
    ["TypeError.prototype", TypeError.prototype],
    ["RangeError.prototype", RangeError.prototype],
    ["SyntaxError.prototype", SyntaxError.prototype],
    ["ReferenceError.prototype", ReferenceError.prototype],
    ["RegExp.prototype", RegExp.prototype],
    ["RegExpStringIterator.prototype", proto(/a/[Symbol.matchAll]("a"))],
    ["Date.prototype", Date.prototype],
    ["JSON", JSON],
    ["Math", Math],
    ["Reflect", Reflect],
    ["Atomics", Atomics],
    ["TypedArray.prototype", proto(Int32Array.prototype)],
    ["Int32Array.prototype", Int32Array.prototype],
    ["Uint8Array.prototype", Uint8Array.prototype],
    ["ArrayBuffer.prototype", ArrayBuffer.prototype],
    ["SharedArrayBuffer.prototype", SharedArrayBuffer.prototype],
    ["Buffer.prototype", Buffer.prototype],
    ["AsyncFunction.prototype", proto(async () => {})],
  ];
}
/** The global names the harness and worker use; only these globalThis properties are watched (a target may add its own globals). */
const WATCHED_GLOBALS = [
  "Object", "Array", "Promise", "JSON", "Reflect", "Map", "Set", "WeakMap", "WeakSet", "Number", "String", "Boolean", "Symbol",
  "BigInt", "Error", "TypeError", "RangeError", "RegExp", "Math", "Date", "Atomics", "SharedArrayBuffer", "Int32Array", "Uint8Array",
  "ArrayBuffer", "Buffer", "structuredClone", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "setImmediate", "clearImmediate", "process", "globalThis",
] as const;

/** One object's state: its prototype, whether it can grow, and every own property's descriptor, flattened. */
type Shot = { label: string; obj: object; proto: unknown; extensible: boolean; keys: (string | symbol)[]; cells: unknown[] };
const CELLS = 6; // value, get, set, writable, enumerable, configurable

function cellsOf(obj: object, keys: (string | symbol)[]): unknown[] {
  const cells: unknown[] = [];
  for (let i = 0; i < keys.length; i++) {
    const d = ObjectGetOwnPropertyDescriptor(obj, keys[i]!);
    // ObjectHasOwn: a field missing from the descriptor must never be read through Object.prototype.
    put(cells, cells.length, d && ObjectHasOwn(d, "value") ? d.value : undefined);
    put(cells, cells.length, d && ObjectHasOwn(d, "get") ? d.get : undefined);
    put(cells, cells.length, d && ObjectHasOwn(d, "set") ? d.set : undefined);
    put(cells, cells.length, d && ObjectHasOwn(d, "writable") ? d.writable : undefined);
    put(cells, cells.length, d ? d.enumerable : undefined);
    put(cells, cells.length, d ? d.configurable : undefined);
  }
  return cells;
}

function shoot(label: string, obj: object, onlyKeys?: readonly string[]): Shot {
  const keys = (onlyKeys ? [...onlyKeys] : ReflectOwnKeys(obj)) as (string | symbol)[];
  return { label, obj, proto: ReflectGetPrototypeOf(obj), extensible: ObjectIsExtensible(obj), keys, cells: cellsOf(obj, keys) };
}

/** A property name safe to show (a plain identifier); anything else is described, never echoed. */
function keyName(k: string | symbol): string {
  if (typeof k === "symbol") return "a symbol-keyed property";
  return /^[A-Za-z_$][\w$]{0,40}$/.test(k) ? k : "a property";
}

/** The cell index of the first difference between the object now and its snapshot; -1 when none. */
function sameCells(s: Shot): number {
  for (let i = 0; i < s.keys.length; i++) {
    const d = ObjectGetOwnPropertyDescriptor(s.obj, s.keys[i]!);
    const b = i * CELLS;
    if (!ObjectIs(d && ObjectHasOwn(d, "value") ? d.value : undefined, s.cells[b])) return i;
    if (!ObjectIs(d && ObjectHasOwn(d, "get") ? d.get : undefined, s.cells[b + 1])) return i;
    if (!ObjectIs(d && ObjectHasOwn(d, "set") ? d.set : undefined, s.cells[b + 2])) return i;
    if (!ObjectIs(d && ObjectHasOwn(d, "writable") ? d.writable : undefined, s.cells[b + 3])) return i;
    if (!ObjectIs(d ? d.enumerable : undefined, s.cells[b + 4])) return i;
    if (!ObjectIs(d ? d.configurable : undefined, s.cells[b + 5])) return i;
  }
  return -1;
}

/**
 * What changed, comparing the object now with its snapshot. Null when nothing did. Allocates nothing on
 * the path where nothing changed (it runs at every hand-back from the code under test).
 */
function diffShot(s: Shot, onlyKeys?: readonly string[]): string | null {
  if (!ObjectIs(ReflectGetPrototypeOf(s.obj), s.proto)) return `${s.label}'s prototype was replaced`;
  if (ObjectIsExtensible(s.obj) !== s.extensible) return `${s.label} was frozen or sealed`;
  if (!onlyKeys) {
    const now = ReflectOwnKeys(s.obj);
    if (now.length !== s.keys.length) return `a property of ${s.label} was added or deleted`;
    for (let i = 0; i < now.length; i++) if (!ObjectIs(now[i], s.keys[i])) return `a property of ${s.label} was added or deleted`;
  }
  const i = sameCells(s);
  if (i === -1) return null;
  try {
    return `${s.label}.${keyName(s.keys[i]!)} was replaced`;
  } catch {
    return `a property of ${s.label} was replaced`;
  }
}

function takeShots(): { shots: Shot[]; globalShot: Shot } {
  // Some Node globals are lazy getters that replace themselves on first use; touch each one first.
  for (const n of WATCHED_GLOBALS) void (g as Record<string, unknown>)[n];
  const list: Shot[] = [];
  const objs = watchedObjects();
  for (let i = 0; i < objs.length; i++) put(list, list.length, shoot(objs[i]![0], objs[i]![1]));
  return { shots: list, globalShot: shoot("globalThis", g, WATCHED_GLOBALS) };
}

/** A checker over one snapshot: null while nothing changed, else the first change seen (sticky). */
function checkerOver(snap: { shots: Shot[]; globalShot: Shot }): () => string | null {
  let seen: string | null = null;
  return () => {
    if (seen !== null) return seen;
    for (let i = 0; i < snap.shots.length; i++) {
      const d = diffShot(snap.shots[i]!);
      if (d !== null) return (seen = d);
    }
    const d = diffShot(snap.globalShot, WATCHED_GLOBALS);
    if (d !== null) seen = d;
    return seen;
  };
}

let armed: (() => string | null) | null = null;

/**
 * Takes the process-wide snapshot. One shot only: the first call wins, so code loaded later cannot take a
 * new snapshot of built-ins it has already changed. The worker calls it before importing the code under test.
 */
export function armBuiltinCheck(): void {
  if (!armed) armed = checkerOver(takeShots());
}

/**
 * The checker a run uses. In the sandbox (armed by the worker before the import): the process-wide one,
 * so a change made while the code under test was LOADED counts too. Outside the sandbox (tests calling the
 * harness directly): a fresh snapshot taken now, for this run only.
 * The checker returns null while every watched built-in is exactly as it was when the snapshot was taken.
 * Otherwise a short description of the first change seen (e.g. "Array.prototype.push was replaced").
 * Sticky: once a change is seen it is reported, even if the code puts the built-in back.
 */
export function builtinWatch(): () => string | null {
  return armed ?? checkerOver(takeShots());
}

/** The process-wide checker's answer (null when not armed or nothing changed). */
export function builtinsChanged(): string | null {
  return armed ? armed() : null;
}
