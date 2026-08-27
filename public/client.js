'use strict';
// 一夜狼人杀 · 在线版 前端逻辑

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// 资源版本号（由服务端注入 window.__ASSET_VER__），拼到头像等静态资源 URL 上做 cache-busting，
// 避免浏览器/平台强缓存导致“换了头像仍显示旧图”。
const ASSET_VER = (typeof window !== 'undefined' && window.__ASSET_VER__) || '';
const assetUrl = (p) => ASSET_VER ? `${p}?v=${ASSET_VER}` : p;

let STATE = {
  token: localStorage.getItem('oww_token') || null,
  code: localStorage.getItem('oww_code') || null,
  name: localStorage.getItem('oww_name') || '',
  seat: null,
  screen: 'home',
  data: null,
};
let ttsOn = true;
let actionSel = {};
let es = null;
let micRec = null;
let recording = false;

// 阵营元数据
const TEAM_META = {
  wolf:    { name: '狼队',       cls: 'team-wolf' },
  village: { name: '好人阵营',   cls: 'team-village' },
  tanner:  { name: '皮匠（独立）', cls: 'team-tanner' },
  vampire: { name: '吸血鬼队',   cls: 'team-vampire' },
  assassin:{ name: '刺客（独立）', cls: 'team-assassin' },
};

// 角色能力说明（该展示的内容一点不少）
const ROLE_DESC = {
  werewolf: '夜晚与同伴互认；若只有你一只狼，可查看一张中央底牌。',
  minion: '狼队的帮手，知道谁是狼人（狼也可能在中央）。',
  alpha_wolf: '将一张中央的狼人身份牌与一名非狼玩家交换（不能换给自己或狼人）。',
  wolf_seer: '查看一名玩家的真实身份。',
  mason: '与另一名守夜人互认，确定你的同伴。',
  seer: '查看一名玩家，或查看两张中央底牌的身份。',
  apprentice_seer: '查看一张中央底牌的身份。',
  paranormal_detective: '查看最多2名玩家；看到狼人则变狼，看到皮匠则变皮匠。',
  robber: '与一名玩家交换身份，并查看换来的新身份。',
  witch: '查看一张中央底牌，并可选与一名玩家交换身份。',
  troublemaker: '悄悄交换另外两名玩家的身份（自己不变）。',
  village_idiot: '轮转所有其他玩家的身份牌（自己不变）。',
  drunk: '被迫与一张中央底牌随机交换身份。',
  insomniac: '天亮前查看自己最终的身份。',
  sentinel: '给一名玩家上盾，被盾保护的玩家本夜不可被查/换/移动。',
  doppelganger: '查看一名玩家身份并复制其角色能力（原版规则，本作简化为仅查看）。',
  revealer: '揭示一名玩家的身份（信息类）。',
  bodyguard: '投票时保护一人：其获最高票则次高票者（≥2票）被放逐。',
  hunter: '被放逐时可开枪带走一名玩家。',
  villager: '普通村民，没有特殊能力。',
  tanner: '只想被放逐；若你被放逐且无狼死亡，你独赢。',
  prince: '若你获得最高票，按规则顺延，由次高票者被放逐。',
  cursed: '若被狼人标记则变成狼。',
  vampire: '黄昏阶段把吸血鬼标记放到一名玩家面前，其变为吸血鬼。',
  count: '黄昏阶段对一名玩家施加恐惧封锁。',
  renfield: '用蝙蝠标记交换原始标记；无吸血鬼死则血奴胜。',
  priest: '黄昏给自己放清白标记，可再净化一名玩家的标记。',
  sharpshooter: '夜晚查一名玩家身份，并查另一名玩家的状态标记。',
  thief: '夜晚将一名玩家的状态标记换到自己面前并查看。',
  gremlin: '盲交换任意两人的角色牌或状态标记（可含自己）。',
  cupid: '黄昏给两名玩家放爱之标记，令二人同生共死。',
  assassin: '黄昏给一名玩家放刺杀标记；该玩家死亡时你获胜。',
  tracker: '查看本夜哪些玩家动过牌（直接查看，不用选人），识破换牌角色。',
};

// --------------------------- 工具 ---------------------------
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function showScreen(name) {
  STATE.screen = name;
  $$('.screen').forEach(s => s.classList.remove('active'));
  $('#screen-' + name).classList.add('active');
}
async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, data: j };
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initial(name) { return (name || '?').slice(0, 1); }

// --------------------------- 首页 ---------------------------
$('#home-name').value = STATE.name;
let createCount = 5;
$$('#count-chips .chip').forEach(ch => ch.onclick = () => {
  $$('#count-chips .chip').forEach(x => x.classList.remove('active'));
  ch.classList.add('active');
  createCount = Number(ch.dataset.n);
});
$('#btn-create').onclick = async () => {
  const name = $('#home-name').value.trim() || '玩家';
  const { data } = await api('/api/create', { name, capacity: createCount });
  if (!data || data.error) return toast(data?.error || '创建失败');
  STATE.token = data.token; STATE.code = data.code; STATE.name = name; STATE.seat = data.seat;
  saveLocal(); connectSSE(); showScreen('lobby');
};
$('#btn-join').onclick = async () => {
  const name = $('#home-name').value.trim() || '玩家';
  const code = $('#home-code').value.trim();
  if (!code) return toast('请输入房间号');
  const { data } = await api('/api/join', { name, code });
  if (!data || data.error) return toast(data?.error || '加入失败');
  STATE.token = data.token; STATE.code = data.code; STATE.name = name; STATE.seat = data.seat;
  saveLocal(); connectSSE(); showScreen('lobby');
};
function saveLocal() {
  localStorage.setItem('oww_token', STATE.token || '');
  localStorage.setItem('oww_code', STATE.code || '');
  localStorage.setItem('oww_name', STATE.name || '');
}

// --------------------------- SSE ---------------------------
function connectSSE() {
  if (es) es.close();
  es = new EventSource(`/api/stream?code=${encodeURIComponent(STATE.code)}&token=${encodeURIComponent(STATE.token)}`);
  es.onopen = () => $('#conn-dot').classList.add('on');
  es.onerror = () => $('#conn-dot').classList.remove('on');
  es.addEventListener('state', (e) => { onState(JSON.parse(e.data)); });
  es.addEventListener('reset', () => {
    // 新一局开始：清空播报历史与语音队列/去重，必须在开场播报之前完成
    _ttsSeq++;                   // 作废在途的 onend/finish
    clearAnnHistory();
    const annEl = $('#ann-text'); if (annEl) annEl.textContent = '';
    stopAnnounce();
    _ttsLastEnqueued = '';
    _ttsAutoUnlocking = false;
    _openStep = 0; _closedStep = 0; _openStage = null; _openRoleName = ''; _ttsCurrentItem = null; // 新局重置夜间揭示进度
    if (_nightAckFallback) { clearTimeout(_nightAckFallback); _nightAckFallback = null; }
  });
  es.addEventListener('speak', (e) => {
    const d = JSON.parse(e.data);
    speakAnnounce(d.text, d.step, d.kind, d.stage, d.roleName); // speak 事件代表一条新播报，入队依次完整朗读（上帝视角）
  });
  es.addEventListener('private', (e) => {
    const d = JSON.parse(e.data);
    // 服务端也会在下一次 state 中推送，这里立刻追加到当前状态并渲染，确保信息即时显示
    if (STATE.data && STATE.data.you) {
      if (!STATE.data.you.seen) STATE.data.you.seen = [];
      if (!STATE.data.you.seen.includes(d.text)) STATE.data.you.seen.push(d.text);
      renderGame(STATE.data);
    }
  });
  es.addEventListener('speech', (e) => { addSpeech(JSON.parse(e.data)); });
  es.addEventListener('hunter', (e) => { const d = JSON.parse(e.data); toast(`猎人 ${d.name} 被放逐，可开枪`); });
  es.addEventListener('voice', (e) => { onVoiceState((JSON.parse(e.data).seats) || []); });
  es.addEventListener('voice_invite', (e) => {
    const d = JSON.parse(e.data);
    if (!voiceOn) showVoiceInvite(d.fromName);
  });
  es.addEventListener('signal', (e) => { const d = JSON.parse(e.data); onVoiceSignal(d.from, d.data); });
}

// --------------------------- 状态渲染 ---------------------------
const PHASE_NAME = {
  lobby: '准备中', dusk: '黄昏阶段', night: '夜晚', day: '白天发言',
  vote: '投票阶段', result: '游戏结束', result_pending_hunter: '猎人开枪',
};

let _lastPhase = null;
function onState(s) {
  STATE.data = s;
  voiceApplyPhase(s.phase);
  // 注：播报历史与语音队列的清空改由服务端 startGame 时发的 `reset` 事件负责，
  // 不能在 lobby→night 的 state 里清，否则会把「游戏开始/天黑/狼人/爪牙」等开场播报一起删掉。
  _lastPhase = s.phase;
  if (s.phase === 'lobby') { renderLobby(s); showScreen('lobby'); }
  else { showScreen('game'); renderGame(s); }
}

function renderLobby(s) {
  $('#lobby-code').textContent = s.code;
  $('#lobby-count').textContent = `${s.players.length} / ${s.capacity}`;
  $('#lobby-cap').textContent = s.capacity;
  const me = s.players.find(p => p.isYou);
  updateReadyBtn(!!(me && me.ready));
  const ul = $('#lobby-players'); ul.innerHTML = '';
  const botCount = s.players.filter(p => p.bot).length;
  const lb = $('#lobby-bots'); if (lb) lb.textContent = `${botCount} 个`;
  s.players.forEach(p => {
    const li = document.createElement('li');
    const tagCls = p.isHost ? 'host' : (p.bot ? 'bot' : (p.ready ? 'ready' : ''));
    const tagText = p.isHost ? '房主' : (p.bot ? '🤖 机器人' : (p.ready ? '已准备' : '未准备'));
    li.innerHTML = `
      <div class="avatar">${p.bot ? '🤖' : escapeHtml(initial(p.name))}</div>
      <span class="p-name">${escapeHtml(p.name)}${p.isYou ? '（你）' : ''}</span>
      <span class="tag ${tagCls}">${tagText}</span>`;
    ul.appendChild(li);
  });
  // 返回大厅时清空上局播报，避免旧记录残留
  clearAnnHistory();
  const annEl = $('#ann-text'); if (annEl) annEl.textContent = '等待开始…';
  const hostOnly = $('#host-only');
  hostOnly.classList.toggle('hidden', !s.isHost);
  $('#btn-start').classList.toggle('hidden', !s.isHost);
  const fillBtn = $('#btn-fill-bots');
  if (fillBtn) fillBtn.disabled = s.players.length >= s.capacity;
  if (s.isHost) {
    renderReco(s.capacity, s.presetId, s.customActive);
    updateCustomCount();
    const descEl = $('#preset-desc');
    // 3/6/7 人局：推荐阵容区已隐藏，这句"当前阵容"说明也一并隐藏
    if (!RECO_GROUPS[s.capacity]) {
      descEl.innerHTML = '';
      descEl.classList.add('hidden');
    } else {
      descEl.classList.remove('hidden');
      let desc = '当前阵容：<b>' + (s.presetName || '—') + '</b>';
      if (!s.customActive) {
        const pr = PRESETS_CACHE.find(p => p.id === s.presetId);
        if (pr) desc += '　身份牌：<b>' + pr.cards.join('、') + '</b>';
      }
      descEl.innerHTML = desc;
    }
  }
}

// 推荐阵容卡片（4/5 人显示折叠分组；3/6/7 人隐藏，只留自选）
const RECO_GROUPS = {
  // 4人局分组（参考《4人版指南》）
  4: [
    { keys: ['P'], label: '🟢 基础阵容' },
    { keys: ['Q'], label: '🔵 进阶阵容' },
    { keys: ['R'], label: '🔴 挑战阵容' },
  ],
  // 5人局分组（参考《5人版指南》：基础6套/进阶6套/挑战5套）
  5: [
    { keys: ['M'], label: '🟢 基础阵容' },                 // M1-M6
    { keys: ['A','B','C','D','E','F'], label: '🔵 进阶阵容' }, // A-F 共6套
    { keys: ['V'], label: '🔴 挑战阵容' },                 // V1-V5
  ],
  // 6人局分组（参考《6人版指南》：基础6套/进阶6套/挑战5套，共17套）
  6: [
    { keys: ['X'], label: '🟢 基础阵容' },                 // X1-X6
    { keys: ['Y'], label: '🔵 进阶阵容' },                 // Y1-Y6
    { keys: ['U'], label: '🔴 挑战阵容' },                 // U1-U5（吸血鬼）
  ],
};
function renderReco(capacity, currentId, customActive) {
  const wrap = $('#reco-wrap');
  // 3/6/7 人局：不显示推荐阵容
  if (!RECO_GROUPS[capacity]) {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const expectedCards = capacity + 3;
  const groups = RECO_GROUPS[capacity];
  const allPresets = PRESETS_CACHE.filter(p => p.cards.length === expectedCards);

  // 按前缀分组
  const grouped = groups.map(g => ({
    ...g,
    presets: allPresets.filter(p => g.keys.some(k => p.id.startsWith(k))),
  })).filter(g => g.presets.length > 0);

  if (grouped.length === 0 || allPresets.length === 0) {
    wrap.innerHTML = `<div class="reco-title">${capacity} 人局暂无推荐阵容，请使用下方「自选角色」配置 ${expectedCards} 张身份牌</div>`;
    return;
  }

  const title = `推荐阵容（${capacity} 人 · ${expectedCards} 张牌）`;
  let html = `<div class="reco-title">${title}</div>`;
  grouped.forEach((g, gi) => {
    const gid = 'reco-g-' + gi;
    html += `<div class="reco-group">
      <button class="reco-group-head" data-target="${gid}" aria-expanded="false">
        <span class="reco-group-label">${g.label}</span>
        <span class="reco-group-count">${g.presets.length} 套</span>
        <span class="reco-group-toggle">＋</span>
      </button>
      <div class="reco-group-body" id="${gid}">
        ${g.presets.map(p => {
          const sel = (p.id === currentId && !customActive) ? ' sel' : '';
          return `<button class="reco-card${sel}" data-id="${p.id}"><span class="reco-name">${escapeHtml(p.name)}</span><span class="reco-cards">${escapeHtml(p.cards.join('、'))}</span></button>`;
        }).join('')}
      </div>
    </div>`;
  });
  wrap.innerHTML = html;

  // 折叠/展开交互
  wrap.querySelectorAll('.reco-group-head').forEach(btn => {
    btn.onclick = () => {
      const body = document.getElementById(btn.dataset.target);
      const exp = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!exp));
      btn.querySelector('.reco-group-toggle').textContent = exp ? '＋' : '－';
      body.classList.toggle('open', !exp);
    };
  });
  // 默认全部折叠
  wrap.querySelectorAll('.reco-group-body').forEach(b => b.classList.remove('open'));

  // 点击选中预设
  wrap.querySelectorAll('.reco-card').forEach(b => b.onclick = () => {
    api('/api/action', { token: STATE.token, type: 'setPreset', payload: { presetId: b.dataset.id } });
  });
}

// 自选角色网格（按扩展分组：基础 → 破晓 → 吸血鬼；支持重复选牌）
const ROLE_PACKS = {
  // 基础
  werewolf: 'base', minion: 'base', mason: 'base', seer: 'base', robber: 'base',
  troublemaker: 'base', drunk: 'base', insomniac: 'base', hunter: 'base', tanner: 'base',
  villager: 'base', doppelganger: 'base',
  // 破晓扩展
  alpha_wolf: 'daybreak', wolf_seer: 'daybreak', apprentice_seer: 'daybreak',
  paranormal_detective: 'daybreak', witch: 'daybreak', village_idiot: 'daybreak',
  sentinel: 'daybreak', revealer: 'daybreak', bodyguard: 'daybreak', prince: 'daybreak',
  cursed: 'daybreak', tracker: 'daybreak',
  // 吸血鬼扩展
  vampire: 'vampire', count: 'vampire', renfield: 'vampire', priest: 'vampire',
  sharpshooter: 'vampire', thief: 'vampire', gremlin: 'vampire', cupid: 'vampire', assassin: 'vampire',
};
const PACK_ORDER = ['base', 'daybreak', 'vampire'];
const PACK_LABEL = { base: '🟢 基础', daybreak: '🔵 破晓扩展', vampire: '🔴 吸血鬼扩展' };
const ROLE_MAX = { werewolf: 2, mason: 2, villager: 3, vampire: 2 }; // 其余角色默认最多 1 张

let customRoles = {}; // key -> 张数
function roleMax(key) { return ROLE_MAX[key] || 1; }
function customTotal() { return Object.values(customRoles).reduce((a, b) => a + b, 0); }

function buildRoleCheckGrid() {
  const grid = $('#role-check-grid');
  if (grid.dataset.built) return;
  const lib = window.ROLE_LIB || [];
  const idx = k => PACK_ORDER.indexOf(ROLE_PACKS[k] || 'base');
  const ordered = [...lib].sort((a, b) => idx(a.key) - idx(b.key));
  let html = '';
  for (const pack of PACK_ORDER) {
    const roles = ordered.filter(r => (ROLE_PACKS[r.key] || 'base') === pack);
    if (!roles.length) continue;
    html += `<div class="role-pack-head">${PACK_LABEL[pack]}</div>`;
    html += roles.map(r => {
      const mx = roleMax(r.key);
      return `<div class="role-step" data-key="${r.key}" data-max="${mx}">
        <span class="role-step-name">${escapeHtml(r.name)}${mx > 1 ? `<i class="role-step-multi">×${mx}</i>` : ''}</span>
        <div class="role-step-ctrl">
          <button type="button" class="step-btn" data-act="dec" aria-label="减少">−</button>
          <span class="step-count">0</span>
          <button type="button" class="step-btn" data-act="inc" aria-label="增加">+</button>
        </div>
      </div>`;
    }).join('');
  }
  html += '<div id="custom-count" class="custom-count"></div>';
  grid.innerHTML = html;
  grid.dataset.built = '1';
  grid.querySelectorAll('.role-step').forEach(row => {
    const key = row.dataset.key;
    const max = Number(row.dataset.max);
    const name = (window.ROLE_MAP && window.ROLE_MAP[key]) ? window.ROLE_MAP[key].name : key;
    const countEl = row.querySelector('.step-count');
    const refresh = () => {
      const c = customRoles[key] || 0;
      countEl.textContent = c;
      row.classList.toggle('on', c > 0);
    };
    row.querySelector('[data-act="inc"]').onclick = () => {
      const c = customRoles[key] || 0;
      if (c >= max) { toast(`「${name}」最多 ${max} 张`); return; }
      customRoles[key] = c + 1;
      refresh(); updateCustomCount();
    };
    row.querySelector('[data-act="dec"]').onclick = () => {
      const c = customRoles[key] || 0;
      if (c <= 0) return;
      if (c - 1 === 0) delete customRoles[key]; else customRoles[key] = c - 1;
      refresh(); updateCustomCount();
    };
  });
}
function updateCustomCount() {
  const el = $('#custom-count');
  if (!el) return;
  const cap = STATE.data && STATE.data.capacity || 5;
  const need = cap + 3;
  const total = customTotal();
  const ok = total === need;
  el.textContent = `已选 ${total} / 需要 ${need} 张`;
  el.className = 'custom-count' + (ok ? ' ok' : (total > need ? ' over' : ''));
}

// 准备按钮高亮状态
function updateReadyBtn(ready) {
  const b = $('#btn-ready');
  if (ready) { b.textContent = '已准备 ✓'; b.classList.add('ready-on'); }
  else { b.textContent = '准备'; b.classList.remove('ready-on'); }
}

// 离开房间 → 回到首页
function leaveRoom() {
  voiceTeardown();
  api('/api/action', { token: STATE.token, type: 'leave' });
  if (es) { es.close(); es = null; }
  STATE.token = null; STATE.code = null; STATE.seat = null; STATE.data = null;
  saveLocal();
  showScreen('home');
}

let PRESETS_CACHE = [];
(async () => {
  try { const r = await fetch('/api/presets'); PRESETS_CACHE = await r.json(); } catch (_) {}
})();

$('#btn-ready').onclick = () => api('/api/action', { token: STATE.token, type: 'ready' });
$('#btn-start').onclick = () => api('/api/action', { token: STATE.token, type: 'start' });
$('#btn-cancel').onclick = leaveRoom;
$('#btn-add-bot').onclick = () => api('/api/action', { token: STATE.token, type: 'addBot', payload: { count: 1 } });
$('#btn-fill-bots').onclick = () => api('/api/action', { token: STATE.token, type: 'addBot', payload: { fill: true } });
$('#btn-custom-toggle').onclick = () => { buildRoleCheckGrid(); $('#custom-wrap').classList.toggle('hidden'); };
$('#btn-apply-custom').onclick = () => {
  const total = customTotal();
  if (total < 3) return toast('至少选择 3 张牌');
  const roles = Object.entries(customRoles).flatMap(([k, c]) => Array(c).fill(k));
  api('/api/action', { token: STATE.token, type: 'setCustom', payload: { roles } }).then(r => {
    if (r.data && r.data.warning) toast(r.data.warning);
    else toast(`已应用自选阵容（${total} 张）`);
  });
};
// 复制文本：优先用 Clipboard API（需安全上下文），否则回退到 textarea + execCommand
function copyText(text) {
  return new Promise((resolve, reject) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(resolve).catch(() => fallbackCopy(text, resolve, reject));
    } else {
      fallbackCopy(text, resolve, reject);
    }
  });
}
function fallbackCopy(text, resolve, reject) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px'; // 避免 iOS 缩放
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    ok ? resolve() : reject(new Error('execCommand failed'));
  } catch (e) { reject(e); }
}

$('#btn-copy').onclick = async () => {
  const link = `${location.origin}/?code=${STATE.code}`;
  const text = `【一夜狼人杀】房间号 ${STATE.code}\n快来玩：${link}`;
  try {
    await copyText(text);
    toast('邀请已复制 ✓');
  } catch (e) {
    toast('复制失败，请长按房间号手动复制：' + STATE.code);
  }
};
// 点击房间号也可直接复制，并支持长按手动选择
$('#lobby-code').onclick = async () => {
  if (!STATE.code) return;
  try { await copyText(STATE.code); toast('房间号已复制：' + STATE.code); }
  catch (e) { toast('请长按房间号手动复制：' + STATE.code); }
};

// --------------------------- 游戏渲染 ---------------------------
function renderGame(s) {
  $('#phase-text').textContent = PHASE_NAME[s.phase] || s.phase;

  // 夜晚 / 黄昏 进度
  const st = $('#stepper');
  if (s.nightInfo) {
    st.classList.remove('hidden');
    const info = s.nightInfo;
    const ico = info.stage === 'dusk' ? '🌆' : '🌙';
    const stageName = info.stage === 'dusk' ? '黄昏' : '夜晚';
    // 步骤号与角色名完全跟随「语音实际揭示进度」(_openStep/_openRoleName)，不再使用服务端快时钟的 current，
    // 彻底消除「步骤数跑在语音前面 / 守夜人刚结束就显示第 7/7 步」的问题。
    const cur = (_openStage === info.stage) ? Math.max(1, _openStep) : 1;
    const revealed = cur >= 1 && cur <= info.total;
    const roleName = (_openStage === info.stage && _closedStep < cur && _openRoleName) ? _openRoleName : '';
    $('#stepper-label').innerHTML = `<span class="ico">${ico}</span> ${stageName} · 第 ${revealed ? cur : 1} / ${info.total} 步${roleName ? ' · <b style="color:var(--text)">' + escapeHtml(roleName) + '</b>' : ''}`;
    $('#stepper-fill').style.width = (info.total ? (revealed ? cur : 0) / info.total * 100 : 0) + '%';
  } else st.classList.add('hidden');

  // 身份卡
  const rc = $('#role-card');
  if (s.you && s.you.role) {
    const tm = TEAM_META[s.you.role.team] || { name: s.you.role.team, cls: '' };
    rc.className = 'role-card ' + tm.cls;
    rc.classList.remove('hidden');
    $('#role-team').textContent = '阵营：' + tm.name;
    const iconEl = $('#role-icon');
    if (iconEl) {
      const key = s.you.role.key;
      iconEl.onerror = () => { iconEl.style.display = 'none'; const fb = $('#role-icon-fallback'); if (fb) { fb.textContent = (s.you.role.name || '?')[0]; fb.style.display = 'flex'; } console.warn('[role-icon] 加载失败:', key); };
      iconEl.onload = () => { const fb = $('#role-icon-fallback'); if (fb) fb.style.display = 'none'; };
      iconEl.src = assetUrl(`/assets/role-icons/${key}/icon.png`);
      iconEl.alt = s.you.role.name;
    }
    $('#role-name').textContent = s.you.role.name;
    const rl = (window.ROLE_MAP && window.ROLE_MAP[s.you.role.key]) || null;
    $('#role-desc').textContent = rl ? rl.ability : (ROLE_DESC[s.you.role.key] || '');
    const rs = $('#role-seen');
    if (s.you.seen && s.you.seen.length) {
      const latest = s.you.seen[s.you.seen.length - 1];
      const prev = s.you.seen.slice(0, -1);
      rs.innerHTML = (prev.length ? prev.map(escapeHtml).join('<br>') + '<br>' : '') +
        `<span class="role-seen-latest">${escapeHtml(latest)}</span>`;
    } else {
      rs.textContent = '';
    }
    const mark = $('#role-mark');
    if (s.you.mark) { mark.textContent = '你的标记：' + s.you.mark; mark.classList.remove('hidden'); }
    else mark.classList.add('hidden');
    // 失眠者：白天在角色卡下方显示"最终身份"小字（仅此角色可见最终身份）
    const finalEl = $('#role-final');
    if (s.you.finalRole) {
      finalEl.textContent = `你现在的身份是【${s.you.finalRole.name}】（最终身份）`;
      finalEl.classList.remove('hidden');
    } else finalEl.classList.add('hidden');
  } else rc.classList.add('hidden');

  // 播报文字由 speak SSE 事件驱动（_speakOne 在开始朗读时同步 #ann-text，保证音文同步）

  // 记录
  const log = $('#log'); log.innerHTML = '';
  s.log.slice(-14).forEach(l => { const d = document.createElement('div'); d.textContent = l; log.appendChild(d); });
  log.scrollTop = log.scrollHeight;

  // 各阶段面板
  // 夜间行动窗口：仅在该角色「睁眼」播报已展示（_openStep 已到达该角色步数）、且尚未「闭眼」时显示，
  // 完全跟随语音揭示进度，不再跟服务端快时钟的 nightInfo.current 比较，避免操作窗口抢跑。
  const showAction = s.action && (!s.nightInfo || (_openStage === s.nightInfo.stage && _openStep === s.nightInfo.current && _closedStep < _openStep));
  renderAction(s, showAction);
  $('#day-box').classList.toggle('hidden', s.phase !== 'day');
  renderVote(s);
  renderHunter(s);
  $('#pending-box').classList.toggle('hidden', s.phase !== 'result_pending_hunter' || !!s.hunterShoot);
  renderResult(s);

  // 房主：开始投票
  $('#btn-start-vote').classList.toggle('hidden', !(s.isHost && s.phase === 'day'));
}

// --------------------------- 行动提示 ---------------------------
function renderAction(s, visible) {
  const box = $('#action-box');
  if (!visible || !s.action) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  const a = s.action;
  actionSel = {};
  let html = `<div class="a-role">${a.roleName} · 你的行动</div><div class="a-text">${a.text}</div>`;
  if (a.type === 'seer') {
    html += `<div class="row-btns"><button class="btn btn-ghost btn-sm" data-mode="player">查玩家</button><button class="btn btn-ghost btn-sm" data-mode="center">查中央（可多选 1–2 张）</button></div>`;
    html += `<div class="choice-grid" id="a-grid"></div><div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认</button></div>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      actionSel = { mode: 'player' };
      if (b.dataset.mode === 'center') { actionSel.mode = 'center'; actionSel.centers = []; }
      box.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); renderSeerChoices(a);
    });
    renderSeerChoices(a);
  } else if (a.type === 'detective' || a.type === 'troublemaker' || a.type === 'cupid') {
    const max = 2;
    html += `<div class="choice-grid" id="a-grid"></div><div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认（选 2 人）</button></div>`;
    box.innerHTML = html; renderMultiPlayer(a, max);
  } else if (a.type === 'tracker') {
    html += `<div class="a-sub">点击下方按钮，查看本夜哪些玩家动过牌（无需选择目标）。</div>`;
    html += `<div class="row-btns"><button class="btn btn-primary" id="a-confirm">查看本夜动牌者</button></div>`;
    box.innerHTML = html;
  } else if (a.type === 'witch') {
    html += `<div class="a-sub">查看中央：</div><div class="choice-grid" id="a-center"></div>`;
    html += `<div class="a-sub">是否与某玩家交换：</div><div class="choice-grid" id="a-grid"></div>`;
    html += `<div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认</button></div>`;
    box.innerHTML = html; renderWitch(a);
  } else if (a.type === 'sharpshooter') {
    html += `<div class="a-sub">查看身份（可选）：</div><div class="choice-grid" id="a-grid"></div>`;
    html += `<div class="a-sub">查看标记（可选）：</div><div class="choice-grid" id="a-grid2"></div>`;
    html += `<div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认</button></div>`;
    box.innerHTML = html; renderSharpshooter(a);
  } else if (a.type === 'gremlin') {
    html += `<div class="row-btns"><button class="btn btn-ghost btn-sm" data-mode="marks">交换标记</button><button class="btn btn-ghost btn-sm" data-mode="cards">交换身份牌</button></div>`;
    html += `<div class="choice-grid" id="a-grid"></div><div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认</button></div>`;
    box.innerHTML = html; renderGremlin(a);
  } else if (a.type === 'priest') {
    html += `<div class="a-sub">是否净化一名玩家（可选）：</div><div class="choice-grid" id="a-grid"></div>`;
    html += `<div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认</button></div>`;
    box.innerHTML = html; renderPriest(a);
  } else if (['robber','seePlayer','vampireMark','fear','alphaWolf','sentinel','werewolf','shield','protect','assassin','thief','minionCenter'].includes(a.type)) {
    html += `<div class="choice-grid" id="a-grid"></div><div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认</button></div>`;
    box.innerHTML = html; renderSingleChoice(a);
  } else {
    html += `<div class="row-btns"><button class="btn btn-primary" id="a-confirm">知道了</button></div>`;
    box.innerHTML = html;
  }
  const cf = $('#a-confirm');
  if (cf) cf.onclick = () => submitAction(a);
}

function renderSharpshooter(a) {
  const grid = $('#a-grid');
  grid.innerHTML = a.players.filter(p => !p.isSelf).map(p => `<div class="choice" data-role="${p.seat}">${escapeHtml(p.name)}</div>`).join('');
  grid.querySelectorAll('.choice').forEach(el => el.onclick = () => { actionSel.roleTarget = Number(el.dataset.role); grid.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
  const grid2 = $('#a-grid2');
  grid2.innerHTML = a.players.filter(p => !p.isSelf).map(p => `<div class="choice" data-mark="${p.seat}">${escapeHtml(p.name)}</div>`).join('');
  grid2.querySelectorAll('.choice').forEach(el => el.onclick = () => { actionSel.markTarget = Number(el.dataset.mark); grid2.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
}
function renderGremlin(a) {
  let mode = 'marks';
  const box = $('#action-box');
  box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; box.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); });
  box.querySelector('[data-mode="marks"]').classList.add('sel');
  const grid = $('#a-grid');
  grid.innerHTML = a.players.filter(p => !p.isSelf).map(p => `<div class="choice" data-target="${p.seat}">${escapeHtml(p.name)}</div>`).join('');
  actionSel.targets = []; actionSel.mode = 'marks';
  grid.querySelectorAll('.choice').forEach(el => el.onclick = () => {
    const t = Number(el.dataset.target);
    if (el.classList.contains('sel')) { el.classList.remove('sel'); actionSel.targets = actionSel.targets.filter(x => x !== t); }
    else { if (actionSel.targets.length >= 2) return toast('最多选 2 人'); el.classList.add('sel'); actionSel.targets.push(t); }
    actionSel.mode = mode;
  });
  // 同步 mode 到 actionSel（点击确认前读取）
  const orig = $('#a-confirm').onclick;
  $('#a-confirm').onclick = () => { actionSel.mode = mode; if (orig) orig(); };
}
function renderPriest(a) {
  const grid = $('#a-grid');
  grid.innerHTML = `<div class="choice" data-target="none">不净化</div>` + a.players.filter(p => !p.isSelf).map(p => `<div class="choice" data-target="${p.seat}">${escapeHtml(p.name)}</div>`).join('');
  actionSel.target = null;
  grid.querySelectorAll('.choice').forEach(el => el.onclick = () => {
    grid.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel');
    actionSel.target = el.dataset.target === 'none' ? null : Number(el.dataset.target);
  });
}

function renderSeerChoices(a) {
  const grid = $('#a-grid'); if (!grid) return;
  if (actionSel.mode === 'center') {
    if (!actionSel.centers) actionSel.centers = [];
    grid.innerHTML = a.centers.map(c => `<div class="choice center" data-center="${c.idx}">中央 ${c.idx + 1}${c.locked ? '🔒' : ''}</div>`).join('');
    grid.querySelectorAll('.choice').forEach(el => el.onclick = () => {
      const ci = Number(el.dataset.center);
      const arr = actionSel.centers;
      const i = arr.indexOf(ci);
      if (i >= 0) { arr.splice(i, 1); el.classList.remove('sel'); }
      else { if (arr.length >= 2) return toast('最多查看 2 张中央底牌'); arr.push(ci); el.classList.add('sel'); }
    });
  } else {
    grid.innerHTML = a.players.filter(p => !p.isSelf).map(p => `<div class="choice" data-target="${p.seat}">${escapeHtml(p.name)}</div>`).join('');
    grid.querySelectorAll('.choice').forEach(el => el.onclick = () => { actionSel.target = Number(el.dataset.target); grid.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
  }
}
function renderMultiPlayer(a, max) {
  const grid = $('#a-grid');
  grid.innerHTML = a.players.filter(p => !p.isSelf).map(p => `<div class="choice" data-target="${p.seat}">${escapeHtml(p.name)}</div>`).join('');
  actionSel.targets = [];
  grid.querySelectorAll('.choice').forEach(el => el.onclick = () => {
    const t = Number(el.dataset.target);
    if (el.classList.contains('sel')) { el.classList.remove('sel'); actionSel.targets = actionSel.targets.filter(x => x !== t); }
    else { if (actionSel.targets.length >= max) return toast(`最多选 ${max} 人`); el.classList.add('sel'); actionSel.targets.push(t); }
  });
}
function renderWitch(a) {
  const cg = $('#a-center');
  cg.innerHTML = a.centers.map(c => `<div class="choice center" data-center="${c.idx}">中央 ${c.idx + 1}</div>`).join('');
  cg.querySelectorAll('.choice').forEach(el => el.onclick = () => { actionSel.center = Number(el.dataset.center); cg.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
  const grid = $('#a-grid');
  grid.innerHTML = `<div class="choice" data-swap="none">不交换</div>` + a.players.filter(p => !p.isSelf).map(p => `<div class="choice" data-swap="${p.seat}">${escapeHtml(p.name)}</div>`).join('');
  grid.querySelectorAll('.choice').forEach(el => el.onclick = () => { actionSel.swapWith = el.dataset.swap === 'none' ? null : Number(el.dataset.swap); grid.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
}
function renderSingleChoice(a) {
  const grid = $('#a-grid');
  let items = [];
  if (a.centers) items = a.centers.map(c => `<div class="choice center" data-center="${c.idx}">中央 ${c.idx + 1}${c.locked ? '🔒' : ''}</div>`);
  if (a.players) items = items.concat(a.players.filter(p => !p.isSelf || a.type === 'werewolf').map(p => `<div class="choice" data-target="${p.seat}">${escapeHtml(p.name)}</div>`));
  grid.innerHTML = items.join('');
  grid.querySelectorAll('.choice').forEach(el => el.onclick = () => {
    grid.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel');
    if (el.dataset.target != null) actionSel.target = Number(el.dataset.target);
    if (el.dataset.center != null) actionSel.center = Number(el.dataset.center);
  });
}

function submitAction(a) {
  // 上帝视角播报不应因玩家操作而中断/清空，保持完整流程
  let payload = {};
  if (a.type === 'seer') {
    if (actionSel.mode === 'center' && (!actionSel.centers || !actionSel.centers.length)) return toast('请选择至少 1 张中央底牌');
    payload = actionSel;
  }
  else if (a.type === 'detective' || a.type === 'troublemaker') payload = { targets: actionSel.targets || [] };
  else if (a.type === 'cupid') payload = { targets: actionSel.targets || [] };
  else if (a.type === 'tracker') payload = { view: true };
  else if (a.type === 'witch') payload = { center: actionSel.center ?? null, swapWith: actionSel.swapWith ?? null };
  else if (a.type === 'sharpshooter') payload = { roleTarget: actionSel.roleTarget ?? null, markTarget: actionSel.markTarget ?? null };
  else if (a.type === 'gremlin') payload = { a: (actionSel.targets || [])[0], b: (actionSel.targets || [])[1], mode: actionSel.mode || 'marks' };
  else if (a.type === 'priest') payload = { target: actionSel.target ?? null };
  else if (a.type === 'robber' || a.type === 'seePlayer' || a.type === 'vampireMark' || a.type === 'fear' || a.type === 'alphaWolf' || a.type === 'assassin' || a.type === 'thief') payload = { target: actionSel.target };
  else if (a.type === 'sentinel' || a.type === 'shield') payload = actionSel.center != null ? { kind: 'center', idx: actionSel.center } : { kind: 'player', target: actionSel.target };
  else if (a.type === 'werewolf' || a.type === 'minionCenter') payload = { center: actionSel.center ?? 0 };
  else if (a.type === 'protect') payload = { target: actionSel.target };
  else payload = {};
  const type = a.type === 'protect' ? 'protect' : 'nightAction';
  api('/api/action', { token: STATE.token, type, payload });
  $('#action-box').classList.add('hidden');
}

// --------------------------- 投票 ---------------------------
function renderVote(s) {
  const box = $('#vote-box');
  if (s.phase !== 'vote') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const list = $('#vote-list'); list.innerHTML = '';
  s.players.forEach(p => {
    const el = document.createElement('div');
    el.className = 'vote-item' + (p.isYou ? ' me' : '');
    el.textContent = p.name;
    if (!p.isYou) el.onclick = () => {
      $$('#vote-list .vote-item').forEach(x => x.classList.remove('sel')); el.classList.add('sel');
      api('/api/action', { token: STATE.token, type: 'vote', payload: { target: p.seat } });
    };
    list.appendChild(el);
  });
  // 「不投票」选项
  const skip = document.createElement('div');
  skip.className = 'vote-item vote-skip';
  skip.textContent = '🚫 不投票';
  skip.onclick = () => {
    $$('#vote-list .vote-item').forEach(x => x.classList.remove('sel')); skip.classList.add('sel');
    api('/api/action', { token: STATE.token, type: 'vote', payload: { target: null } });
  };
  list.appendChild(skip);
  // 已投状态：区分「投了某人」与「已弃票」
  const mine = s.votes?.mine;
  if (s.votes && (mine !== undefined)) {
    if (s.votes.abstained) $('#vote-status').textContent = `你已选择「不投票」 · 已投 ${s.votes.cast} / ${s.players.length}`;
    else $('#vote-status').textContent = `你已投给 ${s.players.find(x => x.seat === mine)?.name || '?'} · 已投 ${s.votes.cast} / ${s.players.length}`;
  } else {
    $('#vote-status').textContent = `已投 ${s.votes?.cast || 0} / ${s.players.length}`;
  }
}
$('#btn-start-vote').onclick = () => api('/api/action', { token: STATE.token, type: 'startVote' });

// --------------------------- 猎人开枪 ---------------------------
function renderHunter(s) {
  const box = $('#hunter-box');
  if (s.phase !== 'result_pending_hunter' || !s.hunterShoot) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const list = $('#hunter-list'); list.innerHTML = '';
  s.players.forEach(p => {
    if (p.isYou) return;
    const el = document.createElement('div');
    el.className = 'vote-item'; el.textContent = p.name;
    el.onclick = () => { if (confirm(`确定开枪带走 ${p.name}？`)) api('/api/action', { token: STATE.token, type: 'hunterShot', payload: { target: p.seat } }); };
    list.appendChild(el);
  });
}

// --------------------------- 结果 ---------------------------
function renderResult(s) {
  const box = $('#result-box');
  if (s.phase !== 'result') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const r = s.result; if (!r) return;
  const banner = $('#result-banner');
  let cls = 'win-village', label = '好人阵营';
  if (r.winners.includes('wolf')) { cls = 'win-wolf'; label = '狼队'; }
  else if (r.winners.includes('vampire')) { cls = 'win-vampire'; label = '吸血鬼队'; }
  else if (r.winners.includes('tanner')) { cls = 'win-tanner'; label = '皮匠'; }
  banner.className = 'result-banner ' + cls;
  banner.textContent = r.summary;
  const ul = $('#result-list'); ul.innerHTML = '';
  r.perPlayer.forEach(p => {
    const tm = TEAM_META[p.team] || { cls: '' };
    const li = document.createElement('li');
    li.className = tm.cls;
    const outTag = p.out ? '<span class="out-tag">出局</span>' : '';
    li.innerHTML = `<span class="who">${escapeHtml(p.name)}${outTag}</span>
      <span class="verdict ${p.win ? 'win' : 'lose'}">${p.roleName} · ${p.win ? '胜' : '负'}</span>`;
    ul.appendChild(li);
  });
  $('#center-reveal').innerHTML = '<b>中央底牌：</b>' + (r.center || []).map(c => c.name).join('、');
  // 「再来一局」仅房主可用（非房主点击无效），对访客隐藏
  $('#btn-restart').classList.toggle('hidden', !s.isHost);
  $('#btn-restart').onclick = () => api('/api/action', { token: STATE.token, type: 'restart' });
}

// --------------------------- 白天发言 / 语音 ---------------------------
$('#btn-send-speech').onclick = sendSpeech;
$('#speech-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendSpeech(); });
function sendSpeech() {
  const v = $('#speech-text').value.trim();
  if (!v) return;
  api('/api/action', { token: STATE.token, type: 'speech', payload: { text: v } });
  $('#speech-text').value = '';
}
function addSpeech(d) {
  const box = $('#speech-log');
  const el = document.createElement('div'); el.className = 'sp';
  el.innerHTML = `<b>${escapeHtml(d.name)}：</b>${escapeHtml(d.text)}`;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}

$('#btn-mic').onclick = toggleMic;
async function toggleMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { toast('当前浏览器不支持语音识别，请手动输入'); return; }
  if (recording) { stopMic(); return; }
  // 先请求麦克风权限（避免 SpeechRecognition 静默失败）
  try {
    const perm = await navigator.permissions.query({ name: 'microphone' });
    if (perm.state === 'denied') {
      $('#mic-status').textContent = '麦克风权限被拒绝：请点击地址栏图标允许麦克风访问';
      toast('麦克风权限被拒绝，请点击浏览器地址栏麦克风图标允许后重试');
      return;
    }
  } catch (_) { /* permissions API 不可用时继续尝试 */ }
  // 部分浏览器需要通过 getUserMedia 触发权限弹窗
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop()); // 立即释放，只为触发权限
  } catch (err) {
    $('#mic-status').textContent = '无法访问麦克风：' + (err.name || err.message);
    toast('无法访问麦克风，请检查浏览器权限设置');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  micRec = new SR();
  micRec.lang = 'zh-CN'; micRec.interimResults = true; micRec.continuous = false;
  micRec.onresult = (ev) => {
    let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
    $('#speech-text').value = t;
    $('#mic-status').textContent = '识别中：' + t;
  };
  micRec.onend = () => { if (recording) { recording = false; $('#btn-mic').classList.remove('recording'); $('#mic-status').textContent = '已停止'; } };
  micRec.onerror = (e) => {
    recording = false; $('#btn-mic').classList.remove('recording');
    const msg = e.error === 'not-allowed' ? '麦克风权限被拒绝（点击地址栏图标允许）' : ('语音识别出错：' + e.error);
    $('#mic-status').textContent = msg;
    if (e.error !== 'aborted') toast(msg);
  };
  try { micRec.start(); recording = true; $('#btn-mic').classList.add('recording'); $('#mic-status').textContent = '正在聆听，请发言…'; } catch (_) { toast('无法启动语音识别'); }
}
function stopMic() { if (micRec) micRec.stop(); recording = false; $('#btn-mic').classList.remove('recording'); }

// --------------------------- AI 播报员（TTS）—— 队列化 + 语音预缓存 ---------------------------
let _ttsVoices = [];          // 缓存的语音列表（onvoiceschanged 时更新）
let _ttsReady = false;         // 语音列表是否已加载
let _ttsZhVoice = null;        // 缓存的中文语音
let _ttsQueue = [];            // 待播报队列（上帝视角：所有角色播报依次完整朗读）
let _ttsDraining = false;      // 是否正在逐条播报
let _ttsUnlocked = false;      // 是否已通过用户手势真正解锁（部分浏览器仅 resume 不够）
let _ttsAutoUnlocking = false; // 是否已自动尝试解锁（避免重复触发兜底）
let _ttsLastEnqueued = '';     // 入队去重：避免同一条播报重复入队
let _currentAnnText = '';      // 当前正显示/播报的文本
let _annHistory = [];          // 播报历史（用于展示所有播报内容）
let _audioCtx = null;          // 用于 Via/移动端 WebView 解锁音频自动播放
let _ttsSupported = ('speechSynthesis' in window);
let _ttsCurrentText = null;    // 当前正在朗读的文本（供静默失败重试判断）
let _nightAckFallback = null;  // 「闭眼」播报兜底确认定时器：即使 TTS 的 onend 不触发，也能在数秒内通知服务端推进
let _openStep = 0, _closedStep = 0, _openStage = null; // 夜间 UI 揭示进度：跟随「睁眼/闭眼」播报实际展示的步数，使界面与语音同步
let _openRoleName = '';        // 当前揭示到的角色名（来自播报 meta，步骤条显示用）
let _ttsCurrentItem = null;    // 当前正在朗读的播报条目（含 kind），用于「闭眼」播完时回执服务端
let _ttsCurrentStarted = false;// 当前 utterance 是否已真正开始（onstart）
let _ttsRetryCount = 0;        // 当前语句静默失败重试次数
let _ttsWatchdog = null;        // 单条朗读的超时看门狗（防 onend 不触发导致队列卡死）
let _ttsStartWatchdog = null;   // 检测 speak 是否真正启动的看门狗
let _ttsSeq = 0;                 // 朗读序列号：cancel() 触发的旧 onend 不会误推进队列
let _serverTtsState = null;      // 服务端 TTS 可用性：null=未知, true=可用, false=不可用（失败一次后不再重试）
let _serverTtsWarned = false;    // 服务端 TTS 不可用提示是否已弹过
let _serverAudioEl = null;       // 当前正在播放的服务端语音 <audio> 实例（供 stopAnnounce 停止）
let _localTtsFailed = false;     // 本地语音引擎是否确认不可用（用于提示文案）
// 注：现已统一走服务端内置 Piper TTS（自托管、免费、国内可部署），移除了百度 key 与浏览器直连微软兜底。

function _ttsLoadVoices() {
  try {
    const vs = speechSynthesis.getVoices() || [];
    if (vs.length) {
      _ttsVoices = vs;
      _ttsReady = true;
      // 优先中文（Microsoft Xiaoxiao / Google 中文等），否则让浏览器按 lang 自动选
      _ttsZhVoice = vs.find(v => /zh|cmn|Chinese/i.test(v.lang + '|' + v.name)) || null;
    }
  } catch (_) {}
}
if ('speechSynthesis' in window) {
  _ttsLoadVoices();
  speechSynthesis.onvoiceschanged = _ttsLoadVoices;
  // 切回标签页时自动恢复（浏览器切后台常暂停语音合成）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && 'speechSynthesis' in window) try { speechSynthesis.resume(); } catch (_) {}
  });
}

/** 通过一次真实可听 speak + AudioContext 解锁浏览器的语音自动播放策略（Chrome/Edge/Safari/Via 均需要） */
function unlockTTS() {
  if (_ttsUnlocked) return;
  // 对 Via 等 WebView，先解锁 AudioContext（与 SpeechSynthesis 解锁互补）
  if (!_audioCtx && window.AudioContext) _audioCtx = new AudioContext();
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  if (!('speechSynthesis' in window)) { _ttsUnlocked = true; _ttsDrain(); return; }
  try {
    _ttsLoadVoices();
    speechSynthesis.resume();
    // Via 等 WebView 对「静音/极小音量」utterance 会直接忽略而不触发 onend，
    // 导致解锁失败——这里用一次真实可听的极短发音完成手势绑定。
    const fire = () => {
      try {
        const dummy = new SpeechSynthesisUtterance('一');
        dummy.volume = 0.4; dummy.lang = 'zh-CN'; dummy.rate = 1.6;
        dummy.onend = () => { if (_ttsUnlocked) return; _ttsUnlocked = true; _ttsDrain(); };
        dummy.onerror = () => { if (_ttsUnlocked) return; _ttsUnlocked = true; _ttsDrain(); };
        speechSynthesis.speak(dummy);
      } catch (_) { if (!_ttsUnlocked) { _ttsUnlocked = true; _ttsDrain(); } }
    };
    fire();
    // Via 部分版本第一次 speak 会失败，220ms 后再试一次
    setTimeout(() => { if (!_ttsUnlocked) fire(); }, 220);
    // 兜底：1.5s 后若仍未解锁（无引擎或 WebView 不触发 onend），强制解锁并继续 drain，避免死锁
    setTimeout(() => {
      if (_ttsUnlocked) return;
      _ttsUnlocked = true;
      _ttsDrain();
      // 本地确实无可用语音引擎（如 via / 小米自带浏览器）：提示将走服务端 TTS 兜底，
      // 若服务端也不可用，_speakServer 会另行提示“仅文字显示”。
      if (!_ttsReady && !_ttsWarned) {
        _ttsWarned = true;
        _localTtsFailed = true;
        toast('本地无语音引擎，将使用服务端内置语音（已部署 Piper 即可听到）；若服务端不可用将仅显示文字。');
      }
    }, 1500);
  } catch (_) { _ttsUnlocked = true; _ttsDrain(); }
}
let _ttsWarned = false;
['click','pointerdown','touchstart','keydown','pointerup'].forEach(ev =>
  window.addEventListener(ev, unlockTTS, { once: true, passive: true })
);

/** 加入一条播报（上帝视角：所有角色的播报都依次完整朗读，不再因打断而跳过）
 * 文字展示在此处无条件先完成，保证「每条播报都有对应文字」，不依赖语音是否可用/已解锁。
 * @param {string} text
 */
function speakAnnounce(text, step, kind, stage, roleName) {
  if (!text) return;
  // 入队去重：与最近入队内容相同则跳过，避免重复播报（同一条播报被 state/speak 重复推送时）
  if (text === _ttsLastEnqueued) return;
  _ttsLastEnqueued = text;
  // 上帝视角：顺序入队（携带步数/类型/阶段/角色名，供音文同步时驱动夜间 UI 揭示），由 _ttsDrain 逐条完整朗读
  _ttsQueue.push({ text, step: step || 0, kind: kind || null, stage: stage || null, roleName: roleName || null });
  // 语音关闭：文字立即展示，且「闭眼」播报视为已展示直接回执服务端推进（无音频可听，靠节奏兜底）
  if (!ttsOn) {
    showAnnItem(text, step, kind, stage, roleName);
    if (kind === 'close') sendNightAck();
    return;
  }
  // 语音开启：文字先展示（不依赖音频是否就绪），保证「文字不晚于语音」；
  // 但「闭眼」回执(nightAck) 不放这里——交给音频真正结束（本地 onend 或服务端音频 ended）或 4.5s 兜底定时器，
  // 避免本地无引擎的浏览器(via/小米)在还没听到时就推进夜晚。
  showAnnItem(text, step, kind, stage, roleName);
  // 若尚未解锁，自动尝试一次解锁兜底：部分浏览器在用户未交互前会静默阻塞 speak。
  if (!_ttsUnlocked && !_ttsAutoUnlocking) {
    _ttsAutoUnlocking = true;
    unlockTTS();
  }
  if (!_ttsDraining) _ttsDrain();
}

/** 通知服务端：当前角色的「闭眼」播报已播完，可推进到下一位 / 进入白天（音文同步节奏） */
function sendNightAck() {
  if (STATE.token) api('/api/action', { token: STATE.token, type: 'nightAck', payload: {} }).catch(() => {});
}

/** 添加一条播报历史 */
function addAnnHistory(text) {
  if (!text) return;
  // 避免连续重复
  if (_annHistory.length && _annHistory[_annHistory.length - 1].text === text) return;
  _annHistory.push({ text, time: Date.now() });
  if (_annHistory.length > 40) _annHistory.shift();
  const el = $('#ann-history');
  if (el) {
    const item = document.createElement('div');
    item.className = 'ann-history-item';
    item.textContent = text;
    el.appendChild(item);
    el.scrollTop = el.scrollHeight;
  }
}

/** 清空播报历史（新游戏开始时调用） */
function clearAnnHistory() {
  _annHistory = [];
  const el = $('#ann-history');
  if (el) el.innerHTML = '';
}

/** 从队列取出一条并播放，播完自动取下一条（上帝视角：每条都完整读完）
 *  未解锁（用户尚未交互）时保留队列内容、不取出，等解锁后由 unlockTTS 触发继续；
 *  这样开场播报（游戏开始/天黑/狼人/爪牙…）会按到达顺序完整保留，解锁后依次读出。 */

/** 同步展示一条播报：更新播报员文字 + 追加到播报记录(#ann-history)。
 *  两者在同一时刻发生，保证“播报记录”与语音/文字进度一致，不会提前走完。
 *  同时：若该条是某角色的「睁眼/闭眼」播报（kind 有值），则同步推进夜间步骤指示与行动窗口，
 *  使界面（步骤条、可操作窗口）与语音/文字播报保持同一节奏，不再抢跑。 */
function showAnnItem(text, step, kind, stage, roleName) {
  _currentAnnText = text;
  const annEl = $('#ann-text'); if (annEl) annEl.textContent = text;
  addAnnHistory(text);
  // 夜间 UI 揭示：仅在「睁眼/闭眼」播报真正展示时才推进，跟随语音节奏
  if (kind && stage) {
    if (kind === 'stage') { _openStep = 0; _closedStep = 0; _openStage = stage; _openRoleName = ''; }
    else if (stage === _openStage) {
      if (kind === 'open') { _openStep = step; if (roleName) _openRoleName = roleName; }
      else if (kind === 'close') _closedStep = step;
    }
    if (STATE.data) renderGame(STATE.data);
  }
}

function _ttsDrain() {
  if (!_ttsQueue.length) { _ttsDraining = false; return; }
  if (_ttsDraining) return;            // 已有 drain 在跑，新入队的条目会被它一并处理
  if (!_ttsUnlocked) return;           // 未解锁：保留队列，等手势解锁后继续（不丢、不乱序）
  _ttsDraining = true;
  if (!_ttsReady) _ttsLoadVoices();
  const item = _ttsQueue.shift();
  _ttsCurrentItem = item;
  // 文字与语音同步：轮到本条朗读时才把播报区切换到本条文字
  showAnnItem(item.text, item.step, item.kind, item.stage, item.roleName);
  // 「闭眼」播报：无论 TTS 是否正常结束，都设一个兜底定时器确保通知服务端推进，
  // 避免个别浏览器/WebView 的 speechSynthesis.onend 不触发导致夜晚永久卡在「闭眼」。
  if (item.kind === 'close') {
    if (_nightAckFallback) clearTimeout(_nightAckFallback);
    _nightAckFallback = setTimeout(() => { sendNightAck(); }, 4500);
  }
  _speakOne(item.text);
}

/** 朗读单条；文字与播报区已由 _ttsDrain 同步切换，此处只负责「出声」。
 *  关键兜底：部分 WebView（如 Via / 小米浏览器）onstart/onend/onerror 不触发，会在读完第一条后卡死队列；
 *  这里按文本长度估算时长，超时强制推进，保证后续播报不被丢弃。
 *  另加「启动看门狗」：若 speak 后短时间内未触发 onstart，则静默重试 1 次，解决部分浏览器首次 speak 失败的问题。 */
function _ttsDoSpeak(text, attempt) {
  if (!('speechSynthesis' in window)) { _afterUtterance(); return; }
  try {
    const mySeq = ++_ttsSeq;   // 序列号：cancel() 触发的旧 onend 不会误推进队列
    speechSynthesis.resume();
    // 若上一条还在说（极少情况），先取消再说新的
    if (speechSynthesis.speaking) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 1.0; u.pitch = 1.0;
    // 只强制指定中文语音；找不到时让浏览器按 lang 自动选（避免 Via 等设备因默认英文语音而不出声）
    if (_ttsZhVoice) u.voice = _ttsZhVoice;
    let finished = false;
    _ttsCurrentStarted = false;
    const finish = () => {
      if (mySeq !== _ttsSeq) return;       // 已被新一条或 reset 取代，忽略
      if (finished) return; finished = true;
      clearTimeout(_ttsWatchdog);
      clearTimeout(_ttsStartWatchdog);
      _afterUtterance();
    };
    u.onerror = finish;
    u.onend = finish;
    u.onstart = () => { _ttsUnlocked = true; _ttsCurrentStarted = true; clearTimeout(_ttsStartWatchdog); };
    speechSynthesis.speak(u);
    // 兜底看门狗：若 onend 未触发（Via 已知问题），按文本长度估算时长后强制推进，避免队列卡死
    const est = Math.max(1600, text.length * 230 + 900);
    _ttsWatchdog = setTimeout(finish, est);
    // 启动看门狗：部分浏览器 speak 后没有 onstart，静默失败，重试一次
    _ttsStartWatchdog = setTimeout(() => {
      if (_ttsCurrentStarted) return;
      if (attempt < 1) { _ttsDoSpeak(text, attempt + 1); }
      else { finish(); }
    }, 900);
  } catch (e) {
    // speak 抛异常（常见于未解锁自动播放策略）：文字已展示，仅跳过本条语音继续后续
    console.warn('[TTS] 异常:', e && e.message || e);
    _afterUtterance();
  }
}
function _speakOne(text) {
  _ttsRetryCount = 0; _ttsCurrentText = text;
  // 本地语音引擎可用（有中文语音）→ 走浏览器内置 Web Speech；
  // 否则（Via / 小米自带浏览器等无引擎）→ 走服务端内置 Piper TTS，
  // 服务端失败则仅文字显示，绝不卡住队列。
  const localOk = _ttsSupported && _ttsVoices.length > 0;
  if (localOk) _ttsDoSpeak(text, 0);
  else _speakServer(text, () => {});
}

/** 服务端内置 Piper TTS：本地无语音引擎时（如 Via / 小米自带浏览器），从 /api/tts 拉取合成语音用 <audio> 播放。
 *  每条播报使用独立的 Audio 实例 + 一次性 done 守卫，避免旧监听叠加导致「文本领先语音」的串台问题；
 *  音频 ended（或 play 被拒/出错）→ 走与本地 onend 相同的 _afterUtterance 流程（含「闭眼」回执 nightAck）；
 *  若服务端 TTS 不可用，则标记失败仅文字显示，绝不卡住队列。 */
function _speakServer(text, fallback) {
  if (_serverTtsState === false) { _afterUtterance(); return; }
  const u = '/api/tts?text=' + encodeURIComponent(text);
  let done = false;
  const el = new Audio();
  el.preload = 'auto';
  _serverAudioEl = el;
  const finish = (ok) => {
    if (done) return; done = true;        // 一次性守卫：ended/error/play被拒 仅触发一次推进
    try { el.onended = el.onerror = null; el.removeAttribute('src'); el.load(); } catch (_) {}
    if (_serverAudioEl === el) _serverAudioEl = null;
    if (ok) { _serverTtsState = true; _afterUtterance(); return; }
    if (_serverTtsState === false) return;  // 此前已判定不可用，避免重复提示
    _serverTtsState = false;
    if (!_serverTtsWarned) { _serverTtsWarned = true; toast('服务端语音不可用，已改为文字显示。建议确认 Bonto 服务端已部署 Piper TTS。'); }
    _afterUtterance();
  };
  el.onended = () => finish(true);
  el.onerror = () => finish(false);
  el.src = u;
  const p = el.play();
  if (p && p.catch) p.catch(() => {
    // 自动播放被拒：重试一次本条，仍失败才回退文字，避免直接跳过导致文本与语音错位
    try { const p2 = el.play(); if (p2 && p2.catch) p2.catch(() => finish(false)); } catch (_) { finish(false); }
  });
}

/** 一条朗读结束（onend/onerror/看门狗）后推进到下一条 */
function _afterUtterance() {
  const finished = _ttsCurrentItem;   // 刚播完的条目（含 kind），用于判断是否为「闭眼」回执
  _ttsCurrentItem = null;
  _ttsDraining = false;
  // 当前播完的是某角色的「闭眼」播报 → 通知服务端推进下一位 / 进入白天（音文同步的关键）
  if (finished && finished.kind === 'close') { if (_nightAckFallback) { clearTimeout(_nightAckFallback); _nightAckFallback = null; } sendNightAck(); }
  setTimeout(_ttsDrain, 120);
}

/** 强制停止当前播报并清空队列（用户手动操作时保证音文同步） */
function stopAnnounce() {
  _ttsSeq++;                     // 作废在途的 onend/finish，避免误推进
  _ttsQueue = [];
  _ttsDraining = false;
  _ttsCurrentItem = null;
  _ttsCurrentText = null;
  _ttsCurrentStarted = false;
  _ttsRetryCount = 0;
  _ttsAutoUnlocking = false;
  clearTimeout(_ttsWatchdog);
  clearTimeout(_ttsStartWatchdog);
  if (_nightAckFallback) { clearTimeout(_nightAckFallback); _nightAckFallback = null; }
  if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch (_) {}
  if (_serverAudioEl) { try { _serverAudioEl.pause(); _serverAudioEl.removeAttribute('src'); _serverAudioEl.load(); } catch (_) {} _serverAudioEl = null; }
}

$('#btn-tts').onclick = () => {
  ttsOn = !ttsOn;
  $('#btn-tts').textContent = ttsOn ? '🔊' : '🔇';
  if (ttsOn && 'speechSynthesis' in window) {
    unlockTTS();                         // 切换开启本身就是一次用户手势，立即解锁
    toast('语音播报已开启');
  } else {
    if ('speechSynthesis' in window) { speechSynthesis.cancel(); _ttsQueue = []; _ttsDraining = false; }
    toast('语音播报已关闭');
  }
};

// --------------------------- 房间实时语音（WebRTC Mesh） ---------------------------
// 信令经服务器 SSE 转发（voice / signal / voice_invite 事件），音频流走浏览器 P2P，不经过服务器。
// 约定：座位号小的一方作为发起方（创建 offer），避免双方同时 offer 冲突。
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
let voiceOn = false;          // 本地麦克风是否已加入通话
let localStream = null;       // 本地麦克风流
let voicePeers = new Map();   // seat -> { pc, audio, pendingCandidates }
let voiceNightMuted = false;  // 夜晚/黄昏自动静音
let voiceLastSeats = [];      // 最近一次收到的通话成员列表，用于断线后重连
let voicePendingOffers = [];  // localStream 未就绪时暂存的 offer
let voiceInviteTimer = null;  // 邀请弹窗自动关闭计时器

function voiceSend(subtype, extra) {
  api('/api/action', { token: STATE.token, type: 'voice', payload: Object.assign({ subtype }, extra || {}) });
}

function voiceMakePeer(seat) {
  if (!window.RTCPeerConnection) return null;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const audio = document.createElement('audio');
  audio.autoplay = true; audio.playsInline = true; audio.muted = false;
  audio.dataset.peer = seat;
  document.body.appendChild(audio); // 必须挂到 DOM：移动端/部分浏览器对未挂载的音频元素不会出声
  const peer = { pc, audio, pendingCandidates: [] };
  if (localStream) localStream.getAudioTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => { if (e.candidate) voiceSend('signal', { to: seat, data: { candidate: e.candidate } }); };
  pc.ontrack = (e) => {
    let stream = (e.streams && e.streams[0]) || null;
    if (!stream) { stream = new MediaStream(); stream.addTrack(e.track); } // 兜底：某些浏览器 streams 为空，用裸 track 组装
    audio.srcObject = stream;
    audio.play().catch(() => {});
  };
  // 稳定性：ICE 失败时自动重启候选协商；连接彻底断开后尝试重连
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      try { pc.restartIce(); } catch (_) {}
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      if (voiceOn) {
        // 延迟重连：让两端都进入干净状态后再重新发起
        setTimeout(() => { voiceClosePeer(seat); onVoiceState(voiceLastSeats); }, 600);
      } else {
        voiceClosePeer(seat);
      }
    }
  };
  return peer;
}

// 本地（座位号更小者）主动发起连接
async function voiceInitiate(seat) {
  if (voicePeers.has(seat)) return;
  const peer = voiceMakePeer(seat);
  if (!peer) { toast('当前浏览器不支持 WebRTC 实时语音'); return; }
  voicePeers.set(seat, peer);
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    voiceSend('signal', { to: seat, data: { desc: peer.pc.localDescription } });
  } catch (_) { voiceClosePeer(seat); }
}

async function onVoiceSignal(from, data) {
  if (!data) return;
  let peer = voicePeers.get(from);
  if (data.desc) {
    if (!peer) {
      if (data.desc.type !== 'offer') return; // 无连接时的 answer 忽略
      // 本地麦克风尚未就绪（getUserMedia 进行中）：暂存 offer，待就绪后处理，
      // 避免创建“无音轨”的 peer 导致对端收不到本端声音（单向无声）。
      if (!localStream) { voicePendingOffers.push({ from, data }); return; }
      peer = voiceMakePeer(from);
      if (!peer) return;
      voicePeers.set(from, peer);
    }
    try {
      await peer.pc.setRemoteDescription(data.desc);
      if (data.desc.type === 'offer') {
        const ans = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(ans);
        voiceSend('signal', { to: from, data: { desc: peer.pc.localDescription } });
      }
      for (const c of peer.pendingCandidates) { try { await peer.pc.addIceCandidate(c); } catch (_) {} }
      peer.pendingCandidates = [];
    } catch (_) {}
  } else if (data.candidate) {
    if (!peer) return;
    if (peer.pc.remoteDescription) { try { await peer.pc.addIceCandidate(data.candidate); } catch (_) {} }
    else peer.pendingCandidates.push(data.candidate);
  }
}
function flushVoicePendingOffers() {
  const list = voicePendingOffers; voicePendingOffers = [];
  for (const o of list) onVoiceSignal(o.from, o.data);
}

function voiceClosePeer(seat) {
  const peer = voicePeers.get(seat);
  if (peer) {
    try { peer.pc.close(); } catch (_) {}
    try { peer.audio.srcObject = null; peer.audio.remove(); } catch (_) {}
    voicePeers.delete(seat);
  }
}

function voiceTeardown() {
  for (const seat of [...voicePeers.keys()]) voiceClosePeer(seat);
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  voiceOn = false; voiceNightMuted = false;
  voiceLastSeats = [];
  hideVoiceInvite();
  renderVoice();
}

function onVoiceState(seats) {
  voiceLastSeats = seats || [];
  const mySeat = STATE.seat;
  const other = voiceLastSeats.filter(s => s !== mySeat);
  for (const seat of [...voicePeers.keys()]) {
    if (!other.includes(seat)) voiceClosePeer(seat);
  }
  renderVoice(other);
  if (!voiceOn) return;
  for (const seat of other) {
    if (!voicePeers.has(seat) && mySeat < seat) voiceInitiate(seat);
  }
}

// 夜晚/黄昏自动静音，白天/投票/结算恢复
function voiceApplyPhase(phase) {
  const isNight = phase === 'dusk' || phase === 'night';
  voiceNightMuted = isNight;
  if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !isNight; });
  renderVoice();
}

// 语音通话邀请弹窗
function showVoiceInvite(name) {
  const modal = $('#voice-invite-modal');
  const text = $('#voice-invite-text');
  if (!modal || !text) return;
  text.textContent = `🎙️ ${escapeHtml(name || '有人')} 邀请你加入语音通话`;
  modal.classList.remove('hidden');
  clearTimeout(voiceInviteTimer);
  voiceInviteTimer = setTimeout(hideVoiceInvite, 15000); // 15 秒未响应自动收起
}
function hideVoiceInvite() {
  const modal = $('#voice-invite-modal');
  if (modal) modal.classList.add('hidden');
  clearTimeout(voiceInviteTimer); voiceInviteTimer = null;
}

async function toggleVoice() {
  if (voiceOn) {
    voiceSend('leave');
    voiceTeardown();
    toast('已退出语音通话');
    return;
  }
  if (!window.RTCPeerConnection) { toast('当前浏览器不支持 WebRTC，请换用 Chrome / Edge'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('无法访问麦克风（需 HTTPS 或 localhost）'); return; }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    localStream = null;
    toast('麦克风权限被拒绝：' + (err && (err.name || err.message) || '无法访问'));
    return;
  }
  // 麦克风就绪后，处理 getUserMedia 期间可能暂存的 offer（避免单向无声）
  flushVoicePendingOffers();
  voiceOn = true;
  renderVoice();
  voiceSend('join');
  // 一方发起后，向房间内其他玩家弹出加入邀请
  voiceSend('invite');
  toast('已加入语音通话，已向其他玩家发送邀请');
}

function renderVoice(members) {
  const list = members !== undefined ? members : [...voicePeers.keys()].filter(s => s !== STATE.seat);
  $$('.voice-toggle').forEach(b => {
    b.classList.toggle('on', voiceOn);
    b.textContent = voiceOn ? '🔴' : '🎙️';
    b.title = voiceOn ? '关闭实时语音' : '开启实时语音';
  });
  const bar = $('#voice-bar');
  if (!bar) return;
  if (!voiceOn) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const players = (STATE.data && STATE.data.players) || [];
  const names = players.filter(p => list.includes(p.seat)).map(p => p.name);
  let txt = '🎙️ 通话中：你';
  if (names.length) txt += '、' + names.join('、');
  else txt += '（等待他人加入）';
  if (voiceNightMuted) txt += ' · 🔇 夜晚已静音';
  $('#voice-bar-status').textContent = txt;
}
$$('.voice-toggle').forEach(b => b.onclick = toggleVoice);
$('#voice-invite-accept').onclick = () => { hideVoiceInvite(); toggleVoice(); };
$('#voice-invite-decline').onclick = () => { hideVoiceInvite(); };

// --------------------------- 角色图鉴 ---------------------------
const CODEX_TEAMS = [
  { key: 'wolf', name: '狼队', cls: 'team-wolf' },
  { key: 'vampire', name: '吸血鬼队', cls: 'team-vampire' },
  { key: 'village', name: '好人阵营', cls: 'team-village' },
  { key: 'tanner', name: '皮匠（独立）', cls: 'team-tanner' },
  { key: 'assassin', name: '刺客（独立）', cls: 'team-assassin' },
];
const PHASE_BADGE = {
  night: '🌙 夜晚', dusk: '🌆 黄昏', day: '☀️ 白天', none: '— 被动',
};
let codexFilter = 'all';
function renderCodex() {
  const lib = window.ROLE_LIB || [];
  const tabs = $('#codex-tabs');
  const filters = [{ key: 'all', name: '全部', cls: '' }].concat(CODEX_TEAMS.map(t => ({ key: t.key, name: t.name, cls: t.cls })));
  tabs.innerHTML = filters.map(f => `<button class="codex-tab ${f.cls} ${codexFilter === f.key ? 'active' : ''}" data-f="${f.key}">${f.name}</button>`).join('');
  tabs.querySelectorAll('.codex-tab').forEach(b => b.onclick = () => { codexFilter = b.dataset.f; renderCodex(); });
  const list = (codexFilter === 'all' ? lib : lib.filter(r => r.team === codexFilter));
  const body = $('#codex-body');
  body.innerHTML = list.map(r => {
    const tm = CODEX_TEAMS.find(t => t.key === r.team) || { cls: '' };
    const wake = r.wake ? '需唤醒' : '不唤醒';
    const iconUrl = assetUrl(`assets/role-icons/${r.key}/icon.png`);
    return `<div class="codex-card ${tm.cls}">
      <div class="codex-card-head">
        <img class="codex-icon" src="${iconUrl}" alt="${escapeHtml(r.name)}" loading="lazy" onerror="this.style.display='none'" />
        <span class="codex-name">${r.name}</span>
        <span class="codex-badges">
          <span class="codex-badge phase">${PHASE_BADGE[r.phase] || ''}</span>
          <span class="codex-badge wake">${wake}</span>
        </span>
      </div>
      <div class="codex-ability"><b>能力</b> ${escapeHtml(r.ability)}</div>
      <div class="codex-goal"><b>胜利目标</b> ${escapeHtml(r.goal)}</div>
      <div class="codex-tip"><b>玩法提示</b> ${escapeHtml(r.tip)}</div>
    </div>`;
  }).join('');
  $('#codex-count').textContent = lib.length;
}
function openCodex() { renderCodex(); $('#codex').classList.remove('hidden'); }
function closeCodex() { $('#codex').classList.add('hidden'); }
$$('.codex-open').forEach(b => b.onclick = openCodex);
$('#codex-close').onclick = closeCodex;
$('#codex').addEventListener('click', (e) => { if (e.target.id === 'codex') closeCodex(); });

// 带 ?code= 链接直接进入加入页
(() => {
  const u = new URL(location.href);
  if (u.searchParams.get('code')) $('#home-code').value = u.searchParams.get('code');
  showScreen('home');
})();
