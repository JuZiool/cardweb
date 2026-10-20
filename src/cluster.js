/**
 * 跨店同款聚类。
 *
 * 用途：同一档位内，把「叫法不同但其实是同一款」的商品聚到一起，便于横向比价。
 * 例：
 *   「G Plus 未接马 质保首登」
 *   「印度-PLUS-outlook邮箱-保首登」
 *   「【源头直供·纯手搓】Plus 独享成品号｜未接马｜质保首登｜账号+密码+2FA」
 * 这三条应归为一簇（同档位 + 同关键属性组合）。
 *
 * 做法：提取属性指纹（渠道 / 邮箱类型 / 接马状态 / 质保类型 / 是否独享），
 * 同档位内指纹相同即视为同款。不依赖标题字符串相似度，避免叫法差异干扰。
 */

const CHANNEL = [
  ['upi', ['upi']],
  ['ios', ['ios', '美区', 'apple']],
  ['ph', ['菲区', '菲律宾', '菲']],
  ['vn', ['越南']],
  ['india', ['印度']],
  ['korea', ['韩国']],
  ['gcash', ['gcash', 'gc']],
  ['pix', ['pix']],
  ['pp', ['pp渠道', 'pp-', ' (pp', 'paypal']],
];

const EMAIL = [
  ['icloud', ['icloud', 'ic邮箱', '苹果邮箱', 'apple邮箱']],
  ['gmail', ['gmail', '谷歌邮箱', 'gmail邮箱']],
  ['outlook', ['outlook', '微软邮箱', 'hotmail']],
  ['domain', ['域名邮箱', '域名邮件']],
];

const SMS = [
  ['ready', ['已接马', '已接码', '已接🐎', '已接']],
  ['pending', ['未接马', '未接码', '未接🐎', '未接']],
];

const WARRANTY = [
  ['sub', ['质保订阅', '质保一个月', '质保30天', '质保25天', '质保28天', '保订阅']],
  ['day', ['质保1天', '质保一天', '质保24小时']],
  ['first', ['质保首登', '首登', '保首登', '1h', '1小时', '半小时']],
  ['none', ['无质保', '不质保', '无售后']],
];

const FLAG = [
  ['exclusive', ['独享', '独有']],
  ['proxy', ['反代', 'sub2', 'cpa']],
  ['reset', ['重置卡']],
  ['full', ['满额度']],
];

function pick(nameLower, table, fallback = '') {
  for (const [key, words] of table) {
    if (words.some((w) => nameLower.includes(w))) return key;
  }
  return fallback;
}

/**
 * 生成商品指纹。
 * 返回 { key, parts }，key 相同即视为同款。
 */
export function fingerprint(item) {
  const name = String(item.name || '').toLowerCase();
  const tier = item.productKey || 'unknown';

  const parts = {
    channel: pick(name, CHANNEL, '-'),
    email: pick(name, EMAIL, '-'),
    sms: pick(name, SMS, '-'),
    warranty: pick(name, WARRANTY, '-'),
    exclusive: FLAG[0][1].some((w) => name.includes(w)) ? '1' : '0',
    proxy: FLAG[1][1].some((w) => name.includes(w)) ? '1' : '0',
    reset: FLAG[2][1].some((w) => name.includes(w)) ? '1' : '0',
    full: FLAG[3][1].some((w) => name.includes(w)) ? '1' : '0',
  };

  // 指纹只包含「有意义」的维度；全 '-' 的维度不参与，避免噪声
  const key = [tier, parts.channel, parts.email, parts.sms, parts.warranty,
    parts.exclusive, parts.proxy, parts.reset, parts.full].join('|');

  return { key, parts, tier };
}

/** 人话描述这一簇的属性 */
export function describeCluster(parts) {
  const map = {
    channel: { upi: 'UPI', ios: 'iOS', ph: '菲区', vn: '越南', india: '印度',
      korea: '韩国', gcash: 'GCash', pix: 'PIX', pp: 'PP', icloud: 'iCloud',
      gmail: 'Gmail', outlook: 'Outlook', domain: '域名邮箱' },
    email: { icloud: 'iCloud', gmail: 'Gmail', outlook: 'Outlook', domain: '域名邮箱' },
    sms: { ready: '已接马', pending: '未接马' },
    warranty: { sub: '订阅质保', day: '1 天质保', first: '仅首登', none: '无质保' },
  };
  const out = [];
  if (map.channel[parts.channel]) out.push(map.channel[parts.channel]);
  // 渠道与邮箱可能是同一概念（如 iCloud 既是渠道也是邮箱），只输出一次
  if (map.email[parts.email] && map.email[parts.email] !== map.channel[parts.channel]) {
    out.push(map.email[parts.email]);
  }
  if (map.sms[parts.sms]) out.push(map.sms[parts.sms]);
  if (map.warranty[parts.warranty]) out.push(map.warranty[parts.warranty]);
  if (parts.exclusive === '1') out.push('独享');
  if (parts.proxy === '1') out.push('反代');
  if (parts.reset === '1') out.push('带重置卡');
  if (parts.full === '1') out.push('满额度');
  return out.length ? out.join(' · ') : '通用规格';
}

/**
 * 把一批商品聚成簇。
 * items: [{ id, name, price, stock, shopId, shopName, productKey, warranty, link, ... }]
 * 返回 [{ key, label, tier, items, best, shops, spread }]
 */
export function clusterProducts(items) {
  const groups = new Map();

  for (const it of items) {
    const fp = fingerprint(it);
    // 属性全空且无主体信息时不聚类（避免把所有「其他」揉成一坨）
    if (!groups.has(fp.key)) {
      groups.set(fp.key, { key: fp.key, parts: fp.parts, tier: fp.tier, items: [] });
    }
    groups.get(fp.key).items.push(it);
  }

  const out = [];
  for (const g of groups.values()) {
    const inStock = g.items.filter((i) => (i.stock || 0) > 0);
    if (g.items.length < 2) continue; // 单条不成簇
    const prices = inStock.map((i) => i.price).filter((p) => p > 0);
    if (!prices.length) continue;

    const sorted = [...g.items].sort((a, b) => {
      const as = (a.stock || 0) > 0 ? 0 : 1;
      const bs = (b.stock || 0) > 0 ? 0 : 1;
      return as - bs || a.price - b.price;
    });
    const shops = new Set(g.items.map((i) => i.shopId));
    out.push({
      key: g.key,
      label: describeCluster(g.parts),
      tier: g.tier,
      items: sorted,
      count: g.items.length,
      inStockCount: inStock.length,
      shops: shops.size,
      best: sorted.find((i) => (i.stock || 0) > 0) || sorted[0],
      min: Math.min(...prices),
      max: Math.max(...prices),
      spread: prices.length > 1
        ? ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100
        : 0,
    });
  }

  // 簇内店铺多、价差大的排前面 —— 这些最值得比价
  out.sort((a, b) => b.shops - a.shops || b.spread - a.spread || b.count - a.count);
  return out;
}
