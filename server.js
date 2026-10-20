import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, listShops, insertShop, getShopByToken, deleteShop,
  tierSummary, productsByTier, priceHistory, productSummary, productsByProductKey,
  searchProducts, reclassifyAll, getDb, productTrend } from './src/db.js';
import { allTiers, tierMeta } from './src/classify.js';
import { allProducts, allGroups, getProduct, WARRANTY_LABEL, classifyProduct, detectConflict, platformMeta } from './src/products.js';
import { parseToken, fetchShopInfo, FetchError } from './src/fetcher.js';
import { clusterProducts } from './src/cluster.js';
import { Scheduler } from './src/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const DB_FILE = process.env.DB_FILE || join(__dirname, 'data', 'cardweb.db');
const PORT = Number(process.env.PORT) || 8052;
const HOST = process.env.HOST || '0.0.0.0';

openDb(DB_FILE);

const scheduler = new Scheduler({ intervalMinutes: Number(process.env.POLL_MINUTES) || 0 });

// ---------- SSE ----------
const sseClients = new Set();
scheduler.onEvent((evt) => {
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of sseClients) {
    try { res.write(line); } catch { sseClients.delete(res); }
  }
});

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    const buf = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch {
    // 前端是单页，未知路径回退到 index.html
    if (existsSync(join(PUBLIC_DIR, 'index.html'))) {
      const buf = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': buf.length });
      return res.end(buf);
    }
    res.writeHead(404); res.end('not found');
  }
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const q = url.searchParams;
  const method = req.method;

  if (pathname === '/api/health') return json(res, 200, { ok: true, time: Date.now() });

  // ---- shops ----
  if (pathname === '/api/shops' && method === 'GET') {
    return json(res, 200, { shops: listShops(), scheduler: scheduler.status() });
  }

  if (pathname === '/api/shops' && method === 'POST') {
    try {
      const body = await readBody(req);
      const token = parseToken(body.url);
      if (getShopByToken(token)) {
        return json(res, 409, { error: '该店铺已存在' });
      }
      const info = await fetchShopInfo(token);
      const id = insertShop({
        token, url: info.url, nickname: info.nickname,
        sellCount: info.sellCount, goodsCount: info.goodsCount,
      });
      const shop = listShops().find((s) => s.id === id);
      return json(res, 201, { shop });
    } catch (err) {
      const code = err instanceof FetchError ? 400 : 500;
      return json(res, code, { error: err.message });
    }
  }

  const shopMatch = pathname.match(/^\/api\/shops\/(\d+)$/);
  if (shopMatch && method === 'DELETE') {
    deleteShop(Number(shopMatch[1]));
    return json(res, 200, { ok: true });
  }

  const shopFetchMatch = pathname.match(/^\/api\/shops\/(\d+)\/fetch$/);
  if (shopFetchMatch && method === 'POST') {
    const shop = listShops().find((s) => s.id === Number(shopFetchMatch[1]));
    if (!shop) return json(res, 404, { error: '店铺不存在' });
    scheduler.triggerAll('manual');
    return json(res, 202, { ok: true, mode: 'full-round', scheduler: scheduler.status() });
  }

  if (pathname === '/api/fetch-all' && method === 'POST') {
    scheduler.triggerAll('manual');
    return json(res, 202, { ok: true, scheduler: scheduler.status() });
  }

  if (pathname === '/api/detect-conflicts' && method === 'POST') {
    const n = reclassifyAll(classifyProduct, detectConflict);
    return json(res, 200, { ok: true, scanned: n });
  }

  if (pathname === '/api/reclassify' && method === 'POST') {
    const n = reclassifyAll(classifyProduct);
    return json(res, 200, { ok: true, updated: n });
  }

  if (pathname === '/api/status' && method === 'GET') {
    return json(res, 200, { scheduler: scheduler.status() });
  }

  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'hello', ...scheduler.status() })}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* noop */ } }, 20000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  // ---- 单品详情（含完整描述） ----
  const detailMatch = pathname.match(/^\/api\/product\/(\d+)$/);
  if (detailMatch && method === 'GET') {
    const row = getDb().prepare(`
      SELECT p.*, s.nickname AS shopName, s.token
      FROM products p JOIN shops s ON s.id = p.shop_id
      WHERE p.id = ?
    `).get(Number(detailMatch[1]));
    if (!row) return json(res, 404, { error: '商品不存在' });
    return json(res, 200, { product: row });
  }

  // ---- 全局搜索 ----
  if (pathname === '/api/search' && method === 'GET') {
    const kw = (q.get('q') || '').trim();
    if (!kw) return json(res, 200, { keyword: '', total: 0, offers: [] });
    const offers = searchProducts(kw, {
      inStockOnly: q.get('in_stock') === '1',
      limit: Math.min(Number(q.get('limit')) || 300, 1000),
    });
    // 附带命中项所属的标准商品名，便于前端按商品聚合展示
    const meta = allProducts();
    const nameByKey = new Map(meta.map((p) => [p.key, p.name]));
    const enriched = offers.map((o) => ({
      ...o,
      productName: nameByKey.get(o.productKey) || '未归类',
    }));
    return json(res, 200, { keyword: kw, total: enriched.length, offers: enriched });
  }

  // ---- 标准商品（OpenAI） ----
  if (pathname === '/api/products' && method === 'GET') {
    const summary = new Map(productSummary().map((r) => [r.productKey, r]));
    const groups = allGroups();
    const products = allProducts()
      .filter((p) => !p.hidden)
      .map((p) => {
        const s = summary.get(p.key);
        return {
          key: p.key,
          group: p.group,
          order: p.order,
          name: p.name,
          spec: p.spec,
          note: p.note || '',
          offers: s?.offers || 0,
          inStock: s?.inStock || 0,
          shops: s?.shops || 0,
          minPrice: s?.minWithWarranty ?? null,
          minInStock: s?.minInStock ?? null,
          minPriceAny: s?.minPrice ?? null,
          band: p.band || null,
        };
      })
      .filter((p) => p.offers > 0);
    return json(res, 200, { platform: platformMeta(), groups, products });
  }

  const prodDetail = pathname.match(/^\/api\/products\/([a-z0-9-]+)\/offers$/);
  if (prodDetail && method === 'GET') {
    const key = prodDetail[1];
    const meta = getProduct(key);
    if (!meta) return json(res, 404, { error: '未知商品' });
    const rows = productsByProductKey(key, {
      inStockOnly: q.get('in_stock') === '1',
      sort: q.get('sort') || 'price',
    });
    const band = meta.band || null;
    const flagged = rows.map((o) => {
      let suspect = null;
      if (band) {
        if (o.price < band.min) suspect = 'below';
        else if (o.price > band.max) suspect = 'above';
      }
      return { ...o, suspect, band };
    });
    return json(res, 200, {
      product: {
        key: meta.key, name: meta.name, spec: meta.spec, note: meta.note || '',
        group: meta.group, band,
      },
      warrantyLabels: WARRANTY_LABEL,
      offers: flagged,
    });
  }

  // ---- tiers / products ----
  if (pathname === '/api/tiers' && method === 'GET') {
    const inStockOnly = q.get('in_stock') === '1';
    const summary = new Map(tierSummary({ inStockOnly }).map((r) => [r.tier, r]));
    const tiers = allTiers()
      .map((t) => {
        const s = summary.get(t.key);
        return {
          key: t.key,
          name: t.name,
          order: t.order,
          hot: !!t.hot,
          items: s?.items || 0,
          inStock: s?.in_stock || 0,
          minPrice: s?.min_price ?? null,
          minPriceAny: s?.min_price_any ?? null,
          shops: s?.shops || 0,
        };
      })
      .filter((t) => t.items > 0)
      .sort((a, b) => {
        if (a.minPrice == null && b.minPrice == null) return b.inStock - a.inStock;
        if (a.minPrice == null) return 1;
        if (b.minPrice == null) return -1;
        return a.minPrice - b.minPrice;
      });
    return json(res, 200, { tiers });
  }

  const tierProducts = pathname.match(/^\/api\/tiers\/([a-z0-9_]+)\/products$/);
  if (tierProducts && method === 'GET') {
    const tier = tierProducts[1];
    const rows = productsByTier(tier, {
      inStockOnly: q.get('in_stock') === '1',
      sort: q.get('sort') || 'price',
    });
    return json(res, 200, { tier: tierMeta(tier), products: rows });
  }

  const historyMatch = pathname.match(/^\/api\/history\/(\d+)\/([\w-]+)$/);
  if (historyMatch && method === 'GET') {
    return json(res, 200, priceHistory(Number(historyMatch[1]), historyMatch[2]));
  }

  // ---- 同款聚类 ----
  const clusterMatch = pathname.match(/^\/api\/products\/([a-z0-9-]+)\/clusters$/);
  if (clusterMatch && method === 'GET') {
    const key = clusterMatch[1];
    const meta = getProduct(key);
    if (!meta) return json(res, 404, { error: '未知商品' });
    const rows = productsByProductKey(key, {
      inStockOnly: q.get('in_stock') === '1',
      sort: 'price',
    });
    const clusters = clusterProducts(rows.map((o) => ({ ...o, productKey: key })));
    return json(res, 200, {
      product: { key: meta.key, name: meta.name, spec: meta.spec },
      total: rows.length,
      clusters,
    });
  }

  const trendMatch = pathname.match(/^\/api\/products\/([a-z0-9-]+)\/trend$/);
  if (trendMatch && method === 'GET') {
    const hours = Math.min(Number(q.get('hours')) || 48, 24 * 30);
    return json(res, 200, productTrend(trendMatch[1], { hours }));
  }

  return json(res, 404, { error: 'not found' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`cardweb listening on http://${HOST}:${PORT}`);
  console.log(`db: ${DB_FILE}`);
  if (scheduler.intervalMinutes > 0) {
    scheduler.startPolling();
    console.log(`polling every ${scheduler.intervalMinutes} min`);
  } else {
    console.log('polling disabled (POLL_MINUTES=0), 手动触发全量抓取');
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    scheduler.stopPolling();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
