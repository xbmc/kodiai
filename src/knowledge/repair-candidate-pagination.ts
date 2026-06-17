export type RepairCandidatePredicateInput = {
  afterId: number | null;
  targetModel: string;
  idColumn?: string;
  embeddingColumn?: string;
  embeddingModelColumn?: string;
  staleColumn?: string;
  extraPredicates?: string[];
};

export type RepairCandidatePredicate = {
  text: string;
  params: Array<string | number>;
};

export function buildRepairCandidatePredicate(input: RepairCandidatePredicateInput): RepairCandidatePredicate {
  const params: Array<string | number> = [input.targetModel];
  const embeddingColumn = input.embeddingColumn ?? "embedding";
  const embeddingModelColumn = input.embeddingModelColumn ?? "embedding_model";
  const stalePredicate = input.staleColumn ? ` OR ${input.staleColumn} = true` : "";
  const predicates = [
    ...(input.extraPredicates ?? []),
    `(${embeddingColumn} IS NULL${stalePredicate} OR ${embeddingModelColumn} IS DISTINCT FROM $1)`,
  ];

  if (input.afterId != null) {
    params.push(input.afterId);
    predicates.push(`${input.idColumn ?? "id"} > $${params.length}::bigint`);
  }

  return {
    text: predicates.join(" AND "),
    params,
  };
}
