import { fetchShop } from './fetcher.js';
import { syncShopGoods, setShopStatus, updateShopMeta, listShops } from './db.js';

/**
 * 串行抓取调度器。
 *
 * 设计要点（按使用者要求）：
 * - 任何时刻只有一个抓取任务在跑，绝不并发打目标站
 * - 店铺之间不插入人工等待，抓完一家立刻抓下一家
 * - 新增店铺只抓该店；「全量抓取」抓所有店铺，两者共用串行队列
 * - 定时轮询默认只跑一轮，用 intervalMinutes 控制（0 表示不自动跑）
 */
export class Scheduler {
  constructor({ intervalMinutes = 0, autoStart = false } = {}) {
    this.intervalMinutes = intervalMinutes;
    this.timer = null;
    this.running = false;
    this.current = null;      // { shopId, token, nickname }
    this.pending = null;      // 排队中的 promise
    this.jobs = new Map();    // 同一店铺或全量任务不重复排队
    this.round = null;        // { startedAt, total, done, failed }
    this.listeners = new Set();
    this.abort = false;
    if (autoStart && intervalMinutes > 0) this.startPolling();
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, payload = {}) {
    const evt = { type, at: Date.now(), ...payload };
    for (const fn of this.listeners) {
      try { fn(evt); } catch { /* 单个监听器异常不影响调度 */ }
    }
  }

  status() {
    return {
      running: this.running,
      queued: !!this.pending,
      current: this.current,
      round: this.round,
      intervalMinutes: this.intervalMinutes,
      nextRunAt: this.nextRunAt || null,
    };
  }

  /** 单店和全量任务共用队列，避免新增店铺时并发抓取或漏掉任务。 */
  enqueue(key, run) {
    if (this.jobs.has(key)) return this.jobs.get(key);
    const task = (this.pending || Promise.resolve()).then(run, run).finally(() => {
      this.jobs.delete(key);
      if (this.pending === task) this.pending = null;
    });
    this.jobs.set(key, task);
    this.pending = task;
    return task;
  }

  triggerAll(reason = 'manual') {
    return this.enqueue('all', () => this.runRound(reason));
  }

  triggerShop(shopId) {
    return this.enqueue(shopId, () => this.runRound('single-shop',
      listShops().filter((s) => s.id === shopId)));
  }

  async runRound(reason, shops = listShops().filter((s) => s.enabled)) {
    this.round = { startedAt: Date.now(), total: shops.length, done: 0, failed: 0, reason };
    this.emit('round:start', { total: shops.length, reason });

    for (const shop of shops) {
      if (this.abort) break;
      await this.fetchOne(shop);
      this.round.done += 1;
    }

    this.round.finishedAt = Date.now();
    this.emit('round:end', { ...this.round });
    this.current = null;
    return { ...this.round };
  }

  async fetchOne(shop) {
    this.running = true;
    this.current = { shopId: shop.id, token: shop.token, nickname: shop.nickname };
    this.emit('shop:start', { ...this.current });

    const t0 = Date.now();
    try {
      const { info, goods } = await fetchShop(shop.token);
      const stats = syncShopGoods(shop.id, goods);
      updateShopMeta(shop.id, {
        nickname: info.nickname,
        sellCount: info.sellCount,
        goodsCount: info.goodsCount,
      });
      setShopStatus(shop.id, 'ok', null);
      this.current = null;
      this.emit('shop:ok', {
        shopId: shop.id, token: shop.token, nickname: info.nickname,
        ...stats, elapsedMs: Date.now() - t0,
      });
      return stats;
    } catch (err) {
      setShopStatus(shop.id, 'error', err.message);
      this.round.failed += 1;
      this.emit('shop:error', {
        shopId: shop.id, token: shop.token, nickname: shop.nickname,
        error: err.message, elapsedMs: Date.now() - t0,
      });
      return null;
    } finally {
      this.running = false;
    }
  }

  startPolling() {
    if (this.timer) return;
    const ms = this.intervalMinutes * 60_000;
    if (!ms) return;
    const tick = () => {
      this.nextRunAt = Date.now() + ms;
      this.triggerAll('poll');
    };
    this.nextRunAt = Date.now() + ms;
    this.timer = setInterval(tick, ms);
    if (this.timer.unref) this.timer.unref();
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  setInterval(minutes) {
    this.intervalMinutes = Number(minutes) || 0;
    this.stopPolling();
    if (this.intervalMinutes > 0) this.startPolling();
  }
}
