# 卡网比价

聚合多家发卡店铺（wzyp.cn / 鲸商城）的商品报价，按 OpenAI、Claude 分平台展示，把各店叫法不同的商品归到统一的标准商品下，一眼看出同一款货在哪家买最便宜、有没有质保。

![OpenAI 平台分组](https://img.shields.io/badge/platform-OpenAI-a9762f) ![零依赖](https://img.shields.io/badge/deps-none-4d8a5b) ![Node](https://img.shields.io/badge/node-24%2B-339933)

## 功能

**比价核心**
- **标准商品 + 别名**：把「G Plus 未接马 质保首登」「印度-PLUS-outlook邮箱-保首登」这类不同叫法归到同一个标准商品下；Claude 独立区分 Pro / Max 成品号、代充、普通账号、接码和 KYC 服务
- **OpenAI / Claude 自动分组（试用）**：从标题和原分类识别商品类型与套餐，OpenAI 自动归入 PriceAI 风格的标准目录，Claude 按实际出现的属性组合生成目录。倍数、面额、期限、接码状态、邮箱、地区等在右侧组合筛选，仅显示有不同取值的属性；报价中保留全部识别属性和依据，关键规格不明的商品集中到一个待确认入口，逐条显示原因
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
- 左侧平台 → 分组 → 标准商品三级结构，平台和分组默认收起，手动展开/收起后记住选择
- 右侧按价格 / 质保 / 店铺 / 库存排序
- 全局搜索（覆盖商品名与描述文本）
- 所有 UI 偏好持久化（折叠、开关、当前分类、排序）
- SSE 实时抓取进度

两个平台的自动分组仅在读取报价时生成，不改写数据库里的标准商品归类。OpenAI 参考 PriceAI 的标准目录，直接展示普号、周边与自助服务、Codex 额度充值、Go、Plus 试用订阅、Plus 正价代充、Team / Business，以及 Pro 100 / 200 / 500 刀档的代充和成品号。目录仅在有对应报价时出现；Team 的席位、母号/子号、共享和轮转商品汇入同一入口，交付细节保留在右侧筛选。

左侧仅对包含多个商品子类型的目录显示可折叠大类，只有一个子项时直接显示完整商品入口，不再额外套一层；判断依据是子类型数量，不是店铺或报价数量。Plus、Pro 按成品号、代充、共享号组织；Plus 正价与其他代充放在同一个代充大类，Pro 代充和成品号各自包含 100 / 200 / 500 刀及其他档位。普号、周边服务、Codex 充值、Go、Team / Business、接码及待确认等只有一个子项时直接展示。大类默认收起并记住展开状态，具体商品的报价和右侧筛选不变。

Claude 同步采用套餐加交付方式组织目录：Pro、Max 各自区分成品号、代充和实际出现的共享号；Max 内按明确写出的 5x、20x 等倍数生成子项，并按倍数升序排列。KYC 认证与提链收在同一服务目录。与 OpenAI 一样，只有多个子类型才显示汇总大类，单个子项直接展示并保留套餐、倍数和交付方式。未识别到套餐的商品不强行归入 Pro 或 Max，期限、邮箱、地区、认证状态等仍在右侧筛选。

两个平台内均优先展示包含多个子类型的汇总分组，单一类型入口排在其后；两类入口各自保留原有相对顺序，分组内的子项顺序不变。

Pro 档位根据商品明确写出的面额或参考目录的倍数对应关系（5x → 100、20x → 200、25x/50x 或 Pro Max → 500）识别，不根据销售价格推断；相互矛盾的规格进入待确认。其他已注明的档位单独保留，不强行归入这三档。Plus 正价代充须有标题中的正价、正规、官方充值或真实付费等依据，半价、试用及未注明渠道的充值另列。共享号、接码等按实际类型保留，信息不足或冲突的报价进入待确认。

一个目录可包含不同期限或交付细节，侧栏价格表示报价起价；使用右侧筛选缩小范围后再比较报价。倍数和明确写出的期限直接取自商品文字，未注明的筛选值显示为「未注明」，不推定月卡。当前仍使用属性和别名词表，尚未采用语义模型；自动组试用期间不展示历史走势或二次同款聚合。页面不提供分组模式切换，预设分类仍可通过 API 的 `openai_grouping=preset`、`claude_grouping=preset` 参数读取。

第三方号池余额充值、API / 中转额度、镜像站服务不纳入比价：两个平台的自动目录、预设分类、报价及全局搜索均统一过滤，重新抓取后仍适用。仅说明支持反代或可用于自建号池的成品账号保留，Codex 官方点数充值保留。原始抓取数据仍保存在数据库中。

标题里的网址、卡密或 CDK 字样不能单独证明商品是订阅充值。独立子邮箱不进入平台主商品目录，成品与代充可选的报价列入待确认；“24 小时自动充值”等服务时效不作为订阅期限。

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

### Windows 常驻运行

在终端里 `node server.js` 起的进程会挂在那个终端下面，**关掉终端或重启 IDE，服务就一起没了**。要长期跑用脚本启动：

```bat
start.bat   :: 以独立进程启动，关闭任何窗口都不影响；日志写 data\server.log
stop.bat    :: 停止占用 8052 的进程
```

`start.bat` 用 `start /min cmd /c` 把进程从当前终端树里摘出去，启动后父进程退出、它变成孤儿进程继续跑。已注册计划任务 `cardweb-autostart`（登录时自动执行 `start.bat`），改端口或路径后记得同步更新该任务。

查自启任务：

```bat
schtasks /Query /TN cardweb-autostart
schtasks /Delete /TN cardweb-autostart /F   :: 取消自启
```

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
| `FETCH_MIN_GAP_MS` | `300` | 相邻请求的最小间隔（毫秒）。被限流时可调大到 `800`~`1500` |

想积累价格走势数据，建议设成 `60`（每小时一轮）。

## 目录结构

```
cardweb/
├── server.js                 HTTP 服务 + 路由 + SSE
├── src/
│   ├── fetcher.js            抓取 wzyp.cn，解析描述/发货格式/售后
│   ├── products.js           标准商品匹配 + 质保识别 + 矛盾检测
│   ├── cluster.js            跨店同款聚类（属性指纹）
│   ├── auto-groups.js        Claude 属性提取 + 两个平台共用的动态分组汇总
│   ├── openai-auto-groups.js OpenAI 关键词属性提取与动态分组（试用）
│   ├── db.js                 SQLite 表结构与查询
│   ├── scheduler.js          串行抓取调度器
│   └── classify.js           旧版档位分类（保留兼容）
├── config/
│   ├── openai-products.json  标准商品 + 别名 + 质保词表 + 价格区间（主配置）
│   ├── claude-products.json  Claude 标准商品 + 别名（复用质保词表）
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
| products | `product_key` | 标准商品 key，`NULL` 表示未归类或不属于已支持的平台 |
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
| GET | `/api/products?openai_grouping=auto&claude_grouping=auto` | 页面使用的两个平台动态分组；API 参数仍可分别设为 `auto` / `preset`，附各自组数和待确认数 |
| GET | `/api/products?grouping=auto` | 兼容旧版 Claude 自动分组入口，OpenAI 仍为预设分类 |
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

`config/openai-products.json` 与 `config/claude-products.json` 使用同一套标准商品结构：

**平台元信息**（OpenAI 与 Claude 各有独立配置，接口统一返回平台、分组和标准商品）

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

### Team 细分四档

Team 类商品标题写法极不统一，同一条「5x team」下混着普通车、轮转车、长效车三种寿命，价格差 3 倍。按**寿命**而不是额度拆成四档：

| key | 名称 | 判定依据 | 典型价格 |
| --- | --- | --- | --- |
| `team-long` | Team 长效车 | 长效 / 不踢 / 非轮转 / 用到空间死 | ¥54 ~ ¥82 |
| `team-1x` | Team 1x（标准席位） | 标准席位 / 普通席位 / 周限号 / 1x / 平替plus | ¥61 ~ ¥95 |
| `team-rotate` | Team 轮转车 | 轮转 / 首车 / 头车 / 二车 / 过夜 / 几点踢 | ¥25 ~ ¥78 |
| `team-5x` | Team 5x（普通车） | 兜底：写了 5x 但无上述特征 | ¥43 |

四条规则都带 `requireAny: ["team"]`，且**排在其他所有规则之前**——否则「Team标准账号平替plus」会被 Plus 规则先吃掉。四档内部的顺序是 `long → 1x → rotate → 5x`：「长效…标准席位」同时命中 long 和 1x，长效才是买家真正关心的信息。

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
**`goods_type: "card"` 现在是必传的** —— 少这个字段接口照样返回 `code:1`，但 `total` 恒为 0，看起来像「店铺下架了」其实是参数问题。

### 反爬与限流（2026-10-21 实测）

平台前面是阿里云 ESA，会按 **TLS 指纹**和 **IP 频次**两套规则拦请求。排查时最容易误判成「IP 被封」，实际分层如下：

| 现象 | 真实原因 | 处理 |
| --- | --- | --- |
| `403` + `X-Tengine-Error: denied by http_ratelimit` | 频次限流（可能是 IP 级，可能是指纹级） | 降速 + 重试；退避几十秒到几分钟会自动恢复 |
| 响应是 `<script>var arg1=...` 的页面 | `acw_sc__v2` JS 挑战 | 在 `node:vm` 沙箱里执行这段脚本，取到 cookie 后重放 |
| Node 一直 403，同一时刻 curl / 浏览器 200 | OpenSSL 指纹被单独限流 | 自动切到 curl 传输（Windows 上是 Schannel，指纹不同） |
| 只有 `/info` 403，`/goodsList` 正常 | `/info` 是单独限流对象 | `/info` 仅在新增店铺时请求，全量刷新不再重复调用 |

同一时刻同一 IP 下 **浏览器 200 / curl 200 / Node fetch 403**、且请求头逐字节对齐后仍 403，是判定「不是 IP 封禁、是指纹识别」的关键对照实验。等 5 分钟仍 403 但 `/goodsList` 正常，说明限的是单个接口而不是整站。

`fetcher.js` 里的对策是四层：全局请求间隔（`FETCH_MIN_GAP_MS`，默认 1500ms）、随机抖动（`FETCH_JITTER_MS`，默认 0~500ms）、403/429 按 30/60/120 秒冷却重试、原生 fetch 被拦时粘性切换到 curl 备用通道。JS 挑战仍会自动求解。

**16688.com.cn 是另一套接口**（`/shopApi/shop/detail` + `{ shop_no }`），结构类似但参数名不同，尚未适配。

商品描述在 `description` 字段（富文本），里面含发货格式、售后条款、使用限制——这些比标题信息量更大，但**不适合作为分类依据**，因为描述里的「接马」多是操作说明而非商品属性。

## 已知限制

- **只支持 wzyp.cn**，16688 需另写适配器（接口已摸清）
- **同款聚类依赖属性词**，标题里不写渠道/邮箱的商品会落到「通用规格」大组，聚类偏粗
- **价格走势数据量**取决于抓取频次，目前只有手动抓取或开 `POLL_MINUTES` 才有数据
- **前端单文件无构建**，约 1200 行，组件化程度低
- **抓取仍可能触发平台限流**：全量刷新只请求商品列表，并默认间隔 1.5~2 秒；连续触发多轮仍可能进入 403 窗口，程序会按 30/60/120 秒自动冷却重试
- **Docker 里的 curl 走 OpenSSL**（Alpine + musl），指纹与宿主 Windows 的 Schannel 不同，备用通道未必能绕开限流。若容器内持续 403，优先考虑在宿主机跑或换用支持自定义 TLS 指纹的出口

## 开发提示

修改任一平台的商品配置后，先重启服务加载配置，再调用以下接口重新归类现有商品并复查标题与描述的矛盾，无需重新抓取：

```bash
curl -X POST localhost:8052/api/detect-conflicts
```

店铺、商品数量以页面和 API 当前返回为准；全量抓取耗时取决于店铺数量、分页和限流重试。
