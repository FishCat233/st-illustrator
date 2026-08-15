import type { AnimaWorkflow } from '../types/comfyui.js';

/**
 * ComfyUI 工作流远程加载与解析。
 * 通过 ComfyUI 的 userdata API 读取用户在 ComfyUI 里设计的工作流（UI 格式），
 * 转换为 API 格式并替换占位符。用户改工作流无需改插件。
 *
 * API：
 * - GET /v2/userdata?path=workflows → 工作流文件列表
 * - GET /userdata/workflows%2F<name> → 工作流文件内容（UI 格式，/ 需 URL 编码）
 */

export interface WorkflowFileInfo {
    name: string;
    path: string;
}

export interface ParsedWorkflow {
    /** API 格式 workflow，可直接 POST /prompt */
    workflow: AnimaWorkflow;
    /** 模板中的占位符集合，如 ['%prompt%', '%sampler%'] */
    placeholders: string[];
    /** 模型的默认值（UNET/CLIP/VAE，若有） */
    defaultModels: { unet?: string; clip?: string; vae?: string };
}

/** 列出 ComfyUI user/default/workflows 下的工作流文件 */
export async function listWorkflows(comfyUrl: string): Promise<WorkflowFileInfo[]> {
    const url = `${comfyUrl.replace(/\/+$/, '')}/v2/userdata?path=${encodeURIComponent('workflows')}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`获取工作流列表失败: HTTP ${response.status}`);
    }
    const files = (await response.json()) as Array<{ name: string; type: string; path: string }>;
    return files
        .filter((f) => f.type === 'file' && f.name.endsWith('.json'))
        .map((f) => ({ name: f.name, path: f.path }));
}

/** 读取并解析工作流（UI 格式 → API 格式） */
export async function loadWorkflow(comfyUrl: string, filePath: string): Promise<ParsedWorkflow> {
    const url = `${comfyUrl.replace(/\/+$/, '')}/userdata/${encodeURIComponent(filePath)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`读取工作流失败: HTTP ${response.status}`);
    }
    const raw = (await response.json()) as ComfyUIWorkflowFile;
    return parseWorkflow(raw);
}

/** ComfyUI UI 格式工作流文件 */
interface ComfyUIWorkflowFile {
    nodes: Array<{
        id: number;
        type: string;
        mode?: number;
        inputs?: Array<{
            name: string;
            link: number | string | null;
            widget?: { name: string };
        }>;
        widgets_values?: unknown[];
    }>;
    links: Array<[number, number, number, number, number, string]>;
}

/** KSampler 类节点：widgets_values 含 control_after_generate（seed 的 randomize/fixed 下拉），需跳过 */
const CONTROL_AFTER_GENERATE_NODES = new Set(['KSampler', 'KSamplerAdvanced', 'RandomNoise']);

/**
 * UI 格式 → API 格式。
 * - link 输入 → ["<来源节点id>", slot]
 * - widget 输入 → 对应 widgets_values 值（跳过 control_after_generate 偏移）
 * - mode 4（bypassed）节点跳过；null/空串值不输出（由调用方填）
 */
export function parseWorkflow(raw: ComfyUIWorkflowFile): ParsedWorkflow {
    const api: AnimaWorkflow = {};
    const placeholders = new Set<string>();
    const defaultModels: { unet?: string; clip?: string; vae?: string } = {};

    for (const node of raw.nodes) {
        if (node.mode === 4) continue;

        const inputs: Record<string, unknown> = {};
        let widgetIdx = 0;
        const skipControlAfter = CONTROL_AFTER_GENERATE_NODES.has(node.type);

        for (const input of node.inputs ?? []) {
            if (input.link != null && input.link !== '') {
                const link = raw.links.find((l) => l[0] === Number(input.link));
                if (!link) continue;
                inputs[input.name] = [String(link[1]), link[2]];
            } else if (input.widget && node.widgets_values && widgetIdx < node.widgets_values.length) {
                let value = node.widgets_values[widgetIdx];
                if (skipControlAfter && input.name === 'seed') {
                    widgetIdx += 2;
                } else {
                    widgetIdx++;
                }
                if (value !== null && value !== '') {
                    if (typeof value === 'string' && value.includes('%')) {
                        placeholders.add(value);
                    }
                    inputs[input.name] = value;
                }
            }
        }

        api[String(node.id)] = { class_type: node.type, inputs };

        // 提取模型默认值（用户在工作流里选的模型）
        if (node.type === 'UNETLoader' && typeof inputs.unet_name === 'string') {
            defaultModels.unet = inputs.unet_name;
        }
        if (node.type === 'CLIPLoader' && typeof inputs.clip_name === 'string') {
            defaultModels.clip = inputs.clip_name;
        }
        if (node.type === 'VAELoader' && typeof inputs.vae_name === 'string') {
            defaultModels.vae = inputs.vae_name;
        }
    }

    return { workflow: api, placeholders: [...placeholders], defaultModels };
}

/**
 * 替换 workflow 中的占位符。
 * @param workflow 解析后的 workflow（会原地修改并返回）
 * @param values 占位符 → 值（不含 %）
 */
export function fillPlaceholders(
    workflow: AnimaWorkflow,
    values: Record<string, string | number | undefined>,
): AnimaWorkflow {
    for (const node of Object.values(workflow)) {
        for (const [key, value] of Object.entries(node.inputs)) {
            if (typeof value === 'string' && value.includes('%')) {
                let replaced = value;
                for (const [placeholder, replacement] of Object.entries(values)) {
                    if (replacement !== undefined) {
                        replaced = replaced.replaceAll(`%${placeholder}%`, String(replacement));
                    }
                }
                node.inputs[key] = replaced;
            }
        }
    }
    return workflow;
}

/** 检查工作流是否包含指定占位符 */
export function hasPlaceholder(workflow: AnimaWorkflow, placeholder: string): boolean {
    for (const node of Object.values(workflow)) {
        for (const value of Object.values(node.inputs)) {
            if (typeof value === 'string' && value.includes(`%${placeholder}%`)) {
                return true;
            }
        }
    }
    return false;
}
