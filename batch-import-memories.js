#!/usr/bin/env node
/**
 * 批量导入历史记忆到向量数据库
 * 用法：node scripts/batch-import-memories.js
 */

const fs = require('fs');
const path = require('path');
const { getEmbedding, init } = require('./nvidia-embeddings');

const MEMORY_DIR = path.join(__dirname, '../memory');
const EXCLUDE_PATTERNS = ['embeddings.json'];

// 初始化
init();

// 读取所有记忆文件
function getMemoryFiles() {
  const files = fs.readdirSync(MEMORY_DIR);
  return files.filter(file => 
    file.endsWith('.md') && 
    !EXCLUDE_PATTERNS.some(p => file.includes(p))
  );
}

// 提取记忆条目（从 Markdown 中提取有意义的句子/段落）
function extractMemories(content, filename) {
  const memories = [];
  
  // 按行分割
  const lines = content.split('\n');
  let currentCategory = 'general';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 跳过空行、标题、列表符号
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      continue;
    }
    
    // 检测类别
    if (trimmed.includes('模型') || trimmed.includes('Qwen') || trimmed.includes('GLM')) {
      currentCategory = 'model';
    } else if (trimmed.includes('配置') || trimmed.includes('安装') || trimmed.includes('错误')) {
      currentCategory = 'technical';
    } else if (trimmed.includes('决策') || trimmed.includes('决定') || trimmed.includes('选择')) {
      currentCategory = 'decision';
    } else if (trimmed.includes('学习') || trimmed.includes('教程') || trimmed.includes('报告')) {
      currentCategory = 'learning';
    } else if (trimmed.includes('API') || trimmed.includes('Key')) {
      currentCategory = 'api';
    }
    
    // 只导入有意义的句子（长度 > 20 且 < 500）
    if (trimmed.length > 20 && trimmed.length < 500) {
      memories.push({
        text: trimmed,
        category: currentCategory,
        source: filename
      });
    }
  }
  
  return memories;
}

// 批量导入
async function batchImport() {
  const files = getMemoryFiles();
  console.log(`📂 找到 ${files.length} 个记忆文件`);
  
  let totalImported = 0;
  let totalSkipped = 0;
  
  // 读取现有的记忆库（避免重复）
  const existingFile = path.join(MEMORY_DIR, 'embeddings.json');
  const existingMemories = fs.existsSync(existingFile) 
    ? JSON.parse(fs.readFileSync(existingFile, 'utf-8')) 
    : [];
  
  const existingTexts = new Set(existingMemories.map(m => m.text));
  
  for (const file of files) {
    const filepath = path.join(MEMORY_DIR, file);
    const content = fs.readFileSync(filepath, 'utf-8');
    const memories = extractMemories(content, file);
    
    console.log(`\n📄 处理 ${file}: ${memories.length} 条候选`);
    
    for (const mem of memories) {
      // 跳过已存在的
      if (existingTexts.has(mem.text)) {
        totalSkipped++;
        continue;
      }
      
      try {
        const embedding = await getEmbedding(mem.text);
        
        const record = {
          id: Date.now() + Math.random(),
          text: mem.text,
          embedding,
          category: mem.category,
          importance: 0.5,
          timestamp: Date.now(),
          source: mem.source
        };
        
        // 添加到现有记忆库
        existingMemories.push(record);
        existingTexts.add(mem.text);
        totalImported++;
        
        // 每 10 条保存一次，避免内存溢出
        if (totalImported % 10 === 0) {
          fs.writeFileSync(existingFile, JSON.stringify(existingMemories, null, 2));
          console.log(`  ✅ 已导入 ${totalImported} 条 (保存进度...)`);
        }
      } catch (err) {
        console.error(`  ❌ 导入失败: ${mem.text.substring(0, 50)}... - ${err.message}`);
      }
    }
  }
  
  // 最终保存
  fs.writeFileSync(existingFile, JSON.stringify(existingMemories, null, 2));
  
  console.log(`\n🎉 导入完成!`);
  console.log(`   成功导入: ${totalImported} 条`);
  console.log(`   跳过重复: ${totalSkipped} 条`);
  console.log(`   总计记忆: ${existingMemories.length} 条`);
}

// 运行
batchImport().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
