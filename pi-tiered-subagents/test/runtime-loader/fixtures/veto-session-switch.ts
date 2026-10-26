import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type Provider,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FIXTURE_CONTROL_KEY = Symbol.for(
  "@code-fixer-23/pi-tiered-subagents:runtime-loader-veto-fixture",
);

interface FixtureControl {
  setVeto(value: boolean): void;
  releaseHeldResponse(): void;
}

let veto = true;
let heldRelease: (() => void) | undefined;
let releaseRequested = false;

const control: FixtureControl = {
  setVeto(value: boolean): void {
    veto = value;
    releaseRequested = false;
  },
  releaseHeldResponse(): void {
    releaseRequested = true;
    heldRelease?.();
    heldRelease = undefined;
  },
};

(globalThis as Record<symbol, unknown>)[FIXTURE_CONTROL_KEY] = control;

const offlineModel: Model<Api> = {
  id: "offline",
  name: "Offline fixture",
  api: "offline-fixture" as Api,
  provider: "offline-fixture",
  baseUrl: "http://offline.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_000,
  maxTokens: 1_000,
};

function assistantMessage(
  model: Model<Api>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function streamMessage(message: AssistantMessage): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    message,
  });
  stream.end();
  return stream;
}

function lastUserText(context: TranscriptContext): string {
  const message = context.messages.findLast(
    (candidate) => candidate.role === "user",
  );
  if (!message || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

function streamFixture(
  model: Model<Api>,
  context: TranscriptContext,
): AssistantMessageEventStream {
  const prompt = lastUserText(context);
  if (prompt.includes("hold active child")) {
    const stream = createAssistantMessageEventStream();
    heldRelease = () => {
      stream.push({
        type: "done",
        reason: "stop",
        message: assistantMessage(
          model,
          [{ type: "text", text: "offline fixture held result" }],
          "stop",
        ),
      });
      stream.end();
    };
    if (releaseRequested) {
      heldRelease();
      heldRelease = undefined;
    }
    return stream;
  }

  const hasQuestionResult = context.messages.some(
    (message) =>
      message.role === "toolResult" && message.toolName === "ask_parent",
  );
  if (prompt.includes("ask and resume") || hasQuestionResult) {
    if (!hasQuestionResult) {
      return streamMessage(
        assistantMessage(
          model,
          [
            {
              type: "toolCall",
              id: "offline-ask-parent",
              name: "ask_parent",
              arguments: { question: "What should I do next?" },
            },
          ],
          "toolUse",
        ),
      );
    }
    const userMessages = context.messages.filter(
      (message) => message.role === "user",
    );
    return streamMessage(
      assistantMessage(
        model,
        [
          {
            type: "text",
            text:
              userMessages.length > 1
                ? "offline fixture resumed result"
                : "offline fixture waiting result",
          },
        ],
        "stop",
      ),
    );
  }

  return streamMessage(
    assistantMessage(
      model,
      [{ type: "text", text: "offline fixture result" }],
      "stop",
    ),
  );
}

const provider: Provider = {
  id: "offline-fixture",
  name: "Offline fixture",
  auth: {
    apiKey: {
      name: "Offline fixture key",
      resolve: async () => ({ auth: { apiKey: "offline" } }),
    },
  },
  getModels: () => [offlineModel],
  stream: streamFixture,
  streamSimple: streamFixture,
};

export default function vetoSessionSwitch(pi: ExtensionAPI): void {
  pi.registerProvider(provider);
  pi.on("session_before_switch", () => ({ cancel: veto }));
}
