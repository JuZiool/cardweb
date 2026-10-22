import vm from 'node:vm';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classify } from './classify.js';
import { classifyProduct, detectConflict } from './products.js';

const BASE = 'https://wzyp.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 请求间隔与重试。
 *
 * 2026-10-21 实测：链动小铺前面是阿里云 ESA，同一 IP 同一时刻，
 * 浏览器 / curl(Schannel) 返回 200，而 Node 的 OpenSSL 连接一律 403
 * （X-Tengine-Error: denied by http_ratelimit / http_custom），
 * 即使请求头逐字节相同也一样 —— 说明拦截点在看 TLS 指纹而非 IP。
 * 所以这里保留 curl 作为备用传输层，被拦时自动切换。
 */
const MIN_GAP_MS = Number(process.env.FETCH_MIN_GAP_MS) || 1500;
const JITTER_MS = Number(process.env.FETCH_JITTER_MS) || 500;
const MAX_ATTEMPTS = 4;
const RATE_LIMIT_BACKOFF_MS = [30_000, 60_000, 120_000];
const execFileAsync = promisify(execFile);

let lastRequestAt = 0;
/** 会话 cookie（acw_tc / cdn_sec_tc / PHPSESSID / acw_sc__v2），两种传输层共用 */
const jar = new Map();
/** 'fetch' = Node 原生；'curl' = 子进程。一旦原生被拦就粘住 curl */
let preferredTransport = 'fetch';
let curlMissing = false;

export class FetchError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'FetchError';
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 全局节流：所有请求共用一个最小间隔，避免一轮全量抓取把 WAF 打起来 */
async function throttle() {
  const jitter = JITTER_MS > 0 ? Math.floor(Math.random() * (JITTER_MS + 1)) : 0;
  const wait = lastRequestAt + MIN_GAP_MS + jitter - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorbSetCookie(values) {
  for (const raw of values || []) {
    const first = String(raw).split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

function requestHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Origin: BASE,
    Referer: token ? `${BASE}/shop/${token}` : BASE,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/** 原生 fetch 传输 */
async function viaFetch(url, payload, headers, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: payload, signal: ctrl.signal });
    absorbSetCookie(res.headers.getSetCookie?.());
    return { status: res.status, text: await res.text() };
  } catch (err) {
    if (err.name === 'AbortError') throw new FetchError('请求超时');
    throw new FetchError(`网络错误：${err.message}`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/** curl 传输：Head/body 走临时文件，避免和 -w 混在一起 */
async function viaCurl(url, payload, headers, timeout) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cardweb-'));
  const headFile = path.join(tmp, 'h');
  const bodyFile = path.join(tmp, 'b');
  try {
    const args = [
      '-sS', '--compressed', '--max-time', String(Math.ceil(timeout / 1000)),
      '-D', headFile, '-o', bodyFile,
      '-X', 'POST', '-w', '%{http_code}', url,
    ];
    for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
    args.push('--data-binary', payload);

    let status;
    try {
      const { stdout } = await execFileAsync('curl', args, {
        timeout: timeout + 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      status = Number(stdout.trim()) || 0;
    } catch (err) {
      if (err.code === 'ENOENT') {
        curlMissing = true;
        throw err;
      }
      throw new FetchError(`curl 请求失败：${err.message}`, { cause: err });
    }

    const rawHead = await fs.readFile(headFile, 'utf8').catch(() => '');
    absorbSetCookie(rawHead.split(/\r?\n/).filter((l) => /^set-cookie:/i.test(l)).map((l) => l.slice(l.indexOf(':') + 1)));
    const text = await fs.readFile(bodyFile, 'utf8').catch(() => '');
    return { status, text };
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function transport(path, body, opts) {
  const url = BASE + path;
  const payload = JSON.stringify(body);
  const headers = requestHeaders(opts.token);
  if (preferredTransport === 'curl' && !curlMissing) {
    try {
      return await viaCurl(url, payload, headers, opts.timeout);
    } catch (err) {
      if (err.code === 'ENOENT') {
        preferredTransport = 'fetch';
      } else {
        throw err;
      }
    }
  }
  return viaFetch(url, payload, headers, opts.timeout);
}

/**
 * 求解阿里云 ESA 下发的 acw_sc__v2 挑战。
 * 挑战脚本是一段自解密的混淆 JS，标准做法是在沙箱里直接跑一遍，
 * 它会把 document.cookie 设成 acw_sc__v2=...，再拿这个 cookie 重放请求。
 */
function solveChallenge(html) {
  const m = String(html).match(/<script>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let cookie = '';
  const ctx = {
    document: {
      get cookie() { return cookie; },
      set cookie(v) { cookie = String(v); },
      location: { reload() {} },
      createElement() { return { style: {}, setAttribute() {}, getElementsByTagName() { return []; } }; },
    },
    location: { reload() {} },
    window: {},
    navigator: { userAgent: UA },
    setTimeout, clearTimeout, console,
    Date, Math, parseInt, parseFloat, RegExp, String, Array, Object, JSON, Error, isNaN,
    encodeURIComponent, decodeURIComponent, escape, unescape,
  };
  ctx.self = ctx;
  ctx.top = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  try {
    vm.runInContext(m[1], ctx, { timeout: 10_000 });
  } catch {
    return null;
  }
  const hit = cookie.match(/acw_sc__v2=([^;]+)/);
  return hit ? hit[1] : null;
}

/** 判断响应是不是被 WAF 挡了：JS 挑战页 or 403 拦截页 */
function blockedKind(text) {
  if (String(text).includes('acw_sc__v2')) return 'challenge';
  if (String(text).trimStart().startsWith('<!DOCTYPE html>') || String(text).includes('403 禁止访问')) {
    return 'denied';
  }
  return null;
}

async function post(path, body, { timeout = 20000, token, attempts = MAX_ATTEMPTS } = {}) {
  let lastErr;
  let rateLimitRetries = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await throttle();
    try {
      const res = await transport(path, body, { timeout, token });
      const blocked = blockedKind(res.text);

      if (blocked === 'challenge') {
        const solved = solveChallenge(res.text);
        if (solved) {
          jar.set('acw_sc__v2', solved);
          lastErr = new FetchError('触发了人机校验，已自动通过，正在重试');
          continue;
        }
        throw new FetchError('被目标站人机校验拦截，且自动通过失败');
      }

      const rateLimited = blocked === 'denied' || res.status === 403 || res.status === 429;
      if (rateLimited) {
        // 先排除 TLS 指纹拦截；切换传输层不占用限流重试次数。
        if (preferredTransport === 'fetch' && !curlMissing) {
          preferredTransport = 'curl';
          lastErr = new FetchError('请求被目标站拦截，已切换到备用通道重试');
          attempt -= 1;
          continue;
        }
        lastErr = new FetchError(`接口返回 HTTP ${res.status || 403}，触发目标站限流`);
        if (attempt < attempts) {
          const delay = RATE_LIMIT_BACKOFF_MS[Math.min(rateLimitRetries, RATE_LIMIT_BACKOFF_MS.length - 1)];
          rateLimitRetries += 1;
          await sleep(delay);
        }
        continue;
      }

      if (!res.status || res.status >= 400) {
        lastErr = new FetchError(res.status ? `接口返回 HTTP ${res.status}` : '请求未拿到响应');
        if (attempt < attempts) await sleep(1000 * attempt);
        continue;
      }

      const json = JSON.parse(res.text);
      if (json.code !== 1) throw new FetchError(json.msg || '接口返回异常');
      return json.data;
    } catch (err) {
      if (err instanceof FetchError) lastErr = err;
      else lastErr = new FetchError(`网络错误：${err.message}`, { cause: err });
      if (attempt >= attempts) break;
      await sleep(800 * attempt);
    }
  }
  throw lastErr || new FetchError('请求失败');
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


export async function fetchShopInfo(token) {
  // /info 在平台上是最容易被单独限流的接口，且只是锦上添花（店名/销量），
  // 所以只试一次、不拖时间 —— 失败由 fetchShop 兜底成 infoError。
  const data = await post('/shopApi/Shop/info', { token, category_key: null }, { token, attempts: 1 });
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
  // /info 仅在新增店铺时请求；全量刷新只抓价格所需的商品列表。
  const goods = await fetchGoods(token);
  const info = {
    token,
    nickname: null,
    url: `${BASE}/shop/${token}`,
    sellCount: null,
    description: '',
    goodsCount: null,
    cardCount: null,
    equityCount: null,
  };
  return { info, goods };
}
