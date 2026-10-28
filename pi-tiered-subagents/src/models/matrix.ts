/** Pure documentation generation through the public router, never a second policy. */
import type { Model } from "@earendil-works/pi-ai";
import { SHIPPED_DEFINITIONS } from "#src/agents/shipped";
import type { ModelCandidate } from "#src/models/profiles";
import { SHIPPED_PROFILES } from "#src/models/profiles";
import { routeModel } from "#src/models/router";
import { SHIPPED_STRATEGIES, strategiesByFamily } from "#src/models/strategy";

export type ModelMatrixRegion = Readonly<{
  name: string;
  markdown: string;
}>;

/** Router inputs here are identities only; generation never calls a provider. */
function identity(candidate: ModelCandidate): Model<"openai-completions"> {
  return { ...candidate, name: candidate.id } as Model<"openai-completions">;
}

function key(candidate: ModelCandidate): string {
  return `${candidate.provider}/${candidate.id}`;
}

function code(value: string): string {
  return `\`${value}\``;
}

function table(headers: string[], rows: string[][]): string {
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

/** Every concrete parent × every shipped role, with explicit availability sets. */
export function generateModelMatrix(): ModelMatrixRegion[] {
  const roles = SHIPPED_DEFINITIONS.map((definition) => definition.id);
  const profiles = new Map(
    SHIPPED_PROFILES.map((profile) => [profile.family, profile]),
  );
  const strategies = strategiesByFamily(SHIPPED_STRATEGIES);
  // Synthetic future versions exercise the same ladder without a release catalogue.
  const samples = SHIPPED_PROFILES.map((profile) => {
    const strategy = strategies.get(profile.family);
    if (!strategy) throw new Error(`No strategy for ${profile.family}`);
    return {
      profile,
      parents: profile.tiers.map((tier) => ({
        tier,
        candidate: {
          provider: "example",
          id: strategy.construct("97.2", tier.tier),
        },
      })),
    };
  });
  const all = samples.flatMap(({ parents }) =>
    parents.map(({ candidate }) => identity(candidate)),
  );

  function outcome(
    parent: ModelCandidate,
    role: string,
    available: typeof all,
  ): string {
    const result = routeModel(
      identity(parent),
      { profiles, strategies, available },
      role,
    );
    return result.kind === "retained"
      ? "**retain**"
      : code(`${result.provider}/${result.modelId}`);
  }

  const representatives = samples.map(({ profile, parents }) => {
    const parent = parents[0]?.candidate;
    if (!parent)
      throw new Error(`No representative parent for ${profile.family}`);
    return { family: profile.family, parent };
  });
  const grid = table(
    ["Agent", ...SHIPPED_PROFILES.map((profile) => profile.family)],
    roles.map((role) => [
      code(role),
      ...representatives.map(({ parent }) => outcome(parent, role, all)),
    ]),
  );
  const gridParents = table(
    ["Family", "Representative parent (all candidates available)"],
    representatives.map(({ family, parent }) => [family, code(key(parent))]),
  );

  const full = samples
    .map(({ profile, parents }) => {
      const otherVersions = all.map((model) => ({
        ...model,
        id: model.id.replace("97.2", "96.2").replace("97-2", "96-2"),
      }));
      const rows = parents.flatMap(({ tier, candidate: parent }) =>
        roles.map((role) => [
          code(key(parent)),
          `97.2 / ${tier.tier || "(default)"} (${tier.size ?? tier.class})`,
          code(role),
          outcome(parent, role, all),
          outcome(parent, role, otherVersions),
          outcome(parent, role, []),
        ]),
      );
      return `### ${profile.family} — ${profile.group}\n\n${table(
        [
          "Parent model",
          "Version / rung (size or class)",
          "Agent",
          "All available",
          "Other versions only",
          "None available",
        ],
        rows,
      )}`;
    })
    .join("\n\n");

  return [
    { name: "grid", markdown: `${grid}\n\n${gridParents}` },
    { name: "full", markdown: full },
  ];
}
