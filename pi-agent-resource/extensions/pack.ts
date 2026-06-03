import {
  type ExtensionAPI,
  ExtensionCommandContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Component, TUI } from "@earendil-works/pi-tui";
import { picklist, safeParse, summarize } from "valibot";

const PACK_LABEL = "pack";
const ROOT_PACK_COMMAND = `resource:${PACK_LABEL}`;

const CREATE_COMMAND = "create";
const EDIT_COMMAND = "edit";
const DELETE_COMMAND = "delete";
const packCommands = picklist([CREATE_COMMAND, DELETE_COMMAND]);

const MOVE_IN_COMMAND = "move-in";
const MOVE_OUT_COMMAND = "move-out";
const MOVE_TO_COMMAND = "move-to";
const packOrginaizationCommands = [MOVE_IN_COMMAND, MOVE_OUT_COMMAND, MOVE_TO_COMMAND] as const;

const SKILL_COMMAND = "skill";
const AGENT_COMMAND = "agent";
const PROMPT_COMMAND = "prompt";

const packManagementCommands = [CREATE_COMMAND, EDIT_COMMAND, DELETE_COMMAND] as const;
const packResourceCommands = picklist([
  ...packOrginaizationCommands,
  ...packManagementCommands,
]);

type PackResourceCommand = (typeof packResourceCommands.options)[number];

type PackResourceHandlers = Record<PackResourceCommand, () => Promise<void>>;

export default function (pi: ExtensionAPI) {
  pi.registerCommand(ROOT_PACK_COMMAND, {
    description: "Manage resource packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue = value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${PACK_LABEL}:${value}`,
            description: `${capitalizedValue} a ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packCommands, arg);

      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await rootPackResourceReducer(result.output, {
        createPackResourceSelector: getCreatePackResourceSelector(
          [SKILL_COMMAND, PROMPT_COMMAND, AGENT_COMMAND].map((command) => `${command}s`),
        ),
        ctx,
      });
    },
  });

  pi.registerCommand(`${ROOT_PACK_COMMAND}:${SKILL_COMMAND}`, {
    description: "Manage skills in packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packResourceCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue = value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${SKILL_COMMAND}:${value}`,
            description: `${capitalizedValue} ${SKILL_COMMAND} in ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packResourceCommands, arg);
      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await skillPackResourceReducer(result.output, ctx);
    },
  });

  pi.registerCommand(`${ROOT_PACK_COMMAND}:${AGENT_COMMAND}`, {
    description: "Manage agents in packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packResourceCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue = value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${AGENT_COMMAND}:${value}`,
            description: `${capitalizedValue} ${AGENT_COMMAND} in ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packResourceCommands, arg);
      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await agentPackResourceReducer(result.output, ctx);
    },
  });

  pi.registerCommand(`${ROOT_PACK_COMMAND}:${PROMPT_COMMAND}`, {
    description: "Manage prompts in packs",
    getArgumentCompletions: (argumentPrefix) => {
      return packResourceCommands.options
        .filter((option) => option.startsWith(argumentPrefix))
        .map((value) => {
          const capitalizedValue = value.charAt(0).toUpperCase() + value.slice(1);
          return {
            value,
            label: `${PROMPT_COMMAND}:${value}`,
            description: `${capitalizedValue} ${PROMPT_COMMAND} in ${PACK_LABEL}`,
          };
        });
    },
    handler: async (arg, ctx) => {
      const result = safeParse(packResourceCommands, arg);
      if (!result.success) {
        return ctx.ui.notify(summarize(result.issues), "error");
      }

      await promptPackResourceReducer(result.output, ctx);
    },
  });
}

export function getCreatePackResourceSelector<T extends ReadonlyArray<string>>(choices: T) {
  return (
    tui: TUI,
    theme: Theme,
    _: KeybindingsManager,
    done: (result?: T) => void,
  ): Component => ({
    invalidate() {
      tui.requestRender();
    },
    handleInput() {
      done(choices);
    },
    render() {
      return [];
    },
  });
}

type PackCommand = (typeof packCommands.options)[number];

export function rootPackResourceReducer(
  arg: PackCommand,
  deps: {
    createPackResourceSelector?: ReturnType<typeof getCreatePackResourceSelector>;
    ctx: ExtensionCommandContext;
  },
) {
  const { createPackResourceSelector, ctx } = deps;

  return (
    {
      [CREATE_COMMAND]: async () => {
        const packName = await ctx.ui.input(
          PACK_LABEL,
          "What is the name of your agent pack?",
        );

        if (createPackResourceSelector) {
          await ctx.ui.custom(createPackResourceSelector);
        }

        ctx.ui.notify(`Pack created successfully with name '${packName}'`);
      },
      [DELETE_COMMAND]: async () => {
        const packName = await ctx.ui.input(
          PACK_LABEL,
          "What is the name of the pack you want to delete?",
        );

        ctx.ui.notify(`Pack deleted successfully with name '${packName}'`);
      },
    } satisfies Record<PackCommand, () => Promise<void>>
  )[arg]();
}

export function skillPackResourceReducer(
  arg: PackResourceCommand,
  ctx: ExtensionCommandContext,
) {
  return (
    {
      [CREATE_COMMAND]: async () => {},
      [EDIT_COMMAND]: async () => {},
      [MOVE_IN_COMMAND]: async () => {},
      [MOVE_OUT_COMMAND]: async () => {},
      [MOVE_TO_COMMAND]: async () => {},
      [DELETE_COMMAND]: async () => {},
    } satisfies PackResourceHandlers
  )[arg]();
}

export function agentPackResourceReducer(
  arg: PackResourceCommand,
  ctx: ExtensionCommandContext,
) {
  return (
    {
      [CREATE_COMMAND]: async () => {},
      [EDIT_COMMAND]: async () => {},
      [MOVE_IN_COMMAND]: async () => {},
      [MOVE_OUT_COMMAND]: async () => {},
      [MOVE_TO_COMMAND]: async () => {},
      [DELETE_COMMAND]: async () => {},
    } satisfies PackResourceHandlers
  )[arg]();
}

export function promptPackResourceReducer(
  arg: PackResourceCommand,
  ctx: ExtensionCommandContext,
) {
  return (
    {
      [CREATE_COMMAND]: async () => {},
      [EDIT_COMMAND]: async () => {},
      [MOVE_IN_COMMAND]: async () => {},
      [MOVE_OUT_COMMAND]: async () => {},
      [MOVE_TO_COMMAND]: async () => {},
      [DELETE_COMMAND]: async () => {},
    } satisfies PackResourceHandlers
  )[arg]();
}
