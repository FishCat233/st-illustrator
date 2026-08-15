import type { AnimaPromptParams } from '../types/comfyui.js';

/**
 * Anima 提示词拼装（Danbooru 标签规范）。
 * 标签顺序是硬规则（AnimaTool knowledge 确认）：
 * [质量/元数据/年份/安全] [人数] [角色名] [作品名] [画师@] [风格] [外观] [标签] [环境] [自然语言]
 *
 * 所有字段可选拼装，空字段跳过；字段内部用逗号连接。
 * 纯函数，便于人工核对与后续测试。
 */

const QUALITY_SAFETY = ['safe', 'sensitive', 'nsfw', 'explicit'] as const;

export function isQualityMetaYearSafeValid(value: string): boolean {
    return QUALITY_SAFETY.some((tag) => value.includes(tag));
}

/**
 * 按 Anima 标签顺序拼装完整提示词。
 * 自然语言（nltags）放最后，是「实在没法用 tag 才写」的兜底。
 */
export function buildAnimaPositive(params: AnimaPromptParams): string {
    const parts: string[] = [];

    parts.push(params.quality_meta_year_safe);
    parts.push(params.count);
    pushIf(parts, params.character);
    pushIf(parts, params.series);
    pushIf(parts, params.artist);
    pushIf(parts, params.style);
    pushIf(parts, params.appearance);
    pushIf(parts, params.tags);
    pushIf(parts, params.environment);
    pushIf(parts, params.nltags);

    return parts.join(', ');
}

/**
 * 组装负面提示词：用户自定义 neg + 安全标签相反约束。
 * 规范要求正面 safe 时负面要带 nsfw/explicit 约束。
 */
export function buildAnimaNegative(neg: string, safetyTag: string): string {
    const parts: string[] = [];
    pushIf(parts, neg);

    const safe = safetyTag === 'safe' || safetyTag === 'sensitive';
    if (safe) {
        parts.push('nsfw, explicit');
    } else if (safetyTag === 'nsfw') {
        parts.push('explicit');
    }

    return parts.join(', ');
}

function pushIf(parts: string[], value?: string): void {
    if (value && value.trim().length > 0) {
        parts.push(value.trim());
    }
}

/** 提取 safety tag（quality_meta_year_safe 中第一个匹配的安全标签），默认 safe */
export function extractSafetyTag(qualityMetaYearSafe: string): string {
    const found = QUALITY_SAFETY.find((tag) => qualityMetaYearSafe.includes(tag));
    return found ?? 'safe';
}
