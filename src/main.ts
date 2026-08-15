import { eventSource, event_types } from 'st/events';
import { getContext } from 'st/extensions';
import type { StoryCharacter, StoryMessage } from './modules/extractor.js';
import { buildPromptParams } from './modules/extractor.js';
import { TriggerController } from './modules/triggers.js';
import { buildWorkflowFromParams } from './modules/workflow.js';
import { ComfyUIGenerator } from './modules/generator.js';

const EXTENSION_NAME = 'st-illustrator';

/**
 * 扩展默认设置。真实设置存入 extension_settings.st_illustrator，
 * 与 ST 设置系统共用持久化。
 */
export const defaultSettings = {
    enabled: false,
    autoMode: true,
    minIntervalMs: 60_000,
    messagesPerIllustration: 1,
    comfyUrl: 'http://127.0.0.1:8188',
    modelUnet: 'anima-preview.safetensors',
    modelClip: 'qwen_3_06b_base.safetensors',
    modelVae: 'qwen_image_vae.safetensors',
    artist: '@fkey',
    qualityMetaYearSafe: 'masterpiece, best quality, newest, year 2024, safe',
    neg: 'worst quality, low quality, blurry, bad anatomy, bad hands, bad feet, extra fingers, missing fingers, malformed limbs, text, watermark, logo, nsfw, explicit',
    style: '',
    aspectRatio: '1:1',
    steps: 30,
    cfg: 4.5,
    seed: -1,
};

export type Settings = typeof defaultSettings;

const trigger = new TriggerController();
let generator = new ComfyUIGenerator({ comfyUrl: defaultSettings.comfyUrl });
let currentSettings: Settings = { ...defaultSettings };

function loadSettingsFromExtensionSettings(): void {
    const extensionSettings = getExtensionSettings();
    currentSettings = { ...defaultSettings, ...extensionSettings };
    trigger.updateConfig({
        enabled: currentSettings.enabled,
        autoMode: currentSettings.autoMode,
        minIntervalMs: currentSettings.minIntervalMs,
        messagesPerIllustration: currentSettings.messagesPerIllustration,
    });
    generator = new ComfyUIGenerator({ comfyUrl: currentSettings.comfyUrl });
}

function getExtensionSettings(): Partial<Settings> {
    const settings = getContext()?.extensionSettings?.st_illustrator ?? {};
    return settings as Partial<Settings>;
}

/** 生成配图并插入目标消息 */
export async function generateIllustration(
    targetMessageId?: number,
    options: { force?: boolean; bypassEnabled?: boolean } = {},
): Promise<boolean> {
    if (!options.bypassEnabled && !currentSettings.enabled) {
        console.log(`[${EXTENSION_NAME}] 扩展未启用，跳过生成`);
        return false;
    }

    const context = getContext() as {
        chat: StoryMessage[];
        characters: StoryCharacter[];
        characterId: number;
        saveChat: () => Promise<void>;
    };

    if (!context.chat || context.chat.length === 0) return false;

    const messageIndex = targetMessageId ?? context.chat.length - 1;
    if (!options.force && !trigger.shouldAutoTrigger(messageIndex)) return false;

    const character = context.characters?.[context.characterId];
    const promptParams = buildPromptParams(character, context.chat, {
        artist: currentSettings.artist,
        qualityMetaYearSafe: currentSettings.qualityMetaYearSafe,
        neg: currentSettings.neg,
        style: currentSettings.style,
    });

    const workflow = buildWorkflowFromParams(
        promptParams,
        {
            aspect_ratio: currentSettings.aspectRatio,
            steps: currentSettings.steps,
            cfg: currentSettings.cfg,
            seed: currentSettings.seed,
        },
        {
            unet: currentSettings.modelUnet,
            clip: currentSettings.modelClip,
            vae: currentSettings.modelVae,
        },
    );

    console.log(`[${EXTENSION_NAME}] 生成配图（消息 ${messageIndex}）`, promptParams);

    const images = await generator.generate(workflow);
    if (images.length === 0) return false;

    // 把图插进目标消息
    await insertImageIntoMessage(messageIndex, images[0].filename);
    trigger.markGenerated(messageIndex);
    await context.saveChat();
    return true;
}

async function insertImageIntoMessage(messageIndex: number, filename: string): Promise<void> {
    const { appendMediaToMessage } = await import('st/script');
    const context = getContext() as {
        chat: StoryMessage[];
    };
    const message = context.chat[messageIndex];
    if (!message) return;

    const url = `${currentSettings.comfyUrl}/view?filename=${encodeURIComponent(filename)}&type=output`;
    const mediaAttachment = {
        url,
        type: 'image',
        title: 'st-illustrator 配图',
        source: 'st-illustrator',
    };

    const messageExtra = (message.extra ?? {}) as Record<string, unknown>;
    const media = (messageExtra.media as unknown[]) ?? [];
    media.push(mediaAttachment);
    messageExtra.media = media;
    messageExtra.inline_image = true;
    message.extra = messageExtra;

    const messageElement = document.querySelector(`.mes[mesid="${messageIndex}"]`);
    if (messageElement) {
        appendMediaToMessage(message, messageElement as never, 'keep');
    }
}

async function onMessageReceived(messageId: number): Promise<void> {
    if (!currentSettings.autoMode) return;
    console.log(`[${EXTENSION_NAME}] 消息 ${messageId} 生成完成，检查自动配图`);
    try {
        await generateIllustration(messageId);
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] 自动配图失败:`, error);
    }
}

/** 手动配图：绕过触发检查与启用检查，对最后一条消息生成 */
export async function manualGenerate(): Promise<boolean> {
    return generateIllustration(undefined, { force: true, bypassEnabled: true });
}

export async function init(): Promise<void> {
    console.log(`[${EXTENSION_NAME}] 初始化`);
    loadSettingsFromExtensionSettings();
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, loadSettingsFromExtensionSettings);
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    // 设置面板等 DOM 就绪后再渲染（ST 扩展加载早于 DOM 完成）
    const { addSettingsUI } = await import('./modules/ui.js');
    if (document.getElementById('extensions_settings')) {
        addSettingsUI().catch((error) => console.error(`[${EXTENSION_NAME}] 设置面板加载失败:`, error));
    } else {
        eventSource.once(event_types.APP_READY, () => {
            addSettingsUI().catch((error) => console.error(`[${EXTENSION_NAME}] 设置面板加载失败:`, error));
        });
    }
}

init();
