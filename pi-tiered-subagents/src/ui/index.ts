/**
 * Terminal presentation module. Pi registration remains at the extension root;
 * execution data reaches these consumers through views and focused actions.
 */
export { AgentWidget } from "./agent-widget.js";
export { createAgentToolRenderer } from "./agent-tool-renderer.js";
export {
  renderGetResultCall,
  renderGetResultResult,
} from "./get-result-tool-renderer.js";
export {
  createNotificationRenderer,
  createUpdateRenderer,
  createWorkspaceNoticeRenderer,
} from "./notification-renderer.js";
export { SessionNavigatorHandler } from "./session-navigator.js";
export { SubagentsSettingsHandler } from "./subagents-settings.js";
