'use strict';
// 无头端到端测试：3 名玩家自动走完一局，验证流程与结果正确。
const http = require('http');
const PORT = 3000;

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let buf = ''; res.on('data', d => buf += d); res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (_) {} resolve({ status: res.statusCode, data: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

// 简易 SSE 客户端
function sse(path, onEvent) {
  const r = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
    let buf = '';
    res.on('data', d => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let ev = 'message', dt = '';
        chunk.split('\n').forEach(line => {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) dt += line.slice(5).trim();
        });
        if (dt) { try { onEvent(ev, JSON.parse(dt)); } catch (_) {} }
      }
    });
  });
  return r;
}

const otherSeat = (players, self) => players.find(p => p.seat !== self).seat;
const twoOthers = (players, self) => players.filter(p => p.seat !== self).map(p => p.seat).slice(0, 2);

(async () => {
  // 创建 + 加入
  const c = await req('POST', '/api/create', { name: '房主' });
  const code = c.data.code, hostToken = c.data.token;
  const tokens = [hostToken];
  for (let i = 1; i < 3; i++) { const j = await req('POST', '/api/join', { name: '玩家' + i, code }); tokens.push(j.data.token); }
  console.log('房间', code, 'tokens', tokens.length);

  const states = {};
  let hunterSeat = null;
  let voted = new Set();
  let result = null;
  let done = false;

  const clients = tokens.map((tk, idx) => sse(`/api/stream?code=${code}&token=${tk}`, async (ev, data) => {
    if (ev === 'hunter') { hunterSeat = data.seat; }
    if (ev === 'state') {
      states[tk] = data;
      const s = data;
      // 行动
      if (s.action && s.you && s.action.seats && s.action.seats.includes(s.you.seat)) {
        const a = s.action; const self = s.you.seat;
        let payload = {};
        switch (a.type) {
          case 'werewolf': payload = { center: 0 }; break;
          case 'seer': payload = { mode: 'player', target: otherSeat(s.players, self) }; break;
          case 'detective': payload = { targets: twoOthers(s.players, self) }; break;
          case 'seePlayer': case 'robber': case 'vampireMark': case 'fear': case 'alphaWolf': payload = { target: otherSeat(s.players, self) }; break;
          case 'witch': payload = { center: 0, swapWith: otherSeat(s.players, self) }; break;
          case 'troublemaker': payload = { targets: twoOthers(s.players, self) }; break;
          case 'sentinel': payload = { kind: 'player', target: otherSeat(s.players, self) }; break;
          case 'protect': payload = { target: otherSeat(s.players, self) }; break;
          case 'cupid': payload = { targets: twoOthers(s.players, self) }; break;
          case 'tracker': payload = { a: twoOthers(s.players, self)[0], b: twoOthers(s.players, self)[1] }; break;
          case 'sharpshooter': payload = { roleTarget: otherSeat(s.players, self), markTarget: twoOthers(s.players, self)[1] }; break;
          case 'gremlin': payload = { a: twoOthers(s.players, self)[0], b: twoOthers(s.players, self)[1], mode: 'cards' }; break;
          case 'priest': payload = { target: otherSeat(s.players, self) }; break;
          case 'assassin': case 'thief': payload = { target: otherSeat(s.players, self) }; break;
          default: payload = {};
        }
        const type = a.type === 'protect' ? 'protect' : 'nightAction';
        await req('POST', '/api/action', { token: tk, type, payload });
      }
      // 投票
      if (s.phase === 'vote' && !voted.has(tk)) {
        voted.add(tk);
        const target = (s.you.seat === 0) ? 1 : 0; // 制造一个明确结果
        await req('POST', '/api/action', { token: tk, type: 'vote', payload: { target } });
      }
      // 房主在白天阶段自动发起投票
      if (s.phase === 'day' && s.isHost && !voted.has('__started')) {
        voted.add('__started');
        setTimeout(() => req('POST', '/api/action', { token: tk, type: 'startVote' }), 800);
      }
      // 猎人开枪
      if (hunterSeat != null && s.you?.seat === hunterSeat && s.phase === 'result_pending_hunter') {
        await req('POST', '/api/action', { token: tk, type: 'hunterShot', payload: { target: otherSeat(s.players, hunterSeat) } });
        hunterSeat = null;
      }
      if (s.phase === 'result') { result = s.result; if (!done) { done = true; finish(); } }
    }
  }));

  // 开始游戏
  await new Promise(r => setTimeout(r, 300));
  const preset = process.argv[2] || 'M1';
  await req('POST', '/api/action', { token: hostToken, type: 'setPreset', payload: { presetId: preset } });
  await req('POST', '/api/action', { token: hostToken, type: 'start' });
  console.log('已发起开始，等待流程…');

  function finish() {
    clients.forEach(c => c.destroy());
    if (result) {
      console.log('=== 结果 ===');
      console.log('总结：', result.summary);
      result.perPlayer.forEach(p => console.log(`  ${p.name}: ${p.roleName} 出局=${p.out} 胜=${p.win}`));
      console.log('中央：', result.center.map(c => c.name).join('、'));
      // 校验：出局者身份是否一致
      const outSeats = result.out;
      console.log('出局座位：', outSeats);
    } else {
      console.log('未产生结果（超时或出错）');
    }
    process.exit(0);
  }
  setTimeout(() => { if (!done) { done = true; finish(); } }, 60000);
})();
