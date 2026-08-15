/**
 * 触发策略：判断「现在该不该生成」。
 * 自动模式按频率限制与最小间隔防刷屏；手动模式直接放行。
 */

export interface TriggerConfig {
    enabled: boolean;
    autoMode: boolean;
    /** 连续两条配图的最小间隔（毫秒） */
    minIntervalMs: number;
    /** 自动模式下同一角色连续消息不重复配图？（简单版：消息条数间隔） */
    messagesPerIllustration: number;
}

const DEFAULT_CONFIG: TriggerConfig = {
    enabled: false,
    autoMode: true,
    minIntervalMs: 60_000,
    messagesPerIllustration: 1,
};

export class TriggerController {
    private config: TriggerConfig;
    private lastGeneratedAt = 0;
    private lastMessageIndex = -1;

    constructor(config?: Partial<TriggerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    updateConfig(config: Partial<TriggerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /** 手动触发：只查频率限制 */
    canManualTrigger(): boolean {
        if (!this.config.enabled) return false;
        return Date.now() - this.lastGeneratedAt >= this.config.minIntervalMs;
    }

    /**
     * 自动触发判断：启用 + 自动模式 + 频率 + 消息条数间隔。
     * @param messageIndex 当前消息在 chat 中的下标
     */
    shouldAutoTrigger(messageIndex: number): boolean {
        if (!this.config.enabled) return false;
        if (!this.config.autoMode) return false;
        if (Date.now() - this.lastGeneratedAt < this.config.minIntervalMs) return false;
        if (messageIndex - this.lastMessageIndex < this.config.messagesPerIllustration) return false;
        return true;
    }

    /** 生成成功后调用，记录时间与消息位置 */
    markGenerated(messageIndex: number): void {
        this.lastGeneratedAt = Date.now();
        this.lastMessageIndex = messageIndex;
    }
}
