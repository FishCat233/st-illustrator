import type {
    ComfyUIHistoryResponse,
    ComfyUIPromptResponse,
    ComfyUIImage,
    AnimaWorkflow,
} from '../types/comfyui.js';

/**
 * ComfyUI 生成客户端：提交 workflow → 轮询 history → 取图。
 * 只依赖 ComfyUI 标准 API（POST /prompt、GET /history/<id>、GET /view），
 * 不依赖第三方 custom node。
 */

export interface GeneratorSettings {
    comfyUrl: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
}

export class ComfyUIGenerator {
    private readonly url: string;
    private readonly timeoutMs: number;
    private readonly pollIntervalMs: number;

    constructor(settings: GeneratorSettings) {
        this.url = settings.comfyUrl.replace(/\/+$/, '');
        this.timeoutMs = settings.timeoutMs ?? 300_000;
        this.pollIntervalMs = settings.pollIntervalMs ?? 2_000;
    }

    /**
     * 提交 workflow 并等待完成，返回生成图片列表。
     * 出错时抛 Error，错误信息带后端返回的详情。
     */
    async generate(workflow: AnimaWorkflow): Promise<ComfyUIImage[]> {
        const promptId = await this.submit(workflow);
        const history = await this.waitForResult(promptId);
        const entry = history[promptId];

        if (!entry || entry.status?.status_str !== 'success') {
            const messages = entry?.status?.messages?.join('; ') ?? '未知错误';
            throw new Error(`ComfyUI 生成失败: ${messages}`);
        }

        const images: ComfyUIImage[] = [];
        for (const output of Object.values(entry.outputs)) {
            if (output.images) {
                images.push(...output.images);
            }
        }
        if (images.length === 0) {
            throw new Error('ComfyUI 生成完成但没有输出图片');
        }
        return images;
    }

    /** 图片 URL（/view 端点） */
    imageUrl(image: ComfyUIImage): string {
        const params = new URLSearchParams({
            filename: image.filename,
            type: image.type ?? 'output',
        });
        if (image.subfolder) {
            params.set('subfolder', image.subfolder);
        }
        return `${this.url}/view?${params.toString()}`;
    }

    private async submit(workflow: AnimaWorkflow): Promise<string> {
        const response = await fetch(`${this.url}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: workflow,
                client_id: `st-illustrator-${Date.now()}`,
            }),
        });

        if (!response.ok) {
            throw new Error(`提交 ComfyUI 失败: HTTP ${response.status}`);
        }

        const data = (await response.json()) as ComfyUIPromptResponse;
        if (!data.prompt_id) {
            throw new Error('ComfyUI 返回缺少 prompt_id');
        }
        return data.prompt_id;
    }

    private async waitForResult(promptId: string): Promise<ComfyUIHistoryResponse> {
        const deadline = Date.now() + this.timeoutMs;
        while (Date.now() < deadline) {
            const response = await fetch(`${this.url}/history/${promptId}`);
            if (response.ok) {
                const history = (await response.json()) as ComfyUIHistoryResponse;
                if (history[promptId]) {
                    return history;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
        throw new Error(`ComfyUI 生成超时（${this.timeoutMs / 1000}s）`);
    }
}
