'use strict';
// 单人 + 机器人 全流程联调测试
// 启动真实 server.js，通过 HTTP/SSE 驱动，验证机器人能自动完成夜晚行动与投票，人类对局可走通到结算。
const { spawn } = require('child_process');
const PORT = 4411;
const BASE = `http://127.0.0.1:${PORT}`;
const NODE = 'C:\\Users\\雾梓\\.workbuddy\\binaries\\node\\versions\\22.12.0\\node.exe';

const server = spawn(NODE, ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT), NODE_OPTIONS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', d => process.env.DEBUG && process.stdout.write('[srv] ' + d));
server.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, data: j };
}

// 客户端侧替人类自动构造一个合法提交（与机器人逻辑同构，仅用于测试驱动）
function humanPayload(a) {
  const others = a.players.filter(p => !p.isSelf).map(p => p.seat);
  const pick = () => others[Math.floor(Math.random() * others.length)];
  const two = () => { const x = pick(); let y; do { y = pick(); } while (y === x); return [x, y]; };
  switch (a.type) {
    case 'werewolf': return { center: 0 };
    case 'seer': return { mode: 'player', target: pick() };
    case 'detective': return { targets: [pick()] };
    case 'wolfSeer': case 'doppelganger': return { target: pick() };
    case 'robber': return { target: pick() };
    case 'witch': return { center: a.centers && a.centers[0] ? a.centers[0].idx : null, swapWith: null };
    case 'troublemaker': { const [x, y] = two(); return { a: x, b: y }; }
    case 'sentinel': return a.centers && a.centers[0] ? { kind: 'center', idx: a.centers[0].idx } : { kind: 'player', target: pick() };
    case 'alphaWolf': return { idx: a.centers[0].idx, target: pick() };
    case 'vampire': case 'fear': case 'assassin': case 'thief': return { target: pick() };
    case 'cupid': { const [x, y] = two(); return { targets: [x, y] }; }
    case 'priest': return { target: Math.random() < 0.5 ? pick() : null };
    case 'sharpshooter': return { roleTarget: pick(), markTarget: pick() };
    case 'gremlin': { const [x, y] = two(); return { a: x, b: y, mode: Math.random() < 0.5 ? 'marks' : 'cards' }; }
    case 'tracker': { const [x, y] = two(); return { a: x, b: y }; }
    case 'protect': return { target: pick() };
    default: return {};
  }
}

async function run() {
  await sleep(600);
  // 1) 建房（capacity=5）
  const create = await api('/api/create', { name: '测试员', capacity: 5 });
  if (!create.data || create.data.error) throw new Error('create failed: ' + JSON.stringify(create.data));
  const { code, token } = create.data;
  console.log('房间:', code, 'token:', token.slice(0, 8));

  // 2) 加满机器人（补齐到 5 人）
  const fill = await api('/api/action', { token, type: 'addBot', payload: { fill: true } });
  if (!fill.data || fill.data.error) throw new Error('addBot fill failed: ' + JSON.stringify(fill.data));
  console.log('已加机器人:', fill.data.added);

  // 3) 边界：游戏中加机器人应被拒（先开始后再测，放在最后）
  // 4) 开始游戏
  const start = await api('/api/action', { token, type: 'start' });
  if (!start.data || start.data.error) throw new Error('start failed: ' + JSON.stringify(start.data));
  console.log('游戏开始 ✔');

  // 5) 打开 SSE，驱动全流程
  const resp = await fetch(`${BASE}/api/stream?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
  let buf = '';
  let voted = false, startedVote = false, hunterShotDone = false;
  let lastPhase = '';
  let phaseCount = {};
  let resultSummary = null;

  const onState = async (s) => {
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      phaseCount[s.phase] = (phaseCount[s.phase] || 0) + 1;
      console.log('  → 阶段:', s.phase, s.nightInfo ? `(第${s.nightInfo.current}/${s.nightInfo.total}步 ${s.nightInfo.roleName || ''})` : '');
    }
    // 人类夜晚行动
    if (s.action && s.action.seats && s.action.seats.includes(s.you && s.you.seat)) {
      const payload = humanPayload(s.action);
      await api('/api/action', { token, type: s.action.type === 'protect' ? 'protect' : 'nightAction', payload });
    }
    // 白天 -> 开始投票
    if (s.phase === 'day' && s.isHost && !startedVote) {
      startedVote = true;
      await api('/api/action', { token, type: 'startVote' });
    }
    // 投票阶段 -> 人类投一次
    if (s.phase === 'vote' && !voted) {
      voted = true;
      const others = s.players.filter(p => !p.isYou).map(p => p.seat);
      const t = others[Math.floor(Math.random() * others.length)];
      await api('/api/action', { token, type: 'vote', payload: { target: t } });
    }
    // 猎人开枪
    if (s.phase === 'result_pending_hunter' && s.hunterShoot && !hunterShotDone) {
      hunterShotDone = true;
      const others = s.players.filter(p => !p.isYou).map(p => p.seat);
      const t = others[Math.floor(Math.random() * others.length)];
      await api('/api/action', { token, type: 'hunterShot', payload: { target: t } });
    }
    // 结算
    if (s.phase === 'result' && s.result) {
      resultSummary = s.result.summary;
    }
  };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  while (!done) {
    const { value, done: d } = await reader.read();
    if (d) { done = true; break; }
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const m = /event:\s*(\S+)/.exec(raw); const dm = /data:\s*(.+)/.exec(raw);
      if (m && dm && m[1] === 'speak') {
        // 夜晚推进由客户端回执驱动（与真实客户端一致）：收到「闭眼」播报后回 nightAck。
        // 服务端现在只要有客户端在线就一直续等回执（不再 8s 抢跑），脚本客户端不回执会拖到硬上限，非常慢。
        try {
          const sp = JSON.parse(dm[1]);
          if (sp.kind === 'close') api('/api/action', { token, type: 'nightAck', payload: { seq: sp.seq } }).catch(() => {});
        } catch (_) {}
      }
      if (m && dm && m[1] === 'state') {
        try { const s = JSON.parse(dm[1]); await onState(s); } catch (_) {}
        if (resultSummary) { done = true; break; }
      }
    }
  }

  // 等待结算或超时
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    if (resultSummary) break;
    await sleep(200);
  }

  if (!resultSummary) {
    console.error('❌ 超时：未走到结算。阶段轨迹=', JSON.stringify(phaseCount));
    throw new Error('timeout-no-result');
  }
  console.log('🎉 结算完成:', resultSummary);
  console.log('阶段轨迹:', JSON.stringify(phaseCount));

  // 6) 再来一局后，验证游戏中无法加机器人
  await api('/api/action', { token, type: 'restart' });
  await sleep(200);
  const badAdd = await api('/api/action', { token, type: 'addBot', payload: { count: 1 } });
  console.log('游戏中加机器人应被拒:', badAdd.data && badAdd.data.error ? '✔' : '❌ 未拦截');

  server.kill();
  process.exit(0);
}

run().catch(e => { console.error('测试失败:', e.message); try { server.kill(); } catch (_) {} process.exit(1); });
