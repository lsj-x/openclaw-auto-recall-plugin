# OpenClaw Auto-Recall Plugin

OpenClaw 自动记忆召回插件，实现语义搜索与自动捕获功能。

## 功能特性

- **自动召回**: 每次对话前自动搜索相关记忆
- **自动捕获**: 与召回同一 Hook 内执行，自动提取新记忆
- **向量搜索**: 基于 NVIDIA Embeddings 的语义相似度计算

## 安装

```bash
# 克隆仓库
git clone https://github.com/lsj-x/openclaw-auto-recall-plugin.git

# 配置环境变量
export NVIDIA_API_KEY="your-nvidia-api-key"

# 复制到 OpenClaw 插件目录
cp -r openclaw-auto-recall-plugin /root/.openclaw/extensions/auto-recall
```

## 配置

在 `openclaw.json` 中启用插件：

```json
{
  "plugins": {
    "auto-recall": {}
  }
}
```

## 核心文件

- `auto-recall-hook.js`: 统一执行“自动捕获 + 记忆召回”逻辑
- `nvidia-embeddings.js`: NVIDIA API 向量嵌入（供工具脚本使用）

## 安全

⚠️ **请勿提交敏感信息**：
- API Key 应通过环境变量 `NVIDIA_API_KEY` 配置
- 不要将 `.env` 文件或包含密钥的代码提交到仓库

## 许可证

MIT
