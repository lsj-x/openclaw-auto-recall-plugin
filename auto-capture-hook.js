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

// 补充正则模式，避免仅靠 includes 导致漏检
const CATEGORY_PATTERNS = {
  preference: [
    /(?:我|我们)?(?:更)?(?:喜欢|偏好|倾向于|希望|想要)(.+?)(?:[。！？!?,，]|$)/i,
    /(?:prefer|like|love)\s+(.+?)(?:[.!?,]|$)/i
  ],
  decision: [
    /(?:我|我们)?(?:决定|选择|打算|计划|准备)(?:用|使用|采用)?(.+?)(?:[。！？!?,，]|$)/i,
    /(?:decide|choose|plan|intend)\s+(?:to\s+)?(.+?)(?:[.!?,]|$)/i
  ],
  fact: [
    /(?:事实|注意|关键|记住)(?:是|为|：|:)?(.+?)(?:[。！？!?,，]|$)/i,
    /(.+?)(?:比|相比|相较于)(.+?)(?:更|更快|更慢|更好|更差)/i
  ],
  lesson: [
    /(?:经验|教训|我学到|我明白|我意识到)(.+?)(?:[。！？!?,，]|$)/i,
    /(?:lesson learned|learned that|realized that)\s+(.+?)(?:[.!?,]|$)/i
  ]
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
  const normalizedMessage = message.toLowerCase();
  let storedCount = 0;
  const seen = new Set();

  for (const category of categories) {
    // 获取该类别的关键词列表，若未定义则跳过
    const keywords = CATEGORY_KEYWORDS[category];
    if (!keywords) continue;

    // 检查消息是否包含任一关键词（大小写不敏感）
    const keywordMatched = keywords.some(keyword =>
      normalizedMessage.includes(keyword.toLowerCase())
    );

    // 补充正则识别
    const patternMatched = (CATEGORY_PATTERNS[category] || []).some(pattern =>
      pattern.test(message)
    );

    if (keywordMatched || patternMatched) {
      // 构建记忆文本（可附加简单前缀，便于识别）
      const memoryText = `[${category}] ${message}`;
      const importance = CATEGORY_IMPORTANCE[category] || 0.5;

      // 单次消息去重：避免同一条 message 被重复写入
      const dedupeKey = `${category}:${memoryText}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      try {
        // 调用 store 存入记忆库
        await store(memoryText, category, importance);
        storedCount += 1;
        // 打印调试信息到 stderr（不影响 stdout）
        console.error(`AutoCapture: ✅ 已存储 [${category}] 记忆: "${memoryText}"`);
      } catch (err) {
        console.error(`AutoCapture: ❌ 存储 [${category}] 记忆失败:`, err.message);
      }
    }
  }

  if (storedCount === 0) {
    console.error('AutoCapture: ℹ️ 未匹配到可捕获记忆');
  }
}

// 执行捕获
capture().catch(err => {
  console.error('AutoCapture Hook Error:', err);
  process.exit(1);
});
