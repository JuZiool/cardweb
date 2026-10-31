import { matchValue, durationOf, groupAutoProducts } from './auto-groups.js';

const KINDS = {
  account: ['成品账号', 1], charge: ['代充订阅', 2], shared: ['共享账号', 3],
  seat: ['团队席位', 4], workspace: ['团队管理', 5], sms: ['接码验证', 6],
  student: ['学生认证', 7], eligibility: ['优惠资格号', 8], kyc: ['身份认证', 9], reset: ['额度重置', 10],
  points: ['点数充值', 11], api: ['API 额度', 12], mirror: ['镜像站', 13],
  invite: ['邀请额度', 14], pool: ['号池充值', 15], peripheral: ['周边与自助服务', 16], pending: ['待确认', 99],
};
const LABELS = {
  plan: '套餐', multiplier: '倍数', amount: '套餐面额', delivery: '交付', duration: '期限',
  usage: '使用方式', sms: '接码状态', region: '地区', email: '邮箱', channel: '渠道',
  auth: '认证', format: '交付格式', access: '使用范围', role: '角色', rotation: '轮换', round: '轮次',
  expires: '截止时间', quota: '额度', models: '模型', cycle: '额度周期', count: '接码次数', repeat: '重复接码',
  phoneCapacity: '号码容量', users: '共享人数', benefit: '优惠资格', reset: '重置', warranty: '质保', balance: '充值金额',
};
const OTHER = /claude|anthropic|克劳|gemini|g\s*r\s*o\s*k|gro[k .]|gork|muse|cursor|kiro|perplexity|capcut|adobe|firefly/i;
const SUBJECT = /open\s*ai|codex|chat[\s.\-]*gpt|gpt|oai|(?:^|[^a-z])g\s*(?:plus|pro|free)|gfree|^g(?:[\s+\-]|$)|bug\s*team|team\s*\d|\d\s*x\s*team/i;
const PLAN = /(?:^|[^a-z])(pro\s*(?:max|more)|pro(?=[\d\W]|$)|plus|free|go|team|business|enterprise)(?=[\d\W]|$)/ig;
const FINISHED = /成品|独享|半成品|账密|帐密|张密|账号密码|账号\s*[+＋]|账号[、,，]密码|子(?:账号|号)|首登|已接[马码🐎]|未接[马码🐎]|日抛|速刷|临期号|(?:发|给|提供|下载)\s*json|仅反代|\d+\s*天号/i;
const CHARGE = /代充|充值|直充|直冲|卡充|卡冲|卡付|自助开通|充到/i;
const REDEEM = /卡密|\bcdk\b/i;
const SMS = /接[马码🐎]|接ma|收码|取码|验证码|手机号验证|手机接马/i;

function canonicalPlan(raw) {
  const key = raw.toLowerCase().replace(/\s+/g, '');
  return { plus: 'Plus', pro: 'Pro', promax: 'Pro Max', promore: 'Pro More', free: 'Free',
    go: 'Go', team: 'Team', business: 'Business', enterprise: 'Enterprise' }[key] || raw;
}

function plansIn(text) {
  const normalized = text.replace(/(?:gpt|gbt|cpt|ctp|oai|g)[-_ ]*(plus|pro|free)(?=[\d\W]|$)/ig, ' $1');
  const plans = [...new Set([...normalized.matchAll(PLAN)].map((m) => canonicalPlan(m[1])))];
  if (/gfree|免费(?:账[号户]|号)|普通(?:账[号户]|号)|普号|无订阅/i.test(text) && !plans.includes('Free')) plans.push('Free');
  if (plans.includes('Team') && plans.includes('Business') && /team\s*[/／]\s*business/i.test(text)) {
    return plans.filter((p) => p !== 'Team' && p !== 'Business').concat('Team / Business');
  }
  return plans;
}

function durationText(title) {
  // 日历日期和账号年龄不表示有效时长；保留原字样作为截止属性。
  const digits = { 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };
  return title.replace(/\d{4}年\d{1,2}月\d{1,2}[日号]?|\d{1,2}月\d{1,2}[日号]?/g, '')
    .replace(/([一二两三四五六七八九十])(?:天|日)/g, (_, n) => `${digits[n]}天`)
    .replace(/天卡/g, '1天').replace(/周卡/g, '7天');
}

function subscriptionText(title) {
  return title.replace(/[（(](?:原(?:来叫做|名)?|曾叫)[^）)]*[）)]/ig, '')
    .replace(/(?:平替|相当于|对标|额度比|比)\s*(?:plus|pro)(?=[\d\W]|$)/ig, '')
    .replace(/(?:不支持|不能|无法|不可|支持|可以|可)(?:直接)?(?:升级|开通|开|升至)[^，,。；;|｜】）)]*/ig, '');
}

function classificationText(text) {
  // 网站地址、兑换凭证和被否定的交付方式都不能证明售卖的是充值服务。
  return text.replace(/https?:\/\/[^\s<>【】（）()，,。；;|｜]+|(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>【】（）()，,。；;|｜]*)?/ig, ' ')
    .replace(/(?:不是|并非|不属于|不提供|不支持|不能|无法|不可(?:以)?|不含|没有|无需|不走|不用|禁止|无|非)\s*(?:用于|用来|使用)?\s*(?:(?:半成品|成品)\s*(?:plus|pro|free)?|(?:代充|充值|续订|续费|直充|直冲|卡充|卡冲|卡付|卡密|cdk|账号|共享|合租|拼车|号池|中转|api|反代)(?:服务|额度|余额|充值)?)/ig, ' ');
}

function catalogOf(kind, attrs, title, reasons) {
  const entry = (id, name, spec, order) => ({ id, name, spec, order });
  const plan = attrs.plan;
  if (['student', 'eligibility', 'kyc', 'reset', 'invite', 'peripheral'].includes(kind)) {
    return entry('services', 'Codex / ChatGPT 周边与自助服务', '提链 · 扫码 · 邀请 · 优惠资格 · 认证 · 重置', 2);
  }
  if (kind === 'points') return entry('credits', 'Codex 额度充值', 'Codex 点数 / Credits', 3);
  if (kind === 'pool') return entry('pool', 'Codex / ChatGPT 号池充值', '第三方号池余额 · 按充值金额筛选', 21);
  if (kind === 'api') return entry('api', 'OpenAI API / 中转额度', 'API 额度 · 中转余额', 22);
  if (kind === 'mirror') return entry('mirror', 'ChatGPT 镜像站', '第三方镜像服务', 23);
  if (kind === 'sms') return entry('sms', 'OpenAI / ChatGPT 接码', '短信验证 · 按次数、期限、地区筛选', 20);
  if (/^(?:Team|Business|Team \/ Business)$/.test(plan)) {
    return entry('team', 'ChatGPT Team / Business', 'K12 · 1x/5x Team · 席位 · 母号/子号 · 轮转车', 7);
  }
  if (plan === 'Free' && kind === 'account') return entry('free', 'ChatGPT 普号', '普通账号 · 已/未接码', 1);
  if (plan === 'Go') return entry('go', 'ChatGPT Go', 'Go · 按交付方式、期限筛选', 4);
  if (plan === 'Plus') {
    if (kind === 'account') return entry('plus-account', 'ChatGPT Plus 试用订阅', '日抛 · 成品号 · 网页号 · 已/未接码', 5);
    if (kind === 'charge') {
      const clean = classificationText(title).replace(/(?:非|不是|并非|不保证)\s*(?:官方|正价|正规|实充|真实付费)/g, '');
      const regular = /正价|正规|官方|实充|真实付费|带(?:官方)?账单/.test(clean)
        && !/半价|5折|试用|0元|资格(?:号|专用)/.test(clean);
      return regular
        ? entry('plus-recharge', 'ChatGPT Plus 正价代充', '标题注明官方充值 · 正价/正规 · 真实付费', 6)
        : entry('plus-other-charge', 'ChatGPT Plus 其他代充', '自助开通 · 优惠充值 · 正价渠道未注明', 16);
    }
  }
  if (/^Pro(?: Max| More)?$/.test(plan) && ['charge', 'account'].includes(kind)) {
    // ponytail: 倍数与面额只按参考目录映射；新档位保留原规格，不按售价猜测。
    const byMultiplier = { '5x': 100, '20x': 200, '25x': 500, '50x': 500 }[attrs.multiplier];
    const byAmount = { '100 USD': 100, '200 USD': 200, '500 USD': 500 }[attrs.amount];
    const tiers = [...new Set([byMultiplier, byAmount, plan === 'Pro Max' ? 500 : null].filter(Boolean))];
    if (tiers.length > 1 || (tiers.length === 1 && attrs.amount && attrs.amount !== `${tiers[0]} USD`)) {
      reasons.push('Pro 倍数、面额或套餐名称对应的档位冲突');
      return null;
    }
    const tier = tiers[0];
    const delivery = kind === 'charge' ? '代充' : '成品号';
    if (!tier) return entry(`pro-other-${kind}`, `ChatGPT Pro 其他档位 ${delivery}`, '保留原始倍数和面额 · 按规格筛选', kind === 'charge' ? 17 : 18);
    const multiplier = { 100: '5x', 200: '20x', 500: '25x / 50x' }[tier];
    return entry(`pro-${tier}-${kind}`, `ChatGPT Pro ${tier}刀档 ${delivery}`,
      `Pro / ${tier} 刀 · ${multiplier} · ${delivery}`, (kind === 'charge' ? 8 : 11) + [100, 200, 500].indexOf(tier));
  }
  return entry(`${kind}-${plan}`, `ChatGPT ${plan === 'Free' ? '普号' : plan} ${KINDS[kind][0]}`.replace(/\s+/g, ' ').trim(),
    '按交付方式、倍数、期限等筛选', 24);
}

function extract(item) {
  const title = String(item.name || '').normalize('NFKC');
  const category = String(item.categoryRaw || '').normalize('NFKC');
  const evidence = [];
  const reasons = [];
  const clean = classificationText(title);
  const cleanCategory = classificationText(category);
  const categoryHint = (SUBJECT.test(cleanCategory) || /^(?:g|plus|pro|free|go|team|business)(?=[\d\W]|$)/i.test(cleanCategory))
    && !OTHER.test(cleanCategory) ? cleanCategory : '';
  const main = subscriptionText(clean);
  const finished = FINISHED.test(clean) || (!CHARGE.test(clean) && (/账[号户]|帐[号户]|提供账密|发\s*json|已注册\s*g\s*free|可(?:登)?网页|带\s*(?:at|rt)\b/i.test(clean)
    || /成品|账号|普号|日抛/.test(categoryHint)));
  const explicitAccount = /成品|半成品|提供账密|发(?:账|帐|张)密|账号密码|子(?:账号|号)|(?:发|给|提供|下载)\s*json|独享.{0,8}账号|账号.{0,8}独享/i.test(clean);
  const ownAccount = /自备(?:账号|账密)|自带账号|自己的账号|(?:需(?:要)?|请|买家|客户|用户)(?:自行)?提供(?:账号|账密|帐密)|(?:充到|充值到)(?:你|您|个人|自己)/.test(clean);
  const smsService = SMS.test(clean) && (!finished || /接马服务|接码服务|接马授权|自助接马|次兑换|取码服务/i.test(clean));
  const team = /team|business/i.test(main) || /team|business/i.test(categoryHint);
  const student = /学生|sheer\s*id/i.test(clean);
  const eligibility = /资格(?:账号|号)|(?:试用|半价|优惠)资格/.test(clean) && !CHARGE.test(clean);
  const deliveryChoice = clean.match(/成品\s*(?:或|\/|和)\s*代充|(?:成品|代充)[^，。;；]{0,12}(?:二选一|可选)/)
    || (explicitAccount && clean.match(/可(?:以)?代充|可(?:以)?发\s*cdk[^，。;；]{0,8}(?:冲|充)(?:自己|自备|你|您)[^，。;；]{0,4}号/i));
  // 兼容能力和教程属于使用说明，不能作为号池或 API 额度的售卖证据。
  const serviceText = clean.replace(/[^，,。；;|｜【】（）()]*(?:教程|教学|使用说明|操作说明)[^，,。；;|｜【】（）()]*/ig, ' ')
    .replace(/(?:可(?:以)?(?:用于|用来)|用于|用来|适用于|支持)\s*(?:自建)?(?:号池|中转|api|tokens?|反代)[^，,。；;|｜【】（）()]*/ig, ' ');
  const poolService = /号池[^，,。；;|｜]{0,24}(?:充值|余额|额度)|(?:充值|充到|充入)[^，,。；;|｜]{0,12}号池/.test(serviceText);
  const apiService = /(?:中转|\bapi\b)[^，,。；;|｜【】（）()]{0,18}(?:额度|余额|密钥|key|充值|\d+(?:\.\d+)?\s*(?:刀|美元|美金|usd|\$|元|rmb|cny))|(?:余额|额度|充值)[^，,。；;|｜【】（）()]{0,12}(?:中转|\bapi\b)|\d+\s*[mk亿万]\s*tokens?/i.test(serviceText);
  let kind = 'pending';
  let source = '';
  if (smsService) { kind = 'sms'; source = clean.match(SMS)?.[0]; }
  else if (poolService) { kind = 'pool'; source = '号池余额 / 额度充值'; }
  else if (!apiService && (/点数|\d+\s*点(?:官方|额度|数|充值|[)）]|$)|codex\s*\d+\s*(?:额度|点)/i.test(clean)
    || /codex/i.test(clean) && /credits|额度充值|充值额度|(?:额度|充值)\s*\d+|\d+\s*额度/i.test(clean))) { kind = 'points'; source = '点数 / 额度充值'; }
  else if (/好友邀请|邀请奖励|自助邀请|邀请额度|邀请.{0,8}额度增加/i.test(clean) && !team) { kind = 'invite'; source = '邀请奖励'; }
  else if (/镜像站|镜像服务/.test(clean)) { kind = 'mirror'; source = '镜像站'; }
  else if (apiService) { kind = 'api'; source = 'API / 中转额度'; }
  else if (!finished && /提链|扫码对接|二维码生成|优惠码/i.test(clean)) { kind = 'peripheral'; source = '提链 / 扫码 / 优惠码服务'; }
  else if (/重置卡|额度重置/.test(clean) && !finished) { kind = 'reset'; source = '额度重置卡'; }
  else if (eligibility) { kind = 'eligibility'; source = '开通优惠资格，不含付费订阅'; }
  else if (student && !finished) { kind = 'student'; source = '学生认证'; }
  else if (/cyber|kyc|身份认证|实名/i.test(clean) && !finished) { kind = 'kyc'; source = clean.match(/cyber|kyc|身份认证|实名/i)?.[0]; }
  else if (team && /母号|管理员|管理权|owner|主号|管理账号/i.test(clean)) { kind = 'workspace'; source = '团队管理账号'; }
  else if (team && /席位|车位|月权益|加入空间|自己的账号|自备账号|邀请入组/.test(clean)) { kind = 'seat'; source = '团队席位'; }
  else if (/共享|合租|拼车/.test(clean)
    || (team && /轮转|轮换|头车|二车|三车|长效车|发车|踢人|空间炸|空间爆炸/.test(clean))) { kind = 'shared'; source = '共享 / 团队车'; }
  else if (CHARGE.test(clean) && (!explicitAccount || ownAccount)) { kind = 'charge'; source = clean.match(CHARGE)?.[0]; }
  else if (finished && !ownAccount) { kind = 'account'; source = clean.match(FINISHED)?.[0] || '交付账号'; }
  else if (CHARGE.test(clean)) { kind = 'charge'; source = clean.match(CHARGE)?.[0]; }
  else if (/成品|账号|日抛/.test(categoryHint) && !CHARGE.test(categoryHint)) { kind = 'account'; source = `店铺分类：${categoryHint}`; }
  else if (CHARGE.test(categoryHint) && !/成品/.test(categoryHint)) { kind = 'charge'; source = `店铺分类：${categoryHint}`; }
  if (source) evidence.push(`交付：${KINDS[kind][0]}（${source}）`);
  if (deliveryChoice) {
    reasons.push('同时提供成品与代充，交付方式待确认');
    evidence.push(`交付冲突：${deliveryChoice[0]}`);
  }
  if (['pool', 'api'].includes(kind) && explicitAccount && !ownAccount) reasons.push('同时出现服务充值与账号交付，商品类型待确认');
  if (!poolService && /号池/.test(clean) && CHARGE.test(clean) && !explicitAccount) reasons.push('号池用途仅见于说明或教程，实际充值对象待确认');

  let plans = plansIn(main);
  if (/k12/i.test(main) && team && plans.every((p) => ['Plus', 'Team', 'Business', 'Team / Business'].includes(p))) {
    plans = ['Team / Business'];
    evidence.push('套餐：Team / Business（K12 团队商品）');
  }
  // 点数与接码文案常提及购买前置套餐，这些词不能成为商品订阅规格。
  if (['sms', 'pool', 'points', 'invite', 'peripheral', 'kyc', 'eligibility'].includes(kind)) plans = [];
  if (!plans.length && !['sms', 'pool', 'points', 'api', 'invite', 'peripheral', 'kyc', 'eligibility'].includes(kind)) {
    const hinted = plansIn(categoryHint);
    if (hinted.length === 1) { plans = hinted; evidence.push(`套餐：${hinted[0]}（店铺分类：${categoryHint}）`); }
  }
  if (plans.length > 1) reasons.push('出现多个套餐');
  const plan = plans.join(' / ');
  if (plan && !evidence.some((e) => e.startsWith('套餐：'))) evidence.push(`套餐：${plan}（商品标题）`);
  const subscription = ['account', 'charge', 'shared', 'seat', 'workspace', 'reset', 'pending'].includes(kind);
  const multipliers = subscription
    ? [...new Set([...main.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*[x×倍](?![a-z])/ig)].map((m) => `${Number(m[1])}x`))] : [];
  if (multipliers.length > 1) reasons.push('出现多个倍数');
  const multiplier = multipliers.join(' / ');
  if (multiplier) evidence.push(`倍数：${multiplier}（商品标题）`);
  let amount = '';
  if (subscription && /pro/i.test(plan)) {
    const amounts = [...new Set([...main.matchAll(/(?:\$|usd\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:刀|美元|美金|usd|\$)|\bpro\s*(\d{2,})(?![\d.x×])/ig)]
      .map((m) => `${Number(m[1] || m[2] || m[3])} USD`))];
    amount = amounts.join(' / ');
    if (amounts.length > 1) reasons.push('出现多个套餐面额');
    if (amount) evidence.push(`套餐面额：${amount}（商品标题）`);
  }
  const attrs = { plan, multiplier, amount, delivery: KINDS[kind][0], duration: durationOf(durationText(title), kind, evidence, plan) };
  attrs.balance = kind === 'pool' ? matchValue(clean, /(?:￥|¥|人民币\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|rmb|cny)/i,
    (m) => `${Number(m[1] || m[2])} 元`, evidence, '充值金额') : '';
  attrs.benefit = kind === 'eligibility' ? matchValue(title, /半价|5折|0元试用|免费试用|试用|优惠/, (m) => m[0], evidence, '优惠资格') : '';
  attrs.users = kind === 'shared' ? matchValue(title, /(\d+)\s*人(?:车|共享|合租|拼车)?/, (m) => `${Number(m[1])}人`, evidence, '共享人数') : '';
  if (!attrs.duration) attrs.duration = matchValue(title, /(?:有效期|可用期)\s*(\d+)\s*分钟/, (m) => `${Number(m[1])}分钟`, evidence, '期限');
  const usageText = title.replace(/(?:不是|并非|非|不属于)(?:日抛|当日抛|速刷|临期)/g, '');
  attrs.usage = matchValue(usageText, /日抛|当日抛|速刷|临期|过期号|周限(?:号)?/, (m) => /日抛|当日抛/.test(m[0]) ? '日抛' : m[0], evidence, '使用方式');
  attrs.sms = '';
  if (['account', 'shared'].includes(kind)) {
    attrs.sms = matchValue(title, /未接[马码🐎]|未绑定手机|需要(?:自己|自行)?接[马码]|需验证手机号/, '未接码', evidence, '接码状态');
    if (!attrs.sms) attrs.sms = matchValue(title, /已接[马码🐎]|已绑(?:定)?手机|手机已绑定/, '已接码', evidence, '接码状态');
    if (!attrs.sms && /(?:已接|未接)(?:[|｜\s]|$)/.test(title)) attrs.sms = matchValue(title, /已接|未接/, (m) => m[0] === '已接' ? '已接码' : '未接码', evidence, '接码状态');
  }
  attrs.region = matchValue(title.replace(/(?:不是|并非|非|不支持升级)[^，。;；|｜】）)]{0,8}(?:菲区|美区|日区|越南|印度)/g, ''),
    /菲律宾|菲区|美国|美区|印度|越南|韩国|日本|日区|智利|埃及|加拿大|阿根廷|南非|欧洲|全球/i,
    (m) => ({ 菲律宾: '菲区', 美国: '美区', 日本: '日区' })[m[0]] || m[0], evidence, '地区');
  attrs.email = '';
  if (['account', 'shared', 'workspace'].includes(kind)) {
    const table = [['iCloud', /icloud|苹果邮箱/i], ['Gmail', /gmail|gamil|谷歌(?:邮箱|邮件)|\bgm邮箱/i],
      ['Outlook', /outlook|hotmail|微软邮箱|out邮箱/i], ['域名邮箱', /域名邮箱/i]];
    const emails = table.filter(([, re]) => re.test(title));
    attrs.email = emails.map(([value]) => value).join(' / ');
    if (attrs.email) evidence.push(`邮箱：${attrs.email}（商品标题）`);
  }
  const channelText = title.replace(/安卓\s*(?:和|与|\/|、)?\s*ios\s*通用/ig, '');
  attrs.channel = matchValue(channelText, /upi|uip|\bios\b|gcash|\bgc\b|paypal|\bpp\b|pix|实卡|直卡|卡付|卡冲|卡充|官网|学生优惠/i,
    (m) => ({ upi: 'UPI', uip: 'UPI', ios: 'iOS', gcash: 'GCash', gc: 'GCash', paypal: 'PayPal', pp: 'PayPal', pix: 'PIX', 卡付: '卡充', 卡冲: '卡充' })[m[0].toLowerCase()] || m[0], evidence, '渠道');
  attrs.auth = matchValue(title, /已过\s*(?:cyber|kyc)|学生认证|已认证|美国认证/i, (m) => m[0], evidence, '认证');
  attrs.format = '';
  attrs.access = '';
  if (['account', 'shared'].includes(kind)) {
    const formatText = title.replace(/(?:不能|不可|不支持|无法|非)\s*反代/g, '');
    attrs.format = matchValue(formatText, /仅反代无账密|仅反代|没有账号密码|无账密|只发\s*rt/i, '仅反代凭据', evidence, '交付格式');
    if (!attrs.format) attrs.format = matchValue(formatText, /账密|帐密|张密|账号密码|账号\s*[+＋]|密码\s*[+＋]|可网页|可登网页|网页版|网页直接登/i, '账号登录', evidence, '交付格式');
    if (!attrs.format) attrs.format = matchValue(formatText, /sub2|\bcpa\b|json/i, '反代凭据', evidence, '交付格式');
    attrs.access = matchValue(title, /(?:不能|不可|不支持|无法|非)\s*反代/, '不支持反代', evidence, '使用范围');
    if (!attrs.access) attrs.access = matchValue(title, /仅反代|支持反代|可(?:网页可)?反代|可登网页\s*反代/, (m) => /仅/.test(m[0]) ? '仅反代' : '支持反代', evidence, '使用范围');
  }
  attrs.role = kind === 'workspace' ? matchValue(title, /母号|管理员|管理权|owner|主号/i, (m) => m[0], evidence, '角色') : '';
  attrs.rotation = '';
  attrs.round = '';
  attrs.expires = '';
  if (team && ['shared', 'seat', 'account'].includes(kind)) {
    attrs.rotation = matchValue(title, /非轮转|非轮换|不踢人|不踢不拉|用到空间(?:炸|爆炸|死)/, '非轮换', evidence, '轮换');
    if (!attrs.rotation) attrs.rotation = matchValue(title, /轮转|轮换|\d+\s*h限制/i, '轮换', evidence, '轮换');
    attrs.round = matchValue(title, /头车|首发|第一轮|第一车|二车|第二轮|第二车|三车|第三轮|第三车/, (m) => ({ 首发: '头车', 第一轮: '头车', 第一车: '头车', 第二轮: '二车', 第二车: '二车', 第三轮: '三车', 第三车: '三车' })[m[0]] || m[0], evidence, '轮次');
  }
  attrs.expires = matchValue(title,
    /(?:\d{1,2}月\d{1,2}[号日]?\s*(?:(?:早上|晚上)?\d{1,2}(?:[:：]\d{2}|点))?|\d{1,2}[/.]\d{1,2}(?:号(?:早上|晚上)?\d{1,2}点)?|\d{1,2}号(?:早上|晚上)?\d{1,2}点|\d{1,2}[:：]\d{2}|\d{1,2}点(?:半)?)\s*(?:左右)?(?:到期|踢|开踢)|(?:到|用到|有效至)\s*\d{1,2}号(?:早上|晚上)?\d{1,2}点/i,
    (m) => m[0], evidence, '截止时间');
  attrs.quota = '';
  attrs.models = '';
  if (kind === 'points') {
    attrs.quota = matchValue(title, /(\d+(?:\.\d+)?)\s*点(?:数)?|codex\s*(\d+)\s*额度|点数\s*(\d+)/i,
      (m) => `${Number(m[1] || m[2] || m[3])} 点`, evidence, '额度');
  } else if (kind === 'api') {
    attrs.quota = matchValue(title, /(\d+(?:\.\d+)?)\s*([mk亿万]?)\s*tokens?/i, (m) => `${Number(m[1]) * ({ k: 1e3, m: 1e6, 万: 1e4, 亿: 1e8 }[m[2].toLowerCase()] || 1)} Token`, evidence, '额度');
    if (!attrs.quota) attrs.quota = matchValue(title, /(?:\$|usd\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:刀|美元|美金|usd|\$)/i, (m) => `${Number(m[1] || m[2])} USD`, evidence, '额度');
    const models = [...title.matchAll(/(?:gpt|o[134])[- ]?\d*(?:\.\d+)?(?:[- ](?:mini|nano|pro))?|codex[- ]\d+(?:\.\d+)?/ig)].map((m) => m[0].toLowerCase().replace(/\s+/g, '-'));
    attrs.models = [...new Set(models)].sort().join(' / ');
    if (attrs.models) evidence.push(`模型：${attrs.models}`);
  }
  attrs.cycle = matchValue(title, /\d+\s*[dD]\s*周额度|\d+\s*天\s*周额度|周额度|日额度/, (m) => m[0].replace(/[dD]/, '天'), evidence, '额度周期');
  attrs.count = '';
  attrs.repeat = '';
  attrs.phoneCapacity = '';
  if (kind === 'sms') {
    const countText = title.replace(/质保\s*\d+\s*次(?:成功)?接[马码]/g, '');
    attrs.count = matchValue(countText, /(\d+)\s*次(?:兑换|接[马码]|码)|(?:单次|一次性|一次码|接一次|接马一次)/i, (m) => m[1] ? `${Number(m[1])}次` : '单次', evidence, '接码次数');
    if (!attrs.count && /一次性|单次/.test(categoryHint)) { attrs.count = '单次'; evidence.push(`接码次数：单次（店铺分类：${categoryHint}）`); }
    attrs.repeat = matchValue(title, /无限接[马码]|无限(?:接收|取)码|不限接马次数|可以二次|可二次|可多次|支持二次|可续接|二次验证/, '可重复收码', evidence, '重复接码');
    attrs.phoneCapacity = matchValue(title, /(?:绑|绑定)\s*(\d+(?:[-～~]\d+)?)\s*个?号|一号一绑|一号一账号/i,
      (m) => m[1] ? `${m[1]}个账号` : '1个账号', evidence, '号码容量');
  }
  attrs.reset = '';
  if (/重置卡|额度重置|满额度/.test(title)) {
    attrs.reset = matchValue(title, /(?:\d+\s*[-～~]\s*\d+|\d+)\s*(?:张|次)?\s*重置(?:卡)?|满额度|重置卡|额度重置/, (m) => m[0], evidence, '重置');
  }
  attrs.warranty = matchValue(title, /(?:质保|保订阅|订阅质保)\s*(?:订阅|一个月|\d+\s*(?:[-～~]\s*\d+)?\s*(?:天|小时|h|个月))|(?:仅|保)?首登|无质保|整体无质保/i, (m) => m[0].replace(/\s+/g, ''), evidence, '质保');

  if (kind === 'pending') reasons.push(REDEEM.test(clean) ? '仅有卡密/CDK信息，无法确认交付方式' : '交付方式未注明');
  if (subscription && !plan) reasons.push('套餐未注明');
  if (subscription && plan === 'Pro' && !multiplier && !amount) reasons.push('Pro 档位未注明');
  if (kind === 'sms' && !attrs.duration && !attrs.count && !attrs.expires) reasons.push('接码次数或有效期未注明');
  if (kind === 'points' && !attrs.quota) reasons.push('点数未注明');
  if (kind === 'pool' && !attrs.balance) reasons.push('号池充值金额未注明');
  if (kind === 'api' && !attrs.quota) reasons.push('API 额度未注明');
  if (kind === 'api' && !attrs.duration && !attrs.expires) reasons.push('API 有效期未注明');
  if (attrs.duration.includes(' / ')) reasons.push('出现多个有效期');
  if (team && attrs.rotation === '轮换' && !attrs.expires) reasons.push('轮换截止时间未注明');
  if (plan === 'Free' && (multiplier || amount)) reasons.push('普通号与付费档位信息矛盾');
  const catalog = reasons.length ? null : catalogOf(kind, attrs, title, reasons);
  if (catalog) evidence.push(`目录：${catalog.name}`);
  return { kind, attributes: attrs, evidence, catalog, pendingReason: [...new Set(reasons)].join('；') };
}

/** 提取商品属性，再归入参考目录；不改写数据库中的原始商品。 */
export function autoGroupOpenAI(items) {
  return groupAutoProducts(items, { platform: 'openai', kinds: KINDS, extract, attributeLabels: LABELS });
}
