import { describe, expect, test } from "bun:test";
import {
  CITATION_WINDOW_DAYS,
  POPULARITY_WEIGHTS,
  RECENCY_HALF_LIFE_DAYS,
  RECENCY_LAMBDA,
  computeCompositeScore,
} from "./wiki-popularity-config.ts";

describe("wiki popularity config", () => {
  test("exports the configured scoring constants", () => {
    expect(CITATION_WINDOW_DAYS).toBe(90);
    expect(RECENCY_HALF_LIFE_DAYS).toBe(90);
    expect(POPULARITY_WEIGHTS).toEqual({
      inboundLinks: 0.3,
      citationFrequency: 0.5,
      editRecency: 0.2,
    });
    expect(
      POPULARITY_WEIGHTS.inboundLinks +
        POPULARITY_WEIGHTS.citationFrequency +
        POPULARITY_WEIGHTS.editRecency,
    ).toBe(1);
    expect(RECENCY_LAMBDA).toBeCloseTo(Math.LN2 / 90, 10);
  });

  test("returns zero normalized link and citation scores when min equals max", () => {
    const result = computeCompositeScore({
      inboundLinks: 10,
      citationCount: 3,
      daysSinceEdit: 0,
      normalization: {
        minInboundLinks: 10,
        maxInboundLinks: 10,
        minCitationCount: 3,
        maxCitationCount: 3,
      },
    });

    expect(result.editRecencyScore).toBe(1);
    expect(result.compositeScore).toBeCloseTo(POPULARITY_WEIGHTS.editRecency, 10);
  });

  test("applies exponential recency decay at the configured half life", () => {
    const fresh = computeCompositeScore({
      inboundLinks: 5,
      citationCount: 10,
      daysSinceEdit: 0,
      normalization: {
        minInboundLinks: 0,
        maxInboundLinks: 10,
        minCitationCount: 0,
        maxCitationCount: 20,
      },
    });

    const halfLifeOld = computeCompositeScore({
      inboundLinks: 5,
      citationCount: 10,
      daysSinceEdit: RECENCY_HALF_LIFE_DAYS,
      normalization: {
        minInboundLinks: 0,
        maxInboundLinks: 10,
        minCitationCount: 0,
        maxCitationCount: 20,
      },
    });

    expect(fresh.editRecencyScore).toBe(1);
    expect(halfLifeOld.editRecencyScore).toBeCloseTo(0.5, 10);
    expect(halfLifeOld.compositeScore).toBeLessThan(fresh.compositeScore);
  });

  test("combines normalized link, citation, and recency signals with configured weights", () => {
    const result = computeCompositeScore({
      inboundLinks: 40,
      citationCount: 15,
      daysSinceEdit: 30,
      normalization: {
        minInboundLinks: 10,
        maxInboundLinks: 70,
        minCitationCount: 5,
        maxCitationCount: 25,
      },
    });

    const normalizedLinks = (40 - 10) / (70 - 10);
    const normalizedCitations = (15 - 5) / (25 - 5);
    const expectedRecency = Math.exp(-RECENCY_LAMBDA * 30);
    const expectedComposite =
      POPULARITY_WEIGHTS.inboundLinks * normalizedLinks +
      POPULARITY_WEIGHTS.citationFrequency * normalizedCitations +
      POPULARITY_WEIGHTS.editRecency * expectedRecency;

    expect(result.editRecencyScore).toBeCloseTo(expectedRecency, 10);
    expect(result.compositeScore).toBeCloseTo(expectedComposite, 10);
  });
});
