/**
 * 使用 NVIDIA Embedding API + 可切换的存储后端
 * 默认：本地 JSON 存储（向后兼容）
 * 可选：LanceDB REST API（更强大、可扩展）
 *
 * 环境变量：
 *   NVIDIA_API_KEY - NVIDIA API 密钥（可选，有默认值）
 *   LANCEDB_API_URL - LanceDB REST API 地址（如 http://127.0.0.1:1234）
 *     若设置则使用 LanceDB，否则使用本地 JSON 存储
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// 配置
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY;
const EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5';
const LANCEDB_API_URL = process.env.LANCEDB_API_URL || null;
const LANCEDB_TABLE = process.env.LANCEDB_TABLE || 'memory';

// 本地 JSON 存储路径
const DB_PATH = path.join(__dirname, '../../workspace/memory/embeddings.json');

// ==================== LanceDB REST API 客户端 ====================

class LanceDBClient {
  constructor(baseUrl, tableName) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.tableName = tableName;
  }

  async insert(data) {
    const response = await fetch(`${this.baseUrl}/insert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: this.tableName,
        data: data
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LanceDB insert failed: ${response.status} - ${err}`);
    }
    return response.json();
  }

  async search(query, limit = 5, category = null) {
    const response = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: this.tableName,
        query: query,
        limit: limit,
        category: category
      })
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LanceDB search failed: ${response.status} - ${err}`);
    }
    return response.json();
  }

  async count() {
    const response = await fetch(`${this.baseUrl}/tables`);
    if (!response.ok) {
      throw new Error(`LanceDB error: ${response.status}`);
    }
    const data = await response.json();
    return data.tables && data.tables.length > 0 ? 1 : 0;
  }
}

// ==================== 本地 JSON 存储（原有逻辑） ====================

function loadMemories() {
  if (!fs.existsSync(DB_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    console.error('Failed to load memories:', e);
    return [];
  }
}

function saveMemories(memories) {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(memories, null, 2));
}

// ==================== Embedding 生成 ====================

async function getEmbedding(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
      input_type: 'query',
      encoding_format: 'float'
    });

    const options = {
      hostname: 'integrate.api.nvidia.com',
      port: 443,
      path: '/v1/embeddings',
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
          try {
            const response = JSON.parse(responseData);
            resolve(response.data[0].embedding);
          } catch (e) {
            reject(new Error(`Failed to parse embedding response: ${e.message}`));
          }
        } else {
          reject(new Error(`NVIDIA API Error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ==================== 统一 API ====================

// 选择存储后端
const useLanceDB = !!LANCEDB_API_URL;
let lancedbClient = null;
if (useLanceDB) {
  lancedbClient = new LanceDBClient(LANCEDB_API_URL, LANCEDB_TABLE);
  console.log(`[Memory] Using LanceDB backend: ${LANCEDB_API_URL}/${LANCEDB_TABLE}`);
} else {
  console.log('[Memory] Using local JSON backend');
}

// 存储记忆
async function storeMemory(text, category = 'general', importance = 0.5) {
  const embedding = await getEmbedding(text);
  const memory = {
    id: Date.now(),
    text,
    embedding,
    category,
    importance,
    timestamp: Date.now()
  };

  if (useLanceDB) {
    // LanceDB 字段映射
    const data = {
      id: memory.id,
      timestamp: new Date(memory.timestamp).toISOString().replace('Z', ''), // naive datetime string
      text: memory.text,
      category: memory.category,
      importance: memory.importance,
      vector: memory.embedding
    };
    await lancedbClient.insert(data);
  } else {
    const memories = loadMemories();
    memories.push(memory);
    saveMemories(memories);
  }

  console.log(`✅ Stored memory [${category}]: ${text.substring(0, 50)}...`);
  return memory.id;
}

// 向量搜索
async function searchMemory(query, limit = 5) {
  console.log(`🔍 Searching memory: "${query}" (limit=${limit})`);

  if (useLanceDB) {
    // LanceDB 需要查询向量
    const queryEmbedding = await getEmbedding(query);
    const result = await lancedbClient.search(queryEmbedding, limit);
    // LanceDB 返回的格式：{results: [...], count: N}
    // 需要转换为本地 JSON 格式（去掉 _distance 等内部字段，保持兼容）
    return result.results.map(r => ({
      id: r.id,
      text: r.text,
      category: r.category,
      importance: r.importance,
      timestamp: r.timestamp,
      // LanceDB 没有返回 embedding，保持一致性设为 null
      embedding: null,
      similarity: 1 - (r._distance || 0)  // _distance 转换为相似度（LanceDB 使用 L2 距离）
    }));
  } else {
    const memories = loadMemories();
    if (memories.length === 0) {
      console.log('⚠️ Memory store is empty');
      return [];
    }

    const queryEmbedding = await getEmbedding(query);

    // 计算余弦相似度
    const results = memories.map(m => {
      const similarity = cosineSimilarity(queryEmbedding, m.embedding);
      return { ...m, similarity };
    });

    // 排序并返回 top-k
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(({ embedding, ...rest }) => rest);  // 移除 embedding 向量减少数据量
  }
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

// 初始化
function init() {
  if (!useLanceDB && !fs.existsSync(DB_PATH)) {
    saveMemories([]);
    console.log('✅ Memory store initialized (JSON)');
  }
}

// 导出
module.exports = {
  init,
  store: storeMemory,
  search: searchMemory,
  getEmbedding,
  // 测试用
  _getConfig: () => ({ useLanceDB, LANCEDB_API_URL, LANCEDB_TABLE })
};

// ==================== 测试 ====================

if (require.main === module) {
  (async () => {
    init();

    console.log('\n📝 Testing memory storage...');
    console.log(`Backend: ${useLanceDB ? 'LanceDB' : 'Local JSON'}`);

    // 存储测试记忆
    await storeMemory("今天学习了 OpenClaw 的向量搜索功能", "learning");
    await storeMemory("Qwen3.5-122B 响应速度最快，0.23s", "model-test");
    await storeMemory("配置 memory-lancedb 成功，使用 Docker REST API", "decision");
    await storeMemory("Python 3.6.8 太老，无法安装 lancedb，改用 Docker 方案", "technical");

    console.log('\n🔍 Test 1: Search "OpenClaw 学习"');
    const results1 = await searchMemory("OpenClaw 学习", 3);
    results1.forEach((r, i) => {
      console.log(`  ${i+1}. [${r.category}] ${r.text} (similarity: ${(r.similarity||0).toFixed(3)})`);
    });

    console.log('\n🔍 Test 2: Search "模型测试"');
    const results2 = await searchMemory("模型测试", 3);
    results2.forEach((r, i) => {
      console.log(`  ${i+1}. [${r.category}] ${r.text} (similarity: ${(r.similarity||0).toFixed(3)})`);
    });

    console.log('\n🔍 Test 3: Search "配置"');
    const results3 = await searchMemory("配置", 3);
    results3.forEach((r, i) => {
      console.log(`  ${i+1}. [${r.category}] ${r.text} (similarity: ${(r.similarity||0).toFixed(3)})`);
    });

    console.log('\n✅ All tests completed!');
  })().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  });
}
