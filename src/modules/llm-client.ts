/**
 * OpenAI 兼容 API 客户端（LLM 提示词生成用）。
 * 插件直连，不经 ST 预设，请求体完全可控。
 */

export interface LlmClientConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature?: number;
    timeoutMs?: number;
}

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LlmResult {
    positive: string;
    negative: string;
}

/** LLM 返回 JSON 的解析结果：positive/negative 都非空才认为有效 */
export class LlmError extends Error { }

/**
 * 调用 OpenAI 兼容 /chat/completions，返回助手消息文本。
 * 失败抛 LlmError（带原因）。
 */
export async function chatCompletion(config: LlmClientConfig, messages: LlmMessage[]): Promise<string> {
    const base = config.baseUrl.replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    const timeoutMs = config.timeoutMs ?? 60_000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: config.model,
                messages,
                temperature: config.temperature ?? 0.7,
                response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new LlmError(`LLM API HTTP ${response.status}`);
        }

        const data = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
            throw new LlmError('LLM 返回空内容');
        }
        return content;
    } catch (error) {
        if (error instanceof LlmError) throw error;
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new LlmError(`LLM 请求超时（${timeoutMs / 1000}s）`);
        }
        throw new LlmError(`LLM 请求失败: ${String(error)}`);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 解析 LLM 返回的 JSON，提取 positive/negative。
 * 兼容纯 JSON 和带 ```json 代码块的输出。
 * 解析失败抛 LlmError。
 */
export function parseLlmJson(content: string): LlmResult {
    let text = content.trim();
    // 去掉 ```json ... ``` 包裹
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        text = fence[1].trim();
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new LlmError('LLM 输出不是有效 JSON');
    }

    if (typeof parsed !== 'object' || parsed === null) {
        throw new LlmError('LLM 输出 JSON 结构错误');
    }

    const obj = parsed as Record<string, unknown>;
    const positive = typeof obj.positive === 'string' ? obj.positive.trim() : '';
    const negative = typeof obj.negative === 'string' ? obj.negative.trim() : '';

    if (!positive) {
        throw new LlmError('LLM 输出缺少 positive 字段');
    }
    return { positive, negative };
}
