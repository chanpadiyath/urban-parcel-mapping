import { useMemo, useState } from "react";
import SimMap from "../components/SimMap";
import type { BuildingCollection, ParcelCollection, ParcelProperties } from "../types";
import { useFloodSim } from "../sim/useFloodSim";
import { fmtClock } from "../sim/flood";

interface Props {
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  center: [number, number];
  zoom: number;
}

export default function SimulationPage({ parcels, buildings, center, zoom }: Props) {
  const sim = useFloodSim(parcels, buildings);
  const [selected, setSelected] = useState<ParcelProperties | null>(null);

  const buildingIds = useMemo(
    () => new Set(buildings.features.map((f) => String(f.properties.parcel_id))),
    [buildings],
  );

  const i = sim.impact;
  const statusLabel = sim.status === "running" ? "ACTIVE" : sim.status === "paused" ? "PAUSED" : "IDLE";
  const sel = selected ? sim.impact.perParcel.get(selected.parcel_id) : undefined;
  const maxLevel = sim.elevation.maxM + 1;
  const progress = Math.min(1, sim.waterLevelM / maxLevel);

  return (
    <div className="sim">
      <div className="sim__main">
        <div className="sim__banner">
          SIMULATION / DEMO MODE — deterministic client-side flood model over Land Twin geometry.
          Demo elevation surface; not a hydrological prediction.
        </div>
        <div className="sim__map">
          <SimMap
            parcels={parcels}
            center={center}
            zoom={zoom}
            impact={sim.impact}
            selectedId={selected?.parcel_id ?? null}
            onSelect={setSelected}
          />
        </div>
        <div className="sim__timeline">
          <div className="sim__tl-track"><div className="sim__tl-fill" style={{ width: `${progress * 100}%` }} /></div>
          <div className="sim__tl-labels">
            <span>t {fmtClock(sim.tSeconds)}</span>
            <span>water {sim.waterLevelM.toFixed(2)} m</span>
            <span>max {maxLevel.toFixed(1)} m</span>
          </div>
        </div>
      </div>

      <aside className="sim__side">
        <section className="sim__card">
          <div className="sim__card-head">
            <h2>Flood simulation</h2>
            <span className={"sim__status sim__status--" + sim.status}>{statusLabel}</span>
          </div>
          <div className="sim__controls">
            {sim.status !== "running"
              ? <button className="btn" onClick={sim.start}>▶ Start</button>
              : <button className="btn" onClick={sim.pause}>❚❚ Pause</button>}
            <button className="btn btn--ghost" onClick={sim.reset}>⟲ Reset</button>
            <button className="btn btn--ghost" onClick={sim.cycleSpeed}>Speed ×{sim.speed}</button>
          </div>
          <div className="sim__controls">
            <button className="btn btn--ghost" onClick={() => sim.bumpLevel(0.25)}>+ Water level</button>
            <button className="btn btn--ghost" onClick={() => sim.bumpLevel(-0.25)}>− Water level</button>
          </div>
        </section>

        <section className="sim__card">
          <h3 className="sim__h3">Impact analytics <span className="sim__tag">approx · demo</span></h3>
          <dl className="sim__metrics">
            <div><dt>Water level</dt><dd>{sim.waterLevelM.toFixed(2)} m</dd></div>
            <div><dt>Affected parcels</dt><dd>{i.affectedParcels}</dd></div>
            <div><dt>Affected buildings</dt><dd>{i.affectedBuildings}</dd></div>
            <div><dt>Affected roads</dt><dd>{i.affectedRoadsApprox}</dd></div>
            <div><dt>Affected area</dt><dd>{(i.affectedAreaSqm / 1e4).toFixed(2)} ha</dd></div>
            <div><dt>Area share</dt><dd>{i.affectedAreaPct.toFixed(1)}%</dd></div>
            <div><dt>Critical infrastructure</dt><dd>{i.criticalInfrastructure}</dd></div>
            <div><dt>Max depth</dt><dd>{i.maxDepthM.toFixed(2)} m</dd></div>
            <div><dt>Simulation time</dt><dd>{fmtClock(sim.tSeconds)}</dd></div>
          </dl>
        </section>

        <section className="sim__card">
          <h3 className="sim__h3">Parcel impact</h3>
          {!selected && <p className="sim__muted">Click a flooded parcel on the map.</p>}
          {selected && (
            <dl className="sim__metrics">
              <div><dt>Parcel</dt><dd>{selected.parcel_id}</dd></div>
              <div><dt>Flood status</dt><dd>{sel ? "AFFECTED" : "Not affected (yet)"}</dd></div>
              <div><dt>Demo elevation</dt><dd>{(sel?.elevationM ?? sim.elevation.at(selected.parcel_id)).toFixed(2)} m</dd></div>
              <div><dt>Estimated depth</dt><dd>{sel ? `${sel.depthM.toFixed(2)} m` : "0.00 m"}</dd></div>
              <div><dt>Impact level</dt><dd>{sel ? sel.impact : "—"}</dd></div>
              <div><dt>Land use</dt><dd>{selected.land_use ?? "—"}</dd></div>
              <div><dt>Building present</dt><dd>{buildingIds.has(selected.parcel_id) ? "Yes" : "No"}</dd></div>
              <div><dt>Road adjacent</dt><dd>Yes (grid)</dd></div>
              <div><dt>Encroachment</dt><dd>{selected.encroachment_status ?? "—"}{typeof selected.encroachment_area_sqm === "number" ? ` · ${selected.encroachment_area_sqm} m²` : ""}</dd></div>
              <div><dt>Simulation time</dt><dd>{fmtClock(sim.tSeconds)}</dd></div>
            </dl>
          )}
        </section>

        <p className="sim__foot">
          Simulated event over real parcel geometry + synthetic Land Twin attributes.
          Elevation, depths and impact levels are demonstration values, not survey or
          hydrological data.
        </p>
      </aside>
    </div>
  );
}
