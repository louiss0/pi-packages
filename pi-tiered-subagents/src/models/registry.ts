/**
 * registry.ts — The session's model resolution, as this package sees it.
 *
 * A narrow structural type: the two ways the session reports its models, and
 * nothing else. The runtime never reaches into the SDK's registry for
 * anything but this.
 */

import type { Model } from "@earendil-works/pi-ai";

/** The models a session knows, and the ones it can run. */
export interface ModelRegistry {
  /** The model of a provider and id, whether or not the session can run it. */
  find(provider: string, modelId: string): Model<any> | undefined;
  /** Every model the session knows. */
  getAll(): Model<any>[];
  /** The models the session can run, when it can say. */
  getAvailable?(): Model<any>[];
}
