import type { AnimaPromptParams } from '../types/comfyui.js';
import { buildAnimaNegative, buildAnimaPositive, extractSafetyTag } from './prompt-builder.js';

/**
 * 提示词拼装与占位符值构造。
 * workflow 模板本身不再硬编码——从 ComfyUI 读取用户自选的工作流
 * （workflow-source.ts），这里只负责：
 * 1. 把结构化提示词拼成 Anima 规范文本
 * 2. 构造占位符替换表（%prompt% / %negative_prompt% / %sampler% / %scheduler% 等）
 * 3. 用调用方传入的生成参数填充 seed/steps/cfg/width/height
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
export function resolveDimensions(params: { width?: number; height?: number; aspect_ratio?: string }): { width: number; height: number } {
    if (params.width && params.height) {
        return { width: params.width, height: params.height };
    }
    if (params.aspect_ratio && ASPECT_RATIOS[params.aspect_ratio]) {
        return ASPECT_RATIOS[params.aspect_ratio];
    }
    return ASPECT_RATIOS['1:1'];
}

/** 占位符键（与用户工作流约定的命名） */
export const PLACEHOLDER = {
    prompt: 'prompt',
    negativePrompt: 'negative_prompt',
    sampler: 'sampler',
    scheduler: 'scheduler',
    width: 'width',
    height: 'height',
    seed: 'seed',
    steps: 'steps',
    cfg: 'cfg',
} as const;

export interface PlaceholderValues {
    /** 完整正面提示词（%prompt%） */
    prompt?: string;
    /** 完整负面提示词（%negative_prompt%） */
    negative_prompt?: string;
    /** 采样器名（%sampler%） */
    sampler?: string;
    /** 调度器名（%scheduler%） */
    scheduler?: string;
    /** 宽（%width% / 模板中 width 留空时直接注入节点） */
    width?: number;
    height?: number;
    seed?: number;
    steps?: number;
    cfg?: number;
    [key: string]: string | number | undefined;
}

export interface BuildPromptOptions {
    prompt: AnimaPromptParams;
    params: {
        aspect_ratio?: string;
        width?: number;
        height?: number;
        steps?: number;
        cfg?: number;
        seed?: number;
        sampler_name?: string;
        scheduler?: string;
    };
}

/**
 * 拼装提示词并构造占位符替换表。
 * 返回值直接传给 workflow-source 的 fillPlaceholders。
 */
export function buildPlaceholderValues(options: BuildPromptOptions): PlaceholderValues {
    const positive = buildAnimaPositive(options.prompt);
    const negative = buildAnimaNegative(options.prompt.neg, extractSafetyTag(options.prompt.quality_meta_year_safe));
    const { width, height } = resolveDimensions(options.params);

    return {
        [PLACEHOLDER.prompt]: positive,
        [PLACEHOLDER.negativePrompt]: negative,
        [PLACEHOLDER.sampler]: options.params.sampler_name ?? 'er_sde',
        [PLACEHOLDER.scheduler]: options.params.scheduler ?? 'simple',
        [PLACEHOLDER.width]: width,
        [PLACEHOLDER.height]: height,
        [PLACEHOLDER.seed]: options.params.seed ?? -1,
        [PLACEHOLDER.steps]: options.params.steps ?? 30,
        [PLACEHOLDER.cfg]: options.params.cfg ?? 4,
    };
}

/** 1MP 目标对齐（保留给未来自定义尺寸用） */
export function alignTo16(value: number): number {
    return Math.max(16, Math.round(value / 16) * 16);
}

export { WIDTH_HEIGHT_TARGET_MP };
