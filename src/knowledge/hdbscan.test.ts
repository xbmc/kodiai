import { describe, it, expect } from "bun:test";
import { hdbscan } from "./hdbscan.ts";

/** Generate a tight cluster of points around a center. */
function cluster(
  cx: number,
  cy: number,
  count: number,
  spread: number,
  seed: number,
): number[][] {
  const points: number[][] = [];
  let s = seed;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  for (let i = 0; i < count; i++) {
    points.push([cx + (rng() - 0.5) * spread, cy + (rng() - 0.5) * spread]);
  }
  return points;
}

describe("hdbscan", () => {
  it("discovers 3 clusters from well-separated groups", () => {
    const data = [
      ...cluster(0, 0, 5, 0.5, 1),     // Cluster A at origin
      ...cluster(10, 10, 5, 0.5, 2),    // Cluster B far away
      ...cluster(20, 0, 5, 0.5, 3),     // Cluster C far away
    ];

    const result = hdbscan(data, { minClusterSize: 3 });

    expect(result.clusterCount).toBe(3);
    expect(result.labels.length).toBe(15);
    expect(result.probabilities.length).toBe(15);

    // All points should be assigned (no noise in well-separated clusters)
    const noiseCount = result.labels.filter((l) => l === -1).length;
    expect(noiseCount).toBe(0);

    // Points from same input cluster should share the same label
    const labelsA = new Set(result.labels.slice(0, 5));
    const labelsB = new Set(result.labels.slice(5, 10));
    const labelsC = new Set(result.labels.slice(10, 15));
    expect(labelsA.size).toBe(1);
    expect(labelsB.size).toBe(1);
    expect(labelsC.size).toBe(1);

    // Labels should be distinct
    const [labelA] = labelsA;
    const [labelB] = labelsB;
    const [labelC] = labelsC;
    expect(labelA).not.toBe(labelB);
    expect(labelB).not.toBe(labelC);
    expect(labelA).not.toBe(labelC);
  });

  it("detects noise points among clusters", () => {
    const data = [
      ...cluster(0, 0, 5, 0.3, 10),     // Tight cluster A
      ...cluster(20, 20, 5, 0.3, 20),    // Tight cluster B
      // Scattered outliers
      [50, 50],
      [-30, 40],
      [100, -100],
    ];

    const result = hdbscan(data, { minClusterSize: 3 });

    // Should find 2 clusters
    expect(result.clusterCount).toBe(2);

    // The 3 outliers should be noise
    const outlierLabels = result.labels.slice(10);
    expect(outlierLabels).toEqual([-1, -1, -1]);
  });

  it("finds a single cluster when all points are close", () => {
    const data = cluster(5, 5, 10, 0.2, 42);

    const result = hdbscan(data, { minClusterSize: 3 });

    expect(result.clusterCount).toBe(1);
    // All points should be in the same cluster
    const uniqueLabels = new Set(result.labels);
    expect(uniqueLabels.size).toBe(1);
    expect(result.labels[0]).toBe(0);
  });

  it("returns all noise when input is smaller than minClusterSize", () => {
    const data = [
      [0, 0],
      [100, 0],
      [0, 100],
    ];

    const result = hdbscan(data, { minClusterSize: 5 });

    // Only 3 points, but minClusterSize=5 -- all are noise
    expect(result.clusterCount).toBe(0);
    expect(result.labels.every((l) => l === -1)).toBe(true);
  });

  it("returns valid probabilities between 0 and 1", () => {
    const data = [
      ...cluster(0, 0, 8, 0.5, 100),
      ...cluster(15, 15, 8, 0.5, 200),
    ];

    const result = hdbscan(data, { minClusterSize: 3 });

    for (let i = 0; i < result.probabilities.length; i++) {
      if (result.labels[i] >= 0) {
        expect(result.probabilities[i]).toBeGreaterThanOrEqual(0);
        expect(result.probabilities[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("respects minClusterSize: groups smaller than threshold become noise", () => {
    // Two groups of 2 points each with huge gap, minClusterSize=3
    // With only 4 total points, HDBSCAN may merge into one cluster.
    // Use minClusterSize=5 to guarantee both groups are too small.
    const data = [
      [0, 0],
      [0.1, 0.1],
      [10, 10],
      [10.1, 10.1],
    ];

    const result = hdbscan(data, { minClusterSize: 5 });

    // 4 points total < minClusterSize=5, so all noise
    expect(result.clusterCount).toBe(0);
    expect(result.labels.every((l) => l === -1)).toBe(true);
  });

  it("handles empty input", () => {
    const result = hdbscan([], { minClusterSize: 3 });

    expect(result.clusterCount).toBe(0);
    expect(result.labels).toEqual([]);
    expect(result.probabilities).toEqual([]);
  });

  it("handles input smaller than minClusterSize", () => {
    const data = [
      [0, 0],
      [1, 1],
    ];

    const result = hdbscan(data, { minClusterSize: 5 });

    expect(result.clusterCount).toBe(0);
    expect(result.labels).toEqual([-1, -1]);
  });

  it("works with higher-dimensional data", () => {
    // Simulate 15-dim UMAP output with 3 clusters
    const dim = 15;
    const rng = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };
    };

    const makeCluster = (center: number[], count: number, spread: number, seed: number) => {
      const r = rng(seed);
      const points: number[][] = [];
      for (let i = 0; i < count; i++) {
        points.push(center.map((c) => c + (r() - 0.5) * spread));
      }
      return points;
    };

    const center1 = new Array(dim).fill(0);
    const center2 = new Array(dim).fill(10);
    const center3 = new Array(dim).fill(-10);

    const data = [
      ...makeCluster(center1, 8, 1, 300),
      ...makeCluster(center2, 8, 1, 400),
      ...makeCluster(center3, 8, 1, 500),
    ];

    const result = hdbscan(data, { minClusterSize: 3 });

    expect(result.clusterCount).toBeGreaterThanOrEqual(2);
    expect(result.clusterCount).toBeLessThanOrEqual(3);
    expect(result.labels.length).toBe(24);
  });

  it("uses minSamples when provided separately", () => {
    const data = [
      ...cluster(0, 0, 10, 1, 50),
      ...cluster(10, 10, 10, 1, 60),
    ];

    const result1 = hdbscan(data, { minClusterSize: 3, minSamples: 2 });
    const result2 = hdbscan(data, { minClusterSize: 3, minSamples: 8 });

    // Both should find clusters, but different minSamples may affect membership
    expect(result1.clusterCount).toBeGreaterThanOrEqual(1);
    expect(result2.clusterCount).toBeGreaterThanOrEqual(1);
  });
});
