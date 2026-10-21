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
 * Ordered by family, so a reader can find one; the order carries no meaning.
 */
export const SHIPPED_PROFILES: readonly FamilyProfile[] = [
  {
    family: "gpt",
    versions: [
      {
        version: "6.1",
        tiers: [
          {
            tier: "sol",
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
            models: [model("openai", "gpt-6-astra")],
            fallbacks: [{ version: "5.6", tier: "sol" }],
          },
          {
            tier: "sol",
            models: [model("openai", "gpt-6-sol")],
            fallbacks: [{ version: "5.6", tier: "sol" }],
          },
          {
            tier: "luna",
            models: [model("openai", "gpt-6-luna")],
            fallbacks: [{ version: "5.6", tier: "luna" }],
          },
        ],
      },
      {
        version: "5.6",
        tiers: [
          { tier: "sol", models: [model("openai", "gpt-5.6-sol")] },
          { tier: "terra", models: [model("openai", "gpt-5.6-terra")] },
          { tier: "luna", models: [model("openai", "gpt-5.6-luna")] },
        ],
      },
      {
        version: "5.5",
        tiers: [
          { tier: "pro", models: [model("openai", "gpt-5.5-pro")] },
          { tier: "", models: [model("openai", "gpt-5.5")] },
        ],
      },
      {
        version: "5.4",
        tiers: [
          { tier: "pro", models: [model("openai", "gpt-5.4-pro")] },
          { tier: "", models: [model("openai", "gpt-5.4")] },
          { tier: "mini", models: [model("openai", "gpt-5.4-mini")] },
          { tier: "nano", models: [model("openai", "gpt-5.4-nano")] },
        ],
      },
    ],
  },
  {
    family: "claude",
    versions: [
      {
        version: "5.5",
        tiers: [
          { tier: "opus", models: [model("anthropic", "claude-opus-5-5")] },
          { tier: "sonnet", models: [model("anthropic", "claude-sonnet-5-5")] },
          { tier: "haiku", models: [model("anthropic", "claude-haiku-5-5")] },
        ],
      },
      {
        version: "5",
        tiers: [
          { tier: "fable", models: [model("anthropic", "claude-fable-5")] },
          { tier: "opus", models: [model("anthropic", "claude-opus-5")] },
          { tier: "sonnet", models: [model("anthropic", "claude-sonnet-5")] },
        ],
      },
      {
        version: "4.8",
        tiers: [
          { tier: "opus", models: [model("anthropic", "claude-opus-4-8")] },
        ],
      },
      {
        version: "4.7",
        tiers: [
          { tier: "opus", models: [model("anthropic", "claude-opus-4-7")] },
        ],
      },
      {
        version: "4.6",
        tiers: [
          { tier: "opus", models: [model("anthropic", "claude-opus-4-6")] },
          { tier: "sonnet", models: [model("anthropic", "claude-sonnet-4-6")] },
        ],
      },
      {
        version: "4.5",
        tiers: [
          {
            tier: "opus",
            models: [
              model("anthropic", "claude-opus-4-5"),
              model("anthropic", "claude-opus-4-5-20251101"),
            ],
          },
          {
            tier: "sonnet",
            models: [
              model("anthropic", "claude-sonnet-4-5"),
              model("anthropic", "claude-sonnet-4-5-20250929"),
            ],
          },
          {
            tier: "haiku",
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
    versions: [
      {
        version: "4",
        tiers: [{ tier: "argon", models: [model("google", "gemini-4-argon")] }],
      },
      {
        version: "3.8",
        tiers: [
          { tier: "flash", models: [model("google", "gemini-3.8-flash")] },
        ],
      },
      {
        version: "3.7",
        tiers: [
          { tier: "flash", models: [model("google", "gemini-3.7-flash")] },
        ],
      },
      {
        version: "3.6",
        tiers: [
          { tier: "flash", models: [model("google", "gemini-3.6-flash")] },
        ],
      },
      {
        version: "3.5",
        tiers: [
          { tier: "flash", models: [model("google", "gemini-3.5-flash")] },
          {
            tier: "flash-lite",
            models: [model("google", "gemini-3.5-flash-lite")],
          },
        ],
      },
      {
        version: "3.1",
        tiers: [
          {
            tier: "pro-preview",
            models: [model("google", "gemini-3.1-pro-preview")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
          {
            tier: "flash-lite",
            models: [model("google", "gemini-3.1-flash-lite")],
          },
        ],
      },
      {
        version: "2.5",
        tiers: [
          { tier: "pro", models: [model("google", "gemini-2.5-pro")] },
          { tier: "flash", models: [model("google", "gemini-2.5-flash")] },
          {
            tier: "flash-lite",
            models: [model("google", "gemini-2.5-flash-lite")],
          },
        ],
      },
    ],
  },
  {
    family: "kimi",
    versions: [
      {
        version: "3",
        tiers: [
          {
            tier: "",
            models: [model("moonshotai", "kimi-k3")],
            fallbacks: [{ version: "2.7", tier: "code" }],
          },
        ],
      },
      {
        version: "2.7",
        tiers: [
          {
            tier: "code",
            models: [
              model("moonshotai", "kimi-k2.7-code"),
              model("moonshotai", "kimi-k2.7-code-highspeed"),
            ],
            fallbacks: [{ version: "2.6", tier: "" }],
          },
        ],
      },
      {
        version: "2.6",
        tiers: [{ tier: "", models: [model("moonshotai", "kimi-k2.6")] }],
      },
    ],
  },
  {
    family: "minimax",
    versions: [
      {
        version: "3",
        tiers: [
          {
            tier: "",
            models: [model("minimax", "MiniMax-M3")],
            fallbacks: [{ version: "2.7", tier: "" }],
          },
        ],
      },
      {
        version: "2.7",
        tiers: [
          {
            tier: "highspeed",
            models: [model("minimax", "MiniMax-M2.7-highspeed")],
          },
          { tier: "", models: [model("minimax", "MiniMax-M2.7")] },
        ],
      },
    ],
  },
  {
    family: "qwen",
    versions: [
      {
        version: "3.7",
        tiers: [
          {
            tier: "max",
            models: [model("qwen-token-plan", "qwen3.7-max")],
            fallbacks: [{ version: "3.6", tier: "plus" }],
          },
          { tier: "plus", models: [model("qwen-token-plan", "qwen3.7-plus")] },
        ],
      },
      {
        version: "3.6",
        tiers: [
          { tier: "plus", models: [model("qwen-token-plan", "qwen3.6-plus")] },
          {
            tier: "flash",
            models: [model("qwen-token-plan", "qwen3.6-flash")],
          },
        ],
      },
    ],
  },
  {
    family: "deepseek",
    versions: [
      {
        version: "4",
        tiers: [
          { tier: "pro", models: [model("deepseek", "deepseek-v4-pro")] },
        ],
      },
    ],
  },
  {
    family: "mimo",
    versions: [
      {
        version: "2.6",
        tiers: [
          {
            tier: "pro-ultraspeed",
            models: [model("xiaomi", "mimo-v2.6-pro-ultraspeed")],
          },
          {
            tier: "pro",
            models: [model("xiaomi", "mimo-v2.6-pro")],
            fallbacks: [{ version: "2.5", tier: "pro" }],
          },
          { tier: "flash", models: [model("xiaomi", "mimo-v2.6-flash")] },
        ],
      },
      {
        version: "2.5",
        tiers: [
          {
            tier: "pro-ultraspeed",
            models: [model("xiaomi", "mimo-v2.5-pro-ultraspeed")],
          },
          { tier: "pro", models: [model("xiaomi", "mimo-v2.5-pro")] },
          { tier: "", models: [model("xiaomi", "mimo-v2.5")] },
        ],
      },
    ],
  },
];
