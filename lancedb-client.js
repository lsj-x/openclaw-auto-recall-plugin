#!/usr/bin/env node
/**
 * LanceDB HTTP Client for OpenClaw
 * 通过 HTTP 调用 LanceDB 容器服务
 */

const https = require('https'); // or http if using http
const { URL } = require('url');

class LanceDBClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://127.0.0.1:1234';
    this.tableName = options.tableName || 'memory'; // 使用容器中的 'memory' 表
    this.embeddingDimension = options.embeddingDimension || 384;
  }

  // 检查服务健康状态
  async health() {
    try {
      const res = await this._request('/health', 'GET');
      return res.status === 'healthy';
    } catch (e) {
      return false;
    }
  }

  // 列出表
  async listTables() {
    const res = await this._request('/tables', 'GET');
    return res.tables || [];
  }

  // 确保表存在
  async ensureTable() {
    const tables = await this.listTables();
    if (!tables.includes(this.tableName)) {
      // 表会自动在第一次插入时创建，无需预先创建
      console.log(`Table '${this.tableName}' will be created on first insert`);
    }
  }

  // 存储记忆（纯文本，不包含向量）
  async storeMemory(text, category = 'general', importance = 0.5) {
    const data = {
      table: this.tableName,
      data: {
        text,
        category,
        importance: parseFloat(importance) || 0.5,
        vector: null // 暂不使用向量搜索
      }
    };

    const res = await this._request('/insert', 'POST', data);
    return res;
  }

  // 搜索记忆（文本搜索）
  async searchMemories(query, limit = 5, category = null) {
    const body = {
      table: this.tableName,
      query,
      limit
    };
    if (category) {
      body.category = category;
    }

    const res = await this._request('/search', 'POST', body);
    return res.results || [];
  }

  // 内部 HTTP 请求
  _request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const isSSL = url.protocol === 'https:';
      const lib = isSSL ? https : require('http');

      const options = {
        hostname: url.hostname,
        port: url.port || (isSSL ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(json);
            } else {
              reject(new Error(json.detail || `HTTP ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.substring(0, 100)}`));
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
}

// 命令行测试
if (require.main === module) {
  (async () => {
    const baseUrl = process.argv[2] || 'http://127.0.0.1:1234';
    const client = new LanceDBClient({ baseUrl });

    console.log('🏥 检查服务健康状态...');
    const healthy = await client.health();
    console.log('健康状态:', healthy ? '✅ 正常' : '❌ 异常');

    if (healthy) {
      console.log('\n📋 列出表...');
      const tables = await client.listTables();
      console.log('表:', tables);

      console.log('\n📝 添加测试记忆...');
      const insertRes = await client.storeMemory(
        '这是通过 HTTP 插入的测试记忆',
        'test',
        0.8,
        { source: 'lancedb-client-test' }
      );
      console.log('插入结果:', insertRes);

      console.log('\n🔍 搜索测试...');
      const results = await client.searchMemories('测试记忆', 5);
      console.log(`找到 ${results.length} 条记忆:`);
      results.forEach((r, i) => {
        console.log(`${i+1}. [${r.category}] ${r.text} (id:${r.id})`);
      });
    }
  })().catch(err => {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  });
}

module.exports = LanceDBClient;
