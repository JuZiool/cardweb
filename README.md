# 卡网比价

聚合多家发卡店铺（wzyp.cn / 鲸商城）的商品报价，把各店叫法不同的商品归到统一的标准商品下，一眼看出同一款货在哪家买最便宜、有没有质保。

![OpenAI 平台分组](https://img.shields.io/badge/platform-OpenAI-a9762f) ![零依赖](https://img.shields.io/badge/deps-none-4d8a5b) ![Node](https://img.shields.io/badge/node-24%2B-339933)

## 功能

**比价核心**
- **标准商品 + 别名**：把「G Plus 未接马 质保首登」「印度-PLUS-outlook邮箱-保首登」这类不同叫法归到同一个标准商品下（25 个可见标准品，另有 1 个中转额度档默认隐藏）
- **质保等级识别**：自动标出「有质保 / 仅首登 / 无质保 / 未注明」，避免被最低价误导
- **同款聚合**：按属性指纹（渠道 / 邮箱 / 接马状态 / 质保 / 独享 / 反代）把同款聚成一组，标注价差
- **价格走势**：按抓取轮次聚合该档位的最低价曲线
- **最低价展示**：走势面板右侧直接显示当前档位最便宜的有货报价

**质量校验**
- **价格区间越界预警**：Pro 100 刀低于 ¥300 自动标记「偏低」，通常是额度或非官方渠道混入
- **标题-描述矛盾检测**：标题写「已接马」但描述要求自行接码这类，标红提示

**商品信息**
- 抓取商品完整描述（富文本转纯文本）
- 提取发货格式（「邮箱----密码----2FA」这类）、售后条款
- 详情抽屉展示全部信息 + 原站链接

**交互**
- 左侧平台 → 分组 → 标准商品三级结构，可逐级折叠
- 右侧按价格 / 质保 / 店铺 / 库存排序
- 全局搜索（覆盖商品名与描述文本）
- 所有 UI 偏好持久化（折叠、开关、当前分类、排序）
- SSE 实时抓取进度

## 技术选型

**零依赖**。只用 Node 内置模块（`node:sqlite` + `node:http`），不需要 `npm install`。Docker 构建 8 步秒完成，容器内存占用几十 MB。

**串行抓取**。任何时刻只有一个请求发往目标站，不会同时抓。24 家店 1890 件商品全量抓取约 7 秒。

**手动触发全量**。点「立即抓取」= 一轮抓完所有店铺，店铺之间无人工间隔。也可通过 `POLL_MINUTES` 开启定时。

## 快速开始

```bash
node server.js
# 打开 http://127.0.0.1:8052
```

首次启动自动创建 `data/cardweb.db`。打开后在顶部粘贴店铺链接（如 `https://wzyp.cn/shop/GUEOI7Z9`）添加，会自动开始抓取。

## 部署

### Docker（服务器）

```bash
git clone https://github.com/JuZiool/cardweb.git
cd cardweb
docker compose up -d --build
```

访问 `http://服务器IP:8052`。数据在 `./data`，容器重建不丢。

### wslc（本机 Windows）

```bash
wslc build -t cardweb:latest .
wslc run -d --name cardweb -p 8052:8052 -v D:\cardweb\data:/app/data cardweb:latest
```

改代码后 `wslc build -t cardweb:latest . && wslc restart cardweb`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8052` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_FILE` | `./data/cardweb.db` | SQLite 路径 |
| `POLL_MINUTES` | `0` | 自动抓取间隔（分钟）。`0` = 关闭，只手动抓 |

想积累价格走势数据，建议设成 `60`（每小时一轮）。

## 目录结构

```
cardweb/
├── server.js                 HTTP 服务 + 路由 + SSE
├── src/
│   ├── fetcher.js            抓取 wzyp.cn，解析描述/发货格式/售后
│   ├── products.js           标准商品匹配 + 质保识别 + 矛盾检测
│   ├── cluster.js            跨店同款聚类（属性指纹）
│   ├── db.js                 SQLite 表结构与查询
│   ├── scheduler.js          串行抓取调度器
│   └── classify.js           旧版档位分类（保留兼容）
├── config/
│   ├── openai-products.json  标准商品 + 别名 + 质保词表 + 价格区间（主配置）
│   └── tiers.json            旧版档位规则
├── public/
│   └── index.html            前端（单文件，无构建）
├── Dockerfile
├── docker-compose.yml
└── .dockerignore
```

## 数据模型

```
shops       店铺（token / 昵称 / 销量 / 抓取状态）
products    商品（价格 / 库存 / 标准商品归类 / 质保等级 / 描述 / 发货格式 / 矛盾标记）
price_log   价格变更记录（仅价格或库存变化时写入）
```

关键字段：

| 表 | 字段 | 说明 |
| --- | --- | --- |
| products | `product_key` | 标准商品 key，`NULL` 表示非 OpenAI 品类 |
| products | `warranty` | `subscription` / `first_login` / `none` / `unknown` |
| products | `delivery` | 提取的发货格式，如「邮箱----密码----2FA」 |
| products | `conflict` | 标题与描述矛盾的原因，`NULL` 表示无矛盾 |

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
| GET | `/api/products` | 标准商品列表（含平台信息、最低价、价格区间） |
| GET | `/api/products/:key/offers` | 某标准商品报价，`?in_stock=1&sort=price\|warranty\|stock` |
| GET | `/api/products/:key/clusters` | 同款聚类结果 |
| GET | `/api/products/:key/trend` | 档位最低价走势，`?hours=720` |
| GET | `/api/product/:id` | 单个商品完整详情 |
| GET | `/api/search` | 全局搜索，`?q=关键词&in_stock=1` |
| GET | `/api/history/:shopId/:goodsKey` | 单商品价格历史 |
| POST | `/api/reclassify` | 用最新规则重新归类全部商品（不重新抓取） |
| POST | `/api/detect-conflicts` | 重新检测标题-描述矛盾 |
| GET | `/api/tiers` | 旧版档位聚合（兼容保留） |

## 标准商品模型

`config/openai-products.json` 分三层：

**平台元信息**（后续接 Claude 等）

```json
{ "platformMeta": { "key": "openai", "name": "OpenAI", "desc": "ChatGPT / Plus / Pro / Codex" } }
```

**标准商品**：跨店统一的商品概念

```json
{
  "key": "plus-daily", "group": "account", "order": 10,
  "name": "Plus 日抛 / 未接马",
  "spec": "未接短信 · 质保首登 · 30 分钟~1 小时验号",
  "note": "最便宜的一档，只保首登，超时不退不换"
}
```

**匹配规则**：按顺序匹配，首个命中即返回

```json
{
  "product": "plus-daily",
  "aliases": ["未接马", "未接码", "日抛", "质保首登", "首登"],
  "requireAny": ["plus", "gpt", "oai"],
  "excludeAny": ["反代", "接马服务"]
}
```

| 字段 | 含义 |
| --- | --- |
| `aliases` | 商品名包含任一别名即命中 |
| `regex` | 正则匹配（替代 aliases） |
| `requireAny` | 必须包含任一，用于收紧 |
| `excludeAny` | 包含任一则本规则不匹配 |
| `band` | 价格合理区间 `{ min, max }`，越界会被标记 |

### 三条踩过的坑

**规则顺序决定一切。** 「已接马」包含「接马」二字，如果接马规则排在成品号前面，所有 Plus 成品号都会被当成接马服务。账号类规则必须排在服务类前面。

**排除词会排除自己。** 给「已接马」档加 `excludeAny: ["接马"]`，结果 40 条全灭——因为「已接马」本身就含「接马」。用「接马服务」「接码服务」这类完整词。

**跨平台污染最难防。** Grok 也有「Plus」和「普号」，Gemini 也有「Pro」，Kling 也有「积分」。`products.js` 里做了平台预判：命中其他平台强特征词、且无 OpenAI 主体词时，直接判为非本平台。

### 质保识别

独立于商品匹配，按标题判断：

| 等级 | 识别词 | 展示 |
| --- | --- | --- |
| `subscription` | 质保订阅 / 质保30天 / 质保25天 | 有质保（绿） |
| `first_login` | 质保首登 / 质保1h / 首登保障 | 仅首登（黄） |
| `none` | 无质保 / 不质保 | 无质保（红） |
| `unknown` | 都没写 | 未注明（灰） |

注意：「封号不保」不算无质保——商家常写「质保订阅，封号不保」，这是两种保障，不矛盾。

## 同款聚类

不做标题字符串相似度，而是提取**属性指纹**：

| 维度 | 取值 |
| --- | --- |
| 渠道 | UPI / iOS / 菲区 / 越南 / 印度 / 韩国 / GCash / PIX / PP |
| 邮箱 | iCloud / Gmail / Outlook / 域名邮箱 |
| 接马 | 已接 / 未接 |
| 质保 | 订阅 / 1天 / 仅首登 / 无 |
| 附加 | 独享 / 反代 / 重置卡 / 满额度 |

同档位内指纹相同即视为同款。实测 `Plus 日抛` 档的 125 条聚成 15 组，其中最值得注意的一组：12 家店卖同款，价格 ¥13.50 ~ ¥25.30，**价差 87%**。

## 抓取原理

目标站是 Vue SPA，页面无数据，全走 JSON 接口：

```
POST https://wzyp.cn/shopApi/Shop/info        { token }
POST https://wzyp.cn/shopApi/Shop/goodsList   { token, current, pageSize }
```

`token` 是店铺链接 `/shop/XXXXXXXX` 的最后一段，`pageSize` 实测可传 500 一次拉完。

**16688.com.cn 是另一套接口**（`/shopApi/shop/detail` + `{ shop_no }`），结构类似但参数名不同，尚未适配。

商品描述在 `description` 字段（富文本），里面含发货格式、售后条款、使用限制——这些比标题信息量更大，但**不适合作为分类依据**，因为描述里的「接马」多是操作说明而非商品属性。

## 已知限制

- **只支持 wzyp.cn**，16688 需另写适配器（接口已摸清）
- **同款聚类依赖属性词**，标题里不写渠道/邮箱的商品会落到「通用规格」大组，聚类偏粗
- **价格走势数据量**取决于抓取频次，目前只有手动抓取或开 `POLL_MINUTES` 才有数据
- **前端单文件无构建**，约 1200 行，组件化程度低

## 开发提示

改完 `config/openai-products.json` 后，不需要重新抓取，调一次接口即可全量重新归类：

```bash
curl -X POST localhost:8052/api/reclassify
curl -X POST localhost:8052/api/detect-conflicts
```

当前规模：24 家店 / 1890 件商品 / 25 个可见标准商品 / 全量抓取约 7 秒。
