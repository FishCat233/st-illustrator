import type { AnimaWorkflow } from '../types/comfyui.js';
import type { AnimaGenerationParams, AnimaPromptParams } from '../types/comfyui.js';
import { buildAnimaNegative, buildAnimaPositive, extractSafetyTag } from './prompt-builder.js';

/**
 * Anima workflow 模板（API 格式，节点结构与 AnimaTool 官方模板一致）。
 * 占位符 __POSITIVE__ / __NEGATIVE__ 由 buildWorkflow 注入。
 */

const WIDTH_HEIGHT_TARGET_MP = 1.0;

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
    '21:9': { width: 1344, height: 576 },
    '2:1': { width: 1280, height: 640 },
    '16:9': { width: 1216, height: 684 },
    '16:10': { width: 1152, height: 720 },
    '5:3': { width: 1152, height: 691 },
    '3:2': { width: 1104, height: 736 },
    '4:3': { width: 1056, height: 792 },
    '1:1': { width: 1024, height: 1024 },
    '3:4': { width: 792, height: 1056 },
    '2:3': { width: 736, height: 1104 },
    '3:5': { width: 691, height: 1152 },
    '10:16': { width: 720, height: 1152 },
    '9:16': { width: 684, height: 1216 },
    '1:2': { width: 640, height: 1280 },
    '9:21': { width: 576, height: 1344 },
};

/**
 * 由长宽比预设推算宽高（约 1MP，16 对齐，Anima 建议）。
 * width/height 显式给定时优先。
 */
export function resolveDimensions(params: AnimaGenerationParams): { width: number; height: number } {
    if (params.width && params.height) {
        return { width: params.width, height: params.height };
    }
    if (params.aspect_ratio && ASPECT_RATIOS[params.aspect_ratio]) {
        return ASPECT_RATIOS[params.aspect_ratio];
    }
    return ASPECT_RATIOS['1:1'];
}

/** 生成默认 workflow 模板 */
function baseWorkflow(): AnimaWorkflow {
    return {
        '45': {
            class_type: 'CLIPLoader',
            inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' },
        },
        '44': {
            class_type: 'UNETLoader',
            inputs: { unet_name: 'anima-preview.safetensors', weight_dtype: 'default' },
        },
        '15': {
            class_type: 'VAELoader',
            inputs: { vae_name: 'qwen_image_vae.safetensors' },
        },
        '11': {
            class_type: 'CLIPTextEncode',
            inputs: { clip: ['45', 0], text: '__POSITIVE__' },
        },
        '12': {
            class_type: 'CLIPTextEncode',
            inputs: { clip: ['45', 0], text: '__NEGATIVE__' },
        },
        '28': {
            class_type: 'EmptyLatentImage',
            inputs: { width: 1024, height: 1024, batch_size: 1 },
        },
        '19': {
            class_type: 'KSampler',
            inputs: {
                model: ['44', 0],
                positive: ['11', 0],
                negative: ['12', 0],
                latent_image: ['28', 0],
                seed: -1,
                steps: 30,
                cfg: 4.5,
                sampler_name: 'er_sde',
                scheduler: 'simple',
                denoise: 1.0,
            },
        },
        '8': {
            class_type: 'VAEDecode',
            inputs: { samples: ['19', 0], vae: ['15', 0] },
        },
        '52': {
            class_type: 'SaveImage',
            inputs: { images: ['8', 0], filename_prefix: 'st-illustrator_' },
        },
    };
}

export interface BuildWorkflowOptions {
    positive: string;
    negative: string;
    params: AnimaGenerationParams;
    modelNames?: { unet?: string; clip?: string; vae?: string };
    filenamePrefix?: string;
}

/**
 * 生成可提交的 workflow：注入提示词与生成参数。
 * 纯函数（读不到设置），模型文件名由调用方传入。
 */
export function buildWorkflow(options: BuildWorkflowOptions): AnimaWorkflow {
    const workflow = baseWorkflow();
    const { width, height } = resolveDimensions(options.params);

    if (options.modelNames?.clip) {
        workflow['45'].inputs.clip_name = options.modelNames.clip;
    }
    if (options.modelNames?.unet) {
        workflow['44'].inputs.unet_name = options.modelNames.unet;
    }
    if (options.modelNames?.vae) {
        workflow['15'].inputs.vae_name = options.modelNames.vae;
    }

    workflow['11'].inputs.text = options.positive;
    workflow['12'].inputs.text = options.negative;
    workflow['28'].inputs.width = width;
    workflow['28'].inputs.height = height;

    const sampler = workflow['19'].inputs;
    sampler.seed = options.params.seed ?? -1;
    sampler.steps = options.params.steps ?? 30;
    sampler.cfg = options.params.cfg ?? 4.5;
    if (options.params.sampler_name) {
        sampler.sampler_name = options.params.sampler_name;
    }
    if (options.filenamePrefix) {
        workflow['52'].inputs.filename_prefix = options.filenamePrefix;
    }

    return workflow;
}

/**
 * 从 Anima 结构化提示词参数 + 生成参数构建完整 workflow。
 * 便捷封装：拼装正负提示词 → 注入 workflow。
 */
export function buildWorkflowFromParams(
    prompt: AnimaPromptParams,
    params: AnimaGenerationParams,
    modelNames?: { unet?: string; clip?: string; vae?: string },
    filenamePrefix?: string,
): AnimaWorkflow {
    const positive = buildAnimaPositive(prompt);
    const negative = buildAnimaNegative(prompt.neg, extractSafetyTag(prompt.quality_meta_year_safe));
    return buildWorkflow({ positive, negative, params, modelNames, filenamePrefix });
}

/** 1MP 目标对齐（保留给未来自定义尺寸用） */
export function alignTo16(value: number): number {
    return Math.max(16, Math.round(value / 16) * 16);
}

export { WIDTH_HEIGHT_TARGET_MP };
