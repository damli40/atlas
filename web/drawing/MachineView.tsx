// D65 style proof: the machine on the page. A flag (?machine=1) turns it on, so nothing changes for anyone else until Dami has seen it.
import { useMemo } from "react";
import { drawMachine, machineParts, type MachineRing } from "../../renderer/machine/machine";
import { MACHINE_CSS } from "../../renderer/machine/pencil";
import type { FileOutline } from "../../src/file-outline";
import type { BenchModel } from "../machines/bench/model";
import { ensureRendererStyle } from "./Drawing";

export const machineOn = () => typeof location !== "undefined" && new URLSearchParams(location.search).get("machine") === "1";

let styled = false;
export function ensureMachineStyle() {
  ensureRendererStyle();
  if (styled || typeof document === "undefined") return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = `${MACHINE_CSS}
.m-host{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:18px 18px 18px;box-sizing:border-box}
.m-host .m-sheet{width:100%;height:100%;max-width:calc(var(--m-w) * 1.3);max-height:calc(var(--m-h) * 1.3);display:block;overflow:visible}
.m-flow{position:relative}
.m-kicker{font:400 15px/1.3 "Atlas Besley",Georgia,serif;color:var(--rr-soft,#5d5650);margin:0}
.m-title{font:400 44px/1.1 "Atlas Besley",Georgia,serif;margin:2px 0 0}
.m-cap{font:italic 400 13.5px/1.45 "Atlas Besley",Georgia,serif;color:#5d5650;margin:4px 0 0}
.m-over{z-index:3}
.m-tooMany{position:absolute;left:24px;top:12px;font:400 13px/1.4 var(--ui, sans-serif);z-index:2}`;
  document.head.append(style);
}

export function SvgSheet({ svg, width, height, testid, className = "" }: { svg: string; width: number; height: number; testid?: string; className?: string }) {
  ensureMachineStyle();
  return <div className={`rr-host m-host ${className}`} data-theme="light" data-testid={testid} style={{ background: "transparent", ["--m-w" as string]: `${width}px`, ["--m-h" as string]: `${height}px` }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function MachineView({ model, outline, source, language, ring = null }: { model: BenchModel; outline: FileOutline; source: string; language: "js" | "ts" | "py"; ring?: MachineRing | null }) {
  const drawn = useMemo(() => drawMachine(machineParts(model, outline, source, language), { seed: `machine:${outline.parts.map((p) => p.name).join(",")}`, ring }), [model, outline, source, language, ring]);
  if (drawn.tooMany) return <p className="m-tooMany" data-testid="machine-too-many">{drawn.tooMany}</p>;
  return <SvgSheet svg={drawn.svg} width={drawn.width} height={drawn.height} testid="machine" />;
}
