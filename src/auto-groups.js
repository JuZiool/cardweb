import { createHash } from 'node:crypto';

const KIND = {
  account: ['成品账号', 1], charge: ['代充订阅', 2], shared: ['共享账号', 3],
  sms: ['接码验证', 4], kyc: ['KYC 认证', 5], 'kyc-link': ['KYC 提链', 6],
  api: ['API 额度', 7], pending: ['待确认', 99],
};
const OTHER_PLATFORM = /codex|openai|gpt|gemini|gro[k .]|gork|muse|cursor|kiro/i;
const FREE = /\bfree\b|普号|普通账[号户]|普通帐[号户]|白号|无订阅|注册号|老号/i;
const ACCOUNT = /成品|独享|账[号户]|帐[号户]|普号|白号|注册号|老号|\d+\s*天号/i;
const CHARGE = /代充|充值|直充|直冲|秒充|卡充|卡冲|卡付|卡密|密钥|\bcdk\b/i;
const IGNORE_PLAN = /^(?:code|api|key|kyc|ios|outlook|gmail|mail|account|token)$/i;

export function matchValue(text, pattern, value, evidence, label) {
  const m = text.match(pattern);
  if (!m) return '';
  const result = typeof value === 'function' ? value(m) : value;
  evidence.push(`${label}：${result}（${m[0]}）`);
  return result;
}

export function durationOf(text, kind, evidence, plan) {
  if (kind === 'kyc' || kind === 'kyc-link') return '';
  if (plan === 'Free' && !/有效|可用期|使用期|\d+\s*天号/.test(text)) return '';
  if (kind === 'sms' && /单次|一次性|一次验证码/.test(text)) {
    return matchValue(text, /单次|一次性|一次验证码/, '单次', evidence, '有效期');
  }
  const candidates = [...text.matchAll(/\d+(?:\.\d+)?\s*(?:[-~～至]\s*\d+(?:\.\d+)?\s*)?(?:个?月|天|日|小时|年)|(?:一|二|两|三|六|半)个?月|一年|月卡|年卡|季卡/ig)];
  const values = [];
  for (const m of candidates) {
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 16).trimStart();
    // 充值服务的营业、处理时效不表示订阅期限，明确有效期仍保留。
    if (kind === 'charge' && (/小时$/.test(m[0]) || /^内/.test(after))
      && !/(?:有效期|可用期|使用期|期限)\s*[:：]?\s*$/.test(before)
      && /^(?:内)?(?:可|支持)?(?:自动|自助)?(?:充值|代充|卡充|开通|到账|营业|在线|客服|接单)/.test(after)) continue;
    // 账号年龄、质保、首登和发货时间都不是商品有效期。
    if (!/^(?:月卡|年卡|季卡)$/.test(m[0]) && (/(?:质保|售后|保修|保首登|首登|接单|发货)[^，,。；;|｜【】（）()]{0,7}$/.test(before)
      || (['account', 'shared'].includes(kind) && /(?:注册|满月|邮箱)[^，,。；;|｜【】（）()]{0,7}$/.test(before))
      || /^(?:内)?(?:首登|自助发货|发货|内发货|接单|老号|以上普号|以上老号)/.test(after))) continue;
    let value = m[0].toLowerCase().replace(/\s+/g, '').replace(/[-~至]/g, '～').replace(/日$/, '天');
    value = value.replace(/^月卡$/, '1个月').replace(/^年卡$/, '1年').replace(/^季卡$/, '3个月');
    value = value.replace(/^半个月$/, '15天').replace(/^半年$/, '6个月');
    value = value.replace(/^[一二两三六]/, (n) => ({ 一: '1', 二: '2', 两: '2', 三: '3', 六: '6' })[n]);
    value = value.replace(/^(\d+)月$/, '$1个月');
    if (!values.includes(value)) values.push(value);
    evidence.push(`有效期：${value}（${m[0]}）`);
  }
  return values.join(' / ');
}

function extract(item) {
  const title = String(item.name || '').normalize('NFKC');
  const category = String(item.categoryRaw || '').normalize('NFKC');
  const evidence = [];
  const pureCategory = /claude|anthropic|克劳/i.test(category) && !OTHER_PLATFORM.test(category);
  // 只用纯平台分类补充标题缺少的信息，混合平台分类不能提供套餐证据。
  const categoryHint = pureCategory ? category : '';
  const account = ACCOUNT.test(title);
  const api = /\bapi\b|中转|\d+\s*[mk亿万]?\s*tokens?/i.test(title);
  let kind;
  let deliveryEvidence;
  if (api) {
    kind = 'api'; deliveryEvidence = title.match(/\bapi\b|中转|tokens?/i)?.[0];
  } else if (/提链|提取\s*kyc\s*链接/i.test(title)) {
    kind = 'kyc-link'; deliveryEvidence = title.match(/提链|提取\s*kyc\s*链接/i)?.[0];
  } else if (!account && /接马|接码|接ma|验证码|收码|手机号验证/i.test(title)) {
    kind = 'sms'; deliveryEvidence = title.match(/接马|接码|接ma|验证码|收码|手机号验证/i)?.[0];
  } else if (!account && /代认证|认证服务|实名认证|kyc\s*认证|主动触发/i.test(title)) {
    kind = 'kyc'; deliveryEvidence = title.match(/代认证|认证服务|实名认证|kyc\s*认证|主动触发/i)?.[0];
  } else if (/(?<!非)(?<!不是)(?<!禁止)(?<!不支持)共享|合租|拼车/.test(title)) {
    kind = 'shared'; deliveryEvidence = title.match(/共享|合租|拼车/)?.[0];
  } else if (/代充/.test(title)) {
    kind = 'charge'; deliveryEvidence = '代充';
  } else if (account) {
    kind = 'account'; deliveryEvidence = title.match(ACCOUNT)?.[0];
  } else if (CHARGE.test(title)) {
    kind = 'charge'; deliveryEvidence = title.match(CHARGE)?.[0];
  } else if (/成品|账号|普号/.test(categoryHint) && !CHARGE.test(categoryHint)) {
    kind = 'account'; deliveryEvidence = `店铺分类：${categoryHint}`;
  } else if (CHARGE.test(categoryHint) && !ACCOUNT.test(categoryHint)) {
    kind = 'charge'; deliveryEvidence = `店铺分类：${categoryHint}`;
  } else kind = 'pending';
  if (deliveryEvidence) evidence.push(`交付：${KIND[kind][0]}（${deliveryEvidence}）`);

  let plan = '';
  let multiplier = '';
  let conflictingPlans = false;
  let conflictingMultipliers = false;
  if (kind === 'account' || kind === 'charge' || kind === 'shared' || kind === 'pending') {
    // 先移除“可升级 Pro”等附带说明，普通号不会因可开通套餐而变成已订阅。
    const main = title.replace(/(?:可以|可|支持|能够|能)(?:开通|开|升级|升至|充值|充)[^，,。；;|｜】）)]*/ig, '');
    const plans = new Set([...main.matchAll(/\b(?:pro|free)\b|\bmax(?=\d|\b)/ig)].map((m) => m[0].toLowerCase()));
    const multipliers = new Set([...main.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*[x×倍](?![a-z])|\bmax\s*(\d+(?:\.\d+)?)/ig)]
      .map((m) => Number(m[1] || m[2])));
    conflictingPlans = plans.size > 1;
    conflictingMultipliers = multipliers.size > 1;
    const direct = main.match(/(?:claude|anthropic|克劳德|克劳徳|克劳)\s*(?:code\s*)?(pro|max|free)(?=[\s\d\W]|$)/i);
    if (direct) plan = matchValue(main, new RegExp(direct[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      direct[1].toLowerCase() === 'pro' ? 'Pro' : direct[1].toLowerCase() === 'max' ? 'Max' : 'Free', evidence, '套餐');
    else if (FREE.test(main)) plan = matchValue(main, FREE, 'Free', evidence, '套餐');
    else {
      // 新出现的英文套餐词直接成为属性，无需先在商品配置里登记。
      const named = main.match(/(?:claude|anthropic|克劳德)\s+(?:code\s+)?([a-z][a-z0-9]*(?:[.-][a-z0-9]+)*)/i);
      if (named && !IGNORE_PLAN.test(named[1]) && !/^max\d/i.test(named[1])) {
        plan = named[1][0].toUpperCase() + named[1].slice(1).toLowerCase();
        evidence.push(`套餐：${plan}（${named[0]}）`);
      }
    }
    multiplier = matchValue(main, /(?<![\d.])(\d+(?:\.\d+)?)\s*[x×倍](?![a-z])/i,
      (m) => `${Number(m[1])}x`, evidence, '倍数');
    if (!multiplier) multiplier = matchValue(main, /\bmax\s*(\d+(?:\.\d+)?)(?![\d.])/i,
      (m) => `${Number(m[1])}x`, evidence, '倍数');
    if (!plan && !multiplier && FREE.test(categoryHint)) {
      plan = 'Free'; evidence.push(`套餐：Free（店铺分类：${categoryHint}）`);
    }
    if (!plan && /\bmax\b/i.test(categoryHint)) {
      plan = 'Max'; evidence.push(`套餐：Max（店铺分类：${categoryHint}）`);
    }
  }

  const attributes = { plan, multiplier, delivery: KIND[kind][0] };
  attributes.duration = durationOf(title, kind, evidence, plan);
  const usageText = title.replace(/(?:不是|并非|非|不属于|非默认)(?:日抛|当日抛|速刷|临期)/g, '');
  attributes.usage = matchValue(usageText, /日抛|当日抛|速刷|临期/, (m) => /日抛|当日抛/.test(m[0]) ? '日抛' : m[0], evidence, '使用方式');
  attributes.kyc = '';
  if (kind === 'account' || kind === 'shared') {
    attributes.kyc = matchValue(title, /已过\s*k(?:yc)?|已(?:完成|通过)\s*kyc|(?<!免)(?<!未)(?<!不)kyc\s*认证|kyc\s*普号/i, '已过 KYC', evidence, '认证');
    if (!attributes.kyc) attributes.kyc = matchValue(title, /免\s*kyc|无需\s*kyc/i, '免 KYC', evidence, '认证');
    if (!attributes.kyc) attributes.kyc = matchValue(title, /未过\s*k(?:yc)?|未\s*kyc|未认证/i, '未过 KYC', evidence, '认证');
  }
  const regionPattern = kind === 'sms' || kind === 'kyc' || kind === 'kyc-link'
    ? /东南亚|欧美|日韩|普通区|美区|美国|全球/i : /东南亚|欧美|日韩|普通区|美区(?:K|认证|kyc)?/i;
  attributes.region = matchValue(title, regionPattern,
    (m) => m[0].replace(/kyc|K|认证/ig, '').replace('美国', '美区'), evidence, '地区');
  attributes.email = '';
  if (kind === 'account' || kind === 'shared') {
    const emails = [
      ['教育谷歌', /教育谷歌|教育谷歌邮箱|教育gmail/i], ['Gmail', /gmail|谷歌邮箱/i],
      ['Outlook', /outlook|微软邮箱|hotmail/i], ['iCloud', /icloud|苹果邮箱/i],
      ['GMX', /gmx/i], ['Mail', /(?<![a-z])mail邮箱/i],
    ];
    for (const [value, pattern] of emails) {
      const found = matchValue(title, pattern, value, evidence, '邮箱');
      if (found) { attributes.email = found; break; }
    }
  }
  const channelText = title.replace(/安卓\s*(?:和|与|\/|、)?\s*ios\s*通用/ig, '');
  attributes.channel = matchValue(channelText, /kiro|\bios\b|官网|卡付|卡充|卡冲|中转|反代/i,
    (m) => ({ ios: 'iOS', kiro: 'Kiro', 卡付: '卡充', 卡充: '卡充', 卡冲: '卡充' })[m[0].toLowerCase()] || m[0], evidence, '渠道');
  attributes.quota = '';
  attributes.models = '';
  if (kind === 'api') {
    attributes.quota = matchValue(title, /(\d+(?:\.\d+)?)\s*([mk亿万]?)\s*tokens?/i, (m) => {
      const scale = { k: 1e3, m: 1e6, 万: 1e4, 亿: 1e8 }[m[2].toLowerCase()] || 1;
      return `${Number(m[1]) * scale} Token`;
    }, evidence, '额度');
    if (!attributes.quota) attributes.quota = matchValue(title, /(\d+(?:\.\d+)?)\s*(?:刀|美元|usd|\$)/i, (m) => `${Number(m[1])} USD`, evidence, '额度');
    const models = [...title.matchAll(/(?:opus|sonnet|haiku|fable)\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*|(?:opus|sonnet|haiku|fable)(?![a-z])/ig)]
      .map((m) => m[0].toLowerCase().replace(/\s+/g, '')).sort();
    attributes.models = [...new Set(models)].join(' / ');
    if (attributes.models) evidence.push(`模型：${attributes.models}`);
  }

  const reasons = [];
  if (conflictingPlans) reasons.push('出现多个套餐');
  if (conflictingMultipliers) reasons.push('出现多个倍数');
  if (kind === 'pending') reasons.push('交付方式未注明');
  if (['account', 'charge', 'shared', 'pending'].includes(kind) && !plan && !multiplier) reasons.push('套餐未注明');
  if (plan === 'Max' && !multiplier) reasons.push('Max 倍数未注明');
  if (plan === 'Free' && multiplier) reasons.push('普通号与倍数信息矛盾');
  if (kind === 'sms' && !attributes.duration) reasons.push('接码次数或有效期未注明');
  if (kind === 'api' && !attributes.quota) reasons.push('API 额度未注明');
  if (kind === 'api' && !attributes.duration) reasons.push('API 有效期未注明');
  if (attributes.duration.includes(' / ')) reasons.push('出现多个有效期');
  const pendingReason = reasons.join('；');
  return { kind, attributes, evidence, pendingReason };
}

/**
 * 按实际出现的属性组合生成 Claude 商品组；不读取标准商品定义或 productKey。
 * ponytail: 关键词提取只覆盖明确写出的规格；语境不明时保留在待确认入口，后续再扩充词义。
 */
export function autoGroupClaude(items) {
  return groupAutoProducts(items, {
    platform: 'claude', kinds: KIND, extract,
    attributeLabels: { plan: '套餐', multiplier: '倍数', delivery: '交付', duration: '期限', usage: '使用方式',
      kyc: '认证', region: '地区', email: '邮箱', channel: '渠道', quota: '额度', models: '模型' },
  });
}

/** 两个平台共用分组标识、报价汇总和识别依据展示。 */
export function groupAutoProducts(items, { platform, kinds, extract, attributeLabels }) {
  const groups = new Map();
  for (const item of items) {
    const hit = extract(item);
    const kind = Object.hasOwn(kinds, hit.kind) ? hit.kind : 'pending';
    const attributes = hit.attributes || {};
    const evidence = hit.evidence || [];
    const pendingReason = hit.pendingReason || (kind === 'pending' ? '商品类型或关键规格未明确' : '');
    const pending = Boolean(pendingReason);
    const groupAttributes = pending ? {} : {
      plan: attributes.plan || '',
      ...(platform === 'claude' && attributes.plan === 'Max' ? { multiplier: attributes.multiplier || '' } : {}),
      delivery: attributes.delivery || '',
    };
    const catalog = pending ? null : hit.catalog;
    const identity = pending ? ['pending'] : catalog ? ['catalog', catalog.id] : [kind, groupAttributes];
    const key = `auto-${platform}-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 20)}`;
    if (!groups.has(key)) {
      const parts = Object.values(groupAttributes).filter(Boolean);
      const name = pending ? '待确认商品' : catalog?.name || parts.join(' · ') || kinds[kind][0];
      groups.set(key, {
        key, platform, group: pending ? 'pending' : kind,
        groupName: kinds[pending ? 'pending' : kind][0], order: catalog?.order ?? kinds[pending ? 'pending' : kind][1],
        name, spec: pending ? '信息不足或存在冲突' : catalog?.spec
          || (platform === 'claude' ? parts.join(' · ') : '按倍数、面额、期限等筛选'),
        note: pending ? '商品信息不足或存在冲突，请查看每条商品的待确认原因。'
          : '本目录包含不同倍数、面额、期限等规格，请按商品属性筛选并查看商品说明。',
        automatic: true, catalog: Boolean(catalog), pending, attributes: catalog ? {} : groupAttributes, items: [], band: null,
      });
    }
    const displayAttributes = Object.fromEntries(Object.entries(attributes)
      .filter(([, value]) => value).map(([field, value]) => [attributeLabels[field] || field, value]));
    if (!attributes.duration) displayAttributes['期限'] = '未注明';
    groups.get(key).items.push({ ...item, autoAttributes: displayAttributes, autoEvidence: evidence, autoPendingReason: pendingReason });
  }
  return [...groups.values()].map((g) => {
    g.items.sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.price - b.price);
    const available = g.items.filter((i) => i.stock > 0);
    const positive = (rows) => rows.map((i) => i.price).filter((p) => p > 0);
    const min = (rows) => { const prices = positive(rows); return prices.length ? Math.min(...prices) : null; };
    return {
      ...g, offers: g.items.length, inStock: available.length,
      shops: new Set(g.items.map((i) => i.shopId)).size,
      minPrice: g.pending ? null : min(available.filter((i) => i.warranty === 'subscription')),
      minInStock: g.pending ? null : min(available), minPriceAny: g.pending ? null : min(g.items),
      lastSeen: Math.max(...g.items.map((i) => Number(i.lastSeen) || 0)) || null,
    };
  }).sort((a, b) => a.order - b.order
    || (platform === 'claude' && a.attributes.plan === b.attributes.plan
      ? (parseFloat(a.attributes.multiplier) || 0) - (parseFloat(b.attributes.multiplier) || 0) : 0)
    || a.name.localeCompare(b.name, 'zh-CN'));
}
