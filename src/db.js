import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS shops (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      token         TEXT NOT NULL UNIQUE,
      url           TEXT NOT NULL,
      nickname      TEXT,
      sell_count    INTEGER DEFAULT 0,
      goods_count   INTEGER DEFAULT 0,
      added_at      INTEGER NOT NULL,
      last_fetch_at INTEGER,
      last_status   TEXT,
      last_error    TEXT,
      enabled       INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id       INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      goods_key     TEXT NOT NULL,
      name          TEXT NOT NULL,
      price         REAL NOT NULL,
      market_price  REAL DEFAULT 0,
      stock         INTEGER,
      category_raw  TEXT,
      tier          TEXT NOT NULL,
      product_key   TEXT,
      warranty      TEXT,
      desc_text     TEXT,
      desc_html     TEXT,
      delivery      TEXT,
      after_sale    TEXT,
      conflict      TEXT,
      link          TEXT,
      is_active     INTEGER DEFAULT 1,
      first_seen    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL,
      UNIQUE(shop_id, goods_key)
    );
    CREATE INDEX IF NOT EXISTS idx_products_tier ON products(tier);
    CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id);

    CREATE TABLE IF NOT EXISTS price_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id     INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      goods_key   TEXT NOT NULL,
      price       REAL NOT NULL,
      stock       INTEGER,
      fetched_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_log ON price_log(shop_id, goods_key, fetched_at);
  `);
  migrate(db);
  return db;
}

/** 老库补列，避免升级后启动失败 */
function migrate(d) {
  const cols = d.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  if (!cols.includes('product_key')) d.exec('ALTER TABLE products ADD COLUMN product_key TEXT');
  if (!cols.includes('warranty')) d.exec('ALTER TABLE products ADD COLUMN warranty TEXT');
  if (!cols.includes('desc_text')) d.exec('ALTER TABLE products ADD COLUMN desc_text TEXT');
  if (!cols.includes('desc_html')) d.exec('ALTER TABLE products ADD COLUMN desc_html TEXT');
  if (!cols.includes('delivery')) d.exec('ALTER TABLE products ADD COLUMN delivery TEXT');
  if (!cols.includes('after_sale')) d.exec('ALTER TABLE products ADD COLUMN after_sale TEXT');
  if (!cols.includes('conflict')) d.exec('ALTER TABLE products ADD COLUMN conflict TEXT');
  d.exec('CREATE INDEX IF NOT EXISTS idx_products_product ON products(product_key)');
}

export function getDb() {
  if (!db) throw new Error('database not opened');
  return db;
}

const now = () => Date.now();

export function listShops() {
  return getDb().prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM products p WHERE p.shop_id = s.id AND p.is_active = 1) AS active_products
    FROM shops s ORDER BY s.added_at ASC
  `).all();
}

export function getShopByToken(token) {
  return getDb().prepare('SELECT * FROM shops WHERE token = ?').get(token);
}

export function insertShop({ token, url, nickname, sellCount, goodsCount }) {
  const info = getDb().prepare(`
    INSERT INTO shops (token, url, nickname, sell_count, goods_count, added_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, url, nickname, sellCount || 0, goodsCount || 0, now());
  return Number(info.lastInsertRowid);
}

/** 只更新这轮真拿到了的字段：/info 被限流时 nickname 会是 null，不能把已有店名冲掉 */
export function updateShopMeta(id, { nickname, sellCount, goodsCount }) {
  const sets = [];
  const vals = [];
  if (nickname != null) { sets.push('nickname = ?'); vals.push(nickname); }
  if (sellCount != null) { sets.push('sell_count = ?'); vals.push(sellCount); }
  if (goodsCount != null) { sets.push('goods_count = ?'); vals.push(goodsCount); }
  if (!sets.length) return;
  vals.push(id);
  getDb().prepare(`UPDATE shops SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function setShopStatus(id, status, error = null) {
  getDb().prepare('UPDATE shops SET last_status = ?, last_error = ?, last_fetch_at = ? WHERE id = ?')
    .run(status, error, now(), id);
}

export function deleteShop(id) {
  getDb().prepare('DELETE FROM shops WHERE id = ?').run(id);
}

/** 整店同步：更新已有、插入新、下架消失的 */
export function syncShopGoods(shopId, goods) {
  const d = getDb();
  const ts = now();
  const existing = new Map(
    d.prepare('SELECT goods_key, price, stock FROM products WHERE shop_id = ?').all(shopId)
      .map((r) => [r.goods_key, r]),
  );

  const upsert = d.prepare(`
    INSERT INTO products (shop_id, goods_key, name, price, market_price, stock, category_raw, tier, product_key, warranty, desc_text, desc_html, delivery, after_sale, conflict, link, is_active, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(shop_id, goods_key) DO UPDATE SET
      name = excluded.name,
      price = excluded.price,
      market_price = excluded.market_price,
      stock = excluded.stock,
      category_raw = excluded.category_raw,
      tier = excluded.tier,
      product_key = excluded.product_key,
      warranty = excluded.warranty,
      desc_text = excluded.desc_text,
      desc_html = excluded.desc_html,
      delivery = excluded.delivery,
      after_sale = excluded.after_sale,
      conflict = excluded.conflict,
      link = excluded.link,
      is_active = 1,
      last_seen = excluded.last_seen
  `);
  const logPrice = d.prepare('INSERT INTO price_log (shop_id, goods_key, price, stock, fetched_at) VALUES (?, ?, ?, ?, ?)');
  const deactivate = d.prepare('UPDATE products SET is_active = 0 WHERE shop_id = ? AND goods_key = ?');

  let added = 0;
  let changed = 0;
  const seen = new Set();

  d.exec('BEGIN');
  try {
    for (const g of goods) {
      seen.add(g.goodsKey);
      const prev = existing.get(g.goodsKey);
      upsert.run(shopId, g.goodsKey, g.name, g.price, g.marketPrice, g.stock,
        g.categoryRaw, g.tier || '', g.productKey || null, g.warranty || null,
        g.descText || '', g.descHtml || '', g.delivery || '', g.afterSale || '',
        g.conflict || null, g.link, ts, ts);

      if (!prev) {
        added += 1;
        logPrice.run(shopId, g.goodsKey, g.price, g.stock, ts);
      } else if (prev.price !== g.price || prev.stock !== g.stock) {
        changed += 1;
        logPrice.run(shopId, g.goodsKey, g.price, g.stock, ts);
      }
    }
    for (const key of existing.keys()) {
      if (!seen.has(key)) deactivate.run(shopId, key);
    }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }

  return { total: goods.length, added, changed, removed: [...existing.keys()].filter((k) => !seen.has(k)).length };
}

/** 左侧分类聚合：每个档位的件数、有货件数、最低现货价 */
export function tierSummary({ inStockOnly = false } = {}) {
  const where = inStockOnly ? 'AND p.is_active = 1 AND p.stock > 0' : 'AND p.is_active = 1';
  return getDb().prepare(`
    SELECT p.tier,
           COUNT(*)                                              AS items,
           SUM(CASE WHEN p.stock > 0 THEN 1 ELSE 0 END)          AS in_stock,
           MIN(CASE WHEN p.stock > 0 THEN p.price END)           AS min_price,
           MIN(p.price)                                          AS min_price_any,
           COUNT(DISTINCT p.shop_id)                             AS shops
    FROM products p
    WHERE 1 = 1 ${where}
    GROUP BY p.tier
  `).all();
}

export function productsByTier(tier, { inStockOnly = false, sort = 'price' } = {}) {
  const order = {
    price: 'p.price ASC',
    price_desc: 'p.price DESC',
    stock: 'p.stock DESC, p.price ASC',
    name: 'p.name ASC',
  }[sort] || 'p.price ASC';

  const stockCond = inStockOnly ? 'AND p.stock > 0' : '';
  return getDb().prepare(`
    SELECT p.id, p.goods_key, p.name, p.price, p.market_price, p.stock,
           p.category_raw, p.tier, p.link, p.is_active, p.last_seen,
           s.id AS shop_id, s.token, s.nickname AS shop_name
    FROM products p
    JOIN shops s ON s.id = p.shop_id
    WHERE p.tier = ? AND p.is_active = 1 ${stockCond}
    ORDER BY ${order}
  `).all(tier);
}

export function priceHistory(shopId, goodsKey, limit = 200) {
  const rows = getDb().prepare(`
    SELECT price, stock, fetched_at AS fetchedAt FROM price_log
    WHERE shop_id = ? AND goods_key = ?
    ORDER BY fetched_at ASC LIMIT ?
  `).all(shopId, goodsKey, limit);
  return { points: rows, stats: historyStats(rows) };
}

function historyStats(rows) {
  if (!rows.length) return null;
  const prices = rows.map((r) => r.price);
  const first = prices[0];
  const last = prices[prices.length - 1];
  return {
    current: last,
    first,
    min: Math.min(...prices),
    max: Math.max(...prices),
    change: last - first,
    changePct: first > 0 ? ((last - first) / first) * 100 : 0,
    points: rows.length,
  };
}

/**
 * 某标准商品的最低价格走势。
 *
 * 一次抓取会给该档带来多条 price_log（每家店每件货各一条），
 * 我们关心的是「这一轮抓取里，该档最低有货价是多少」。
 * 因此按抓取轮次（时间桶）聚合，每个桶取最低价。
 */
export function productTrend(productKey, { hours = 168, bucketMinutes = 0 } = {}) {
  const since = Date.now() - hours * 3600_000;
  const rows = getDb().prepare(`
    SELECT l.fetched_at AS t, l.price, l.stock
    FROM price_log l
    JOIN products p ON p.shop_id = l.shop_id AND p.goods_key = l.goods_key
    WHERE p.product_key = ? AND l.fetched_at >= ? AND l.price > 0
    ORDER BY l.fetched_at ASC
  `).all(productKey, since);

  if (!rows.length) return { points: [], stats: null };

  // 时间桶：默认按 10 分钟聚合，避免同一轮抓取的抖动产生多个点
  const bucketMs = (bucketMinutes || 10) * 60_000;
  const buckets = new Map();
  for (const r of rows) {
    const b = Math.floor(r.t / bucketMs) * bucketMs;
    const cur = buckets.get(b);
    // 优先统计有货的最低；一桶内没有有货则退回全部最低
    const usable = r.stock == null || r.stock > 0;
    if (!cur) buckets.set(b, { t: b, price: r.price, hasStock: usable });
    else {
      if (usable && !cur.hasStock) { cur.price = r.price; cur.hasStock = true; }
      else if (usable === cur.hasStock && r.price < cur.price) cur.price = r.price;
    }
  }

  const points = [...buckets.values()]
    .sort((a, b) => a.t - b.t)
    .map((b) => ({ t: b.t, fetchedAt: b.t, price: b.price }));
  return { points, stats: historyStats(points) };
}

/**
 * 标准商品聚合（OpenAI）。
 * 返回每个标准商品的：报价数、有货数、最低价、最低有货价、带质保最低价、涉及店铺数。
 */
export function productSummary() {
  return getDb().prepare(`
    SELECT p.product_key                      AS productKey,
           COUNT(*)                           AS offers,
           MAX(p.last_seen)                   AS lastSeen,
           SUM(CASE WHEN p.stock > 0 THEN 1 ELSE 0 END)  AS inStock,
           COUNT(DISTINCT p.shop_id)          AS shops,
           MIN(p.price)                       AS minPrice,
           MIN(CASE WHEN p.stock > 0 THEN p.price END)   AS minInStock,
           MIN(CASE WHEN p.stock > 0 AND p.warranty = 'subscription'
                    THEN p.price END)         AS minWithWarranty,
           MAX(CASE WHEN p.stock > 0 THEN 1 ELSE 0 END)  AS hasStock
    FROM products p
    WHERE p.is_active = 1 AND p.product_key IS NOT NULL
    GROUP BY p.product_key
  `).all();
}

export function productsByProductKey(productKey, { inStockOnly = false, sort = 'price' } = {}) {
  const order = {
    price: 'p.price ASC',
    price_desc: 'p.price DESC',
    stock: 'p.stock DESC, p.price ASC',
    warranty: `CASE p.warranty WHEN 'subscription' THEN 0 WHEN 'first_login' THEN 1
                 WHEN 'none' THEN 2 ELSE 3 END ASC, p.price ASC`,
    name: 'p.name ASC',
  }[sort] || 'p.price ASC';

  const stockCond = inStockOnly ? 'AND p.stock > 0' : '';
  return getDb().prepare(`
    SELECT p.id, p.goods_key AS goodsKey, p.name, p.price, p.market_price AS marketPrice,
           p.stock, p.warranty, p.category_raw AS categoryRaw, p.product_key AS productKey,
           p.delivery, p.after_sale AS afterSale, p.conflict, p.desc_text AS descText,
           p.link, p.is_active AS isActive, p.last_seen AS lastSeen,
           s.id AS shopId, s.token, s.nickname AS shopName
    FROM products p
    JOIN shops s ON s.id = p.shop_id
    WHERE p.product_key = ? AND p.is_active = 1 ${stockCond}
    ORDER BY ${order}
  `).all(productKey);
}

/**
 * 全局搜索：按商品名模糊匹配，跨分类、跨店铺。
 * 返回命中的报价行 + 每个词的匹配位置，供前端高亮。
 */
export function searchProducts(keyword, { inStockOnly = true, limit = 300 } = {}) {
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  // 转义 LIKE 通配符，避免用户输入的 % _ 影响匹配
  const escaped = kw.replace(/[\\%_]/g, (c) => '\\' + c);
  const stockCond = inStockOnly ? 'AND p.stock > 0' : '';
  return getDb().prepare(`
    SELECT p.id, p.goods_key AS goodsKey, p.name, p.price, p.stock, p.warranty,
           p.product_key AS productKey, p.delivery, p.after_sale AS afterSale, p.conflict,
           p.link, p.is_active AS isActive,
           s.id AS shopId, s.token, s.nickname AS shopName
    FROM products p
    JOIN shops s ON s.id = p.shop_id
    WHERE p.is_active = 1 ${stockCond}
      AND (p.name LIKE ? ESCAPE '\\' OR p.desc_text LIKE ? ESCAPE '\\')
    ORDER BY CASE WHEN p.stock > 0 THEN 0 ELSE 1 END, p.price ASC
    LIMIT ?
  `).all(`%${escaped}%`, `%${escaped}%`, limit);
}

/** 用最新匹配规则重新归类所有已存商品（不重新抓取） */
export function reclassifyAll(classifyFn, conflictFn = null) {
  const d = getDb();
  const rows = d.prepare('SELECT id, name, desc_text FROM products').all();
  const upd = d.prepare('UPDATE products SET product_key = ?, warranty = ?, conflict = ? WHERE id = ?');
  let changed = 0;
  d.exec('BEGIN');
  try {
    for (const r of rows) {
      const hit = classifyFn({ name: r.name });
      let conflict = null;
      if (conflictFn) {
        const c = conflictFn(r.name, r.desc_text || '');
        conflict = c ? c.reason : null;
      }
      upd.run(hit ? hit.productKey : null, hit ? hit.warranty : null, conflict, r.id);
      changed += 1;
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return changed;
}
