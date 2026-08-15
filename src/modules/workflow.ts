/**
 * 模板渲染与占位符值构建。
 *
 * 与生图规范完全解耦：
 * - 用户提供提示词模板（设置面板），模板内用 {素材} 引用插件提取的素材
 * - 插件渲染模板 → %prompt% 值 → 填充到工作流占位符
 * - Anima 用户写 Anima 风格模板，SD 用户写 SD 风格模板，插件不关心
 */

import type { StoryMaterials } from './extractor.js';

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

/** 由长宽比预设推算宽高（约 1MP，16 对齐）。width/height 显式给定时优先。 */
export function resolveDimensions(params: { width?: number; height?: number; aspect_ratio?: string }): { width: number; height: number } {
    if (params.width && params.height) {
        return { width: params.width, height: params.height };
    }
    if (params.aspect_ratio && ASPECT_RATIOS[params.aspect_ratio]) {
        return ASPECT_RATIOS[params.aspect_ratio];
    }
    return ASPECT_RATIOS['1:1'];
}

/**
 * 渲染用户提示词模板：{character} / {appearance} / {scene} / {personality} / {scenario} / {scene_full}
 * 未提供的素材替换为空串，模板中 {xxx} 换成空后可能留下多余逗号，做基础清理。
 */
export function renderTemplate(template: string, materials: StoryMaterials): string {
    let result = template;
    for (const [key, value] of Object.entries(materials)) {
        result = result.replaceAll(`{${key}}`, value);
    }
    // 清理空素材留下的重复逗号/悬挂逗号
    result = result.replace(/,{2,}/g, ',').replace(/,\s*$/g, '').trim();
    return result;
}

/**
 * 生成随机种子（ComfyUI 要求 seed >= 0，-1 不合法）。
 * 用户填负数（如 -1 表示随机）时使用。
 */
export function randomSeed(): number {
    return Math.floor(Math.random() * 4_294_967_295);
}

/** 生成参数 → 占位符值表（%seed% / %steps% / %cfg% / %sampler% / %scheduler% / %width% / %height%） */
export function buildParamPlaceholders(params: {
    aspect_ratio?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    sampler_name?: string;
    scheduler?: string;
}): Record<string, string | number> {
    const { width, height } = resolveDimensions(params);
    return {
        seed: params.seed !== undefined && params.seed >= 0 ? params.seed : randomSeed(),
        steps: params.steps ?? 30,
        cfg: params.cfg ?? 4,
        sampler: params.sampler_name ?? 'er_sde',
        scheduler: params.scheduler ?? 'simple',
        width,
        height,
    };
}

export { WIDTH_HEIGHT_TARGET_MP };
