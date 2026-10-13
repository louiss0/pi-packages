import {
  CURSOR_MARKER,
  stripTerminalSequences,
  Text,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export function agentFormViewport(
  form: Component & Focusable,
  tui: TUI,
  theme: Theme,
  errors: () => string[] = () => [],
  footerSize = 3,
): Component & Focusable {
  let scrollTop = 0;
  return {
    get focused() {
      return form.focused;
    },
    set focused(value: boolean) {
      form.focused = value;
    },
    handleInput: (data: string) => form.handleInput?.(data),
    invalidate: () => form.invalidate(),
    render: (width: number) => {
      const lines = form.render(width);
      const height = Math.max(10, Math.floor(tui.terminal.rows * 0.8));
      const messages = errors();
      const footer = [
        ...(messages.length
          ? new Text(theme.fg("error", messages[0])).render(width).slice(0, 3)
          : []),
        ...lines.slice(-footerSize),
      ];
      const body = lines.slice(1, -footerSize);
      const available = height - footer.length - 1;
      if (body.length <= available) {
        scrollTop = 0;
        return [lines[0], ...body, ...footer];
      }
      let active = body.findIndex((line) => line.includes(CURSOR_MARKER));
      if (active < 0) {
        active = body.findIndex((line) =>
          /^[›]|^>\s+\[[ x]\]/.test(stripTerminalSequences(line).trimStart()),
        );
      }
      if (active < scrollTop) scrollTop = Math.max(0, active);
      else if (active >= scrollTop + available)
        scrollTop = active - available + 1;
      scrollTop = Math.min(scrollTop, Math.max(0, body.length - available));
      return [
        lines[0],
        ...body.slice(scrollTop, scrollTop + available),
        ...footer,
      ];
    },
  };
}
