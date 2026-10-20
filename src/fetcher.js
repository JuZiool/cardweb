import { classify } from './classify.js';
import { classifyProduct, detectConflict } from './products.js';

const BASE = 'https://wzyp.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class FetchError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'FetchError';
    this.cause = cause;
  }
}

/** 从各种形态的链接里解析店铺 token：/shop/XXXX、裸 token */
export function parseToken(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new FetchError('链接不能为空');
  const m = raw.match(/\/shop\/([A-Za-z0-9_-]{4,32})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{4,32}$/.test(raw)) return raw;
  throw new FetchError('无法识别的店铺链接，请粘贴形如 https://wzyp.cn/shop/XXXXXXXX 的地址');
}

async function post(path, body, { timeout = 20000, token } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: BASE,
        Referer: token ? `${BASE}/shop/${token}` : BASE,
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new FetchError(`接口返回 HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== 1) throw new FetchError(json.msg || '接口返回异常');
    return json.data;
  } catch (err) {
    if (err.name === 'AbortError') throw new FetchError('请求超时');
    if (err instanceof FetchError) throw err;
    throw new FetchError(`网络错误：${err.message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchShopInfo(token) {
  const data = await post('/shopApi/Shop/info', { token, category_key: null }, { token });
  return {
    token,
    nickname: data.nickname || token,
    url: `${BASE}/shop/${token}`,
    sellCount: Number(data.sell_count) || 0,
    description: data.description || '',
    goodsCount: Number(data.goods_count) || 0,
    cardCount: Number(data.card_count) || 0,
    equityCount: Number(data.equity_count) || 0,
  };
}

/** 富文本转纯文本：去标签、解实体、压空白 */
export function htmlToText(html) {
  if (!html) return '';
  let t = String(html);
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '· ');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ');
  t = t.replace(/&amp;/g, '&');
  t = t.replace(/&lt;/g, '<');
  t = t.replace(/&gt;/g, '>');
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/&#39;/g, "'");
  t = t.replace(/&ldquo;|&rdquo;/g, '"');
  t = t.replace(/&mdash;/g, '—');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** 从描述里抽取「发货格式」 */
export function extractDelivery(html) {
  const t = htmlToText(html);
  // 1) 「发货格式：xxx」
  const m = t.match(/发货(?:格式|方式|形式|信息)\s*[:：]?\s*([^\n]{2,80})/);
  if (m) {
    const cand = m[1].trim().replace(/^为\s*/, '');
    // 排除说明性句子（含动词/否定词，不像格式描述）
    if (!/不会|别买|注意|请看|需要|可以|建议|否则|后果|售[后前]/.test(cand) && cand.length <= 60) {
      return cand;
    }
  }
  // 2) 倒装写法「账密2fa发货」「json发货」：取「发货」前 12 字内、且以格式词结尾的片段
  const rev = t.match(/(账密[\w\u4e00-\u9fa5]{0,8}|账号[\w\u4e00-\u9fa5]{0,8}|json|rt|卡密|cdk|链接|地址)\s*发货/gi);
  if (rev && rev.length) {
    const cand = rev[0].replace(/\s*发货$/i, '').trim();
    if (cand.length <= 20) return cand;
  }
  // 3) 「账号----密码----2FA」格式串：必须含 3 段以上、以分隔符连接
  const m2 = t.match(/([^\n]{0,30}(?:账号|邮箱|账密)[^\n]{0,20}(?:----|---|—)[^\n]{0,60})/);
  if (m2) {
    const cand = m2[1].trim();
    // 至少要出现两次分隔符，才算真格式串
    if ((cand.match(/----|---|—/g) || []).length >= 2) return cand.slice(0, 80);
  }
  return '';
}

/** 从描述里抽取「售后/质保」关键句（最多 3 条） */
export function extractAfterSale(html) {
  const t = htmlToText(html);
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const hits = lines.filter(
    (l) => /(质保|售后|不退|不换|不保|补卡|退款)/.test(l) && l.length >= 6 && l.length <= 160,
  );
  return [...new Set(hits)].slice(0, 3).join(' / ');
}

/** 一次拉全量商品（接口 pageSize 上限实测可到 500，超过则翻页） */
export async function fetchGoods(token, { pageSize = 500 } = {}) {
  const out = [];
  let current = 1;
  for (;;) {
    const data = await post(
      '/shopApi/Shop/goodsList',
      { token, keywords: '', category_id: 0, goods_type: 'card', current, pageSize },
      { token },
    );
    const list = Array.isArray(data?.list) ? data.list : [];
    out.push(...list);
    const total = Number(data?.total) || out.length;
    if (out.length >= total || list.length === 0) break;
    current += 1;
    if (current > 50) break;
  }

  const seen = new Set();
  return out
    .map((g) => {
      const ext = g.extend || {};
      const hit = classifyProduct({ name: g.name });
      const descHtml = g.description || '';
      const descText = htmlToText(descHtml);
      const conflict = detectConflict(g.name, descText);
      return {
        goodsKey: String(g.goods_key),
        name: String(g.name || '').trim(),
        price: Number(g.price) || 0,
        marketPrice: Number(g.market_price) || 0,
        stock: ext.stock_count == null ? null : Number(ext.stock_count),
        categoryRaw: g.category?.name || '',
        link: g.link || `${BASE}/item/${g.goods_key}`,
        tier: classify({ name: g.name, categoryRaw: g.category?.name || '', price: g.price }),
        productKey: hit ? hit.productKey : null,
        warranty: hit ? hit.warranty : null,
        descHtml,
        descText,
        image: g.image || '',
        delivery: extractDelivery(descHtml),
        afterSale: extractAfterSale(descHtml),
        conflict: conflict ? conflict.reason : null,
      };
    })
    .filter((g) => {
      if (!g.goodsKey || seen.has(g.goodsKey)) return false;
      seen.add(g.goodsKey);
      return true;
    });
}

export async function fetchShop(token) {
  const [info, goods] = await Promise.all([fetchShopInfo(token), fetchGoods(token)]);
  return { info, goods };
}
