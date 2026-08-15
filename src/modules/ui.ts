import { getContext, renderExtensionTemplateAsync } from 'st/extensions';
import { saveSettingsDebounced } from 'st/script';
import { defaultSettings, type Settings } from '../main.js';
import { listWorkflows } from './workflow-source.js';

/**
 * 设置面板：渲染模板、读写 extension_settings、绑定控件事件。
 * 控件 id 与 settings.html 一一对应。
 */

const CONTAINER_ID = 'st_illustrator_container';

export function getSettings(): Settings {
    const extensionSettings = getContext()?.extensionSettings as Record<string, unknown>;
    return { ...defaultSettings, ...(extensionSettings.st_illustrator as Partial<Settings>) };
}

export function setSettings(settings: Settings): void {
    const extensionSettings = getContext()?.extensionSettings as Record<string, unknown>;
    extensionSettings.st_illustrator = settings;
    saveSettingsDebounced();
}

export async function addSettingsUI(): Promise<void> {
    // 第三方扩展不预设容器，动态创建后挂到 #extensions_settings（ST 设置面板）
    let container = $(`#${CONTAINER_ID}`);
    if (container.length === 0) {
        container = $('<div>', { id: CONTAINER_ID, class: 'extension_container' }).appendTo('#extensions_settings');
    }
    const html = await renderExtensionTemplateAsync('st-illustrator', 'settings');
    container.append(html);
    bindSettingsUI();
}

/** 从 ComfyUI 拉取工作流列表，填充下拉框 */
async function loadWorkflowList(): Promise<void> {
    const settings = getSettings();
    const select = $('#sti_workflow_file');
    try {
        const files = await listWorkflows(settings.comfyUrl);
        if (files.length === 0) {
            select.html('<option value="">未找到工作流（确认 ComfyUI 有 workflows 目录）</option>');
            return;
        }
        const current = settings.workflowFile;
        let options = '';
        for (const file of files) {
            options += `<option value="${file.path}"${file.path === current ? ' selected' : ''}>${file.name}</option>`;
        }
        select.html(options);
    } catch (error) {
        select.html('<option value="">工作流列表加载失败（检查 ComfyUI 地址）</option>');
        console.error('加载工作流列表失败:', error);
    }
}

function bindSettingsUI(): void {
    const settings = getSettings();

    $('#sti_enabled').prop('checked', settings.enabled);
    $('#sti_auto_mode').val(settings.autoMode ? 'auto' : 'manual');
    $('#sti_min_interval').val(settings.minIntervalMs / 1000);
    $('#sti_comfy_url').val(settings.comfyUrl);
    $('#sti_model_unet').val(settings.modelUnet);
    $('#sti_model_clip').val(settings.modelClip);
    $('#sti_model_vae').val(settings.modelVae);
    $('#sti_prompt_template').val(settings.promptTemplate);
    $('#sti_negative_template').val(settings.negativeTemplate);
    $('#sti_aspect_ratio').val(settings.aspectRatio);
    $('#sti_steps').val(settings.steps);
    $('#sti_cfg').val(settings.cfg);
    $('#sti_seed').val(settings.seed);
    $('#sti_sampler_name').val(settings.samplerName);
    $('#sti_scheduler').val(settings.scheduler);

    // 工作流列表：从 ComfyUI 拉取
    loadWorkflowList().catch((error) => console.error('加载工作流列表失败:', error));

    // 所有控件变化 → 保存
    $('#sti_enabled').on('change', () => {
        const next = getSettings();
        next.enabled = !!$('#sti_enabled').prop('checked');
        setSettings(next);
    });
    $('#sti_auto_mode').on('change', () => {
        const next = getSettings();
        next.autoMode = $('#sti_auto_mode').val() === 'auto';
        setSettings(next);
    });
    $('#sti_min_interval').on('change', () => {
        const next = getSettings();
        next.minIntervalMs = Math.max(0, Number($('#sti_min_interval').val()) * 1000);
        setSettings(next);
    });
    $('#sti_comfy_url').on('change', () => {
        const next = getSettings();
        next.comfyUrl = String($('#sti_comfy_url').val() ?? defaultSettings.comfyUrl);
        setSettings(next);
    });
    $('#sti_model_unet').on('change', () => {
        const next = getSettings();
        next.modelUnet = String($('#sti_model_unet').val() ?? defaultSettings.modelUnet);
        setSettings(next);
    });
    $('#sti_model_clip').on('change', () => {
        const next = getSettings();
        next.modelClip = String($('#sti_model_clip').val() ?? defaultSettings.modelClip);
        setSettings(next);
    });
    $('#sti_model_vae').on('change', () => {
        const next = getSettings();
        next.modelVae = String($('#sti_model_vae').val() ?? '');
        setSettings(next);
    });
    $('#sti_prompt_template').on('change', () => {
        const next = getSettings();
        next.promptTemplate = String($('#sti_prompt_template').val() ?? defaultSettings.promptTemplate);
        setSettings(next);
    });
    $('#sti_negative_template').on('change', () => {
        const next = getSettings();
        next.negativeTemplate = String($('#sti_negative_template').val() ?? defaultSettings.negativeTemplate);
        setSettings(next);
    });
    $('#sti_aspect_ratio').on('change', () => {
        const next = getSettings();
        next.aspectRatio = String($('#sti_aspect_ratio').val() ?? defaultSettings.aspectRatio);
        setSettings(next);
    });
    $('#sti_steps').on('change', () => {
        const next = getSettings();
        next.steps = Number($('#sti_steps').val());
        setSettings(next);
    });
    $('#sti_cfg').on('change', () => {
        const next = getSettings();
        next.cfg = Number($('#sti_cfg').val());
        setSettings(next);
    });
    $('#sti_seed').on('change', () => {
        const next = getSettings();
        next.seed = Number($('#sti_seed').val());
        setSettings(next);
    });
    $('#sti_workflow_file').on('change', () => {
        const next = getSettings();
        next.workflowFile = String($('#sti_workflow_file').val() ?? defaultSettings.workflowFile);
        setSettings(next);
    });
    $('#sti_sampler_name').on('change', () => {
        const next = getSettings();
        next.samplerName = String($('#sti_sampler_name').val() ?? defaultSettings.samplerName);
        setSettings(next);
    });
    $('#sti_scheduler').on('change', () => {
        const next = getSettings();
        next.scheduler = String($('#sti_scheduler').val() ?? defaultSettings.scheduler);
        setSettings(next);
    });

    $('#sti_test_generate').on('click', async () => {
        const { manualGenerate } = await import('../main.js');
        try {
            const ok = await manualGenerate();
            $('#sti_status').text(ok ? '生成成功' : '未生成（看控制台）');
        } catch (error) {
            $('#sti_status').text(`生成失败: ${String(error)}`);
        }
    });

    $('#sti_manual_generate').on('click', async () => {
        const { manualGenerate } = await import('../main.js');
        try {
            const ok = await manualGenerate();
            $('#sti_status').text(ok ? '生成成功' : '未生成（看控制台）');
        } catch (error) {
            $('#sti_status').text(`生成失败: ${String(error)}`);
        }
    });
}
