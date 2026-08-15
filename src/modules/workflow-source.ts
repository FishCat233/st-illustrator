import type { AnimaWorkflow } from '../types/comfyui.js';
import { comfyFetch } from './comfy-fetch.js';

/**
 * 工作流加载与占位符协议。
 *
 * 核心设计：插件与工作流通过「占位符」解耦，插件不理解工作流内部结构。
 * - 插件提供一组占位符值（%prompt% / %seed% / %width% / 自定义...）
 * - 工作流任意节点任意输入框写 %xxx% 即被替换，写在哪由用户决定
 * - 不按 class_type 猜结构、不注入特定节点——复杂工作流（subgraph、
 *   多 KSampler、inpaint 分支、控制节点）天然兼容
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
    /** 模型的默认值（UNET/CLIP/VAE，若有） */
    defaultModels: { unet?: string; clip?: string; vae?: string };
}

/** 列出 ComfyUI user/default/workflows 下的工作流文件 */
export async function listWorkflows(comfyUrl: string): Promise<WorkflowFileInfo[]> {
    const path = `/v2/userdata?path=${encodeURIComponent('workflows')}`;
    const response = await comfyFetch(comfyUrl, path);
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
    const path = `/userdata/${encodeURIComponent(filePath)}`;
    const response = await comfyFetch(comfyUrl, path);
    if (!response.ok) {
        throw new Error(`读取工作流失败: HTTP ${response.status}`);
    }
    const raw = (await response.json()) as ComfyUIWorkflowFile;
    return parseWorkflow(raw);
}

/** ComfyUI UI 格式工作流文件 */
export interface ComfyUIWorkflowFile {
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

    return { workflow: api, defaultModels };
}

/** 扫描工作流所有字符串输入，收集 %xxx% 占位符（不含 %） */
export function collectPlaceholders(workflow: AnimaWorkflow): string[] {
    const found = new Set<string>();
    for (const node of Object.values(workflow)) {
        for (const value of Object.values(node.inputs)) {
            if (typeof value === 'string' && value.includes('%')) {
                for (const match of value.matchAll(/%([^%]+)%/g)) {
                    found.add(match[1]);
                }
            }
        }
    }
    return [...found];
}

/**
 * 替换工作流中的占位符（原地修改并返回）。
 * 值替换后自动类型转换：纯数字字符串转 number，布尔转 boolean。
 * 未提供值的占位符保持原样（由调用方用 hasUnresolvedPlaceholders 检查）。
 */
export function fillPlaceholders(
    workflow: AnimaWorkflow,
    values: Record<string, string | number | boolean | undefined>,
): AnimaWorkflow {
    for (const node of Object.values(workflow)) {
        for (const [key, value] of Object.entries(node.inputs)) {
            if (typeof value !== 'string' || !value.includes('%')) continue;
            let replaced = value;
            for (const [placeholder, replacement] of Object.entries(values)) {
                if (replacement !== undefined) {
                    replaced = replaced.replaceAll(`%${placeholder}%`, String(replacement));
                }
            }
            node.inputs[key] = coerceValue(replaced);
        }
    }
    return workflow;
}

/** 字符串值智能转换：纯数字 → number，true/false → boolean，其余保持字符串 */
function coerceValue(value: string): string | number | boolean {
    if (/^-?\d+$/.test(value)) return Number(value);
    if (/^-?\d+\.\d+$/.test(value)) return Number(value);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
}

/** 检查工作流中是否还有未替换的 %xxx% 占位符（替换后残留 = 值缺失） */
export function hasUnresolvedPlaceholders(workflow: AnimaWorkflow): string[] {
    const unresolved = new Set<string>();
    for (const node of Object.values(workflow)) {
        for (const value of Object.values(node.inputs)) {
            if (typeof value === 'string' && value.includes('%')) {
                for (const match of value.matchAll(/%([^%]+)%/g)) {
                    unresolved.add(match[1]);
                }
            }
        }
    }
    return [...unresolved];
}

/**
 * 兜底填充工作流中留空的必填生成参数（通用机制，不绑定生图规范）。
 * 用户工作流里 seed/steps/cfg/width/height 等输入框留空时，
 * 用插件的生成参数补上。有值的（含占位符替换后的）不覆盖。
 * 按节点类型做字段映射，复杂工作流的多实例节点（多 KSampler）全部生效。
 */
export function fillMissingParams(
    workflow: AnimaWorkflow,
    values: Record<string, string | number | boolean | undefined>,
): AnimaWorkflow {
    const NODE_DEFAULT_INPUTS: Record<string, Record<string, string>> = {
        KSampler: { seed: 'seed', steps: 'steps', cfg: 'cfg', sampler_name: 'sampler', scheduler: 'scheduler', denoise: 'denoise' },
        KSamplerAdvanced: { steps: 'steps', cfg: 'cfg', sampler_name: 'sampler', scheduler: 'scheduler' },
        EmptyLatentImage: { width: 'width', height: 'height', batch_size: 'batch_size' },
    };

    for (const node of Object.values(workflow)) {
        const mapping = NODE_DEFAULT_INPUTS[node.class_type];
        if (!mapping) continue;
        for (const [inputName, valueKey] of Object.entries(mapping)) {
            const current = node.inputs[inputName];
            const isMissing = current === undefined || current === null || (typeof current === 'string' && current.trim() === '');
            if (isMissing) {
                node.inputs[inputName] = values[valueKey] ?? defaultNumber(valueKey);
            }
        }
    }
    return workflow;
}

function defaultNumber(key: string): number {
    switch (key) {
        case 'seed': return Math.floor(Math.random() * 4_294_967_295);
        case 'steps': return 30;
        case 'cfg': return 4;
        case 'denoise': return 1;
        case 'batch_size': return 1;
        case 'width': return 1024;
        case 'height': return 1024;
        case 'sampler': return -1;
        default: return -1;
    }
}
