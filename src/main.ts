import { eventSource, event_types } from 'st/events';

const EXTENSION_NAME = 'st-illustrator';

async function onExtensionSettingsLoaded() {
    console.log(`[${EXTENSION_NAME}] 扩展已加载，版本 0.1.0`);
}

export function init() {
    console.log(`[${EXTENSION_NAME}] 初始化`);
    eventSource.on(event_types.EXTENSION_SETTINGS_LOADED, onExtensionSettingsLoaded);
}

init();
