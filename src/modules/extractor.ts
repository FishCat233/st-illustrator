/**
 * 从角色卡与剧情消息提取提示词素材。
 * 素材是「尽力而为」层：角色卡有就提，没有就留空。
 * 素材不绑定任何生图规范（Anima/SD 通用），具体怎么用由用户模板决定。
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

/** 提取的素材集合，供用户模板用 {xxx} 引用 */
export interface StoryMaterials {
    /** 角色名 */
    character: string;
    /** 角色卡描述前两句（外观素材） */
    appearance: string;
    /** 角色性格 */
    personality: string;
    /** 角色卡场景设定 */
    scenario: string;
    /** 最近剧情摘要（最近一条角色消息正文截断） */
    scene: string;
    /** 最近剧情原文（更长，可自行截断） */
    scene_full: string;
    /** 最近对话记录（带说话人，用户+角色交替，供 LLM 理解剧情） */
    chat_history: string;
}

/** 角色卡描述 → 外观素材（取前 2 句） */
export function extractCharacterAppearance(character: StoryCharacter | undefined): string {
    if (!character) return '';
    const desc = character.description ?? '';
    const sentences = desc
        .split(/[。.!?！？\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return sentences.slice(0, 2).join('，');
}

/** 最近剧情 → scene 素材（最近一条角色消息，截断） */
export function extractScene(chat: StoryMessage[], window: number, maxLen: number): string {
    if (!chat || chat.length === 0) return '';
    const recent = chat.slice(-window);
    for (let i = recent.length - 1; i >= 0; i--) {
        const mes = recent[i]?.mes?.trim();
        if (mes && !recent[i]?.is_user) {
            return mes.slice(0, maxLen);
        }
    }
    return '';
}

/** 最近剧情 → 对话记录素材（带说话人，供 LLM 理解剧情） */
export function extractChatHistory(chat: StoryMessage[], window: number, maxChars: number): string {
    if (!chat || chat.length === 0) return '';
    const recent = chat.slice(-window);
    const lines: string[] = [];
    let total = 0;

    for (const mes of recent) {
        const text = mes?.mes?.trim();
        if (!text) continue;
        const speaker = mes.is_user ? 'User' : (mes.name || 'Character');
        const line = `${speaker}: ${text}`;
        total += line.length;
        if (total > maxChars && lines.length > 0) break;
        lines.push(line);
    }

    return lines.join('\n');
}

/** 从角色卡 + 剧情提取全部素材 */
export function extractMaterials(
    character: StoryCharacter | undefined,
    chat: StoryMessage[],
    config: { sceneWindow?: number; sceneMaxLen?: number; upToIndex?: number } = {},
): StoryMaterials {
    const window = config.sceneWindow ?? 6;
    const maxLen = config.sceneMaxLen ?? 120;
    // 指定截至某条消息时，只取该消息及之前的剧情（回顾式配图）
    const context = config.upToIndex !== undefined ? chat.slice(0, config.upToIndex + 1) : chat;
    const sceneFull = extractScene(context, window, 500);

    return {
        character: character?.name?.trim() ?? '',
        appearance: extractCharacterAppearance(character),
        personality: character?.personality?.trim() ?? '',
        scenario: character?.scenario?.trim() ?? '',
        scene: sceneFull.slice(0, maxLen),
        scene_full: sceneFull,
        chat_history: extractChatHistory(context, window, 1500),
    };
}
