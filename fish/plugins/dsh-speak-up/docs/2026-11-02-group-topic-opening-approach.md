# 群聊主动开话题：从「接一句/总结」改成「带一个具体话头进来」（2026-11-02）

## 现状与问题

- 主动搭话掷中 QQ 房间后，送的是通用提示「看一眼群里正在聊什么，用自己的口气接一句、冒个泡」。
  这句话没有给她任何具体由头，模型能抓的只有两样东西：最后一条消息、最近聊天的大意。
  结果就是「回复上一句」或「总结最近聊天」，而不是开一个新话题。
- 宿主侧已经有房间缓冲、兴趣画像、人物志、未闭合话头和最近消息时间；鱼脑也有 B 站真实经历。
  缺的不是数据，而是**把数据组成一个具体话头**的那一步。

## 人类怎么起话题

| 动作 | 人话 | 为什么有效 |
| --- | --- | --- |
| topic initial elicitor | 「最近咋样」「有人吗」 | 把选题权交给对方，成本低；内容空，单用容易像查岗 |
| itemized news inquiry | 「你上次说的展去了吗」 | 有共同背景，答案具体，最容易接住 |
| news announcement | 「我今天……」「刚看到一个……」 | 自我披露 + 情绪分享，别人可以追问/恭喜/吐槽 |
| topic nomination | 「你们看那个了吗」 | 提名一个外部对象，邀请反应 |
| stepwise / disjunctive | 「说起这个」「突然想到」 | 贴着旧话题换，或冷场后硬切；不在两人热聊中间插 |
| pre-sequence | 「问个事」「说个事」 | 先打招呼，降低打断感 |
| topic pursuit | 没人接就补细节/缩小问题/点名 | 1–2 次后放弃，不无限追 |
| capitalization / social sharing | 讲好事、讲情绪事件 | 80–95% 的情绪事件会被讲出来；听者反应影响下一次 |
| bids / phatic | 一个链接、一个梗、一句「在吗」 | 低成本的连接请求；内容轻，但维持关系 |
| recipient design / @ | 对具体的人说具体的事 | 群越大越不能只喊「大家」，责任扩散会没人回 |

参考：Button & Casey（topic nomination / pursuit）、Jefferson（stepwise transition）、Maynard（topic change placement）、Schegloff（pre-sequence）、Gable & Reis（capitalization）、Rimé（social sharing）、Huang et al.（question asking）、Loewenstein（information gap）、Dunbar（gossip/social grooming）、Gottman（bids）、Markey（CMC bystander effect）、Horvitz（mixed-initiative timing）、Deng et al.（proactive dialogue survey）、Multi-Party Conversational Agents Survey。

## 采用的做法

### 1. 五种开头动作

- `带进来`：B 站真实内容，或 B 站没有材料时联网搜一次新鲜事；一句看法 + 一个可接的问题。
- `问大家`：从她的兴趣词/群稳定词里出一个具体、一句话能答的问题，不是「你们怎么看」。
- `接旧话`：这间屋 30 分钟–14 天前、还没被回答的旧话头；不是回复旧消息，是拿它重新起头。
- `自己的事`：她真实在 B 站看到/做过的事；不编线下生活。
- `点名`：@ 一个最近 24 小时在这间屋出现过、有公开由头、态度不是 `ignore/cold/quiet` 的熟人；
  同屋每 3 次开头最多 1 次，主人不点。

### 2. 由头从哪来

- B 站：`fishMind.biliSeeds(limit)` 只读 `source_kind='bili'`、72 小时内、salience ≥0.3 的经历。
  不读主人会话、不读 QQ 会话、不读私密事实；心情只做语气，不做事实。
- 旧话头：新增 `qq-social-openers.json` 的 `threads`。判断模型可选返回 `threads`（只看 watch 里的消息），
  另加零成本规则提取（「下次/回头/打算/求推荐/周末」等标记）；只存同屋、公开事实，14 天过期。
- 人：`公开事实们(目标)` 只取 `房 === 目标.key && 密 === false`，且只取这间屋最近一小时出现过的人。
- 新鲜事：给一个查询词，回复模型用社交会话已有的 `web_search` 搜一次；搜不到/矛盾/敏感就换候选或不起话。
- 兴趣：`qq-social-interests.json` 稳定词 + 配置 `兴趣词`。

### 3. 候选与闸门

- 候选排除最后一条消息、最近 10 分钟消息、已被回答的旧话头、私密/别屋事实、主人、游戏/不聊话题、广告和敏感内容。
- 同一房间最近 7 天用过的由头不再用；同类型只留分最高的一个；一次给 2–3 个不同类型。
- 评分是确定性的加权和：新鲜度、群兴趣匹配、旧话头年龄、人物活跃度、该类型历史接住率（Laplace 平滑）、重复类型惩罚。
- 不新增规划模型调用：2–3 个候选直接给回复模型，让它挑一个写成她的话。
- 发送前再跑 `开头像总结` / `开头像复述`：命中「刚刚大家/你们在聊」或与最后一条高度重合就不发，宁可这轮不起话。
- 开头发出去时正文最前面写 `[开头:N]`，桥解析后去掉；候选不在时默认第 1 个。

### 4. 时机与频率

- 房间必须安静：没有待看/待发/正在答的回合，最后一条别人消息 ≥ `安静分钟`（默认 10），
  最近 5 条不是 ≤2 个人在热聊；不在静音/故障暂停/额度用完/只听/关掉/试运行。
- 每间屋默认 1 天 2 次、4 小时冷却、最小安静 10 分钟；不做「6 小时没消息就死屋」的硬上限。
- 没有合适由头就记一次 `上次尝试At`，半小时内不重复试；不会为了主动而硬发。

### 5. 接住与统计

- `开头建议` 登记 `{id, 类型, 由头, 种子词, 对象, 状态:'待发'}`；speak-up 的 followup 进房后由桥绑定。
- 发送成功 → `已发`，记录 `发出id们`；被闸门拦下/模型没成文 → `被拦`/`作废`。
- 20 分钟内有人回复她的开头消息、@ 她、或提到由头关键词 → `接住`；超时 → `未接`。
- v1 不自动追；只按房间/类型记 `发出/接住`，温和影响下次候选排序。

## 不做的

- 不做「每次必发」：没有合适的由头就不开口，和人类一样。
- 不自动追话题：留到下一轮概率曲线重新掷；避免追着人聊。
- 不把主人私事、别屋事实、私密事实端进群；不点主人；不碰游戏/不聊话题/敏感内容。
- 不用「总结最近聊天」当由头；不把最后一条消息改写成开头。

## 验证

- 单测：`能开头` 的每个失败原因、候选过滤、提示词不含旧「接一句/冒泡」、总结/复述闸门、接住三种命中、点名配额。
- 集成：`qqSocial.开头建议` → speak-up 发出 → `[开头:N]` 去掉 → QQ 收到 → 关键词回复记 `接住`。
- 试运行：先勾 1–2 个群，类型全开但点名受配额；1 天 2 次、4 小时冷却；跑 3–5 天。
- 验收线：≥10 次真实开头，接住率 ≥40%，没有「机器人/别刷」投诉，没有隐私外泄，没有重复同一由头。

## 参考

- Button, G. & Casey, N. (1985). Topic nomination and topic pursuit. *Human Studies*.
- Jefferson, G. (1984). On stepwise transition from talk about a trouble to inappropriately next-positioned matters.
- Maynard, D. W. (1980). Placement of topic changes in conversation. *Semiotica*.
- Schegloff, E. A. (2007). *Sequence Organization in Interaction*.
- Gable, S. L. & Reis, H. T. (2010). Good news! Capitalizing on positive events in an interpersonal context.
- Rimé, B. (2007). The social sharing of emotion as an interface between individual and collective processes.
- Huang, K. et al. (2017). It doesn't hurt to ask: Question-asking increases liking.
- Loewenstein, G. (1994). The psychology of curiosity.
- Dunbar, R. I. M. (2004). Gossip in evolutionary perspective.
- Gottman, J. (1999). *The Relationship Cure* (bids for connection).
- Markey, P. M. (2000). Bystander intervention in computer-mediated communication.
- Nonnecke, B. & Preece, J. (2000). Online lurkers tell why.
- Horvitz, E. (1999). Principles of mixed-initiative user interfaces.
- Deng, Y. et al. (2023). A survey on proactive dialogue systems.
- Gu, J.-C. et al. (2022). Who says what to whom: A survey of multi-party conversations.
