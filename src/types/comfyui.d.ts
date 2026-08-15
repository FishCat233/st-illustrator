/**
 * ComfyUI 标准 API 的类型声明（实测确认，见 docs/autonomous-runs/2026-08-15/report-t2.md）
 */

export interface ComfyUIPromptResponse {
    prompt_id: string;
    number: number;
    node_errors: Record<string, unknown>;
}

export interface ComfyUIImage {
    filename: string;
    subfolder: string;
    type: string;
}

export interface ComfyUIOutput {
    images?: ComfyUIImage[];
    [key: string]: unknown;
}

export interface ComfyUIHistoryEntry {
    prompt: unknown;
    outputs: Record<string, ComfyUIOutput>;
    status: {
        status_str: 'success' | 'error';
        completed: boolean;
        messages: string[];
    };
}

export type ComfyUIHistoryResponse = Record<string, ComfyUIHistoryEntry>;

export interface ComfyUIQueueInfo {
    queue_running: unknown[];
    queue_pending: unknown[];
}

/**
 * Anima workflow 节点类型（API 格式，非 UI 格式）。
 * 节点 id 与 AnimaTool 官方模板保持一致。
 */
export type AnimaWorkflow = Record<string, {
    class_type: string;
    inputs: Record<string, unknown>;
}>;

/**
 * Anima 提示词结构化参数（Danbooru 标签规范）。
 * 标签顺序（硬规则）：质量/元数据/年份/安全 → 人数 → 角色 → 作品 → 画师@ → 风格 → 外观 → 标签 → 环境 → 自然语言
 */
export interface AnimaPromptParams {
    /** 质量/年份/安全标签，必须含 safe/sensitive/nsfw/explicit 之一 */
    quality_meta_year_safe: string;
    /** 人数，如 1girl / 2girls / 1boy */
    count: string;
    /** 画师，必须带 @ 前缀，如 "@fkey, @jima" */
    artist: string;
    /** Danbooru 标签 */
    tags: string;
    /** 负面提示词 */
    neg: string;
    /** 角色名（可选） */
    character?: string;
    /** 作品名（可选） */
    series?: string;
    /** 外观描述（可选） */
    appearance?: string;
    /** 画风（可选） */
    style?: string;
    /** 环境/光影（可选） */
    environment?: string;
    /** 自然语言补充（可选，最多一句） */
    nltags?: string;
}

export interface AnimaGenerationParams {
    /** 长宽比预设（如 16:9、9:16），与 width/height 二选一 */
    aspect_ratio?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfg?: number;
    seed?: number;
    sampler_name?: string;
    loras?: Array<{ name: string; weight: number }>;
}
