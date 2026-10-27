/**
 * profiles.ts — The family profiles this package ships.
 *
 * Each profile is data: the versions a family has, the tiers of each version in
 * capability order, the concrete model ids of each tier, and the rungs a tier
 * may fall back to. Nothing here is code, so an operator can correct a
 * ladder — or replace a family wholesale — without touching the runtime.
 *
 * The ladders are written against the model catalogue the installed SDK ships,
 * which is a representative registry and not a promise of vendor availability:
 * a tier whose model the session cannot run is skipped, and the walk continues
 * down the ladder. The capability order within a version follows the
 * catalogue's own price order, which is the only ordering the registry
 * states; an operator with better information can rewrite it.
 *
 * A version's default model — the one whose id names no tier of its own — is
 * the tier with the empty name.
 *
 * The fallbacks are the only way a version is ever crossed. They are written
 * on the rung that may cross, because the tiers of two versions are not
 * comparable by name: one version's cheapest line may be dearer than
 * another's.
 */

import type { FamilyProfile, ModelCandidate } from "#src/models/profile";

/** A model of the given provider. */
function model(provider: string, id: string): ModelCandidate {
  return { provider, id };
}

/**
 * The shipped profiles.
 *
 * Legacy labels are explicit too: Claude fable is L; GPT's unnamed default
 * line is M. Non-flash flagships (Gemini argon, MiniMax's unnamed and
 * highspeed lines, and MiMo's unnamed line) are planners. Flash-lite remains
 * its own worker rung rather than being folded into flash.
 *
 * Ordered by family, so a reader can find one; the order carries no meaning.
 */
export const SHIPPED_PROFILES: readonly FamilyProfile[] = [
  {
    family: "gpt",
    group: "size",
    versions: [
      {
        version: "6.1",
        tiers: [
          {
            tier: "sol",
            size: "L",
            models: [model("openai", "gpt-6.1-sol")],
            // The 6.1 line has one rung, so the walk crosses into 6 — an
            // approved link, and the only one this profile declares.
            fallbacks: [{ version: "6", tier: "luna" }],
          },
        ],
      },
      {
        version: "6",
        tiers: [
          {
            tier: "astra",
            size: "L",
            models: [model("openai", "gpt-6-astra")],
            fallbacks: [{ version: "5.6", tier: "sol" }],
          },
          {
            tier: "sol",
            size: "L",
            models: [model("openai", "gpt-6-sol")],
            fallbacks: [{ version: "5.6", tier: "sol" }],
          },
          {
            tier: "luna",
            size: "M",
            models: [model("openai", "gpt-6-luna")],
            fallbacks: [{ version: "5.6", tier: "luna" }],
          },
        ],
      },
      {
        version: "5.6",
        tiers: [
          { tier: "sol", size: "L", models: [model("openai", "gpt-5.6-sol")] },
          {
            tier: "terra",
            size: "M",
            models: [model("openai", "gpt-5.6-terra")],
          },
          {
            tier: "luna",
            size: "M",
            models: [model("openai", "gpt-5.6-luna")],
          },
        ],
      },
      {
        version: "5.5",
        tiers: [
          { tier: "pro", size: "M", models: [model("openai", "gpt-5.5-pro")] },
          { tier: "", size: "M", models: [model("openai", "gpt-5.5")] },
        ],
      },
      {
        version: "5.4",
        tiers: [
          { tier: "pro", size: "M", models: [model("openai", "gpt-5.4-pro")] },
          { tier: "", size: "M", models: [model("openai", "gpt-5.4")] },
          {
            tier: "mini",
            size: "S",
            models: [model("openai", "gpt-5.4-mini")],
          },
          {
            tier: "nano",
            size: "S",
            models: [model("openai", "gpt-5.4-nano")],
          },
        ],
      },
    ],
  },
  {
    family: "claude",
    group: "size",
    versions: [
      {
        version: "5.5",
        tiers: [
          {
            tier: "opus",
            size: "L",
            models: [model("anthropic", "claude-opus-5-5")],
          },
          {
            tier: "sonnet",
            size: "M",
            models: [model("anthropic", "claude-sonnet-5-5")],
          },
          {
            tier: "haiku",
            size: "S",
            models: [model("anthropic", "claude-haiku-5-5")],
          },
        ],
      },
      {
        version: "5",
        tiers: [
          {
            tier: "fable",
            size: "L",
            models: [model("anthropic", "claude-fable-5")],
          },
          {
            tier: "opus",
            size: "L",
            models: [model("anthropic", "claude-opus-5")],
          },
          {
            tier: "sonnet",
            size: "M",
            models: [model("anthropic", "claude-sonnet-5")],
          },
        ],
      },
      {
        version: "4.8",
        tiers: [
          {
            tier: "opus",
            size: "L",
            models: [model("anthropic", "claude-opus-4-8")],
          },
        ],
      },
      {
        version: "4.7",
        tiers: [
          {
            tier: "opus",
            size: "L",
            models: [model("anthropic", "claude-opus-4-7")],
          },
        ],
      },
      {
        version: "4.6",
        tiers: [
          {
            tier: "opus",
            size: "L",
            models: [model("anthropic", "claude-opus-4-6")],
          },
          {
            tier: "sonnet",
            size: "M",
            models: [model("anthropic", "claude-sonnet-4-6")],
          },
        ],
      },
      {
        version: "4.5",
        tiers: [
          {
            tier: "opus",
            size: "L",
            models: [
              model("anthropic", "claude-opus-4-5"),
              model("anthropic", "claude-opus-4-5-20251101"),
            ],
          },
          {
            tier: "sonnet",
            size: "M",
            models: [
              model("anthropic", "claude-sonnet-4-5"),
              model("anthropic", "claude-sonnet-4-5-20250929"),
            ],
          },
          {
            tier: "haiku",
            size: "S",
            models: [
              model("anthropic", "claude-haiku-4-5"),
              model("anthropic", "claude-haiku-4-5-20251001"),
            ],
          },
        ],
      },
    ],
  },
  {
    family: "gemini",
    group: "planner-worker",
    versions: [
      {
        version: "4",
        tiers: [
          {
            tier: "argon",
            class: "planner",
            models: [model("google", "gemini-4-argon")],
          },
        ],
      },
      {
        version: "3.8",
        tiers: [
          {
            tier: "flash",
            class: "worker",
            models: [model("google", "gemini-3.8-flash")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
        ],
      },
      {
        version: "3.7",
        tiers: [
          {
            tier: "flash",
            class: "worker",
            models: [model("google", "gemini-3.7-flash")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
        ],
      },
      {
        version: "3.6",
        tiers: [
          {
            tier: "flash",
            class: "worker",
            models: [model("google", "gemini-3.6-flash")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
        ],
      },
      {
        version: "3.5",
        tiers: [
          {
            tier: "flash",
            class: "worker",
            models: [model("google", "gemini-3.5-flash")],
          },
          {
            tier: "flash-lite",
            class: "worker",
            models: [model("google", "gemini-3.5-flash-lite")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
        ],
      },
      {
        version: "3.1",
        tiers: [
          {
            tier: "pro-preview",
            class: "planner",
            models: [model("google", "gemini-3.1-pro-preview")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
          {
            tier: "flash-lite",
            class: "worker",
            models: [model("google", "gemini-3.1-flash-lite")],
          },
        ],
      },
      {
        version: "2.5",
        tiers: [
          {
            tier: "pro",
            class: "planner",
            models: [model("google", "gemini-2.5-pro")],
          },
          {
            tier: "flash",
            class: "worker",
            models: [model("google", "gemini-2.5-flash")],
          },
          {
            tier: "flash-lite",
            class: "worker",
            models: [model("google", "gemini-2.5-flash-lite")],
          },
        ],
      },
    ],
  },
  {
    family: "glm",
    group: "planner-worker",
    versions: [
      {
        version: "5.3",
        tiers: [
          {
            tier: "",
            class: "planner",
            models: [
              model("zai", "glm-5.3"),
              model("opencode", "glm-5.3"),
              model("radius", "glm-5.3"),
            ],
          },
          {
            tier: "flash",
            class: "worker",
            models: [
              model("zai", "glm-5.3-flash"),
              model("opencode", "glm-5.3-flash"),
              model("radius", "glm-5.3-flash"),
            ],
          },
        ],
      },
    ],
  },
  {
    family: "minimax",
    group: "planner-worker",
    versions: [
      {
        // The 3.1 release is explicit issue data, ahead of this SDK catalogue.
        version: "3.1",
        tiers: [
          {
            tier: "",
            class: "planner",
            models: [model("minimax", "MiniMax-M3.1")],
          },
          {
            tier: "flash",
            class: "worker",
            models: [model("minimax", "MiniMax-M3.1-flash")],
          },
        ],
      },
      {
        version: "3",
        tiers: [
          {
            tier: "",
            class: "planner",
            models: [model("minimax", "MiniMax-M3")],
            fallbacks: [
              { version: "3.1", tier: "flash" },
              { version: "2.7", tier: "" },
            ],
          },
        ],
      },
      {
        version: "2.7",
        tiers: [
          {
            tier: "highspeed",
            class: "planner",
            models: [model("minimax", "MiniMax-M2.7-highspeed")],
            fallbacks: [{ version: "3.1", tier: "flash" }],
          },
          {
            tier: "",
            class: "planner",
            models: [model("minimax", "MiniMax-M2.7")],
            fallbacks: [{ version: "3.1", tier: "flash" }],
          },
        ],
      },
    ],
  },
  {
    family: "qwen",
    group: "size",
    versions: [
      {
        version: "3.7",
        tiers: [
          {
            tier: "max",
            size: "L",
            models: [model("qwen-token-plan", "qwen3.7-max")],
            fallbacks: [
              { version: "3.6", tier: "plus" },
              { version: "3.6", tier: "flash" },
            ],
          },
          {
            tier: "plus",
            size: "M",
            models: [model("qwen-token-plan", "qwen3.7-plus")],
            fallbacks: [{ version: "3.6", tier: "flash" }],
          },
        ],
      },
      {
        version: "3.6",
        tiers: [
          {
            tier: "plus",
            size: "M",
            models: [model("qwen-token-plan", "qwen3.6-plus")],
          },
          {
            tier: "flash",
            size: "S",
            models: [model("qwen-token-plan", "qwen3.6-flash")],
          },
        ],
      },
    ],
  },
  {
    family: "deepseek",
    group: "planner-worker",
    versions: [
      {
        version: "4",
        tiers: [
          {
            tier: "pro",
            class: "planner",
            models: [model("deepseek", "deepseek-v4-pro")],
          },
        ],
      },
    ],
  },
  {
    family: "mimo",
    group: "planner-worker",
    versions: [
      {
        version: "2.6",
        tiers: [
          {
            tier: "pro-ultraspeed",
            class: "planner",
            models: [model("xiaomi", "mimo-v2.6-pro-ultraspeed")],
          },
          {
            tier: "pro",
            class: "planner",
            models: [model("xiaomi", "mimo-v2.6-pro")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
          {
            tier: "flash",
            class: "worker",
            models: [model("xiaomi", "mimo-v2.6-flash")],
          },
        ],
      },
      {
        version: "2.5",
        tiers: [
          {
            tier: "pro-ultraspeed",
            class: "planner",
            models: [model("xiaomi", "mimo-v2.5-pro-ultraspeed")],
          },
          {
            tier: "pro",
            class: "planner",
            models: [model("xiaomi", "mimo-v2.5-pro")],
          },
          {
            tier: "",
            class: "planner",
            models: [model("xiaomi", "mimo-v2.5")],
          },
        ],
      },
    ],
  },
];
