/**
 * Authoritative flood simulation engine (server-side).
 *
 * The maths mirrors src/sim/flood.ts (kept deliberately simple and in sync):
 * a synthesised demo elevation surface + a rising water level, with impact
 * counts derived from the real parcel geometry / attributes. This is a
 * SIMULATION — not a hydrological model — but the state it produces is real,
 * shared, and advanced by a real server timer.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GRID_COLS = 12;
const TICK_MS = 500;
const RISE_RATE_M_PER_S = 0.05;
const SPEEDS = [1, 2, 5];
const CRITICAL_USES = new Set(["Institutional", "Public/Semi-Public"]);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function seqOf(id) {
  const m = String(id).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}
function polygonCentroidBBox(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] > maxY) maxY = c[1];
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  visit(geom.coordinates);
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}
function impactFromDepth(d) {
  if (d < 0.3) return "Low";
  if (d < 1) return "Moderate";
  if (d < 2) return "High";
  return "Severe";
}

export class FloodEngine {
  constructor(parcelsPath, buildingsPath) {
    const parcels = JSON.parse(readFileSync(parcelsPath, "utf8"));
    const buildings = JSON.parse(readFileSync(buildingsPath, "utf8"));
    this.buildingParcelIds = new Set(buildings.features.map((f) => String(f.properties.parcel_id)));

    // parcel table + demo elevation surface
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rows = parcels.features.map((f) => {
      const [x, y] = polygonCentroidBBox(f.geometry);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      return {
        id: String(f.properties.parcel_id),
        x, y,
        areaSqm: typeof f.properties.area_sqm === "number" ? f.properties.area_sqm : 0,
        landUse: String(f.properties.land_use ?? ""),
      };
    });
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    let eMin = Infinity, eMax = -Infinity;
    for (const r of rows) {
      const u = (r.x - minX) / spanX;
      const v = (r.y - minY) / spanY;
      const slope = 0.55 * u + 0.55 * (1 - v);
      const noise = 0.12 * Math.sin(u * 9.1) * Math.cos(v * 7.3) + 0.06 * Math.sin(seqOf(r.id) * 1.7);
      r.elev = clamp(0.3 + 6.2 * (slope + noise), 0.2, 6.5);
      eMin = Math.min(eMin, r.elev);
      eMax = Math.max(eMax, r.elev);
    }
    this.rows = rows;
    this.totalArea = rows.reduce((s, r) => s + r.areaSqm, 0);
    this.elevMin = eMin;
    this.elevMax = eMax;
    this.baseLevel = eMin - 0.25;
    this.maxLevel = eMax + 1;

    this.status = "idle";
    this.simTimeSec = 0;
    this.speed = 1;
    this.levelOffsetM = 0;
    this.startedAt = null;
    this._timer = null;
    this._listeners = new Set();
  }

  get waterLevelM() {
    const raw = this.baseLevel + RISE_RATE_M_PER_S * this.simTimeSec + this.levelOffsetM;
    return Math.max(0, Math.min(this.maxLevel, raw));
  }

  computeImpact() {
    const level = Math.round(this.waterLevelM * 20) / 20;
    const perParcel = {};
    const ids = [];
    const rowsHit = new Set();
    const colsHit = new Set();
    let area = 0, critical = 0, buildings = 0, maxDepth = 0;
    for (const r of this.rows) {
      const depth = level - r.elev;
      if (depth > 0) {
        ids.push(r.id);
        perParcel[r.id] = {
          depthM: Math.round(depth * 100) / 100,
          elevationM: Math.round(r.elev * 100) / 100,
          impact: impactFromDepth(depth),
        };
        area += r.areaSqm;
        if (depth > maxDepth) maxDepth = depth;
        if (CRITICAL_USES.has(r.landUse)) critical += 1;
        if (this.buildingParcelIds.has(r.id)) buildings += 1;
        const s = seqOf(r.id) - 1;
        if (s >= 0) { rowsHit.add(Math.floor(s / GRID_COLS)); colsHit.add(s % GRID_COLS); }
      }
    }
    return {
      parcelIds: ids,
      perParcel,
      affectedParcels: ids.length,
      affectedBuildings: buildings,
      affectedRoadsApprox: rowsHit.size + colsHit.size,
      affectedAreaSqm: Math.round(area),
      affectedAreaPct: this.totalArea > 0 ? (area / this.totalArea) * 100 : 0,
      criticalInfrastructure: critical,
      maxDepthM: Math.round(maxDepth * 100) / 100,
    };
  }

  snapshot() {
    return {
      source: "server",
      status: this.status,
      simTimeSec: Math.round(this.simTimeSec * 10) / 10,
      speed: this.speed,
      waterLevelM: Math.round(this.waterLevelM * 100) / 100,
      levelOffsetM: Math.round(this.levelOffsetM * 100) / 100,
      elevMin: Math.round(this.elevMin * 100) / 100,
      elevMax: Math.round(this.elevMax * 100) / 100,
      maxLevelM: Math.round(this.maxLevel * 100) / 100,
      totalParcels: this.rows.length,
      totalAreaSqm: Math.round(this.totalArea),
      updatedAt: Date.now(),
      impact: this.computeImpact(),
    };
  }

  // --- control ---
  start() { if (this.status !== "running") { this.status = "running"; this.startedAt = Date.now(); this._ensureTimer(); this._broadcast(); } }
  pause() { if (this.status === "running") { this.status = "paused"; this._broadcast(); } }
  reset() { this.status = "idle"; this.simTimeSec = 0; this.levelOffsetM = 0; this._broadcast(); }
  setSpeed(v) { if (SPEEDS.includes(Number(v))) { this.speed = Number(v); this._broadcast(); } }
  cycleSpeed() { this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]; this._broadcast(); }
  bumpLevel(deltaM) {
    const d = Number(deltaM);
    if (Number.isFinite(d)) {
      this.levelOffsetM = clamp(this.levelOffsetM + d, -this.baseLevel, this.maxLevel);
      this._broadcast();
    }
  }

  _ensureTimer() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      if (this.status !== "running") return;
      this.simTimeSec += (TICK_MS / 1000) * this.speed;
      if (this.baseLevel + RISE_RATE_M_PER_S * this.simTimeSec + this.levelOffsetM >= this.maxLevel) {
        this.status = "paused";
      }
      this._broadcast();
    }, TICK_MS);
    this._timer.unref?.();
  }

  // --- SSE listener registry ---
  addListener(fn) { this._listeners.add(fn); fn(this.snapshot()); return () => this._listeners.delete(fn); }
  _broadcast() {
    const snap = this.snapshot();
    for (const fn of this._listeners) { try { fn(snap); } catch { /* drop dead client */ } }
  }
  get listenerCount() { return this._listeners.size; }

  dispose() { if (this._timer) clearInterval(this._timer); this._timer = null; this._listeners.clear(); }
}

export function createEngine() {
  const pub = resolve(__dirname, "../public");
  return new FloodEngine(resolve(pub, "demo-parcels.geojson"), resolve(pub, "demo-buildings.geojson"));
}
