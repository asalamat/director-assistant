/**
 * CLI Type Stubs for Claims Module
 *
 * Local type definitions to avoid cross-package imports.
 * These mirror the types from @claude-flow/cli for use in claims commands.
 */
export interface CommandContext {
    args: string[];
    flags: Record<string, string | boolean | number | undefined>;
    cwd: string;
    verbose: boolean;
}
export interface CommandResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: Error;
}
export interface Command {
    name: string;
    description: string;
    aliases?: string[];
    usage?: string;
    examples?: string[];
    options?: CommandOption[];
    subcommands?: Command[];
    execute: (context: CommandContext) => Promise<CommandResult>;
}
export interface CommandOption {
    name: string;
    alias?: string;
    description: string;
    type: 'string' | 'boolean' | 'number';
    required?: boolean;
    default?: string | boolean | number;
}
export declare const output: {
    log: (message: string) => void;
    error: (message: string) => void;
    warn: (message: string) => void;
    warning: (message: string) => string;
    success: (message: string) => void;
    info: (message: string) => void;
    table: (data: Record<string, unknown>[]) => void;
    json: (data: unknown) => void;
    dim: (message: string) => string;
    bold: (message: string) => string;
    italic: (message: string) => string;
    highlight: (message: string) => string;
    code: (message: string) => string;
    link: (url: string, text?: string) => string;
    list: (items: string[]) => string;
    header: (message: string) => string;
    red: (message: string) => string;
    green: (message: string) => string;
    yellow: (message: string) => string;
    blue: (message: string) => string;
    cyan: (message: string) => string;
    magenta: (message: string) => string;
    gray: (message: string) => string;
    white: (message: string) => string;
};
export interface SelectOption<T = string> {
    label: string;
    value: T;
    description?: string;
}
export declare function select<T = string>(message: string, options: SelectOption<T>[]): Promise<T>;
export declare function confirm(message: string, defaultValue?: boolean): Promise<boolean>;
export declare function input(message: string, defaultValue?: string): Promise<string>;
export declare class MCPClientError extends Error {
    readonly code?: string | undefined;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code?: string | undefined, details?: Record<string, unknown> | undefined);
}
export interface MCPToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
}
export declare function callMCPTool(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult>;
//# sourceMappingURL=cli-types.d.ts.map