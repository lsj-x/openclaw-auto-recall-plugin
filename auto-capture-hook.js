#!/usr/bin/env node
/**
 * OpenClaw 自动记忆捕获钩子
 * 根据用户消息自动捕获偏好、决策、事实、经验等信息并存入记忆库
 * 
 * 环境变量：
 *   OPENCLAW_USER_MESSAGE - 用户当前消息
 *   CAPTURE_CATEGORIES    - 逗号分隔的类别列表，如 "preference,decision,fact,lesson"
 * 
 * 依赖 nvidia-embeddings.js 提供的 store 函数
 */

const { init, store } = require('./nvidia-embeddings');

// 初始化记忆库
init();

// 各类别的关键词规则（可根据需要扩展）
const CATEGORY_KEYWORDS = {
  preference: ['喜欢', '爱好', 'prefer', 'like', 'love', 'enjoy', 'favorite'],
  decision: ['决定', '选择', '打算', '计划', 'decide', 'choose', 'plan', 'intend', 'will'],
  fact: ['是', '在', '有', '位于', '住在', '出生于', '成立于', 'fact', 'actually', '事实'],
  lesson: ['经验', '教训', '学到', '明白', 'lesson', 'learned', 'realize', '体会']
};

// 每个类别对应的默认重要程度（0-1，可调）
const CATEGORY_IMPORTANCE = {
  preference: 0.6,
  decision: 0.8,
  fact: 0.7,
  lesson: 0.9
};

async function capture() {
  const message = process.env.OPENCLAW_USER_MESSAGE;
  const categoriesEnv = process.env.CAPTURE_CATEGORIES;

  if (!message || !categoriesEnv) {
    // 无消息或无类别配置，直接退出
    process.exit(0);
  }

  const categories = categoriesEnv.split(',').map(c => c.trim());

  for (const category of categories) {
    // 获取该类别的关键词列表，若未定义则跳过
    const keywords = CATEGORY_KEYWORDS[category];
    if (!keywords) continue;

    // 检查消息是否包含任一关键词
    const matched = keywords.some(keyword => message.includes(keyword));
    if (matched) {
      // 构建记忆文本（可附加简单前缀，便于识别）
      const memoryText = `[${category}] ${message}`;
      const importance = CATEGORY_IMPORTANCE[category] || 0.5;

      try {
        // 调用 store 存入记忆库
        await store(memoryText, category, importance);
        // 打印调试信息到 stderr（不影响 stdout）
        console.error(`AutoCapture: ✅ 已存储 [${category}] 记忆: "${memoryText}"`);
      } catch (err) {
        console.error(`AutoCapture: ❌ 存储 [${category}] 记忆失败:`, err.message);
      }
    }
  }
}

// 执行捕获
capture().catch(err => {
  console.error('AutoCapture Hook Error:', err);
  process.exit(1);
});
