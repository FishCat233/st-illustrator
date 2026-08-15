import { eventSource, event_types } from 'st/events';
import { getContext } from 'st/extensions';

/**
 * 消息菜单按钮：给每条消息的原生「⋯」菜单（.extraMesButtons）注入「配图」按钮。
 * 按钮只在悬停消息时随原生菜单出现，不污染界面。
 * 点击 → illustrateMessage(mesid)，mesid 即 chat 数组下标。
 */

const BUTTON_CLASS = 'sti_message_gen';
const BUTTON_TITLE = '为这条消息配图';

/** 已注入按钮的消息下标集合（防重复注入） */
const injected = new Set<number>();

/** 注册渲染事件，消息渲染完成后注入按钮 */
export function initMessageButtons(): void {
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (messageId: number) => {
        injectButton(messageId);
    });
    eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId: number) => {
        injectButton(messageId);
    });
    // 历史消息在扩展加载前已渲染，不触发渲染事件——聊天加载/翻页时批量补注入
    eventSource.on(event_types.CHAT_LOADED, () => {
        injectAllVisible();
    });
    eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
        injectAllVisible();
    });

    // 事件委托：按钮是动态注入的，用 document 级委托
    $(document).on('click', `.${BUTTON_CLASS}`, async (event) => {
        event.preventDefault();
        const $button = $(event.currentTarget);
        const $mes = $button.closest('.mes');
        const mesId = Number($mes.attr('mesid'));
        if (Number.isNaN(mesId) || mesId < 0) return;

        // 忙碌状态提示（简单转圈）
        $button.addClass('fa-spin');
        try {
            const { illustrateMessage } = await import('../main.js');
            await illustrateMessage(mesId);
        } catch (error) {
            console.error('[st-illustrator] 消息配图失败:', error);
        } finally {
            $button.removeClass('fa-spin');
        }
    });
}

/** 给当前可见的所有消息补注入按钮（历史消息批量场景） */
function injectAllVisible(): void {
    $('.mes').each((_, element) => {
        const mesId = Number($(element).attr('mesid'));
        if (!Number.isNaN(mesId) && mesId >= 0) {
            injectButton(mesId);
        }
    });
}

/** 向消息的 ⋯ 菜单注入配图按钮（幂等） */
function injectButton(messageId: number): void {
    if (injected.has(messageId)) return;

    const context = getContext() as {
        chat: unknown[];
    };
    const mesId = Number(messageId);
    if (Number.isNaN(mesId) || mesId < 0) return;
    if (!context.chat || mesId >= context.chat.length) return;

    const $mes = $(`.mes[mesid="${mesId}"]`);
    if ($mes.length === 0) return;

    const $menu = $mes.find('.extraMesButtons');
    if ($menu.length === 0) return;

    $menu.append(
        $('<div>', {
            class: `mes_button ${BUTTON_CLASS} fa-solid fa-image`,
            title: BUTTON_TITLE,
        }),
    );
    injected.add(mesId);
}
