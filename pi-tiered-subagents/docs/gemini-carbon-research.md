# Gemini Carbon: release facts and routing implications

Research checked against Google's primary sources on 2026-10-29. This is a research note, not an approved routing change.

## Confirmed release facts

- Google announced **Gemini 4 Carbon on October 28, 2026**, describing it as its strongest model, with improvements over Gemini 4 Argon in coding, long-horizon agentic work, and cybersecurity. Google reports AA Intelligence Index v5.0 scores of 59 for Carbon and 50 for Argon. These are Google's published results, not independently reproduced measurements. [Carbon announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/) and [Gemini comparison](https://deepmind.google/models/gemini/).
- Announcement is not general API availability. Google's initial rollout is to a subset of cyber defenders, followed by additional trusted partners through Fairwind. Broader developer, business, and consumer availability is described as coming soon. [Carbon announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/).
- Carbon's announced introductory price is the same as Argon's: $2/million input tokens and $10/million output tokens, with cached inputs discounted 95%. Price alone does not establish a capability rung. [Carbon announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-carbon/).
- The fetched Gemini API model catalogue lists `gemini-4-argon` but no Carbon endpoint. Do not invent or promise a public Carbon API identifier from the product name. [API model catalogue](https://ai.google.dev/gemini-api/docs/models).
- Argon's October 13 availability announcement promises more of the Gemini 4 family, but does not name Flash or give a Flash release date. The fetched API catalogue lists Gemini 3.8 Flash, not Gemini 4 Flash. A near-term Gemini 4 Flash release is not confirmed by these sources. [Argon availability](https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-argon/) and [API catalogue](https://ai.google.dev/gemini-api/docs/models).

## Classification is a package policy

Google does not assign this package's S/M/L/XL classes. These are relative capability labels in `src/models/profiles.ts`, not published parameter counts or universal cross-vendor equivalences.

Carbon belongs above Argon in preference order based on Google's positioning and published comparison. **L is a defensible initial label for Carbon**, but not an independently established fact. Two defensible policies remain:

- Carbon L, Argon M, legacy Pro M, Flash/Flash Lite S: makes Worker from Carbon target Argon when available.
- Carbon L, Argon L, legacy Pro M, Flash/Flash Lite S: treats Carbon and Argon as flagship peers; Worker from Carbon targets M instead of Argon.

A larger benchmark score alone does not prove a separate product-size class. Choose explicitly whether Worker should step from Carbon to Argon or skip both flagship variants.

## Existing implementation implications

The shipped Gemini profile currently uses `planner-worker` and contains Argon, Pro Preview, Pro, Flash, and Flash Lite, but not Carbon. An unrecognized Carbon parent tier is retained by the existing router.

Changing Gemini to `size` changes routing for every Gemini specialist: Worker targets one size below the parent, Debug targets M, Reviewer starts at the parent's own rung, and Explore/Researcher target S.

The router remains version-local. A Gemini 4 parent cannot route to Gemini 3.8 Flash or Gemini 3.1 Pro merely because those models have suitable labels. If the targeted same-version model is not runnable, the runtime retains the parent. A profile entry is not evidence that an endpoint exists or is accessible.

No implementation or routing policy was changed by this research.
