# ST Illustrator

SillyTavern 配图扩展：给聊天里的任何一条消息配一张插画。剧情走到后面才回味过来「这里该有图」？悬停消息，点一下，图就来了。

作者：FishCat233

## 特点

- **按消息配图**：想给哪条配就给哪条，图插在那条消息里
- **AI 翻译剧情**：LLM 把剧情场景翻译成画面描述（轻小说插画风），不是角色设定图
- **工作流自选**：用自己的 ComfyUI 工作流，改工作流不用改插件
- **模型无关**：Anima / SD / 其他，提示词风格由你配置

## 需要什么

- SillyTavern 1.12+
- ComfyUI（含你要用的生图模型，如 Anima）
- 可选：OpenAI 兼容的 LLM API（Ollama / LM Studio / OpenRouter 等），用来把剧情翻译成画面描述

## 安装

把扩展目录链接到 SillyTavern 的扩展目录（Windows）：

```powershell
New-Item -ItemType Junction -Path "<SillyTavern>\public\scripts\extensions\st-illustrator" -Target "<本项目路径>"
```

然后：

```bash
npm install
npm run build
```

重启 SillyTavern，扩展面板应出现「ST Illustrator」。

## 配置

打开 SillyTavern 设置 → 扩展 → ST Illustrator：

1. **ComfyUI**：填地址（默认 `http://127.0.0.1:8188`），选你的工作流（`t.json` 等）
2. **生成方式**：选「LLM」，填 LLM API 地址 / Key / 模型名
3. **提示词模板**：按需调整（默认已按 Anima 规范配好）

工作流约定：用 `%prompt%`、`%negative_prompt%`、`%sampler%`、`%scheduler%` 等占位符标出插件要填的位置，写在哪个节点就填哪个节点。不写占位符的工作流也能跑，只是提示词不会注入。

## 使用

悬停任意消息 → 点「⋯」→ 点图片按钮 → 等图插入该消息。

## 配置项速查

| 配置 | 说明 | 默认 |
|------|------|------|
| 生成方式 | LLM（剧情→画面描述）或 规则模板 | LLM |
| LLM API | OpenAI 兼容地址/Key/模型 | 空 |
| LLM 模板 | 指导 LLM 怎么翻译剧情 | Anima 规范版 |
| 前后缀 | 注入 LLM 结果（质量词/画师） | 已配 |
| 素材上限 | 喂给 LLM 的剧情上下文长度 | 窗口 6 条 / 1500 字符 |
| 工作流 | ComfyUI 里的工作流文件 | workflows/t.json |

## 许可

[GPLv2](LICENSE)。生图模型（如 Anima）按各自许可使用。
