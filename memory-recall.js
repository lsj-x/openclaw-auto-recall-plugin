#!/usr/bin/env node
/**
 * OpenClaw 记忆召回脚本
 * 用法：node scripts/memory-recall.js "查询内容" [limit]
 * 输出：JSON 格式的相关记忆列表
 */

const { search: searchMemory, init } = require('./nvidia-embeddings');

// 初始化
init();

// 解析参数
const query = process.argv[2];
const limit = parseInt(process.argv[3]) || 5;

if (!query) {
  console.error('用法：node scripts/memory-recall.js "查询内容" [limit]');
  process.exit(1);
}

// 搜索并输出 JSON
(async () => {
  try {
    const results = await searchMemory(query, limit);
    
    // 输出纯 JSON，方便其他脚本解析
    console.log(JSON.stringify({
      query,
      count: results.length,
      memories: results.map(m => ({
        id: m.id,
        text: m.text,
        category: m.category,
        importance: m.importance,
        timestamp: m.timestamp,
        similarity: m.similarity
      }))
    }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
