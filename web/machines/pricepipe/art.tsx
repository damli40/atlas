// The price pipe's static art: every part whose shape never depends on the run, as JSX built once
// from geometry.ts, handed to live.tsx (Anatomy's React split). Parts that the run decides (a feed
// canister, the blank plate, the gear or its dashed ghost, the needles, the ghost bet marks) are
// built in live.tsx from model.ts. Each part carries data-part with its name from PARTS.

import { Dots, Line, Solid } from "../iso/react/draw";
import { BASE_ART, GAUGE_ART, HOUSING_ART, OUTLET_ART, PEDESTAL_ART, type PartName } from "./geometry";

export const Part = ({ name, children, className }: { name: PartName; children: React.ReactNode; className?: string }) => (
  <g data-part={name} className={className}>
    {children}
  </g>
);

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

export const HOUSING = (
  <g key="housing">
    <Part name="gear-housing" className="pp-housing">
      <Solid
        paths={HOUSING_ART.box}
        tone="mid"
        inner={
          <Part name="housing-seam">
            <Line d={HOUSING_ART.seam} tone="faint" />
          </Part>
        }
      />
    </Part>
    <Part name="housing-screws">
      <Dots points={HOUSING_ART.screws} size={0.5} tone="mid" />
    </Part>
    <Part name="slot-pocket">
      <path className="pp-pocket-face" d={HOUSING_ART.pocketFace} />
      <Line d={HOUSING_ART.pocketRing} tone="lo" />
    </Part>
    <Part name="slot-seat">
      <Line d={HOUSING_ART.pocketSeat} tone="faint" />
    </Part>
  </g>
);

export const PEDESTAL = (
  <g key="pedestal">
    <Part name="gauge-pedestal">
      <Solid
        paths={PEDESTAL_ART.box}
        tone="mid"
        inner={
          <Part name="pedestal-seam">
            <Line d={PEDESTAL_ART.seam} tone="faint" />
          </Part>
        }
      />
    </Part>
    <Part name="pedestal-screws">
      <Dots points={PEDESTAL_ART.screws} size={0.5} tone="mid" />
    </Part>
  </g>
);

export const OUTLET = (
  <g key="outlet">
    <Part name="outlet-collar">
      <Solid paths={OUTLET_ART.collar} tone="mid" />
      <Dots points={OUTLET_ART.collarBolts} size={0.45} tone="mid" />
    </Part>
    <Part name="outlet-duct" className="pp-outlet">
      <Solid paths={OUTLET_ART.duct} tone="hi" crease="lo" inner={<Line d={OUTLET_ART.seam} tone="faint" />} />
    </Part>
  </g>
);

export const GAUGE_BODY = (
  <g key="gauge-body">
    <Part name="gauge-case">
      <Solid paths={GAUGE_ART.case} tone="mid" inner={<Line d={GAUGE_ART.caseSeam} tone="faint" />} />
    </Part>
    <Part name="gauge-bezel">
      <Solid paths={GAUGE_ART.bezel} tone="hi" crease="lo" />
    </Part>
    <Part name="dial-face">
      <Line d={GAUGE_ART.faceRing} tone="lo" />
      <Line d={GAUGE_ART.dialRing} tone="mid" />
    </Part>
    <Part name="dial-ticks">
      <Line d={GAUGE_ART.minor} tone="lo" />
      <Line d={GAUGE_ART.major} tone="hi" />
    </Part>
  </g>
);

export const HUB = (
  <Part name="needle-hub">
    <Solid paths={GAUGE_ART.hub} tone="hi" crease="lo" />
    <Dots points={GAUGE_ART.hubDot} size={0.6} tone="mid" />
  </Part>
);
