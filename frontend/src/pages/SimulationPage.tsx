import { useEffect, useMemo, useRef, useState } from "react";
import SimMap, { type SimBasemap } from "../components/SimMap";
import type { BuildingCollection, ParcelCollection, ParcelProperties, ViewMode } from "../types";
import type { RoadCollection } from "../data/roads";
import { useServerSim } from "../sim/useServerSim";
import { useWeather } from "../sim/useWeather";
import { useWhatIf } from "../sim/useWhatIf";
import { EMPTY_IMPACT, fmtClock, IMPACT_GUIDANCE, type ImpactLevel } from "../sim/flood";

const IMPACT_LEVELS: ImpactLevel[] = ["Low", "Moderate", "High", "Severe"];
const OUTLOOK_DOT: Record<string, string> = { Low: "dot--ok", Elevated: "dot--warn", High: "dot--bad" };

const BASEMAP_OPTIONS: Array<[SimBasemap, string]> = [["map", "Map"], ["satellite", "Satellite"], ["drone", "Drone"]];

const PLINTH_OPTIONS = [0, 0.3, 0.5, 1.0];
const REDUCTION_OPTIONS: Array<[number, string]> = [
  [0, "None"],
  [0.15, "Minor drainage"],
  [0.3, "Retention basin"],
];

interface Props {
  parcels: ParcelCollection;
  buildings: BuildingCollection;
  roads?: RoadCollection;
  center: [number, number];
  zoom: number;
}

export default function SimulationPage({ parcels, buildings, roads, center, zoom }: Props) {
  const server = useServerSim();
  const weather = useWeather(center[1], center[0]);
  const [selected, setSelected] = useState<ParcelProperties | null>(null);
  const [plinthRaiseM, setPlinthRaiseM] = useState(0);
  const [levelReductionM, setLevelReductionM] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [basemap, setBasemap] = useState<SimBasemap>("map");
  const [droneImageUrl, setDroneImageUrl] = useState<string | null>(null);
  const [showTerrain, setShowTerrain] = useState(false);
  const droneImageUrlRef = useRef<string | null>(null);
  droneImageUrlRef.current = droneImageUrl;

  useEffect(() => {
    // revoke the object URL on unmount so the blob isn't kept alive
    return () => { if (droneImageUrlRef.current) URL.revokeObjectURL(droneImageUrlRef.current); };
  }, []);

  const handleDroneUpload = (file: File | undefined) => {
    if (!file) return;
    if (droneImageUrlRef.current) URL.revokeObjectURL(droneImageUrlRef.current);
    setDroneImageUrl(URL.createObjectURL(file));
    setBasemap("drone");
  };

  useEffect(() => {
    setPlinthRaiseM(0);
    setLevelReductionM(0);
  }, [selected?.parcel_id]);

  const whatIf = useWhatIf(selected?.parcel_id ?? null, plinthRaiseM, levelReductionM);

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
  const progress = Math.min(1, waterLevelM / (maxLevel || 1));
  const elevSource = snap?.elevSource;
  const isRealElevation = !!elevSource;
  const elevPercentile =
    whatIf.data && snap && snap.elevMax > snap.elevMin
      ? Math.round(((whatIf.data.elevationM - snap.elevMin) / (snap.elevMax - snap.elevMin)) * 100)
      : null;

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
            buildings={buildings}
            roads={roads}
            center={center}
            zoom={zoom}
            impact={impact}
            selectedId={selected?.parcel_id ?? null}
            viewMode={viewMode}
            basemap={basemap}
            droneImageUrl={droneImageUrl}
            showTerrain={showTerrain}
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
          <h3 className="sim__h3">View</h3>
          <p className="sim__muted" style={{ margin: "0 0 6px" }}>Camera</p>
          <div className="seg">
            <button type="button" className={"seg__btn" + (viewMode === "2d" ? " is-active" : "")} onClick={() => setViewMode("2d")}>2D</button>
            <button type="button" className={"seg__btn" + (viewMode === "3d" ? " is-active" : "")} onClick={() => setViewMode("3d")}>3D</button>
          </div>
          <p className="sim__muted" style={{ margin: "10px 0 6px" }}>Basemap</p>
          <div className="seg">
            {BASEMAP_OPTIONS.map(([id, label]) => {
              const disabled = id === "drone" && !droneImageUrl;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  title={disabled ? "Unavailable — no drone imagery uploaded yet" : undefined}
                  className={"seg__btn" + (basemap === id ? " is-active" : "")}
                  onClick={() => setBasemap(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="sim__muted" style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 0 0", cursor: "pointer" }}>
            <input type="checkbox" checked={showTerrain} onChange={(e) => setShowTerrain(e.target.checked)} />
            Terrain shading <span className="sim__tag">real elevation</span>
          </label>
          <p className="sim__foot" style={{ padding: "6px 0 0" }}>
            Real topographic relief from the same free, keyless elevation-tile source (Mapzen/
            Tilezen) behind this page's flood model — not drone imagery, but a genuine
            topographical view while none exists yet.
          </p>
          <label className="sim__muted" style={{ display: "block", margin: "10px 0 4px" }}>
            Upload drone photo/orthophoto (optional)
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleDroneUpload(e.target.files?.[0])}
          />
          <p className="sim__foot">
            Placed over this area's bounding box as a rough overlay — not orthorectified or
            precisely georeferenced. No real drone imagery has been captured for this project yet;
            this is the seam it will drop into once it has.
          </p>
        </section>

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
          <h3 className="sim__h3">Parcel impact <span className="sim__tag">why it's vulnerable</span></h3>
          {!selected && <p className="sim__muted">Click a parcel on the map.</p>}
          {selected && whatIf.loading && !whatIf.data && <p className="sim__muted">Loading…</p>}
          {selected && whatIf.error && <p className="sim__muted">Unavailable ({whatIf.error}).</p>}
          {selected && whatIf.data && (
            <>
              <dl className="sim__metrics">
                <div><dt>Parcel</dt><dd>{selected.parcel_id}</dd></div>
                <div><dt>{isRealElevation ? "Elevation (real)" : "Elevation"}</dt><dd>{whatIf.data.elevationM.toFixed(2)} m</dd></div>
                {elevPercentile != null && (
                  <div><dt>Relative ground level</dt><dd>Lower than {elevPercentile}% of parcels here</dd></div>
                )}
                <div>
                  <dt>Nearest road</dt>
                  <dd>
                    {whatIf.data.road.distanceM != null
                      ? `${whatIf.data.road.name ?? "Unnamed road"} · ${whatIf.data.road.distanceM.toFixed(0)} m`
                      : "Data unavailable"}
                  </dd>
                </div>
                <div><dt>Land use</dt><dd>{selected.land_use ?? "—"}</dd></div>
                <div><dt>Building present</dt><dd>{buildingIds.has(selected.parcel_id) ? "Yes" : "No"}</dd></div>
                <div><dt>Encroachment</dt><dd>{selected.encroachment_status ?? "—"}{typeof selected.encroachment_area_sqm === "number" ? ` · ${selected.encroachment_area_sqm} m²` : ""}</dd></div>
                <div><dt>Current depth</dt><dd>{whatIf.data.baseline.depthM.toFixed(2)} m</dd></div>
                <div><dt>Current impact</dt><dd>{whatIf.data.baseline.impact}</dd></div>
              </dl>

              <h3 className="sim__h3" style={{ marginTop: 16 }}>What-if: reduce flood risk</h3>
              <p className="sim__muted" style={{ margin: "0 0 6px" }}>Raise plinth (real recalculation)</p>
              <div className="seg">
                {PLINTH_OPTIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={"seg__btn" + (plinthRaiseM === v ? " is-active" : "")}
                    onClick={() => setPlinthRaiseM(v)}
                  >
                    {v === 0 ? "None" : `+${v} m`}
                  </button>
                ))}
              </div>
              <p className="sim__muted" style={{ margin: "10px 0 6px" }}>Drainage / retention (assumed reduction)</p>
              <div className="seg">
                {REDUCTION_OPTIONS.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    className={"seg__btn" + (levelReductionM === v ? " is-active" : "")}
                    onClick={() => setLevelReductionM(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {whatIf.data.baseline.impact === "None" ? (
                <p className="sim__muted" style={{ marginTop: 10 }}>
                  Not currently flooded at this water level — bump the water level above to test
                  interventions against an active flood.
                </p>
              ) : (
                <dl className="sim__metrics" style={{ marginTop: 10 }}>
                  <div><dt>Scenario depth</dt><dd>{whatIf.data.scenario.depthM.toFixed(2)} m</dd></div>
                  <div><dt>Scenario impact</dt><dd>{whatIf.data.scenario.impact}</dd></div>
                  <div><dt>Depth reduced by</dt><dd>{whatIf.data.deltaDepthM.toFixed(2)} m</dd></div>
                </dl>
              )}
              <p className="sim__foot">
                Raising the plinth recomputes real depth from real elevation. The drainage/retention
                figure is an assumed local water-level reduction you chose — illustrative, not a
                drainage-network or hydraulic simulation.
              </p>
            </>
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
