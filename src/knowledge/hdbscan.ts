/**
 * HDBSCAN clustering algorithm (Campello et al. 2013).
 *
 * Pure TypeScript implementation:
 * 1. Compute core distances
 * 2. Build mutual reachability graph
 * 3. Build minimum spanning tree (Prim's)
 * 4. Build cluster hierarchy (single-linkage dendrogram)
 * 5. Extract flat clusters (Excess of Mass method)
 */

import type { HdbscanOptions, HdbscanResult } from "./cluster-types.ts";

// ── Distance Helpers ─────────────────────────────────────────────────

/** Euclidean distance between two points. */
function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Compute full pairwise distance matrix. */
function computeDistanceMatrix(data: number[][]): Float64Array[] {
  const n = data.length;
  const matrix: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    matrix[i] = new Float64Array(n);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = euclidean(data[i]!, data[j]!);
      matrix[i]![j] = d;
      matrix[j]![i] = d;
    }
  }
  return matrix;
}

// ── Core Distances ───────────────────────────────────────────────────

/** Compute core distance for each point: distance to k-th nearest neighbor. */
function computeCoreDistances(
  distMatrix: Float64Array[],
  minSamples: number,
): Float64Array {
  const n = distMatrix.length;
  const coreDistances = new Float64Array(n);
  const k = Math.min(minSamples, n - 1);

  for (let i = 0; i < n; i++) {
    // Get distances from point i to all others, sort ascending
    const dists = Array.from(distMatrix[i]!).filter((_, j) => j !== i);
    dists.sort((a, b) => a - b);
    coreDistances[i] = dists[k - 1] ?? 0;
  }

  return coreDistances;
}

// ── Mutual Reachability ──────────────────────────────────────────────

/** Mutual reachability distance: max(core(a), core(b), dist(a,b)). */
function computeMutualReachability(
  distMatrix: Float64Array[],
  coreDistances: Float64Array,
): Float64Array[] {
  const n = distMatrix.length;
  const mrd: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    mrd[i] = new Float64Array(n);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.max(
        coreDistances[i]!,
        coreDistances[j]!,
        distMatrix[i]![j]!,
      );
      mrd[i]![j] = d;
      mrd[j]![i] = d;
    }
  }

  return mrd;
}

// ── Minimum Spanning Tree (Prim's) ──────────────────────────────────

type MstEdge = { from: number; to: number; weight: number };

/** Build MST using Prim's algorithm on the mutual reachability graph. */
function buildMst(mrd: Float64Array[]): MstEdge[] {
  const n = mrd.length;
  if (n <= 1) return [];

  const inMst = new Uint8Array(n);
  const minWeight = new Float64Array(n).fill(Infinity);
  const minFrom = new Int32Array(n).fill(-1);
  const edges: MstEdge[] = [];

  // Start from node 0
  inMst[0] = 1;
  for (let j = 1; j < n; j++) {
    minWeight[j] = mrd[0]![j]!;
    minFrom[j] = 0;
  }

  for (let iter = 0; iter < n - 1; iter++) {
    // Find minimum weight edge to a non-MST node
    let bestNode = -1;
    let bestWeight = Infinity;
    for (let j = 0; j < n; j++) {
      if (!inMst[j] && minWeight[j]! < bestWeight) {
        bestWeight = minWeight[j]!;
        bestNode = j;
      }
    }

    if (bestNode === -1) break; // Graph is disconnected

    inMst[bestNode] = 1;
    edges.push({ from: minFrom[bestNode]!, to: bestNode, weight: bestWeight });

    // Update minimum weights
    for (let j = 0; j < n; j++) {
      if (!inMst[j] && mrd[bestNode]![j]! < minWeight[j]!) {
        minWeight[j] = mrd[bestNode]![j]!;
        minFrom[j] = bestNode;
      }
    }
  }

  return edges;
}

// ── Cluster Hierarchy ────────────────────────────────────────────────

type HierarchyNode = {
  id: number;
  left: number;   // Child node ID (or point index if leaf)
  right: number;  // Child node ID (or point index if leaf)
  weight: number; // Merge distance
  size: number;   // Number of points
};

/** Union-Find data structure for building hierarchy. */
class UnionFind {
  parent: Int32Array;
  size: Int32Array;
  nextCluster: number;

  constructor(n: number) {
    this.parent = new Int32Array(n * 2);
    this.size = new Int32Array(n * 2);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.size[i] = 1;
    }
    this.nextCluster = n;
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root]!;
    }
    // Path compression
    while (this.parent[x] !== root) {
      const next = this.parent[x]!;
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(x: number, y: number, weight: number): HierarchyNode {
    const rootX = this.find(x);
    const rootY = this.find(y);
    const newCluster = this.nextCluster++;
    const sizeX = this.size[rootX]!;
    const sizeY = this.size[rootY]!;

    this.parent[rootX] = newCluster;
    this.parent[rootY] = newCluster;
    this.parent[newCluster] = newCluster;
    this.size[newCluster] = sizeX + sizeY;

    return {
      id: newCluster,
      left: rootX,
      right: rootY,
      weight,
      size: sizeX + sizeY,
    };
  }
}

/** Build single-linkage hierarchy from sorted MST edges. */
function buildHierarchy(edges: MstEdge[], n: number): HierarchyNode[] {
  const sortedEdges = [...edges].sort((a, b) => a.weight - b.weight);
  const uf = new UnionFind(n);
  const hierarchy: HierarchyNode[] = [];

  for (const edge of sortedEdges) {
    const rootA = uf.find(edge.from);
    const rootB = uf.find(edge.to);
    if (rootA !== rootB) {
      hierarchy.push(uf.union(rootA, rootB, edge.weight));
    }
  }

  return hierarchy;
}

// ── Cluster Extraction (Excess of Mass) ──────────────────────────────

type CondensedNode = {
  parent: number;
  child: number;
  lambdaVal: number; // 1/distance at which this split occurs
  childSize: number;
};

/** Condense the hierarchy tree: remove spurious splits below minClusterSize. */
function condenseTree(
  hierarchy: HierarchyNode[],
  n: number,
  minClusterSize: number,
): CondensedNode[] {
  const condensed: CondensedNode[] = [];

  // Build a map from node ID to its children and weight
  const nodeChildren = new Map<number, { left: number; right: number; weight: number; size: number }>();
  for (const h of hierarchy) {
    nodeChildren.set(h.id, { left: h.left, right: h.right, weight: h.weight, size: h.size });
  }

  // Track which nodes are "cluster nodes" vs "leaf nodes"
  const rootNode = hierarchy.length > 0 ? hierarchy[hierarchy.length - 1]!.id : 0;

  // BFS to condense
  const relabel = new Map<number, number>();
  let nextLabel = 0;

  function getLabel(nodeId: number): number {
    if (!relabel.has(nodeId)) {
      relabel.set(nodeId, nextLabel++);
    }
    return relabel.get(nodeId)!;
  }

  // Walk the hierarchy from root, collapsing small splits
  function walk(nodeId: number, parentLabel: number, parentLambda: number): void {
    const node = nodeChildren.get(nodeId);
    if (!node) {
      // Leaf node (original point)
      condensed.push({
        parent: parentLabel,
        child: nodeId,
        lambdaVal: parentLambda,
        childSize: 1,
      });
      return;
    }

    const lambdaVal = node.weight > 0 ? 1 / node.weight : Infinity;
    const leftSize = getNodeSize(node.left);
    const rightSize = getNodeSize(node.right);

    if (leftSize >= minClusterSize && rightSize >= minClusterSize) {
      // Both children are large enough — this is a real split
      const leftLabel = getLabel(node.left);
      const rightLabel = getLabel(node.right);

      condensed.push({
        parent: parentLabel,
        child: leftLabel,
        lambdaVal,
        childSize: leftSize,
      });
      condensed.push({
        parent: parentLabel,
        child: rightLabel,
        lambdaVal,
        childSize: rightSize,
      });

      walk(node.left, leftLabel, lambdaVal);
      walk(node.right, rightLabel, lambdaVal);
    } else if (leftSize >= minClusterSize) {
      // Only left is large enough — right falls out as points
      fallOutPoints(node.right, parentLabel, lambdaVal);
      walk(node.left, parentLabel, lambdaVal);
    } else if (rightSize >= minClusterSize) {
      // Only right is large enough — left falls out as points
      fallOutPoints(node.left, parentLabel, lambdaVal);
      walk(node.right, parentLabel, lambdaVal);
    } else {
      // Neither is large enough — both fall out as points
      fallOutPoints(node.left, parentLabel, lambdaVal);
      fallOutPoints(node.right, parentLabel, lambdaVal);
    }
  }

  function getNodeSize(nodeId: number): number {
    const node = nodeChildren.get(nodeId);
    return node ? node.size : 1; // 1 for leaf points
  }

  function fallOutPoints(nodeId: number, parentLabel: number, lambdaVal: number): void {
    const node = nodeChildren.get(nodeId);
    if (!node) {
      // Single point
      condensed.push({
        parent: parentLabel,
        child: nodeId,
        lambdaVal,
        childSize: 1,
      });
      return;
    }
    fallOutPoints(node.left, parentLabel, lambdaVal);
    fallOutPoints(node.right, parentLabel, lambdaVal);
  }

  if (hierarchy.length > 0) {
    const rootLabel = getLabel(rootNode);
    walk(rootNode, rootLabel, 0);
  }

  return condensed;
}

/** Extract flat clusters using Excess of Mass (stability) method. */
function extractClusters(
  condensed: CondensedNode[],
  n: number,
  minClusterSize: number,
): { labels: number[]; probabilities: number[] } {
  if (condensed.length === 0) {
    return {
      labels: new Array(n).fill(-1),
      probabilities: new Array(n).fill(0),
    };
  }

  // Find all cluster nodes (non-leaf parents)
  const clusterNodes = new Set<number>();
  const clusterBirthLambda = new Map<number, number>();
  const clusterDeathLambda = new Map<number, number>();

  for (const node of condensed) {
    clusterNodes.add(node.parent);
    if (node.childSize > 1) {
      clusterNodes.add(node.child);
    }
  }

  // Compute birth lambda (when cluster first appears) and track points
  for (const node of condensed) {
    if (!clusterBirthLambda.has(node.child) && clusterNodes.has(node.child)) {
      clusterBirthLambda.set(node.child, node.lambdaVal);
    }
  }

  // Compute stability for each cluster
  // Stability = sum over points of (lambda_point - lambda_birth)
  const stability = new Map<number, number>();
  const clusterPoints = new Map<number, Array<{ point: number; lambdaVal: number }>>();

  for (const cluster of clusterNodes) {
    stability.set(cluster, 0);
    clusterPoints.set(cluster, []);
  }

  for (const node of condensed) {
    if (node.childSize === 1 && node.child < n) {
      // This is a point falling out of a cluster
      const birthLambda = clusterBirthLambda.get(node.parent) ?? 0;
      const pointLambda = node.lambdaVal;
      const contribution = pointLambda - birthLambda;
      if (contribution > 0) {
        stability.set(
          node.parent,
          (stability.get(node.parent) ?? 0) + contribution,
        );
      }
      clusterPoints.get(node.parent)?.push({ point: node.child, lambdaVal: pointLambda });
    }
  }

  // Build parent-child tree for clusters
  const clusterChildren = new Map<number, number[]>();
  for (const node of condensed) {
    if (node.childSize > 1 && clusterNodes.has(node.child)) {
      if (!clusterChildren.has(node.parent)) {
        clusterChildren.set(node.parent, []);
      }
      clusterChildren.get(node.parent)!.push(node.child);
    }
  }

  // Select clusters: bottom-up, compare stability of cluster vs sum of children
  const selected = new Set<number>();
  const isLeafCluster = new Map<number, boolean>();

  // Process from leaves up
  const toProcess = [...clusterNodes].sort((a, b) => b - a);

  for (const cluster of toProcess) {
    const children = clusterChildren.get(cluster) ?? [];
    if (children.length === 0) {
      // Leaf cluster — always selected initially
      isLeafCluster.set(cluster, true);
      selected.add(cluster);
    } else {
      // Internal cluster — compare stability
      const childStabilitySum = children.reduce(
        (sum, c) => sum + (stability.get(c) ?? 0),
        0,
      );
      const ownStability = stability.get(cluster) ?? 0;

      if (ownStability >= childStabilitySum) {
        // This cluster is more stable — select it, deselect children
        selected.add(cluster);
        for (const c of children) {
          deselect(c);
        }
        // Propagate stability up
        stability.set(cluster, ownStability);
      } else {
        // Children are more stable — propagate their stability up
        stability.set(cluster, childStabilitySum);
      }
    }
  }

  function deselect(cluster: number): void {
    selected.delete(cluster);
    for (const c of clusterChildren.get(cluster) ?? []) {
      deselect(c);
    }
  }

  // Remove root from selected if present (root is not a real cluster)
  // Root is the one with no parent in condensed, or the largest numbered node
  // Actually, keep it if it's the only one (all points in one cluster)

  // Assign labels
  const labels = new Array(n).fill(-1);
  const probabilities = new Array(n).fill(0);

  // Map selected clusters to sequential IDs
  const selectedList = [...selected];
  const clusterIdMap = new Map<number, number>();
  let nextId = 0;
  for (const s of selectedList) {
    clusterIdMap.set(s, nextId++);
  }

  // Assign each point to its closest selected ancestor cluster
  function assignPoints(cluster: number, assignTo: number | null): void {
    const effectiveCluster = selected.has(cluster) ? cluster : assignTo !== null ? assignTo : null;

    // Assign leaf points
    for (const { point, lambdaVal } of clusterPoints.get(cluster) ?? []) {
      if (effectiveCluster !== null && clusterIdMap.has(effectiveCluster)) {
        labels[point] = clusterIdMap.get(effectiveCluster)!;
        // Probability based on how long point survived in cluster
        const birthLambda = clusterBirthLambda.get(effectiveCluster) ?? 0;
        const maxLambda = getMaxLambda(effectiveCluster);
        if (maxLambda > birthLambda) {
          probabilities[point] = Math.min(
            1,
            (lambdaVal - birthLambda) / (maxLambda - birthLambda),
          );
        } else {
          probabilities[point] = 1;
        }
      }
    }

    // Recurse into child clusters
    for (const child of clusterChildren.get(cluster) ?? []) {
      const nextAssign = selected.has(child) ? child : effectiveCluster;
      assignPoints(child, nextAssign);
    }
  }

  function getMaxLambda(cluster: number): number {
    let maxL = 0;
    for (const { lambdaVal } of clusterPoints.get(cluster) ?? []) {
      if (lambdaVal > maxL) maxL = lambdaVal;
    }
    for (const child of clusterChildren.get(cluster) ?? []) {
      const childMax = getMaxLambda(child);
      if (childMax > maxL) maxL = childMax;
    }
    return maxL;
  }

  // Start assignment from root
  const allParents = new Set(condensed.map((c) => c.parent));
  const allChildren = new Set(
    condensed.filter((c) => c.childSize > 1).map((c) => c.child),
  );
  const roots = [...allParents].filter((p) => !allChildren.has(p));
  const root = roots.length > 0 ? roots[0]! : [...clusterNodes][0];

  if (root !== undefined) {
    assignPoints(root, selected.has(root) ? root : null);
  }

  // Filter: clusters with fewer than minClusterSize assigned points -> noise
  const clusterCounts = new Map<number, number>();
  for (const l of labels) {
    if (l >= 0) {
      clusterCounts.set(l, (clusterCounts.get(l) ?? 0) + 1);
    }
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) {
      const count = clusterCounts.get(labels[i]) ?? 0;
      if (count < minClusterSize) {
        labels[i] = -1;
        probabilities[i] = 0;
      }
    }
  }

  // Re-number clusters sequentially starting from 0
  const uniqueLabels = [...new Set(labels.filter((l) => l >= 0))].sort(
    (a, b) => a - b,
  );
  const renumber = new Map<number, number>();
  for (let i = 0; i < uniqueLabels.length; i++) {
    renumber.set(uniqueLabels[i]!, i);
  }
  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) {
      labels[i] = renumber.get(labels[i])!;
    }
  }

  return { labels, probabilities };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Run HDBSCAN clustering on a dataset.
 *
 * @param data - N points, each D-dimensional
 * @param opts - Algorithm configuration (minClusterSize, minSamples)
 * @returns Cluster labels (-1 = noise), probabilities, and cluster count
 */
export function hdbscan(data: number[][], opts: HdbscanOptions): HdbscanResult {
  const n = data.length;

  if (n === 0) {
    return { labels: [], probabilities: [], clusterCount: 0 };
  }

  if (n < opts.minClusterSize) {
    return {
      labels: new Array(n).fill(-1),
      probabilities: new Array(n).fill(0),
      clusterCount: 0,
    };
  }

  const minSamples = opts.minSamples ?? opts.minClusterSize;

  // Step 1: Compute pairwise distances
  const distMatrix = computeDistanceMatrix(data);

  // Step 2: Compute core distances
  const coreDistances = computeCoreDistances(distMatrix, minSamples);

  // Step 3: Compute mutual reachability distances
  const mrd = computeMutualReachability(distMatrix, coreDistances);

  // Step 4: Build MST
  const mst = buildMst(mrd);

  // Step 5: Build hierarchy
  const hierarchy = buildHierarchy(mst, n);

  // Step 6: Condense tree
  const condensed = condenseTree(hierarchy, n, opts.minClusterSize);

  // Step 7: Extract clusters
  const { labels, probabilities } = extractClusters(condensed, n, opts.minClusterSize);

  const clusterCount = new Set(labels.filter((l) => l >= 0)).size;

  return { labels, probabilities, clusterCount };
}
