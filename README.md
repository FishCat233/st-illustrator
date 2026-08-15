# ST Illustrator

给 SillyTavern 对话配图的扩展：AI 把剧情场景画成插画，插到对应的聊天消息里。剧情走到关键处，悬停消息点一下，图就来了；开着自动模式，图自己出现。

## 它能做什么

- **按消息配图**：图挂在触发它的那条消息上，跟着剧情走，不是单独一张
- **LLM 翻译剧情**：先让 LLM 把剧情场景翻译成画面描述，再交给生图模型画出来，画面贴着剧情走
- **工作流自选**：用你自己的 ComfyUI 工作流和模型（Anima / SD 均可），提示词风格由你控制
- **自动或手动**：自动模式按频率自动配图；手动模式想配哪条配哪条

## 需要什么

- SillyTavern 1.12+
- ComfyUI + 生图模型（如 Anima）
- 可选：OpenAI 兼容 LLM API（Ollama / LM Studio / OpenRouter 等），把剧情翻译成画面描述；用规则模板的话可以不要

## 安装

Windows 下把本项目链接到 ST 扩展目录，然后构建：

```powershell
New-Item -ItemType Junction -Path "<SillyTavern>\public\scripts\extensions\st-illustrator" -Target "<本项目路径>"
npm install
npm run build
```

重启 SillyTavern，扩展面板出现「ST Illustrator」即成功。

## 第一次配置（1 分钟）

设置 → 扩展 → ST Illustrator：

1. **连 ComfyUI**：填地址（默认 `http://127.0.0.1:8188`），选一个工作流
2. **选模型**：工作流里没写死的话，填 UNET / CLIP / VAE 模型名
3. **配提示词来源**：生成方式选「LLM」，填 API 地址、模型名（本地服务 Key 可留空）；不想用 LLM 就选「规则模板」
4. 点「测试生成」验证整条链路

工作流约定：用 `%prompt%`、`%negative_prompt%`、`%seed%`、`%steps%` 等占位符标出插件要填的位置，写在哪个节点就填哪个节点。不写也能跑，只是生成参数用工作流自己的默认值。

## 使用

- **手动**：悬停消息 → 点「⋯」→ 点图片按钮，配图插到该消息
- **自动**：打开「启用配图」+ 自动模式，对话到点自动配图（可调最小间隔）
- **设置面板**：「手动配图」给最后一条消息配图

## 配置速查

| 配置 | 说明 | 默认 |
|------|------|------|
| 生成方式 | LLM（剧情 → 画面描述）或规则模板 | LLM |
| LLM API | OpenAI 兼容地址 / Key / 模型名 | 空 |
| 前后缀 | 包在 LLM 结果外的固定词（质量词 / 画师） | Anima 规范版 |
| 提示词模板 | 规则模板模式用的正 / 负面模板 | Anima 规范版 |
| 素材上限 | 喂给 LLM 的剧情量 | 窗口 6 条 / 1500 字符 |
| 长宽比 | 生成尺寸 | 2:3 |
| 步数 / CFG / 采样器 | 生图参数 | 30 / 4 / er_sde |

## 许可

GPLv2（SPDX: GPL-2.0-or-later），详见 [LICENSE](LICENSE)。生图模型按各自许可使用。
