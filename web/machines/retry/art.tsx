// The retry machine's static art: every part that never moves, as JSX built once from geometry.ts,
// handed to live.tsx as element props (Anatomy's React split). Each part carries data-part with
// its name from PARTS, so the manifest test can check the drawing against the list.

import { Dots, Line, Solid } from "../iso/react/draw";
import {
  BASE_ART,
  CHUTE_ART,
  DRUM_ART,
  HEAD_ART,
  LEVER_ART,
  MAST_ART,
  RACK_ART,
  RULER_ART,
  STATION_ART,
  TUBE_ART,
  type PartName,
} from "./geometry";

const Part = ({ name, children }: { name: PartName; children: React.ReactNode }) => <g data-part={name}>{children}</g>;

export const BASE = (
  <g key="base">
    <Part name="base-halo">
      <path className="iso-halo" d={BASE_ART.halo} />
    </Part>
    {BASE_ART.feet.map((pair, i) => (
      <Part key={i} name={`foot-${i + 1}` as PartName}>
        <Solid paths={pair[0]!} tone="lo" />
        <Solid paths={pair[1]!} tone="mid" />
      </Part>
    ))}
    <Part name="base-plate">
      <Solid paths={BASE_ART.slab} tone="mid" />
    </Part>
    <Part name="base-groove">
      <Line d={BASE_ART.groove} tone="lo" />
    </Part>
    <Part name="corner-screws">
      <Line d={BASE_ART.screwRings} tone="lo" />
      <Dots points={BASE_ART.screws} size={0.5} tone="mid" />
    </Part>
    <Part name="label-plate">
      <Solid paths={BASE_ART.label} tone="lo" crease="none" />
      <Line d={BASE_ART.labelLine} tone="faint" />
      <Line d={BASE_ART.labelRule} tone="lo" free />
      <Dots points={BASE_ART.labelScrews} size={0.45} tone="mid" />
    </Part>
  </g>
);

export const CHUTE_MAST = (
  <g key="chute-mast">
    <Part name="chute-mast-foot">
      <Solid paths={MAST_ART.chuteFoot} tone="lo" />
      <Dots points={MAST_ART.chuteFootScrews} size={0.45} tone="mid" />
    </Part>
    <Part name="chute-mast">
      <Solid paths={MAST_ART.chute} tone="mid" />
    </Part>
  </g>
);

export const STATION = (
  <g key="station">
    <Part name="station-cabinet">
      <Solid
        paths={STATION_ART.cabinet}
        tone="mid"
        inner={
          <Part name="station-lid-seam">
            <Line d={STATION_ART.lidSeam} tone="faint" />
          </Part>
        }
      />
    </Part>
    <Part name="station-top-groove">
      <Line d={STATION_ART.topGroove} tone="faint" />
    </Part>
    <Part name="station-screws">
      <Dots points={STATION_ART.screws} size={0.5} tone="mid" />
    </Part>
    <Part name="cradle">
      <Solid paths={STATION_ART.cradle} tone="mid" />
    </Part>
    <Part name="cradle-seat">
      <Line d={STATION_ART.cradleSeat} tone="lo" />
    </Part>
    <Part name="lever-gate">
      <Solid paths={STATION_ART.gate} tone="lo" />
    </Part>
    <Part name="lever-gate-slot">
      <Line d={STATION_ART.gateSlot} tone="lo" />
    </Part>
    <Part name="lever-gate-screws">
      <Dots points={STATION_ART.gateScrews} size={0.45} tone="mid" />
    </Part>
    <Part name="pull-counter">
      <Solid paths={STATION_ART.counter} tone="lo" crease="none" />
    </Part>
    <Part name="pull-counter-holes">
      <Line d={STATION_ART.counterHoles} tone="lo" />
    </Part>
  </g>
);

export const TUBE_MAST = (
  <g key="tube-mast">
    <Part name="tube-mast-foot">
      <Solid paths={MAST_ART.tubeFoot} tone="lo" />
    </Part>
    <Part name="tube-mast">
      <Solid paths={MAST_ART.tube} tone="mid" />
    </Part>
  </g>
);

export const RACK = (
  <g key="rack">
    <Part name="return-rack">
      <Solid
        paths={RACK_ART.body}
        tone="mid"
        inner={
          <Part name="rack-seam">
            <Line d={RACK_ART.seam} tone="faint" />
          </Part>
        }
      />
    </Part>
    <Part name="rack-lane">
      <Line d={RACK_ART.lane} tone="lo" />
    </Part>
    <Part name="rack-slots">
      <Line d={RACK_ART.slots} tone="lo" />
    </Part>
    <Part name="rack-slot-steps">
      <Line d={RACK_ART.slotSteps} tone="faint" />
    </Part>
    <Part name="rack-stop-left">
      <Solid paths={RACK_ART.stops[0]!} tone="mid" />
    </Part>
    <Part name="rack-stop-right">
      <Solid paths={RACK_ART.stops[1]!} tone="mid" />
    </Part>
    <Part name="rack-stop-screws">
      <Dots points={RACK_ART.stopScrews} size={0.45} tone="mid" />
    </Part>
  </g>
);

export const RULER = (
  <g key="ruler">
    <Part name="ruler-strip">
      <Solid paths={RULER_ART.strip} tone="lo" crease="none" />
    </Part>
    <Part name="ruler-ticks">
      <Line d={RULER_ART.minor} tone="lo" />
      <Line d={RULER_ART.major} tone="mid" />
    </Part>
  </g>
);

export const TUBE = (
  <g key="tube">
    <Part name="tube-collar">
      <Solid paths={TUBE_ART.collar} tone="mid" />
    </Part>
    <Part name="tube">
      <Solid paths={TUBE_ART.body} tone="hi" crease="lo" />
    </Part>
    <Part name="tube-seams">
      <Line d={TUBE_ART.seams} tone="faint" />
    </Part>
    {(["low", "high"] as const).map((w, i) => (
      <g key={w}>
        <Part name={`tube-clamp-${w}`}>
          <Solid paths={TUBE_ART.clampBlocks[i]!} tone="mid" />
        </Part>
        <Part name={`tube-band-${w}`}>
          <Solid paths={TUBE_ART.bands[i]!} tone="mid" />
          <Dots points={[TUBE_ART.bandDots[i]!]} size={0.45} tone="mid" />
        </Part>
      </g>
    ))}
  </g>
);

export const CHUTE = (
  <g key="chute">
    <Part name="chute-collar">
      <Solid paths={CHUTE_ART.collar} tone="mid" />
    </Part>
    <Part name="return-chute">
      <Solid paths={CHUTE_ART.body} tone="hi" crease="lo" />
    </Part>
    <Part name="chute-seams">
      <Line d={CHUTE_ART.seams} tone="faint" />
    </Part>
    {(["low", "high"] as const).map((w, i) => (
      <g key={w}>
        <Part name={`chute-clamp-${w}`}>
          <Solid paths={CHUTE_ART.clampBlocks[i]!} tone="mid" />
        </Part>
        <Part name={`chute-band-${w}`}>
          <Solid paths={CHUTE_ART.bands[i]!} tone="mid" />
          <Dots points={[CHUTE_ART.bandDots[i]!]} size={0.45} tone="mid" />
        </Part>
      </g>
    ))}
  </g>
);

export const HEAD = (
  <g key="head">
    <Part name="far-end-head">
      <Solid
        paths={HEAD_ART.box}
        tone="mid"
        inner={
          <Part name="head-seam">
            <Line d={HEAD_ART.seam} tone="faint" />
          </Part>
        }
      />
    </Part>
    <Part name="head-lid">
      <Line d={HEAD_ART.lid} tone="faint" />
    </Part>
    <Part name="head-screws">
      <Dots points={HEAD_ART.screws} size={0.5} tone="mid" />
    </Part>
  </g>
);

export const DRUM_BASE = (
  <g key="drum-base">
    <Part name="drum-stand">
      <Solid paths={DRUM_ART.stand} tone="lo" />
    </Part>
    <Part name="drum-stand-screws">
      <Dots points={DRUM_ART.standScrews} size={0.5} tone="mid" />
    </Part>
    <Part name="turn-counter">
      <Solid paths={DRUM_ART.counter} tone="lo" crease="none" />
    </Part>
    <Part name="turn-counter-holes">
      <Line d={DRUM_ART.counterHoles} tone="lo" />
    </Part>
    <Part name="drum-index">
      <Solid paths={DRUM_ART.index} tone="hi" />
    </Part>
    <Part name="drum-hub">
      <Solid paths={DRUM_ART.hub} tone="mid" />
    </Part>
  </g>
);

export const LEVER = (
  <g key="lever">
    <Part name="lever-collar">
      <Solid paths={LEVER_ART.collar} tone="mid" />
    </Part>
    <Part name="lever-stem">
      <Solid paths={LEVER_ART.stem} tone="mid" crease="none" />
    </Part>
    <Part name="lever-knob">
      <Solid paths={LEVER_ART.knob} tone="hi" crease="lo" />
    </Part>
    <Part name="lever-knurl">
      <Line d={LEVER_ART.knurl} tone="lo" />
    </Part>
    <Part name="lever-cap">
      <Line d={LEVER_ART.cap} tone="lo" />
    </Part>
  </g>
);
