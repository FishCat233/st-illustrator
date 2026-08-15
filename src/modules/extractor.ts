import type { AnimaPromptParams } from '../types/comfyui.js';

/**
 * 从角色卡与剧情消息提取 Anima 提示词素材。
 * 提取是「尽力而为」层：角色卡有就提，没有就留空，拼装层跳过空字段。
 */

export interface StoryCharacter {
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    [key: string]: unknown;
}

export interface StoryMessage {
    name?: string;
    is_user?: boolean;
    mes?: string;
    [key: string]: unknown;
}

/** 角色卡 → 角色标签（appearance 素材） */
export function extractCharacterAppearance(character: StoryCharacter | undefined): string {
    if (!character) return '';
    // 描述通常是自然语言段落，取前 2 句作为外观描述素材
    const desc = character.description ?? '';
    const sentences = desc
        .split(/[。.!?！？\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return sentences.slice(0, 2).join('，');
}

/** 角色卡 → 角色名标签（character 字段，优先真实名） */
export function extractCharacterName(character: StoryCharacter | undefined): string {
    if (!character?.name) return '';
    // Danbooru 风格：角色名 + 作品名组合形式由调用方拼接，这里只给名字本体
    return character.name.trim();
}

/** 最近剧情 → tags / nltags 素材 */
export function extractSceneTags(chat: StoryMessage[], window: number): { tags: string; nltags: string } {
    if (!chat || chat.length === 0) return { tags: '', nltags: '' };

    const recent = chat.slice(-window);
    // 自然语言摘取：取最近一条角色消息的正文（截断）
    for (let i = recent.length - 1; i >= 0; i--) {
        const mes = recent[i]?.mes?.trim();
        if (mes && !recent[i]?.is_user) {
            return {
                tags: '',
                nltags: mes.slice(0, 120),
            };
        }
    }
    return { tags: '', nltags: '' };
}

/** 从角色卡 + 剧情组装 Anima 结构化参数（未含生成参数） */
export function buildPromptParams(
    character: StoryCharacter | undefined,
    chat: StoryMessage[],
    config: {
        artist: string;
        qualityMetaYearSafe: string;
        neg: string;
        style?: string;
        sceneWindow?: number;
    },
): AnimaPromptParams {
    const scene = extractSceneTags(chat, config.sceneWindow ?? 6);

    return {
        quality_meta_year_safe: config.qualityMetaYearSafe,
        count: '1girl',
        artist: config.artist,
        tags: scene.tags,
        nltags: scene.nltags,
        neg: config.neg,
        character: extractCharacterName(character) || undefined,
        appearance: extractCharacterAppearance(character) || undefined,
        style: config.style || undefined,
    };
}
