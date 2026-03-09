#!/usr/bin/env node
/**
 * OpenClaw 自动记忆召回钩子 - 混合智能捕获版
 * 功能：
 * 1. 自动召回相关记忆（向量搜索）
 * 2. 智能捕获：规则快速匹配 + LLM 条件提取
 * 3. 更新 SESSION-STATE.md（WAL 协议）
 */

const { search: searchMemory, store: storeMemory, init, loadMemories } = require('/root/.openclaw/workspace/scripts/nvidia-embeddings');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 初始化
init();

// 读取当前消息
const message = process.env.OPENCLAW_USER_MESSAGE || process.argv[2] || '';
const limit = parseInt(process.env.MEMORY_RECALL_LIMIT, 10) || 5;
const threshold = parseFloat(process.env.MEMORY_RECALL_THRESHOLD) || 0.3;
const autoCaptureEnabled = (process.env.AUTO_CAPTURE_ENABLED || 'true').toLowerCase() !== 'false';
const captureCategories = (process.env.CAPTURE_CATEGORIES || 'preference,decision,fact,lesson')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

// SESSION-STATE.md 路径
const SESSION_STATE_PATH = path.join(__dirname, '../../workspace/SESSION-STATE.md');

// NVIDIA API 配置（用于 LLM 提取）
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY;
const LLM_MODEL = 'z-ai/glm4.7'; // 使用 GLM-4.7-flash 对应模型 ID

if (!message) {
  console.log(JSON.stringify({ recall: [] }));
  process.exit(0);
}

// ========== 工具函数 ==========

// 更新 SESSION-STATE.md (WAL 协议)
function updateSessionState(category, text) {
  try {
    if (!fs.existsSync(SESSION_STATE_PATH)) return;
    
    let content = fs.readFileSync(SESSION_STATE_PATH, 'utf-8');
    const timestamp = new Date().toISOString();
    
    let section = '## Key Context\n';
    if (category === 'decision') {
      section = '## Recent Decisions\n';
    } else if (category === 'preference') {
      section = '## Key Context\n';
    }
    
    const entry = `- [${category}] ${text.substring(0, 150)} (${timestamp})\n`;
    
    const pendingIndex = content.indexOf('## Pending Actions');
    if (pendingIndex !== -1) {
      content = content.slice(0, pendingIndex) + entry + content.slice(pendingIndex);
    } else {
      content += '\n' + entry;
    }
    
    content = content.replace(/Last updated:.*/, `Last updated: ${timestamp}`);
    fs.writeFileSync(SESSION_STATE_PATH, content, 'utf-8');
    console.log(`📝 SESSION-STATE.md 已更新 (${category})`);
  } catch (e) {
    console.error(`⚠️ 更新 SESSION-STATE.md 失败: ${e.message}`);
  }
}

// 去重：检查是否已存在相似记忆
async function isDuplicate(text, threshold = 0.85) {
  const memories = loadMemories();
  if (memories.length === 0) return false;
  
  // 快速检查：完全匹配或高度相似
  for (const m of memories) {
    if (m.text === text) return true;
    
    // 简单的前 50 字相似度检查
    const sim = simpleSimilarity(text.substring(0, 50), m.text.substring(0, 50));
    if (sim > threshold) return true;
  }
  return false;
}

// 简单文本相似度（用于去重）
function simpleSimilarity(a, b) {
  const wordsA = a.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const wordsB = b.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  
  return intersection / union;
}

// ========== 方案 1：快速规则提取 ==========

function fastRuleExtract(text) {
  // 决策模式（扩展）
  const decisionPatterns = [
    /(?:我|我们|建议|推荐|决定|选择|采用|将|应该|必须)(?:决定|选择|使用|采用|用|选)(.+?)(?:[。？]|$)/i,
    /(?:采用|使用|选择)(.+?)(?:方案|方法|工具|框架|技术)/i,
    /(?:最终|最后)(?:确定|决定|选定)(.+?)(?:[。】]|$)/i,
    /(?:打算|计划|准备)(?:用|使用|采用)(.+?)(?:[。】]|$)/i,
    /(?:决定|选择)(?:用|使用)(.+?)(?:[。】]|$)/i,
    /(?:用|使用)(\w+?)(?:作为|做|代替)/i
  ];
  
  // 偏好模式
  const preferencePatterns = [
    /(?:我|我们|偏好|喜欢|倾向|希望|更希望)(?:偏好|喜欢|倾向于|希望|更希望)(.+?)(?:[。】]|$)/i,
    /(?:喜欢|偏好)(.+?)(?:多过|而不是|而非)/i,
    /(?:最合适|最适合|最喜欢的)(?:是|为|就是)(.+?)(?:[。】]|$)/i,
    /(?:还是|或者)(.+?)好/i
  ];
  
  // 事实/知识模式
  const factPatterns = [
    /(?:注意|重要|关键|事实上|确实|确切|谨记)(?:：|:|)(.+?)(?:[。】]|$)/i,
    /(?:记住|记下|知晓)(?::|：|)(.+?)(?:[。】]|$)/i,
    /(.+?)(?:比|相较于|相比)(.+?)(?:更|比较好|差|慢|快)/i
  ];
  
  // 依次匹配，返回第一个匹配
  for (const pattern of decisionPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return {
        type: 'decision',
        content: match[1].trim(),
        confidence: 0.7
      };
    }
  }
  
  for (const pattern of preferencePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return {
        type: 'preference',
        content: match[1].trim(),
        confidence: 0.7
      };
    }
  }
  
  for (const pattern of factPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // 对于比较语句，提取完整句子
      const content = match[0] ? match[0].trim() : match[1].trim();
      return {
        type: 'fact',
        content: content.substring(0, 100),
        confidence: 0.6
      };
    }
  }
  
  return null;
}

// ========== 方案 1.5：分类兜底提取（关键词 + 正则） ==========
const CATEGORY_KEYWORDS = {
  preference: ['喜欢', '爱好', 'prefer', 'like', 'love', 'enjoy', 'favorite'],
  decision: ['决定', '选择', '打算', '计划', 'decide', 'choose', 'plan', 'intend', 'will'],
  fact: ['注意', '关键', '记住', '事实', 'fact', 'actually', '相比', '更快', '更慢'],
  lesson: ['经验', '教训', '学到', '明白', 'lesson', 'learned', 'realize', '体会']
};

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

function categoryFallbackExtract(text, categories) {
  const normalizedText = text.toLowerCase();

  for (const category of categories) {
    const keywords = CATEGORY_KEYWORDS[category] || [];
    const patterns = CATEGORY_PATTERNS[category] || [];

    const keywordMatched = keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase()));
    const patternMatched = patterns.some((pattern) => pattern.test(text));

    if (keywordMatched || patternMatched) {
      return {
        type: category,
        content: text.length > 120 ? text.substring(0, 120) : text,
        confidence: 0.65
      };
    }
  }

  return null;
}

// ========== 方案 2：条件 LLM 提取 ==========

function shouldUseLLM(text) {
  // 触发条件：
  // 1. 消息长度 > 80 字符（可能有复杂内容）
  // 2. 包含特定关键词（模型名、技术栈、数字比较）
  // 3. 有问号或感叹号（表达强烈观点）
  
  if (text.length < 80) return false;
  
  const techKeywords = ['glm', 'qwen', 'deepseek', 'minimax', 'kimi', 'step', 'openai', 'anthropic', 'claude'];
  const hasTech = techKeywords.some(k => text.toLowerCase().includes(k));
  
  const hasComparison = /比|优于|不如|更快|更慢|更强|更好|vs|versus/i.test(text);
  const hasQuestion = /[？！]/.test(text);
  
  return hasTech || hasComparison || hasQuestion;
}

async function extractWithLLM(text) {
  const prompt = `
从用户消息中提取重要事实，返回严格 JSON：

{
  "type": "decision|preference|fact|learning",
  "content": "精简的核心内容（20-60字，必须完整）",
  "confidence": 0.7-1.0
}

要求：
1. content 必须是一个完整句子，不要截断
2. 去掉"我觉得"、"我认为"等主观前缀
3. 保留关键实体（模型名、数字、对比关系）
4. 如果无法提取明确事实，返回 null

示例：
用户："我觉得 Qwen3.5-397B 比 GLM-5 快 30%"
输出：{"type":"fact","content":"Qwen3.5-397B 比 GLM-5 快 30%","confidence":0.9}

用户："我决定用 React 做前端"
输出：{"type":"decision","content":"使用 React 作为前端框架","confidence":0.95}

用户消息：${text}

只返回 JSON，不要任何其他文字。`;

  try {
    const response = await callLLM(prompt);
    console.error(`  [LLM RAW] ${response.substring(0, 200)}`); // DEBUG
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.type && parsed.content && parsed.content.length > 5) {
      return {
        type: parsed.type,
        content: parsed.content.trim(),
        confidence: parsed.confidence || 0.8
      };
    }
  } catch (e) {
    console.error(`⚠️ LLM 提取失败: ${e.message}`);
  }
  return null;
}

// 调用 LLM API (NVIDIA)
function callLLM(prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: "You are a precise fact extractor. Always return complete JSON with full content. Never truncate." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const options = {
      hostname: 'integrate.api.nvidia.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const response = JSON.parse(responseData);
          resolve(response.choices[0].message.content);
        } else {
          reject(new Error(`LLM API ${res.statusCode}: ${responseData.substring(0, 100)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ========== 主捕获逻辑 ==========

async function autoCapture(message) {
  if (!autoCaptureEnabled) return [];

  const captures = [];
  
  // 1. 快速规则（总是尝试）
  const ruleCapture = fastRuleExtract(message);
  if (ruleCapture) {
    captures.push(ruleCapture);
  }
  
  // 2. 条件 LLM 提取
  if (shouldUseLLM(message) && !ruleCapture) {
    const llmCapture = await extractWithLLM(message);
    if (llmCapture) {
      captures.push(llmCapture);
    }
  }

  // 2.5 分类兜底（解决“召回能触发但捕获未触发”的场景）
  if (captures.length === 0) {
    const fallbackCapture = categoryFallbackExtract(message, captureCategories);
    if (fallbackCapture) {
      captures.push(fallbackCapture);
    }
  }
  
  // 3. 去重（避免重复存储同一事实）
  const uniqueCaptures = [];
  for (const cap of captures) {
    const isDup = await isDuplicate(cap.content);
    if (!isDup) {
      uniqueCaptures.push(cap);
    }
  }
  
  return uniqueCaptures;
}

// ========== 主流程 ==========

(async () => {
  try {
    // 步骤 1: 智能捕获当前消息
    const captures = await autoCapture(message);
    
    for (const capture of captures) {
      // 存储到向量数据库
      await storeMemory(capture.content, capture.type, capture.confidence || 0.7);
      // 更新 SESSION-STATE.md
      updateSessionState(capture.type, capture.content);
    }
    
    if (captures.length > 0) {
      console.error(`🔍 自动捕获了 ${captures.length} 条记忆`);
    } else {
      console.error('🔍 本轮未捕获到可存储记忆');
    }
    
    // 步骤 2: 搜索相关记忆
    const results = await searchMemory(message, limit);
    
    // 过滤低相似度结果
    const filtered = results.filter(m => m.similarity >= threshold);
    
    // 格式化记忆内容（按用户要求的格式）
    const formatRecallContext = (recalls) => {
      if (!recalls || recalls.length === 0) return '';
      
      const lines = recalls.map(m => {
        const text = m.text.length > 80 ? m.text.substring(0, 80) + '...' : m.text;
        return `- [${m.category}] ${text} (相似度：${m.similarity.toFixed(2)})`;
      });
      
      return `## 🧠 相关记忆（自动召回）\n\n${lines.join('\n')}\n\n---\n\n`;
    };
    
    const context = formatRecallContext(filtered);
    
    // 输出 JSON
    console.log(JSON.stringify({
      recall: filtered,
      context: context,
      count: filtered.length,
      captured: captures.length
    }));
    
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
