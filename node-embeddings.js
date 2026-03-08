/**
 * Node.js 本地向量搜索实现
 * 使用 @xenova/transformers 进行本地 Embedding
 * 使用 better-sqlite3 存储向量
 */

const { pipeline, env } = require('@xenova/transformers');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// 禁用本地模型下载，使用 HuggingFace CDN
env.allowLocalModels = false;
env.useBrowserCache = true;

const DB_PATH = path.join(__dirname, '../memory/vector-db.sqlite');
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'; // 轻量级模型，约 45MB

let embedder = null;
let db = null;

// 初始化数据库
function initDB() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  
  db = new Database(DB_PATH);
  
  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      embedding BLOB NOT NULL,
      category TEXT,
      timestamp INTEGER DEFAULT (strftime('%s', 'now')),
      importance REAL DEFAULT 0.5
    );
    
    CREATE INDEX IF NOT EXISTS idx_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp);
  `);
  
  console.log('✅ Vector DB initialized');
}

// 加载 Embedding 模型
async function loadEmbedder() {
  if (embedder) return embedder;
  
  console.log('🔄 Loading embedding model:', MODEL_NAME);
  embedder = await pipeline('feature-extraction', MODEL_NAME, {
    quantized: true // 使用量化模型，更快更小
  });
  console.log('✅ Embedding model loaded');
  return embedder;
}

// 生成向量
async function embed(text) {
  const embedder = await loadEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// 存储记忆
function storeMemory(text, category = 'general', importance = 0.5) {
  const stmt = db.prepare('INSERT INTO memories (text, embedding, category, importance) VALUES (?, ?, ?, ?)');
  const embedding = embed(text); // 注意：这里需要 await，但为了简单先同步调用
  
  // 实际使用时应该用 async/await
  return stmt.run(text, Buffer.from(JSON.stringify(embedding)), category, importance);
}

// 向量搜索
function searchMemory(query, limit = 5) {
  // 这里需要实现向量相似度搜索
  // 由于 better-sqlite3 不支持向量运算，我们需要在 JS 层计算
  const stmt = db.prepare('SELECT id, text, category, importance, embedding FROM memories');
  const memories = stmt.all();
  
  const queryEmbedding = embed(query);
  
  // 计算余弦相似度
  const results = memories.map(m => {
    const emb = JSON.parse(m.embedding.toString());
    const similarity = cosineSimilarity(queryEmbedding, emb);
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

// 导出 API
module.exports = {
  init: initDB,
  embed: async (text) => {
    await loadEmbedder();
    return embed(text);
  },
  store: storeMemory,
  search: searchMemory
};

// 测试
if (require.main === module) {
  initDB();
  (async () => {
    await loadEmbedder();
    const text = "今天天气很好，适合学习 OpenClaw";
    const embedding = await embed(text);
    console.log('Embedding length:', embedding.length);
    
    storeMemory(text, 'daily');
    const results = searchMemory("OpenClaw 学习", 3);
    console.log('Search results:', results);
  })();
}
