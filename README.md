# 卡网比价

多家发卡店铺（wzyp.cn / 鲸商城）的商品聚合比价工具。左侧按标准商品分类，右侧按价格对比各店铺报价，并标注质保等级。

## 特点

- **零依赖**：只用 Node 内置模块（`node:sqlite` + `node:http`），不用 `npm install`
- **串行抓取**：任何时刻只有一个请求发往目标站，绝不同时抓取
- **手动触发全量**：点「立即抓取」= 一轮抓完所有店铺，店铺之间无人工间隔
- **标准商品 + 别名**：把各店叫法不同的商品归到统一标准商品下（23 个 OpenAI 标准品）
- **质保等级识别**：自动标出「有质保 / 仅首登 / 无质保」，避免被最低价误导

## 快速开始

```bash
cd cardweb
node server.js
# 打开 http://127.0.0.1:8052
```

首次启动会自动建 `data/cardweb.db`。

## 用 wslc 跑（本机）

```bash
wslc build -t cardweb:latest .
wslc run -d --name cardweb -p 8052:8052 -v D:\cardweb\data:/app/data cardweb:latest
```

改代码后：

```bash
wslc build -t cardweb:latest . && wslc restart cardweb
```

## 用 docker compose 跑（服务器）

```bash
docker compose up -d
```

数据落在 `./data`，重启不丢。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8052` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_FILE` | `./data/cardweb.db` | SQLite 路径 |
| `POLL_MINUTES` | `0` | 自动轮询间隔（分钟）。`0` = 关闭，只手动抓取 |

## 目录结构

```
cardweb/
├── server.js              HTTP 服务 + 路由 + SSE
├── src/
│   ├── fetcher.js         抓取 wzyp.cn（info / goodsList）
│   ├── products.js        标准商品匹配器（读 openai-products.json）
│   ├── classify.js        旧版档位分类器（保留兼容）
│   ├── db.js              SQLite 表结构与查询
│   └── scheduler.js       串行抓取调度器
├── config/
│   ├── openai-products.json  标准商品 + 别名 + 质保识别（主配置）
│   └── tiers.json            旧版档位规则
├── public/
│   └── index.html         前端（单文件，无构建）
├── Dockerfile
└── docker-compose.yml
```

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/shops` | 店铺列表 + 调度器状态 |
| POST | `/api/shops` | 添加店铺 `{ "url": "..." }` |
| DELETE | `/api/shops/:id` | 删除店铺（连带商品） |
| POST | `/api/fetch-all` | 立即抓取全部店铺（一轮） |
| GET | `/api/status` | 调度器状态 |
| GET | `/api/events` | SSE 实时进度 |
| GET | `/api/products` | **标准商品列表**（含最低有货价 / 带质保最低价） |
| GET | `/api/products/:key/offers` | 某标准商品的全部报价，`?in_stock=1&sort=price\|warranty` |
| GET | `/api/tiers` | 旧版档位聚合 |
| GET | `/api/tiers/:tier/products` | 旧版档位商品 |
| GET | `/api/history/:shopId/:goodsKey` | 某商品价格历史 |

## 标准商品模型（OpenAI）

`config/openai-products.json` 定义了两层结构：

**第一层：标准商品**（`products`）—— 跨店统一的商品概念。

```json
{
  "key": "plus-daily", "group": "account", "order": 10,
  "name": "Plus 日抛 / 未接马",
  "spec": "未接短信 · 质保首登 · 30 分钟~1 小时验号",
  "note": "最便宜的一档，只保首登，超时不退不换"
}
```

**第二层：匹配规则**（`rules`）—— 按顺序匹配，首个命中即返回。

```json
{
  "product": "plus-daily",
  "aliases": ["未接马", "未接码", "日抛", "质保首登", "首登"],
  "requireAny": [],          // 必须包含任一（收紧用）
  "excludeAny": ["反代"]     // 包含任一则跳过（互斥用）
}
```

| 字段 | 含义 |
| --- | --- |
| `aliases` | 商品名包含任一别名即命中 |
| `regex` | 正则匹配（替代 aliases） |
| `requireAny` | 全部满足才能命中，用于收紧 |
| `excludeAny` | 包含任一则本规则不匹配 |

**平台隔离**：`products.js` 里有一份 `OTHER_PLATFORM` 列表（claude / gemini / muse / grok…）。商品名命中其他平台特征词、且不含 OpenAI 主体词（plus / gpt / oai / codex / g free）时，直接判定为非本平台，不会被通用别名误吃。

**质保识别**：独立于商品匹配，按标题判断三档：

| 等级 | 识别词 | 展示 |
| --- | --- | --- |
| `subscription` | 质保订阅 / 质保30天 / 质保25天… | 有质保（绿） |
| `first_login` | 质保首登 / 质保1h / 首登保障… | 仅首登（黄） |
| `none` | 无质保 / 不保 / 封号不保… | 无质保（红） |
| `unknown` | 都没写 | 未注明（灰） |

左侧每个标准商品显示「最低有货价」，右侧可按「质保」列排序 —— 这样能立刻看出市场上最便宜的那批全是仅首登。

## 抓取原理

目标站是 Vue SPA，页面本身无数据，全部走 JSON 接口：

```
POST https://wzyp.cn/shopApi/Shop/info        { token }
POST https://wzyp.cn/shopApi/Shop/goodsList   { token, current, pageSize }
```

`token` 就是店铺链接 `/shop/XXXXXXXX` 的最后一段。`pageSize` 实测可传 500 一次拉完。

库存来自 `extend.stock_count`，空值表示不限库存（权益类商品多为空）。

## 已知限制

- 只支持 wzyp.cn 这一套发卡平台；换平台需要改 `src/fetcher.js`
- 同款识别目前基于「档位 + 人工看标题」，未做跨店自动去重（标题相似但叫法不同的商品会并列显示）
- 价格历史已写入 `price_log`，但前端还没做走势图
