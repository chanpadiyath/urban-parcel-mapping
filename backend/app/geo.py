"""Planar-geometry helpers for small polygons (local metric projection)."""

import math

DEG2RAD = math.pi / 180
SQFT_PER_SQM = 10.76391

Ring = list[list[float]]


def js_round(x: float) -> int:
    """JavaScript Math.round semantics (half rounds up), unlike Python's banker's rounding."""
    return math.floor(x + 0.5)


def round_to(x: float, digits: int) -> float:
    f = 10**digits
    return js_round(x * f) / f


def ring_of(geom: dict | None) -> Ring:
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return geom["coordinates"][0] if geom["coordinates"] else []
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"][0][0] if geom["coordinates"] else []
    return []


def bbox_of_ring(ring: Ring) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_center(geom: dict) -> tuple[float, float]:
    """Centre of the geometry's bounding box (any coordinate nesting)."""
    xs: list[float] = []
    ys: list[float] = []

    def visit(c):
        if isinstance(c, list) and c and isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        elif isinstance(c, list):
            for i in c:
                visit(i)

    visit(geom["coordinates"])
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def centroid_of(ring: Ring) -> tuple[float, float]:
    if not ring:
        return 0.0, 0.0
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def point_in_ring(pt: tuple[float, float], ring: Ring) -> bool:
    px, py = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > py) != (yj > py) and px < ((xj - xi) * (py - yi)) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def scale_at(lat: float) -> tuple[float, float]:
    """Metres per degree (kx for longitude, ky for latitude) at a latitude."""
    return 111320 * math.cos(lat * DEG2RAD), 110540.0


def area_m2(ring: Ring) -> float:
    if len(ring) < 4:
        return 0.0
    kx, ky = scale_at(centroid_of(ring)[1])
    a = 0.0
    j = len(ring) - 1
    for i in range(len(ring)):
        a += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky)
        j = i
    return abs(a) / 2


def dist_point_seg_m(p, a, b, kx: float, ky: float) -> float:
    ax, ay, bx, by = a[0] * kx, a[1] * ky, b[0] * kx, b[1] * ky
    px, py = p[0] * kx, p[1] * ky
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy or 1.0
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / len2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))
