import type { Mesh } from "./triangulate";
import { mlsRigidWeighted, type Pt } from "./mls";

export interface MeshHandle {
  vertex: number;
  to: Pt;
}

/** Geodesic distance from each source vertex to every vertex, via Dijkstra over the mesh edge graph
 *  (edge weight = Euclidean length). dist[s][v]; Infinity if unreachable. */
export function geodesicDistances(mesh: Mesh, sources: number[]): number[][] {
  const V = mesh.vertices.length;
  const adj: { to: number; w: number }[][] = Array.from({ length: V }, () => []);
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
  return sources.map((s) => dijkstra(adj, V, s));
}

function dijkstra(adj: { to: number; w: number }[][], V: number, src: number): number[] {
  const dist = new Array<number>(V).fill(Infinity);
  const done = new Array<boolean>(V).fill(false);
  dist[src] = 0;
  for (let iter = 0; iter < V; iter++) {
    let u = -1,
      best = Infinity;
    for (let i = 0; i < V; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1) break;
    done[u] = true;
    for (const e of adj[u]) {
      const nd = dist[u] + e.w;
      if (nd < dist[e.to]) dist[e.to] = nd;
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
): { from: Pt[]; weights: number[][] } {
  const dist = geodesicDistances(mesh, handleVertices);
  const from = handleVertices.map((v) => mesh.vertices[v]);
  const weights = mesh.vertices.map((_, v) =>
    handleVertices.map((_, h) => {
      const g = dist[h][v];
      return g === 0 ? Infinity : g === Infinity ? 0 : 1 / Math.pow(g, 2 * alpha);
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
