import { useMemo, useState } from "react";
import SimMap from "../components/SimMap";
import type { BuildingCollection, ParcelCollection, ParcelProperties } from "../types";
import { useFloodSim } from "../sim/useFloodSim";
import { useServerSim } from "../sim/useServerSim";
import { fmtClock } from "../sim/flood";

interface Props {
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  center: [number, number];
  zoom: number;
}

export default function SimulationPage({ parcels, buildings, center, zoom }: Props) {
  const local = useFloodSim(parcels, buildings);
  const server = useServerSim();
  const [selected, setSelected] = useState<ParcelProperties | null>(null);

  const onServer = server.connected && server.snapshot != null && server.impact != null;

  // unified view model
  const status = onServer ? server.snapshot!.status : local.status;
  const tSeconds = onServer ? server.snapshot!.simTimeSec : local.tSeconds;
  const speed = onServer ? server.snapshot!.speed : local.speed;
  const waterLevelM = onServer ? server.snapshot!.waterLevelM : local.waterLevelM;
  const maxLevel = onServer ? server.snapshot!.maxLevelM : local.elevation.maxM + 1;
  const impact = onServer ? server.impact! : local.impact;

  const start = onServer ? server.start : local.start;
  const pause = onServer ? server.pause : local.pause;
  const reset = onServer ? server.reset : local.reset;
  const cycleSpeed = onServer ? server.cycleSpeed : local.cycleSpeed;
  const bumpLevel = onServer ? server.bumpLevel : local.bumpLevel;

  const buildingIds = useMemo(
    () => new Set(buildings.features.map((f) => String(f.properties.parcel_id))),
    [buildings],
  );

  const i = impact;
  const statusLabel = status === "running" ? "ACTIVE" : status === "paused" ? "PAUSED" : "IDLE";
  const sel = selected ? impact.perParcel.get(selected.parcel_id) : undefined;
  const progress = Math.min(1, waterLevelM / (maxLevel || 1));
  const selElev = sel?.elevationM ?? local.elevation.at(selected?.parcel_id ?? "");

  return (
    <div className="sim">
      <div className="sim__main">
        <div className="sim__banner">
          SIMULATION / DEMO MODE — the flood <em>event</em> is a deterministic model over a
          synthesised elevation surface (not hydrology).{" "}
          {onServer
            ? "State is served live by the simulation backend (SSE)."
            : "Backend not reachable — running the client-side fallback engine."}
        </div>
        <div className="sim__map">
          <SimMap
            parcels={parcels}
            center={center}
            zoom={zoom}
            impact={impact}
            selectedId={selected?.parcel_id ?? null}
            onSelect={setSelected}
          />
        </div>
        <div className="sim__timeline">
          <div className="sim__tl-track"><div className="sim__tl-fill" style={{ width: `${progress * 100}%` }} /></div>
          <div className="sim__tl-labels">
            <span>t {fmtClock(tSeconds)}</span>
            <span>water {waterLevelM.toFixed(2)} m</span>
            <span>max {maxLevel.toFixed(1)} m</span>
          </div>
        </div>
      </div>

      <aside className="sim__side">
        <section className="sim__card">
          <div className="sim__card-head">
            <h2>Flood simulation</h2>
            <span className={"sim__status sim__status--" + status}>{statusLabel}</span>
          </div>
          <div className="sim__engine">
            <span className={"dot " + (onServer ? "dot--ok" : "dot--warn")} />
            {onServer ? "LIVE · simulation backend" : "LOCAL · client-side fallback"}
            {onServer && server.snapshot ? ` · ${new Date(server.snapshot.updatedAt).toLocaleTimeString()}` : ""}
          </div>
          <div className="sim__controls">
            {status !== "running"
              ? <button className="btn" onClick={start}>▶ Start</button>
              : <button className="btn" onClick={pause}>❚❚ Pause</button>}
            <button className="btn btn--ghost" onClick={reset}>⟲ Reset</button>
            <button className="btn btn--ghost" onClick={cycleSpeed}>Speed ×{speed}</button>
          </div>
          <div className="sim__controls">
            <button className="btn btn--ghost" onClick={() => bumpLevel(0.25)}>+ Water level</button>
            <button className="btn btn--ghost" onClick={() => bumpLevel(-0.25)}>− Water level</button>
          </div>
        </section>

        <section className="sim__card">
          <h3 className="sim__h3">Impact analytics <span className="sim__tag">{onServer ? "server · approx" : "approx · demo"}</span></h3>
          <dl className="sim__metrics">
            <div><dt>Water level</dt><dd>{waterLevelM.toFixed(2)} m</dd></div>
            <div><dt>Affected parcels</dt><dd>{i.affectedParcels}</dd></div>
            <div><dt>Affected buildings</dt><dd>{i.affectedBuildings}</dd></div>
            <div><dt>Affected roads</dt><dd>{i.affectedRoadsApprox}</dd></div>
            <div><dt>Affected area</dt><dd>{(i.affectedAreaSqm / 1e4).toFixed(2)} ha</dd></div>
            <div><dt>Area share</dt><dd>{i.affectedAreaPct.toFixed(1)}%</dd></div>
            <div><dt>Critical infrastructure</dt><dd>{i.criticalInfrastructure}</dd></div>
            <div><dt>Max depth</dt><dd>{i.maxDepthM.toFixed(2)} m</dd></div>
            <div><dt>Simulation time</dt><dd>{fmtClock(tSeconds)}</dd></div>
          </dl>
        </section>

        <section className="sim__card">
          <h3 className="sim__h3">Parcel impact</h3>
          {!selected && <p className="sim__muted">Click a flooded parcel on the map.</p>}
          {selected && (
            <dl className="sim__metrics">
              <div><dt>Parcel</dt><dd>{selected.parcel_id}</dd></div>
              <div><dt>Flood status</dt><dd>{sel ? "AFFECTED" : "Not affected (yet)"}</dd></div>
              <div><dt>Demo elevation</dt><dd>{Number.isFinite(selElev) ? `${selElev.toFixed(2)} m` : "—"}</dd></div>
              <div><dt>Estimated depth</dt><dd>{sel ? `${sel.depthM.toFixed(2)} m` : "0.00 m"}</dd></div>
              <div><dt>Impact level</dt><dd>{sel ? sel.impact : "—"}</dd></div>
              <div><dt>Land use</dt><dd>{selected.land_use ?? "—"}</dd></div>
              <div><dt>Building present</dt><dd>{buildingIds.has(selected.parcel_id) ? "Yes" : "No"}</dd></div>
              <div><dt>Road adjacent</dt><dd>Yes (grid)</dd></div>
              <div><dt>Encroachment</dt><dd>{selected.encroachment_status ?? "—"}{typeof selected.encroachment_area_sqm === "number" ? ` · ${selected.encroachment_area_sqm} m²` : ""}</dd></div>
              <div><dt>Simulation time</dt><dd>{fmtClock(tSeconds)}</dd></div>
            </dl>
          )}
        </section>

        <p className="sim__foot">
          {onServer
            ? "Simulation state is maintained by a real server process and streamed over SSE; every connected client sees the same run. The flood model itself is a demonstration, not survey or hydrological data."
            : "Running the in-browser fallback engine. Start the backend (npm run server) for shared, server-authoritative state."}
        </p>
      </aside>
    </div>
  );
}
