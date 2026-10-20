import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'config', 'tiers.json');

let config = load();

function load() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const tiers = new Map();
  for (const t of raw.tiers) tiers.set(t.key, t);

  const rules = raw.rules.map((r) => {
    const rule = { tier: r.tier };
    if (r.re) rule.re = new RegExp(r.re, 'i');
    if (r.hasAny) rule.hasAny = r.hasAny.map((s) => s.toLowerCase());
    if (r.exclude) rule.exclude = r.exclude.map((s) => s.toLowerCase());
    if (r.also) rule.also = r.also.map((s) => s.toLowerCase());
    if (r.categoryIn) rule.categoryIn = new Set(r.categoryIn);
    if (r.accountMarker) rule.accountMarker = true;
    if (r.all) {
      rule.all = r.all.map((c) => ({
        re: c.re ? new RegExp(c.re, 'i') : null,
        hasAny: c.hasAny ? c.hasAny.map((s) => s.toLowerCase()) : null,
        categoryIn: c.categoryIn ? new Set(c.categoryIn) : null,
        accountMarker: !!c.accountMarker,
      }));
    }
    return rule;
  });

  return { tiers, rules, accountMarkers: raw.accountMarkers.map((s) => s.toLowerCase()) };
}

function matchCond(cond, item, nameLower) {
  if (cond.re && !cond.re.test(item.name)) return false;
  if (cond.hasAny && !cond.hasAny.some((s) => nameLower.includes(s))) return false;
  if (cond.categoryIn && !cond.categoryIn.has(item.categoryRaw)) return false;
  if (cond.accountMarker && !config.accountMarkers.some((s) => nameLower.includes(s))) return false;
  return true;
}

function matchRule(rule, item, nameLower) {
  if (rule.re && !rule.re.test(item.name)) return false;
  if (rule.hasAny && !rule.hasAny.some((s) => nameLower.includes(s))) return false;
  if (rule.exclude && rule.exclude.some((s) => nameLower.includes(s))) return false;
  if (rule.categoryIn && !rule.categoryIn.has(item.categoryRaw)) return false;
  if (rule.accountMarker && !config.accountMarkers.some((s) => nameLower.includes(s))) return false;
  if (rule.also && !rule.also.some((s) => nameLower.includes(s))) return false;
  if (rule.all && !rule.all.every((c) => matchCond(c, item, nameLower))) return false;
  return true;
}

/** 按 rules 顺序匹配，第一条命中即返回档位 key */
export function classify(item) {
  const nameLower = (item.name || '').toLowerCase();
  for (const rule of config.rules) {
    if (matchRule(rule, item, nameLower)) return rule.tier;
  }
  return 'misc';
}

export function explain(item) {
  const nameLower = (item.name || '').toLowerCase();
  for (let i = 0; i < config.rules.length; i++) {
    if (matchRule(config.rules[i], item, nameLower)) {
      return { tier: config.rules[i].tier, ruleIndex: i };
    }
  }
  return { tier: 'misc', ruleIndex: -1 };
}

export function tierMeta(key) {
  return config.tiers.get(key) || { key: 'misc', name: '其他', order: 999, hot: false };
}

export function allTiers() {
  return [...config.tiers.values()].sort((a, b) => a.order - b.order);
}

export function reload() {
  config = load();
}
