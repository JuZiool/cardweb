import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATHS = ['openai-products.json', 'claude-products.json']
  .map((file) => join(__dirname, '..', 'config', file));

let cfg = load();

function normList(arr) {
  return (arr || []).map((s) => String(s).toLowerCase());
}

function load() {
  const configs = CONFIG_PATHS.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  const raw = configs[0];
  const products = new Map();
  const groups = new Map();
  const rules = new Map();
  const platforms = [];
  for (const config of configs) {
    const platform = config.platformMeta;
    platforms.push(platform);
    for (const p of config.products) products.set(p.key, { ...p, platform: platform.key });
    for (const g of config.groups) groups.set(`${platform.key}:${g.key}`, { ...g, platform: platform.key });
    rules.set(platform.key, config.rules.map((r) => ({
      product: r.product,
      aliases: normList(r.aliases),
      requireAny: normList(r.requireAny),
      excludeAny: normList(r.excludeAny),
      regex: r.regex ? new RegExp(r.regex, 'i') : null,
    })));
  }

  const warranty = {
    subscription: normList(raw.warranty?.subscription),
    firstLogin: normList(raw.warranty?.first_login),
    noneMarkers: normList(raw.warranty?.none_markers),
  };

  return { products, groups, rules, warranty, raw, platforms, platform: platforms[0] };
}

/**
 * 识别质保等级：
 * - subscription：质保订阅 / 质保 N 天（真正的售后）
 * - first_login：只保首登（几十分钟~几小时）
 * - none：明确无质保
 * - unknown：没写
 */
export function warrantyLevel(name) {
  const L = (name || '').toLowerCase();
  if (cfg.warranty.noneMarkers.some((s) => L.includes(s))) {
    // 「质保订阅」和「不保封号」可能同时出现，订阅优先
    if (cfg.warranty.subscription.some((s) => L.includes(s))) return 'subscription';
    return 'none';
  }
  if (cfg.warranty.subscription.some((s) => L.includes(s))) return 'subscription';
  if (cfg.warranty.firstLogin.some((s) => L.includes(s))) return 'first_login';
  return 'unknown';
}

export const WARRANTY_LABEL = {
  subscription: '有质保',
  first_login: '仅首登',
  none: '无质保',
  unknown: '未注明',
};

function matchRule(rule, name, nameLower) {
  if (rule.excludeAny.length && rule.excludeAny.some((s) => nameLower.includes(s))) return false;
  if (rule.requireAny.length && !rule.requireAny.some((s) => nameLower.includes(s))) return false;
  if (rule.regex) {
    if (!rule.regex.test(name)) return false;
    return true;
  }
  if (rule.aliases.length && rule.aliases.some((s) => nameLower.includes(s))) return true;
  // 只有 requireAny 没有 aliases：满足前置条件即命中
  return rule.aliases.length === 0 && rule.requireAny.length > 0;
}

/**
 * 平台归属判定：先看商品属于哪个 AI 平台。
 * 命中其他平台的强特征词且没有 OpenAI 主体词时，直接判定为「非本平台」。
 */
const OTHER_PLATFORM = [
  'claude', '克劳德', 'gemini', 'muse', 'supergro', 'super gro', 'gro4.6',
  'grok', 'gro ', 'grok premium', 'gro premium', 'gro普号', 'gro 普号',
  'kiro', 'leonardo', 'capcut', '即梦', 'antigravity', '反重力', 'firefly',
  'gr ok', 'g r o k', 'grok',
];
const OPENAI_SUBJECT = [
  'plus', 'gpt', 'oai', 'codex', 'g free', 'gfree', 'chatgpt', 'openai', '吉皮提',
  'g+p', 'gp t', 'gp·t', 'openai',
];

function isOtherPlatform(nameLower) {
  const hasOther = OTHER_PLATFORM.some((s) => nameLower.includes(s));
  if (!hasOther) return false;
  return !OPENAI_SUBJECT.some((s) => nameLower.includes(s));
}

function isGuideListing(name, categoryRaw) {
  if ((categoryRaw || '').includes('教程')) return true;
  return /^(?:【教程】|小白.*教程|免费教程|反代教程|使用.*教程)/i.test(name)
    || /保姆级.*教程.*指南/i.test(name);
}

/** 排除售卖中转、号池余额或镜像服务的条目，账号的兼容能力不作为排除依据。 */
export function isRelayProduct({ name = '', categoryRaw = '' }) {
  const clean = String(name).normalize('NFKC')
    .replace(/https?:\/\/[^\s<>【】（）()，,。；;|｜]+/ig, ' ')
    .replace(/(?:不是|并非|不属于|不支持|不能|无需|不走|不含|非)\s*(?:中转站?|号池|镜像站?|api)/ig, ' ')
    .replace(/(?:可(?:以)?(?:用于|用来)|用于|用来|适用于|支持(?:自建|搭建)?|可(?:自建|搭建))\s*(?:自建)?(?:号池|中转|api|反代)[^，,。；;|｜【】（）()]*/ig, ' ')
    .replace(/[^，,。；;|｜【】（）()]*(?:教程|教学|使用说明|操作说明)[^，,。；;|｜【】（）()]*/ig, ' ');
  if (/中转|镜像(?:站|服务)|号池[^，,。；;|｜]{0,24}(?:充值|余额|额度)|(?:充值|余额|额度)[^，,。；;|｜]{0,12}号池|\bapi\b[^，,。；;|｜【】（）()]{0,18}(?:额度|余额|充值|密钥|key)|\d+\s*[mk亿万]\s*tokens?/i.test(clean)) return true;
  const category = String(categoryRaw).normalize('NFKC');
  const account = /成品|普号|白号|老号|账[号户密]|帐[号户密]|席位|代充|直充|已接[马码]|未接[马码]|官方.*(?:点数|额度)/i.test(clean);
  return !account && /中转|号池|镜像(?:站|服务)|\bapi\b/i.test(category);
}

/**
 * 返回 { productKey, warranty }。
 * 先确定平台，再按该平台 rules 顺序取首个命中；非目标商品返回 null。
 */
export function classifyProduct(item) {
  const name = item.name || '';
  const nameLower = name.toLowerCase();

  if (isGuideListing(name, item.categoryRaw) || isRelayProduct(item)) return null;
  const category = (item.categoryRaw || '').toLowerCase();
  const claudeName = /claude|anthropic|克劳德|克劳徳|克劳/.test(nameLower);
  // 仅补认纯 Claude 分类里的无平台词成品号，混合分类不能作为平台依据。
  const claudeCategory = /claude|anthropic|克劳/.test(category)
    && !/codex|openai|gpt|gemini|gro[k .]|gork|muse/.test(category);
  const platform = claudeName || (claudeCategory && /已过k(?:yc)?无订阅.*(?:成品号|普号)/i.test(name))
    ? 'claude' : 'openai';
  if (platform === 'claude') {
    if (/接马手机卡|能用\s*claude|claude[、,，/\s]+codex可用/i.test(name)) return null;
  } else if (isOtherPlatform(nameLower)) return null;

  for (const rule of cfg.rules.get(platform)) {
    if (matchRule(rule, name, nameLower)) {
      return { productKey: rule.product, warranty: warrantyLevel(name) };
    }
  }
  return null;
}

export function getProduct(key) {
  return cfg.products.get(key) || null;
}

export function allProducts() {
  return [...cfg.products.values()].sort((a, b) => a.order - b.order);
}

export function platformMeta() {
  return cfg.platform;
}

export function allPlatforms() {
  return [...cfg.platforms].sort((a, b) => a.order - b.order);
}

export function allGroups() {
  return [...cfg.groups.values()].sort((a, b) => a.order - b.order);
}

export function reload() {
  cfg = load();
}

/**
 * 标题与描述的矛盾检测。
 *
 * 商家常把标题写成「已接马」引流，描述里却要求买家自己接马。
 * 买家按标题下单 → 拿到发现要自己接 → 售后纠纷。这类必须标出来。
 *
 * 返回 { conflict, reason } 或 null。
 */
const CONFLICT_RULES = [
  {
    // 标题声称已接马，描述却要求自行接码
    title: /已接(马|码)/,
    desc: /(需要|需|要|自行|自己|请)(.{0,6})(接马|接码)|自动接马需|需自行接/i,
    reason: '标题写「已接马」，描述要求自行接码',
  },
  {
    // 标题声称未接马，描述却说已接好
    title: /未接(马|码)/,
    desc: /(已接好|已接马|无需接马|already.?(verified))/i,
    reason: '标题写「未接马」，描述称已接好',
  },
  {
    // 标题说质保订阅/长质保，描述却明确「无质保」。
    // 注意： 「封号不保」不在此列 —— 订阅质保与封号无关，商家常并列写明，属正常。
    title: /(质保订阅|质保(25|28|30)天|质保一个月)/,
    // 只认「整体无质保」；「不质保封号」「封号无质保」「无售后」多指封号不赔，属正常范围
    desc: /(整体无质保|完全无质保|本商品无质保|无质保版|无任何售后保障|不含质保|不含售后)/,
    reason: '标题写质保订阅，商品描述称整体无质保',
  },
  {
    // 标题说「可覆盖」，描述却说不可。
    // 标题里若本来就写着「不可覆盖」，不是矛盾。
    title: /(可覆盖|支持续费|能续费)/,
    titleExclude: /(不可覆盖|无法覆盖|不支持续费|不能续费)/,
    desc: /(不(可|能)覆盖|无法覆盖|不支持续费|不能续费|不可续费)/,
    reason: '标题写可覆盖/可续费，商品描述称不可',
  },
  {
    // 标题说是成品号/独享，描述却说本商品是共享的。
    // 必须先排除否定/限制语境：「非共享」「禁止共享」「共享 IP」「共享转售」「禁止多人」都是正常说明。
    title: /(成品|独享)/,
    desc: /(?<!非)(?<!禁止)(?<!不支持)(?<!不是)(?<!严禁)(本(商品|账号)?(为|是)共享|共享账号|合租号|拼车号|多人共用该号)/,
    reason: '标题写成品/独享，描述称本商品为共享号',
  },
  {
    // 标题说是月卡/长效，描述却定为日抛。
    // 只认「本商品是日抛」的说法，排除「不是日抛」「日抛日抛日抛」这类强调/否定句。
    title: /(月卡|长效|长期)/,
    desc: /(?<!不是)(?<!非)(默认日抛|本商品日抛|就是日抛|日抛号|当天失效|当日失效|24小时内失效)/,
    reason: '标题写月卡/长效，描述称日抛',
  },
];

export function detectConflict(name, descText) {
  const title = name || '';
  const desc = descText || '';
  if (!desc) return null;
  for (const r of CONFLICT_RULES) {
    if (r.titleExclude && r.titleExclude.test(title)) continue;
    if (r.title.test(title) && r.desc.test(desc)) {
      return { conflict: true, reason: r.reason };
    }
  }
  return null;
}
