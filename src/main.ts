import { eventSource, event_types } from 'st/events';
import { getContext } from 'st/extensions';
import type { StoryCharacter, StoryMessage } from './modules/extractor.js';
import { extractMaterials } from './modules/extractor.js';
import { TriggerController } from './modules/triggers.js';
import { renderTemplate, buildParamPlaceholders } from './modules/workflow.js';
import { loadWorkflow, fillPlaceholders, fillMissingParams, hasUnresolvedPlaceholders } from './modules/workflow-source.js';
import { ComfyUIGenerator } from './modules/generator.js';
import { resetProxyProbe } from './modules/comfy-fetch.js';
import type { AnimaWorkflow } from './types/comfyui.js';

const EXTENSION_NAME = 'st-illustrator';

/**
 * 扩展默认设置。真实设置存入 extension_settings.st_illustrator，
 * 与 ST 设置系统共用持久化。
 * 提示词通过「模板」配置，模板用 {素材} 引用插件提取的内容，
 * 生图规范（Anima/SD 等）完全由模板决定，插件不绑定任何生图细节。
 * 默认模板是 Anima 风格（当前环境），SD 用户换成自己的模板即可。
 */
export const defaultSettings = {
    enabled: false,
    autoMode: true,
    minIntervalMs: 60_000,
    messagesPerIllustration: 1,
    comfyUrl: 'http://127.0.0.1:8188',
    workflowFile: 'workflows/t.json',
    modelUnet: '',
    modelClip: '',
    modelVae: '',
    promptTemplate: 'masterpiece, best quality, score_9, score_8, highres, anime coloring, very aesthetic, safe, 1girl, @fkey, {appearance}, {scene}',
    negativeTemplate: 'worst quality, low quality, score_1, score_2, score_3, bad quality, worst detail, sketch, censor, extra limbs, deformed fingers, bad anatomy, mutated body, lowres, blurry, text, ugly, hooded eyes, watermark, pale, bad hands, bad anatomy, bad proportions, poorly drawn face, poorly drawn hand, missing finger, extra limbs, pixelated, distorted, jpeg artifacts, signature, (deformed:1.5), (bad hand:1.3), overexposed, underexposed, censored, mutated, extra finger, cloned face, bad eyes, nsfw, explicit',
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
    const previousUrl = currentSettings.comfyUrl;
    currentSettings = { ...defaultSettings, ...extensionSettings };
    if (previousUrl !== currentSettings.comfyUrl) {
        // ComfyUI 地址变化时重置代理探测缓存
        resetProxyProbe();
    }
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
 * 1. 提取素材（角色卡/剧情，可指定截至某条消息）
 * 2. 渲染用户模板（{素材} → 提示词）
 * 3. 从 ComfyUI 读取工作流（UI 格式 → API 格式）
 * 4. 替换工作流中的 %占位符%（prompt/negative_prompt/seed/steps/cfg/sampler/scheduler/width/height）
 * 5. 模型覆盖（设置面板显式填写时优先，否则用工作流默认）
 */
async function buildWorkflowFromSettings(
    character: StoryCharacter | undefined,
    chat: StoryMessage[],
    options: { upToIndex?: number } = {},
): Promise<AnimaWorkflow> {
    const { workflow, defaultModels } = await loadWorkflow(currentSettings.comfyUrl, currentSettings.workflowFile);

    // 素材 → 模板 → 提示词（upToIndex 指定时只取该消息及之前的剧情）
    const materials = extractMaterials(character, chat, { sceneWindow: 6, sceneMaxLen: 120, upToIndex: options.upToIndex });
    const prompt = renderTemplate(currentSettings.promptTemplate, materials);
    const negativePrompt = renderTemplate(currentSettings.negativeTemplate, materials);

    // 占位符值表：提示词 + 生成参数（含尺寸推算）
    const values: Record<string, string | number> = {
        prompt,
        negative_prompt: negativePrompt,
        ...buildParamPlaceholders({
            aspect_ratio: currentSettings.aspectRatio,
            steps: currentSettings.steps,
            cfg: currentSettings.cfg,
            seed: currentSettings.seed,
            sampler_name: currentSettings.samplerName,
            scheduler: currentSettings.scheduler,
        }),
    };

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

    // 占位符替换（%prompt% / %seed% / %width% ... 工作流里写了哪就用哪）
    fillPlaceholders(workflow, values);

    // 兜底填充：工作流中留空的必填生成参数（KSampler 的 seed/steps/cfg 等）
    fillMissingParams(workflow, values);

    // 校验：工作流里的占位符必须全部有值（防用户选错工作流或拼错占位符名）
    const unresolved = hasUnresolvedPlaceholders(workflow);
    if (unresolved.length > 0) {
        throw new Error(`工作流有未替换的占位符: %${unresolved.join('%, %')}%（检查工作流选择或拼写）`);
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
    // 素材截至目标消息：配图描述的是「那条消息当时」的场景
    const workflow = await buildWorkflowFromSettings(character, context.chat, { upToIndex: messageIndex });

    console.log(`[${EXTENSION_NAME}] 生成配图（消息 ${messageIndex}）`);

    const images = await generator.generate(workflow);
    if (images.length === 0) return false;

    // 把图插进目标消息
    await insertImageIntoMessage(messageIndex, images[0]);
    trigger.markGenerated(messageIndex);
    await context.saveChat();
    return true;
}

/**
 * 为指定消息配图（消息菜单按钮入口）。
 * 绕过启用/触发检查：用户明确点按钮就是要配图。
 */
export async function illustrateMessage(messageIndex: number): Promise<boolean> {
    return generateIllustration(messageIndex, { force: true, bypassEnabled: true });
}

async function insertImageIntoMessage(messageIndex: number, image: { filename: string; type?: string; subfolder?: string }): Promise<void> {
    const { appendMediaToMessage } = await import('st/script');
    const { imageDisplayUrl } = await import('./modules/comfy-fetch.js');
    const context = getContext() as {
        chat: StoryMessage[];
    };
    const message = context.chat[messageIndex];
    if (!message) return;

    const url = await imageDisplayUrl(currentSettings.comfyUrl, image);
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

    // 消息菜单配图按钮（渲染事件注入 + 点击委托）
    const { initMessageButtons } = await import('./modules/message-buttons.js');
    initMessageButtons();

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
