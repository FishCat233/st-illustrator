import { chatCompletion, parseLlmJson, LlmError, type LlmClientConfig, type LlmResult } from './llm-client.js';
import type { StoryMaterials } from './extractor.js';

/**
 * LLM 提示词生成编排：剧情上下文 → LLM 提示词模板 → LLM → Positive/Negative。
 *
 * 分层：
 * - 用户可编辑的「LLM 提示词模板」指导 LLM 如何从剧情提炼画面（不猜用户工作流）
 * - LLM 输出 JSON {positive, negative}
 * - 用户可配前后缀注入到 LLM 结果（如质量词前缀、画师标签）
 * - LLM 不可用时由调用方降级到规则模板
 */

export interface LlmPromptConfig {
    client: LlmClientConfig;
    /** 指导 LLM 的提示词模板（可含 {素材} 占位符） */
    template: string;
    /** 注入到 positive 结果的开头（如 "masterpiece, best quality, "） */
    positivePrefix: string;
    /** 注入到 positive 结果的结尾（如 ", @fkey"） */
    positiveSuffix: string;
    /** 注入到 negative 结果的开头 */
    negativePrefix: string;
    /** 注入到 negative 结果的结尾 */
    negativeSuffix: string;
}

/** 素材 JSON（模板可引用的字段） */
function materialsJson(materials: StoryMaterials): string {
    return JSON.stringify(materials, null, 2);
}

/**
 * 用 LLM 生成提示词。成功返回 {positive, negative}，失败抛 LlmError。
 * @param materials 剧情素材
 * @param characterName 角色名（用于模板）
 */
export async function generateWithLlm(
    config: LlmPromptConfig,
    materials: StoryMaterials,
): Promise<LlmResult> {
    // 渲染用户模板（{素材} 占位符替换）——渲染器会清掉空素材留下的逗号
    const template = renderLlmTemplate(config.template, materials);

    const messages = [
        {
            role: 'system' as const,
            content: '你是插画提示词工程师。根据剧情素材输出 JSON，格式为 {"positive": "正面提示词", "negative": "负面提示词"}。正面提示词描述画面构图、场景、动作、氛围，不要写质量词（调用方会加）。负面提示词列常见的崩坏项。',
        },
        {
            role: 'user' as const,
            content: template,
        },
    ];

    const raw = await chatCompletion(config.client, messages);
    const result = parseLlmJson(raw);

    // 前后缀注入
    result.positive = `${config.positivePrefix}${result.positive}${config.positiveSuffix}`.replace(/,{2,}/g, ',').replace(/,+\s*$/g, '').trim();
    result.negative = `${config.negativePrefix}${result.negative}${config.negativeSuffix}`.replace(/,{2,}/g, ',').replace(/,+\s*$/g, '').trim();

    return result;
}

/** 渲染 LLM 提示词模板（{素材} 占位符替换，含场景 JSON） */
function renderLlmTemplate(template: string, materials: StoryMaterials): string {
    let result = template;
    for (const [key, value] of Object.entries(materials)) {
        result = result.replaceAll(`{${key}}`, value);
    }
    result = result.replaceAll('{materials}', materialsJson(materials));
    result = result.replace(/,{2,}/g, ',').replace(/,\s*$/g, '').trim();
    return result;
}

export { LlmError };
