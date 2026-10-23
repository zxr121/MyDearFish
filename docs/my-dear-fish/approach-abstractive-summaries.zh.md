# 章节摘要改成她自己的话

## 目标

把章节摘要从现在的原文摘录改成她用自然语言讲的故事，让记忆更像人。

## 设计

### 分层摘要

- **日章节**：从这一天的情景（每情景取第一条消息）生成 1-2 句总结
- **周章节**：从这一周的日章节摘要生成 1-2 句总结
- **月章节**：从这一月的周章节摘要生成 1-2 句总结

每层只总结子层，不重复读原文，控制输入 token。

### 模型调用

- 模型：flash+max（便宜，推理质量够）
- 提示词：`用你自己的话总结{这一天/周/月}发生了什么，要像你在跟主人聊天时提到的那样自然。不要列清单，不要报时间戳，只讲重要的事。`
- 输入：子章节摘要或情景首条消息（截断到 maxTextChars）
- 输出：1-2 句话，她的声音
- 失败兜底：保留原文摘录，诊断日志记一条

### 存储

- schema v4：`chapters` 表加 `abstractive_summary TEXT` 列
- 现有 `summary` 列保留（摘录，调试用）
- UI 优先显示 `abstractive_summary`，为空时回退到 `summary`

### 迁移与触发

- v3→v4 迁移：加列，现有章节 `abstractive_summary` 为 NULL
- 懒回填：`buildChapters` 跑完后，扫描 `abstractive_summary IS NULL` 的章节，逐条调用模型
- 新章节：`buildChapters` 创建后立即标记待摘要
- 重编章节：`force: true` 时清空 `abstractive_summary`，重新生成

## 成本

### 估算

- 当前 19 个章节（9 日 + 5 周 + 5 月）
- 每章节：~500 输入 token + ~50 输出 token
- flash+max 定价：输入 ¥0.5/M，输出 ¥2/M
- 单章节：¥0.00035
- 19 章节回填：¥0.00665（不到 1 分钱）
- 日常增量：每天 ~1 个新日章节，每周 ~1 个新周章节，每月 ~1 个新月章节
- 月成本：~¥0.01（可忽略）

### 控制

- 只摘要新/空章节，不重复跑
- 失败不重试（下次 buildChapters 会再扫到）
- 配置开关：`config.chapters.abstractive` 默认 true，可关掉退回摘录

## 实现

### 文件改动

1. **store.js**
   - schema v4：加 `abstractive_summary` 列
   - 迁移：v3→v4 ALTER TABLE
   - `buildChapters`：创建章节后返回新章节 id 列表
   - `summarizeChapter(chapterId)`：加载子内容，调模型，写回
   - `summarizePendingChapters()`：扫描 NULL，逐条摘要
   - `openChapter` / `chapterTree`：返回 `abstractive_summary` 优先

2. **index.js**
   - `organizeMemory`：buildChapters 后调 `summarizePendingChapters`
   - 注入模型调用能力（通过 ctx.llm 或类似服务）
   - 配置：`config.chapters.abstractive`

3. **config.js**
   - 默认值：`chapters.abstractive: true`
   - 归一化：布尔，非布尔 diag

4. **client.js**
   - 设置页显示 `abstractive_summary`（有则显示，无则回退 `summary`）

5. **overview.js**
   - `memoryOverview` 返回 `abstractive_summary`

6. **tests/store.test.mjs**
   - v3→v4 迁移测试
   - `summarizeChapter` 单元测试（mock 模型）
   - 懒回填测试
   - 失败兜底测试

7. **tests/plugin.test.mjs**
   - 集成测试：buildChapters 后 abstractive_summary 非空
   - 配置开关测试

### 新函数

```js
// store.js
async function summarizeChapter(chapterId, llm) {
  const chapter = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId)
  if (!chapter) return { ok: false, reason: 'not found' }

  const input = chapter.level === 'day'
    ? loadDayEpisodes(chapterId)  // 情景首条消息
    : loadChildSummaries(chapterId)  // 子章节 abstractive_summary

  if (input.length === 0) return { ok: false, reason: 'empty' }

  const prompt = buildSummaryPrompt(chapter.level, input)

  try {
    const result = await llm.generate({ prompt, model: 'flash', reasoning: 'max' })
    const summary = result.text.trim().slice(0, 200)  // 限制长度
    db.prepare('UPDATE chapters SET abstractive_summary = ? WHERE id = ?').run(summary, chapterId)
    return { ok: true, summary }
  } catch (error) {
    diag(`store: 章节 ${chapterId} 摘要失败（${error.message}）`)
    return { ok: false, reason: error.message }
  }
}

async function summarizePendingChapters(llm) {
  const pending = db.prepare('SELECT id FROM chapters WHERE abstractive_summary IS NULL').all()
  const results = []
  for (const row of pending) {
    const result = await summarizeChapter(row.id, llm)
    results.push({ id: row.id, ...result })
  }
  return results
}
```

## 测试

### 单元测试

- v3→v4 迁移：列存在，现有数据保留
- `summarizeChapter`：mock llm 返回，验证写入
- `summarizeChapter` 失败：mock llm 抛错，验证回退到摘录
- 懒回填：插入 NULL 章节，调用后全部填充

### 集成测试

- `buildChapters` 后 `summarizePendingChapters`，验证 abstractive_summary 非空
- 配置 `abstractive: false`，验证不调用模型
- 重编章节（force: true），验证清空并重新生成

### 成本测试

- 记录每次模型调用的 token 数
- 验证回填只跑一次
- 验证新章节只摘要一次

## 文档

### 双语更新

- `cognition.zh.md` / `cognition.md`：章节摘要从摘录改成模型生成
- `plugins.zh.md` / `plugins.md`：新增 abstractive 配置项
- `implementation.zh.md` / `implementation.md`：分层摘要机制
- `development-plan.zh.md` / `development-plan.md`：任务完成记录
- `README.md`：章节树与关系边章节增加 abstractive 说明

### i18n

- 所有改动的 `.i18n.yaml` 重新生成
- `pnpm run verify-translation-pairing --write` 同步

## 风险

### 模型失败

- 风险：flash+max 偶尔返回空或乱码
- 缓解：截断到 200 字，失败保留摘录，诊断日志

### 成本失控

- 风险：配置错误或逻辑 bug 导致重复调用
- 缓解：只摘要 NULL 章节，配置开关，成本测试

### 隐私泄露

- 风险：摘要可能包含敏感信息
- 缓解：输入已经过隐私过滤（模型输出拦截），摘要本身不新增信息

### 性能

- 风险：大量 NULL 章节同时摘要阻塞启动
- 缓解：懒回填串行执行，每次 buildChapters 后跑一批（可配置上限）

## 验收

- [ ] schema v4 迁移测试通过
- [ ] 183 + 新测试全过
- [ ] 设置页显示她的声音摘要
- [ ] 成本 < ¥0.01/月
- [ ] 双语文档同步
- [ ] 提交推送
