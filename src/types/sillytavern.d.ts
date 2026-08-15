/**
 * SillyTavern 全局模块的最小类型声明。
 * 源码里用语义化 specifier（st/script 等）引用 ST 模块，
 * 构建时由 build.mjs 替换为相对 dist/ 的真实路径。
 * 只声明本项目实际用到的 API 面，随开发迭代补全。
 */

declare module 'st/events' {
    export const event_types: {
        APP_READY: string;
        APP_INITIALIZED: string;
        MESSAGE_SENT: string;
        MESSAGE_RECEIVED: string;
        MESSAGE_UPDATED: string;
        MESSAGE_SWIPED: string;
        CHAT_CHANGED: string;
        CHAT_LOADED: string;
        GENERATION_STARTED: string;
        GENERATION_ENDED: string;
        GENERATION_STOPPED: string;
        EXTENSION_SETTINGS_LOADED: string;
        SETTINGS_LOADED: string;
        SETTINGS_UPDATED: string;
        SETTINGS_LOADED_BEFORE: string;
        SETTINGS_LOADED_AFTER: string;
        EXTENSIONS_FIRST_LOAD: string;
        CHARACTER_MESSAGE_RENDERED: string;
        USER_MESSAGE_RENDERED: string;
        CHARACTER_PAGE_LOADED: string;
        GROUP_CHAT_CREATED: string;
        GROUP_CHAT_DELETED: string;
        CHARACTER_DELETED: string;
        IMAGE_SWIPED: string;
        [key: string]: string;
    };

    export const eventSource: EventEmitter;
}

declare module 'st/script' {
    export const saveSettingsDebounced: (loopCounter?: number) => void;
    export function saveSettings(loopCounter?: number): Promise<void>;
    export function appendMediaToMessage(
        message: unknown,
        media: string | string[],
        extra: { as_attachment?: boolean; delay?: number },
    ): Promise<void>;
    export function getRequestHeaders(): Record<string, string>;
    export function generateQuietPrompt(prompt: string, quietToLoud: boolean, withLouded: boolean, characterName?: string): Promise<unknown>;
    export function substituteParams(content: string, replacement?: unknown): string;
    export function getCurrentChatId(): string | undefined;
}

declare module 'st/extensions' {
    export const extension_settings: Record<string, unknown>;
    export function getContext(): unknown;
    export function renderExtensionTemplateAsync(
        extensionName: string,
        templateId: string,
        templateData?: unknown,
    ): Promise<string>;
}

declare module 'st/st-context' {
    export function getContext(): unknown;
}

declare module 'st/utils' {
    export function delay(ms: number): Promise<void>;
    export function escapeHtml(text: string): string;
}
