import { useMemo, useState } from "react";
import SimMap from "../components/SimMap";
import type { BuildingCollection, ParcelCollection, ParcelProperties } from "../types";
import { useServerSim } from "../sim/useServerSim";
import { useParcelElevations } from "../sim/useParcelElevations";
import { useWeather } from "../sim/useWeather";
import { EMPTY_IMPACT, fmtClock, IMPACT_GUIDANCE, type ImpactLevel } from "../sim/flood";

const IMPACT_LEVELS: ImpactLevel[] = ["Low", "Moderate", "High", "Severe"];
const OUTLOOK_DOT: Record<string, string> = { Low: "dot--ok", Elevated: "dot--warn", High: "dot--bad" };

interface Props {
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  center: [number, number];
  zoom: number;
}

export default function SimulationPage({ parcels, buildings, center, zoom }: Props) {
  const server = useServerSim();
  const elevations = useParcelElevations();
  const weather = useWeather(center[1], center[0]);
  const [selected, setSelected] = useState<ParcelProperties | null>(null);

  // The simulation runs in the backend; this page only displays and controls it.
  const online = server.connected && server.snapshot != null && server.impact != null;
  const snap = online ? server.snapshot! : null;

  const status = snap?.status ?? "idle";
  const tSeconds = snap?.simTimeSec ?? 0;
  const speed = snap?.speed ?? 1;
  const waterLevelM = snap?.waterLevelM ?? 0;
  const maxLevel = snap?.maxLevelM ?? 0;
  const impact = online ? server.impact! : EMPTY_IMPACT;
  const { start, pause, reset, cycleSpeed, bumpLevel } = server;

  const buildingIds = useMemo(
    () => new Set(buildings.features.map((f) => String(f.properties.parcel_id))),
    [buildings],
  );

  const i = impact;
  const statusLabel = !online ? "OFFLINE" : status === "running" ? "ACTIVE" : status === "paused" ? "PAUSED" : "IDLE";
  const sel = selected ? impact.perParcel.get(selected.parcel_id) : undefined;
  const progress = Math.min(1, waterLevelM / (maxLevel || 1));
  const selElev = sel?.elevationM ?? elevations?.[selected?.parcel_id ?? ""];
  const elevSource = snap?.elevSource;
  const isRealElevation = !!elevSource;

  return (
    <div className="sim">
      <div className="sim__main">
        <div className="sim__banner">
          SIMULATION / DEMO MODE — the flood <em>event</em> (the rising water level) is a
          deterministic simulation, not hydrology, rising over{" "}
          {isRealElevation ? <>a <strong>real elevation surface</strong> ({elevSource})</> : "a real elevation surface"}.{" "}
          {online
            ? "State is served live by the simulation backend (SSE)."
            : "The simulation backend is not reachable — start it with `npm run dev` from the project root."}
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
            <span className={"dot " + (online ? "dot--ok" : "dot--warn")} />
            {online ? "LIVE · simulation backend" : "OFFLINE · waiting for the backend"}
            {snap ? ` · ${new Date(snap.updatedAt).toLocaleTimeString()}` : ""}
          </div>
          <div className="sim__controls">
            {status !== "running"
              ? <button className="btn" onClick={start} disabled={!online}>▶ Start</button>
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
          <div className="sim__card-head">
            <h3 className="sim__h3">Real weather <span className="sim__tag">real data · Open-Meteo</span></h3>
          </div>
          {weather.loading && <p className="sim__muted">Loading current conditions…</p>}
          {weather.error && <p className="sim__muted">Weather unavailable ({weather.error}).</p>}
          {weather.data && (
            <>
              <dl className="sim__metrics">
                <div><dt>Now</dt><dd>{weather.data.current.temperatureC.toFixed(0)}°C · {weather.data.current.precipitationMm.toFixed(1)} mm precip</dd></div>
                <div><dt>Today's rain outlook</dt><dd><span className={"dot " + (OUTLOOK_DOT[weather.data.outlook] ?? "")} /> {weather.data.outlook}</dd></div>
                {weather.data.daily.slice(0, 3).map((d) => (
                  <div key={d.date}><dt>{d.date}</dt><dd>{d.precipitationSumMm.toFixed(1)} mm · {d.precipitationProbabilityMaxPct}% chance</dd></div>
                ))}
              </dl>
              <p className="sim__foot">
                Real current + forecast precipitation for this location — context to read the simulation
                against, not an input to it. The flood <em>event</em> below is still a fixed-rate timer,
                not a rainfall/hydrology model.
              </p>
            </>
          )}
        </section>

        <section className="sim__card">
          <h3 className="sim__h3">How this works</h3>
          <p className="sim__foot" style={{ marginTop: 0 }}>
            The water level rises at a fixed rate over {isRealElevation ? "real elevation data" : "a synthesised elevation surface"}.
            A parcel is "affected" once the level exceeds its ground elevation; depth = water level − elevation.
            This is a depth-threshold simulation, not a hydrological or rainfall model.
          </p>
          <dl className="sim__metrics">
            {IMPACT_LEVELS.map((lvl) => (
              <div key={lvl}>
                <dt>{lvl} <span className="sim__muted">({IMPACT_GUIDANCE[lvl].depthRange})</span></dt>
                <dd>{IMPACT_GUIDANCE[lvl].guidance}</dd>
              </div>
            ))}
          </dl>
          <p className="sim__foot">
            Illustrative guidance only — not an official hazard assessment. For real flood risk and
            emergency decisions, consult your local municipal or disaster-management authority.
          </p>
        </section>

        <section className="sim__card">
          <h3 className="sim__h3">Impact analytics <span className="sim__tag">{online ? "server · approx" : "offline"}</span></h3>
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
              <div><dt>{isRealElevation ? "Elevation (real)" : "Elevation"}</dt><dd>{selElev != null ? `${selElev.toFixed(2)} m` : "—"}</dd></div>
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
          {online
            ? "Simulation state is maintained by a real server process and streamed over SSE; every connected client sees the same run. The flood model itself is a demonstration, not survey or hydrological data."
            : "The flood simulation runs in the backend, which is not reachable right now. Start it (npm run dev from the project root) to see impact numbers."}
        </p>
      </aside>
    </div>
  );
}
