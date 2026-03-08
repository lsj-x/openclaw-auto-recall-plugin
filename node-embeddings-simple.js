/**
 * 纯 Node.js 向量搜索实现（无需编译）
 * 使用 @xenova/transformers 进行本地 Embedding
 * 使用 JSON 文件存储（简单可靠）
 */

const { pipeline, env } = require('@xenova/transformers');
const fs = require('fs');
const path = require('path');

// 禁用本地模型下载
env.allowLocalModels = false;
env.useBrowserCache = true;

const DB_PATH = path.join(__dirname, '../memory/embeddings.json');
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'; // 轻量级模型，约 45MB

let embedder = null;

// 加载 Embedding 模型
async function loadEmbedder() {
  if (embedder) return embedder;
  
  console.log('🔄 正在加载 Embedding 模型:', MODEL_NAME);
  embedder = await pipeline('feature-extraction', MODEL_NAME, {
    quantized: true
  });
  console.log('✅ Embedding 模型加载完成');
  return embedder;
}

// 生成向量
async function embed(text) {
  const embedder = await loadEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// 读取记忆库
function loadMemories() {
  if (!fs.existsSync(DB_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    return [];
  }
}

// 保存记忆库
function saveMemories(memories) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(memories, null, 2));
}

// 存储记忆
async function storeMemory(text, category = 'general', importance = 0.5) {
  const memories = loadMemories();
  const embedding = await embed(text);
  
  memories.push({
    id: Date.now(),
    text,
    embedding,
    category,
    importance,
    timestamp: Date.now()
  });
  
  saveMemories(memories);
  return memories.length;
}

// 向量搜索
async function searchMemory(query, limit = 5) {
  const memories = loadMemories();
  if (memories.length === 0) {
    return [];
  }
  
  const queryEmbedding = await embed(query);
  
  // 计算余弦相似度
  const results = memories.map(m => {
    const similarity = cosineSimilarity(queryEmbedding, m.embedding);
    return { ...m, similarity };
  });
  
  // 排序并返回 top-k
  return results
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ embedding, ...rest }) => rest);
}

// 余弦相似度
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 初始化（创建空文件）
function init() {
  if (!fs.existsSync(DB_PATH)) {
    saveMemories([]);
    console.log('✅ 记忆库初始化完成');
  }
}

// 测试
if (require.main === module) {
  (async () => {
    init();
    await loadEmbedder();
    
    // 测试存储
    await storeMemory("今天学习了 OpenClaw 的向量搜索功能", "learning");
    await storeMemory("Qwen3.5-122B 响应速度最快", "model-test");
    await storeMemory("配置 memory-lancedb 失败，改用 Node.js 方案", "decision");
    
    console.log('\n🔍 测试搜索 "OpenClaw 学习":');
    const results = await searchMemory("OpenClaw 学习", 3);
    results.forEach((r, i) => {
      console.log(`${i+1}. [${r.category}] ${r.text} (相似度：${r.similarity.toFixed(3)})`);
    });
    
    console.log('\n🔍 测试搜索 "模型测试":');
    const results2 = await searchMemory("模型测试", 3);
    results2.forEach((r, i) => {
      console.log(`${i+1}. [${r.category}] ${r.text} (相似度：${r.similarity.toFixed(3)})`);
    });
  })();
}

module.exports = {
  init,
  store: storeMemory,
  search: searchMemory,
  embed
};
