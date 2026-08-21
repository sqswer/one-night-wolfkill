'use strict';
// 一夜狼人杀 · 在线版 前端逻辑

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

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
  alpha_wolf: '将一张中央底牌换给一名玩家，把该底牌伪装成狼。',
  wolf_seer: '查看一名玩家的真实身份。',
  mason: '与另一名守夜人互认，确定你的同伴。',
  seer: '查看一名玩家，或查看两张中央底牌的身份。',
  apprentice_seer: '查看一张中央底牌的身份。',
  paranormal_detective: '最多查看 2 名玩家的身份。',
  robber: '与一名玩家交换身份，并查看换来的新身份。',
  witch: '查看一张中央底牌，并可选与一名玩家交换身份。',
  troublemaker: '悄悄交换另外两名玩家的身份（自己不变）。',
  village_idiot: '轮转所有其他玩家的身份牌（自己不变）。',
  drunk: '被迫与一张中央底牌随机交换身份。',
  insomniac: '天亮前查看自己最终的身份。',
  sentinel: '选择一张牌（玩家或中央）上盾，本夜不可被查/换。',
  doppelganger: '查看一名玩家的身份（简化版）。',
  revealer: '揭示一名玩家的身份（信息类）。',
  bodyguard: '投票前选择保护一人，其本票不被放逐。',
  hunter: '被放逐时可开枪带走一名玩家。',
  villager: '普通村民，没有特殊能力。',
  tanner: '只想被放逐；若你被放逐且无狼死亡，你独赢。',
  prince: '若你获得最高票，按规则顺延，由次高票者被放逐。',
  cursed: '若被狼人标记则变成狼。',
  vampire: '黄昏阶段把吸血鬼标记放到一名玩家面前，其变为吸血鬼。',
  count: '黄昏阶段对一名玩家施加恐惧封锁。',
  renfield: '知道谁是吸血鬼。',
  priest: '黄昏给自己放清白标记，可再净化一名玩家的标记。',
  sharpshooter: '夜晚查一名玩家身份，并查另一名玩家的状态标记。',
  thief: '夜晚将一名玩家的状态标记换到自己面前并查看。',
  gremlin: '夜晚交换两名玩家的角色牌，或交换两名玩家的状态标记。',
  cupid: '黄昏给两名玩家放爱之标记，令二人同生共死。',
  assassin: '黄昏给一名玩家放刺杀标记；该玩家死亡时你获胜。',
  tracker: '夜晚查看任意两名玩家身份牌是否本夜被对调。',
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
  es.addEventListener('speak', (e) => { speakAnnounce(JSON.parse(e.data).text); });
  es.addEventListener('speech', (e) => { addSpeech(JSON.parse(e.data)); });
  es.addEventListener('hunter', (e) => { const d = JSON.parse(e.data); toast(`猎人 ${d.name} 被放逐，可开枪`); });
}

// --------------------------- 状态渲染 ---------------------------
const PHASE_NAME = {
  lobby: '准备中', dusk: '黄昏阶段', night: '夜晚', day: '白天发言',
  vote: '投票阶段', result: '游戏结束', result_pending_hunter: '猎人开枪',
};

function onState(s) {
  STATE.data = s;
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

// 自选角色复选网格（只构建一次）
let customRoles = new Set();
function buildRoleCheckGrid() {
  const grid = $('#role-check-grid');
  if (grid.dataset.built) return;
  const lib = window.ROLE_LIB || [];
  grid.innerHTML = lib.map(r => `<label class="role-check"><input type="checkbox" value="${r.key}" /> ${escapeHtml(r.name)}</label>`).join('') + '<div id="custom-count" class="custom-count"></div>';
  grid.dataset.built = '1';
  grid.querySelectorAll('input').forEach(cb => cb.onchange = () => {
    if (cb.checked) customRoles.add(cb.value); else customRoles.delete(cb.value);
    updateCustomCount();
  });
}
function updateCustomCount() {
  const el = $('#custom-count');
  if (!el) return;
  const cap = STATE.data && STATE.data.capacity || 5;
  const need = cap + 3;
  const ok = customRoles.size === need;
  el.textContent = `已选 ${customRoles.size} / 需要 ${need} 张`;
  el.className = 'custom-count' + (ok ? ' ok' : (customRoles.size > need ? ' over' : ''));
}

// 准备按钮高亮状态
function updateReadyBtn(ready) {
  const b = $('#btn-ready');
  if (ready) { b.textContent = '已准备 ✓'; b.classList.add('ready-on'); }
  else { b.textContent = '准备'; b.classList.remove('ready-on'); }
}

// 离开房间 → 回到首页
function leaveRoom() {
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
  const cap = STATE.data && STATE.data.capacity || 5;
  const need = cap + 3;
  if (customRoles.size < 3) return toast('至少勾选 3 个角色');
  api('/api/action', { token: STATE.token, type: 'setCustom', payload: { roles: [...customRoles] } }).then(r => {
    if (r.data && r.data.warning) toast(r.data.warning);
    else toast(`已应用自选阵容（${customRoles.size} 张）`);
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
    $('#stepper-label').innerHTML = `<span class="ico">${ico}</span> ${stageName} · 第 ${info.current} / ${info.total} 步${info.roleName ? ' · <b style="color:var(--text)">' + info.roleName + '</b>' : ''}`;
    $('#stepper-fill').style.width = (info.total ? (info.current / info.total * 100) : 0) + '%';
  } else st.classList.add('hidden');

  // 身份卡
  const rc = $('#role-card');
  if (s.you && s.you.role) {
    const tm = TEAM_META[s.you.role.team] || { name: s.you.role.team, cls: '' };
    rc.className = 'role-card ' + tm.cls;
    rc.classList.remove('hidden');
    $('#role-team').textContent = '阵营：' + tm.name;
    const iconEl = $('#role-icon');
    if (iconEl) { iconEl.src = `assets/role-icons/${s.you.role.key}/icon.png`; iconEl.alt = s.you.role.name; }
    $('#role-name').textContent = s.you.role.name;
    const rl = (window.ROLE_MAP && window.ROLE_MAP[s.you.role.key]) || null;
    $('#role-desc').textContent = rl ? rl.ability : (ROLE_DESC[s.you.role.key] || '');
    $('#role-seen').textContent = (s.you.seen && s.you.seen.length) ? s.you.seen.join('\n') : '';
    const mark = $('#role-mark');
    if (s.you.mark) { mark.textContent = '你的标记：' + s.you.mark; mark.classList.remove('hidden'); }
    else mark.classList.add('hidden');
  } else rc.classList.add('hidden');

  // 播报
  $('#ann-text').textContent = s.announce || '';

  // 记录
  const log = $('#log'); log.innerHTML = '';
  s.log.slice(-14).forEach(l => { const d = document.createElement('div'); d.textContent = l; log.appendChild(d); });
  log.scrollTop = log.scrollHeight;

  // 各阶段面板
  renderAction(s);
  $('#day-box').classList.toggle('hidden', s.phase !== 'day');
  renderVote(s);
  renderHunter(s);
  $('#pending-box').classList.toggle('hidden', s.phase !== 'result_pending_hunter' || !!s.hunterShoot);
  renderResult(s);

  // 房主：开始投票
  $('#btn-start-vote').classList.toggle('hidden', !(s.isHost && s.phase === 'day'));
}

// --------------------------- 行动提示 ---------------------------
function renderAction(s) {
  const box = $('#action-box');
  if (!s.action) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  const a = s.action;
  actionSel = {};
  let html = `<div class="a-role">${a.roleName} · 你的行动</div><div class="a-text">${a.text}</div>`;
  if (a.type === 'seer') {
    html += `<div class="row-btns"><button class="btn btn-ghost btn-sm" data-mode="player">查玩家</button><button class="btn btn-ghost btn-sm" data-mode="center">查中央</button></div>`;
    html += `<div class="choice-grid" id="a-grid"></div><div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认</button></div>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { actionSel = { mode: 'player' }; if (b.dataset.mode === 'center') actionSel.mode = 'center'; box.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); renderSeerChoices(a); });
    renderSeerChoices(a);
  } else if (a.type === 'detective' || a.type === 'troublemaker' || a.type === 'cupid' || a.type === 'tracker') {
    const max = (a.type === 'cupid' || a.type === 'tracker' || a.type === 'troublemaker') ? 2 : 2;
    html += `<div class="choice-grid" id="a-grid"></div><div class="row-btns"><button class="btn btn-primary" id="a-confirm">确认（选 2 人）</button></div>`;
    box.innerHTML = html; renderMultiPlayer(a, max);
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
  } else if (['robber','seePlayer','vampireMark','fear','alphaWolf','sentinel','werewolf','shield','protect','assassin','thief'].includes(a.type)) {
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
    grid.innerHTML = a.centers.map(c => `<div class="choice center" data-center="${c.idx}">中央 ${c.idx + 1}${c.locked ? '🔒' : ''}</div>`).join('');
    grid.querySelectorAll('.choice').forEach(el => el.onclick = () => { actionSel.centers = [Number(el.dataset.center)]; grid.querySelectorAll('.choice').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); });
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
  let payload = {};
  if (a.type === 'seer') payload = actionSel;
  else if (a.type === 'detective' || a.type === 'troublemaker') payload = { targets: actionSel.targets || [] };
  else if (a.type === 'cupid') payload = { targets: actionSel.targets || [] };
  else if (a.type === 'tracker') payload = { a: (actionSel.targets || [])[0], b: (actionSel.targets || [])[1] };
  else if (a.type === 'witch') payload = { center: actionSel.center ?? null, swapWith: actionSel.swapWith ?? null };
  else if (a.type === 'sharpshooter') payload = { roleTarget: actionSel.roleTarget ?? null, markTarget: actionSel.markTarget ?? null };
  else if (a.type === 'gremlin') payload = { a: (actionSel.targets || [])[0], b: (actionSel.targets || [])[1], mode: actionSel.mode || 'marks' };
  else if (a.type === 'priest') payload = { target: actionSel.target ?? null };
  else if (a.type === 'robber' || a.type === 'seePlayer' || a.type === 'vampireMark' || a.type === 'fear' || a.type === 'alphaWolf' || a.type === 'assassin' || a.type === 'thief') payload = { target: actionSel.target };
  else if (a.type === 'sentinel' || a.type === 'shield') payload = actionSel.center != null ? { kind: 'center', idx: actionSel.center } : { kind: 'player', target: actionSel.target };
  else if (a.type === 'werewolf') payload = { center: actionSel.center ?? 0 };
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
  $('#vote-status').textContent = `已投 ${s.votes?.cast || 0} / ${s.players.length}`;
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

// --------------------------- AI 播报员（TTS） ---------------------------
function speakAnnounce(text) {
  if (!ttsOn || !text) return;
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 1.0; u.pitch = 1.0;
    const v = pickZhVoice(); if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (_) {}
}
function pickZhVoice() {
  const vs = speechSynthesis.getVoices();
  return vs.find(v => /zh|cmn|Chinese/i.test(v.lang + v.name)) || null;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {};
$('#btn-tts').onclick = () => {
  ttsOn = !ttsOn;
  $('#btn-tts').textContent = ttsOn ? '🔊' : '🔇';
  if (!ttsOn && 'speechSynthesis' in window) speechSynthesis.cancel();
  toast(ttsOn ? '语音播报已开启' : '语音播报已关闭');
};

// --------------------------- 角色图鉴 ---------------------------
const CODEX_TEAMS = [
  { key: 'wolf', name: '狼队', cls: 'team-wolf' },
  { key: 'vampire', name: '吸血鬼队', cls: 'team-vampire' },
  { key: 'tanner', name: '皮匠（独立）', cls: 'team-tanner' },
  { key: 'assassin', name: '刺客（独立）', cls: 'team-assassin' },
  { key: 'village', name: '好人阵营', cls: 'team-village' },
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
    const iconUrl = `assets/role-icons/${r.key}/icon.png`;
    return `<div class="codex-card ${tm.cls}">
      <div class="codex-card-head">
        <img class="codex-icon" src="${iconUrl}" alt="${escapeHtml(r.name)}" onerror="this.style.display='none'" />
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
