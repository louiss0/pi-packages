// Type surface for @juanibiapina/pi-extension-settings.
//
// The package ships raw TS sources that don't compile under this workspace's
// strict compiler flags, so tsconfig maps the module here for typechecking.
// At runtime the real package is loaded from node_modules.
declare module "@juanibiapina/pi-extension-settings" {
  export interface OrderedListOption {
    id: string;
    label: string;
  }

  export interface SettingDefinition {
    id: string;
    label: string;
    description?: string;
    defaultValue: string;
    values?: string[];
    options?: OrderedListOption[];
  }

  export interface SettingStorageOptions {
    scope?: "global" | "local";
    cwd?: string;
    agentDir?: string;
  }

  export function getSetting(
    extensionName: string,
    settingId: string,
    defaultValue?: string,
    options?: SettingStorageOptions,
  ): string | undefined;

  export function setSetting(
    extensionName: string,
    settingId: string,
    value: string,
    options?: SettingStorageOptions,
  ): void;
}
