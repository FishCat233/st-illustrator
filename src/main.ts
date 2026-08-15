import { eventSource, event_types } from 'st/events';
import { getContext } from 'st/extensions';
import type { StoryCharacter, StoryMessage } from './modules/extractor.js';
import { buildPromptParams } from './modules/extractor.js';
import { TriggerController } from './modules/triggers.js';
import { buildPlaceholderValues } from './modules/workflow.js';
import { loadWorkflow, fillPlaceholders, hasPlaceholder } from './modules/workflow-source.js';
import { ComfyUIGenerator } from './modules/generator.js';
import type { AnimaWorkflow } from './types/comfyui.js';

const EXTENSION_NAME = 'st-illustrator';

/**
 * 扩展默认设置。真实设置存入 extension_settings.st_illustrator，
 * 与 ST 设置系统共用持久化。
 * 默认值对齐用户实际环境（实测 D:\1ToolAndProject\ComfyUI_windows_portable_nvidia_1）：
 * 工作流用用户设计的 t.json（含 %prompt% 等占位符，SaveImage 前缀 SillyTavern），
 * 模型默认 anima-base-v1.0 + qwen_3_06b_base + qwen_image_vae，
 * 采样器 er_sde + simple（用户工作流 KSampler 参数）。
 */
export const defaultSettings = {
    enabled: false,
    autoMode: true,
    minIntervalMs: 60_000,
    messagesPerIllustration: 1,
    comfyUrl: 'http://127.0.0.1:8188',
    workflowFile: 'workflows/t.json',
    modelUnet: 'anima-base-v1.0.safetensors',
    modelClip: 'qwen_3_06b_base.safetensors',
    modelVae: 'qwen_image_vae.safetensors',
    artist: '@fkey',
    qualityMetaYearSafe: 'masterpiece, best quality, score_9, score_8, highres, anime coloring, very aesthetic, safe',
    neg: 'worst quality, low quality, score_1, score_2, score_3, bad quality, worst detail, sketch, censor, extra limbs, deformed fingers, bad anatomy, mutated body, lowres, blurry, text, ugly, hooded eyes, watermark, pale, bad hands, bad anatomy, bad proportions, poorly drawn face, poorly drawn hand, missing finger, extra limbs, pixelated, distorted, jpeg artifacts, signature, (deformed:1.5), (bad hand:1.3), overexposed, underexposed, censored, mutated, extra finger, cloned face, bad eyes, red sleeves, red sleeve cuffs, nsfw, explicit',
    style: '',
    aspectRatio: '2:3',
    steps: 30,
    cfg: 4,
    seed: -1,
    samplerName: 'er_sde',
    scheduler: 'simple',
};

export type Settings = typeof defaultSettings;

const trigger = new TriggerController();
let generator = new ComfyUIGenerator({ comfyUrl: defaultSettings.comfyUrl });
let currentSettings: Settings = { ...defaultSettings };

/**
 * 刷新设置快照。
 * init 时与 EXTENSION_SETTINGS_LOADED 事件时都会调用；
 * 设置面板保存后 ST 只 emit SETTINGS_UPDATED（不重发 EXTENSION_SETTINGS_LOADED），
 * 所以每次生成前也会懒读取（见 generateIllustration），保证改动实时生效。
 */
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

/**
 * 从设置自选的工作流构建可提交的 API 格式 workflow：
 * 1. 从 ComfyUI 读取工作流文件（UI 格式 → API 格式）
 * 2. 替换 %prompt% / %negative_prompt% / %sampler% / %scheduler% 占位符
 * 3. seed/steps/cfg/width/height 直接注入对应节点（模板中留空时）
 */
async function buildWorkflowFromSettings(promptParams: ReturnType<typeof buildPromptParams>): Promise<AnimaWorkflow> {
    const { workflow, defaultModels } = await loadWorkflow(currentSettings.comfyUrl, currentSettings.workflowFile);

    const values = buildPlaceholderValues({
        prompt: promptParams,
        params: {
            aspect_ratio: currentSettings.aspectRatio,
            steps: currentSettings.steps,
            cfg: currentSettings.cfg,
            seed: currentSettings.seed,
            sampler_name: currentSettings.samplerName,
            scheduler: currentSettings.scheduler,
        },
    });

    // 模型覆盖：设置面板显式填写时优先，否则用工作流里的默认模型
    const modelNames = {
        unet: currentSettings.modelUnet || defaultModels.unet,
        clip: currentSettings.modelClip || defaultModels.clip,
        vae: currentSettings.modelVae || defaultModels.vae,
    };
    for (const node of Object.values(workflow)) {
        if (node.class_type === 'UNETLoader' && modelNames.unet) node.inputs.unet_name = modelNames.unet;
        if (node.class_type === 'CLIPLoader' && modelNames.clip) node.inputs.clip_name = modelNames.clip;
        if (node.class_type === 'VAELoader' && modelNames.vae) node.inputs.vae_name = modelNames.vae;
    }

    // 占位符替换（%prompt% 等）
    fillPlaceholders(workflow, values);

    // 模板中留空的生成参数直接注入节点（t.json 的 KSampler/EmptyLatentImage 留空由插件填）
    for (const node of Object.values(workflow)) {
        if (node.class_type === 'KSampler') {
            const inputs = node.inputs;
            if (inputs.seed === undefined || inputs.seed === null) inputs.seed = values.seed ?? -1;
            if (inputs.steps === undefined || inputs.steps === null) inputs.steps = values.steps ?? 30;
            if (inputs.cfg === undefined || inputs.cfg === null) inputs.cfg = values.cfg ?? 4;
        }
        if (node.class_type === 'EmptyLatentImage') {
            const inputs = node.inputs;
            if (inputs.width === undefined || inputs.width === null) inputs.width = values.width ?? 1024;
            if (inputs.height === undefined || inputs.height === null) inputs.height = values.height ?? 1024;
        }
    }

    // 校验：正负提示词占位符必须被替换（防用户选错工作流）
    if (hasPlaceholder(workflow, 'prompt') || hasPlaceholder(workflow, 'negative_prompt')) {
        throw new Error('工作流缺少 %prompt% / %negative_prompt% 占位符替换（工作流选择可能不对）');
    }

    return workflow;
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

    // 懒读取设置：设置面板改动即时生效（ST 保存设置不重发 EXTENSION_SETTINGS_LOADED）
    loadSettingsFromExtensionSettings();

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

    const workflow = await buildWorkflowFromSettings(promptParams);

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
