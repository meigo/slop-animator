import type { Mesh } from "./triangulate";
import { mlsRigidWeighted, type Pt } from "./mls";

export interface MeshHandle {
  vertex: number;
  to: Pt;
}

/** The mesh's edge graph (edge weight = Euclidean length), for `geodesicFrom`. Build it once per
 *  mesh: a pose asks for one source at a time, as handles are added. */
export type MeshAdjacency = { to: number; w: number }[][];

export function meshAdjacency(mesh: Mesh): MeshAdjacency {
  const V = mesh.vertices.length;
  const adj: MeshAdjacency = Array.from({ length: V }, () => []);
  const seen = new Set<number>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? a * V + b : b * V + a;
    if (seen.has(key)) return;
    seen.add(key);
    const w = Math.hypot(
      mesh.vertices[a].x - mesh.vertices[b].x,
      mesh.vertices[a].y - mesh.vertices[b].y,
    );
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
  };
  for (const [a, b, c] of mesh.triangles) {
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return adj;
}

/** Geodesic distance from each source vertex to every vertex, via Dijkstra over the mesh edge graph
 *  (edge weight = Euclidean length). dist[s][v]; Infinity if unreachable. */
export function geodesicDistances(mesh: Mesh, sources: number[]): number[][] {
  const adj = meshAdjacency(mesh);
  return sources.map((s) => geodesicFrom(adj, s));
}

/**
 * Dijkstra from one vertex, with a binary heap. It was a linear scan for the nearest unvisited
 * vertex — O(V²) — and ran for every handle on every Pencil event of a reach-nub drag: measured
 * 62 ms an event for 3 handles on 1600×1000 content at the default spacing, over a second at the
 * densest (2026-09-30 review). Stale heap entries are skipped rather than decreased.
 */
export function geodesicFrom(adj: MeshAdjacency, src: number): number[] {
  const V = adj.length;
  const dist = new Array<number>(V).fill(Infinity);
  if (src < 0 || src >= V) return dist;
  dist[src] = 0;
  const hd: number[] = [0]; // heap of distances…
  const hv: number[] = [src]; // …and their vertices
  const swap = (i: number, j: number) => {
    [hd[i], hd[j]] = [hd[j], hd[i]];
    [hv[i], hv[j]] = [hv[j], hv[i]];
  };
  while (hd.length) {
    const d = hd[0];
    const u = hv[0];
    const lastD = hd.pop()!;
    const lastV = hv.pop()!;
    if (hd.length) {
      hd[0] = lastD;
      hv[0] = lastV;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < hd.length && hd[l] < hd[m]) m = l;
        if (r < hd.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        swap(i, m);
        i = m;
      }
    }
    if (d > dist[u]) continue; // stale entry
    for (const e of adj[u]) {
      const nd = d + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        hd.push(nd);
        hv.push(e.to);
        for (let i = hd.length - 1; i > 0; ) {
          const p = (i - 1) >> 1;
          if (hd[p] <= hd[i]) break;
          swap(i, p);
          i = p;
        }
      }
    }
  }
  return dist;
}

/** Geodesic MLS weights for a fixed handle set (cacheable; depends on mesh + handle vertices, not
 *  targets). weights[vertex][handle]; Infinity at a handle's own vertex; 0 if unreachable. */
export function poseWeights(
  mesh: Mesh,
  handleVertices: number[],
  alpha = 1,
  reaches?: (number | undefined)[],
  /** Each handle's distance row, when the caller already has them (they do not depend on reach). */
  distances?: number[][],
): { from: Pt[]; weights: number[][] } {
  const dist = distances ?? geodesicDistances(mesh, handleVertices);
  const from = handleVertices.map((v) => mesh.vertices[v]);
  const weights = mesh.vertices.map((_, v) =>
    handleVertices.map((_, h) => {
      const g = dist[h][v];
      if (g === 0) return Infinity;
      if (g === Infinity) return 0;
      let w = 1 / Math.pow(g, 2 * alpha);
      const R = reaches?.[h];
      if (R != null && R > 0) {
        if (g >= R) return 0;
        const t = g / R; // smooth compact window: 1 at g=0 → 0 at g=R
        const win = 1 - t * t;
        w *= win * win;
      }
      return w;
    }),
  );
  return { from, weights };
}

/** Deform a mesh's vertices from vertex-anchored handles, weighting by geodesic distance. Pure. */
export function deformMeshGeodesic(mesh: Mesh, handles: MeshHandle[], alpha = 1): Pt[] {
  if (handles.length === 0) return mesh.vertices.map((v) => ({ x: v.x, y: v.y }));
  const { from, weights } = poseWeights(
    mesh,
    handles.map((h) => h.vertex),
    alpha,
  );
  return mlsRigidWeighted(
    mesh.vertices,
    from,
    handles.map((h) => h.to),
    weights,
  );
}
