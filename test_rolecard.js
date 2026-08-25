'use strict';
// 定向测试：验证白天角色卡显示【初始身份】，且失眠者有 finalRole 小字。
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
function sse(path, onEvent) {
  const r = http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
    let buf = '';
    res.on('data', d => { buf += d.toString(); let idx; while ((idx = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2); let ev = 'message', dt = ''; chunk.split('\n').forEach(l => { if (l.startsWith('event:')) ev = l.slice(6).trim(); else if (l.startsWith('data:')) dt += l.slice(5).trim(); }); if (dt) { try { onEvent(ev, JSON.parse(dt)); } catch (_) {} } } });
  });
  return r;
}
const otherSeat = (players, self) => players.find(p => p.seat !== self).seat;
const twoOthers = (players, self) => players.filter(p => p.seat !== self).map(p => p.seat).slice(0, 2);

(async () => {
  const c = await req('POST', '/api/create', { name: '房主' });
  const code = c.data.code, hostToken = c.data.token;
  const tokens = [hostToken];
  for (let i = 1; i < 3; i++) { const j = await req('POST', '/api/join', { name: '玩家' + i, code }); tokens.push(j.data.token); }

  const initialByName = {};   // token -> 初始身份名（来自私有信息"游戏开始时…"）
  const dayCard = {};         // token -> 白天角色卡名
  const finalRole = {};       // token -> 失眠者 finalRole 名
  let voted = new Set(); let done = false; let result = null;

  const clients = tokens.map((tk) => sse(`/api/stream?code=${code}&token=${tk}`, async (ev, data) => {
    if (ev === 'private') { const m = data.text.match(/游戏开始时，你的身份是【(.+?)】/); if (m) initialByName[tk] = m[1]; }
    if (ev === 'state') {
      const s = data;
      // 行动
      if (s.action && s.you && s.action.seats && s.action.seats.includes(s.you.seat)) {
        const a = s.action; const self = s.you.seat; let payload = {};
        switch (a.type) {
          case 'werewolf': payload = { center: 0 }; break;
          case 'seer': payload = { mode: 'player', target: otherSeat(s.players, self) }; break;
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
      // 记录白天角色卡
      if (s.phase === 'day' && s.you && s.you.role) {
        dayCard[tk] = s.you.role.name;
        if (s.you.finalRole) finalRole[tk] = s.you.finalRole.name;
      }
      // 投票
      if (s.phase === 'vote' && !voted.has(tk)) { voted.add(tk); await req('POST', '/api/action', { token: tk, type: 'vote', payload: { target: s.you.seat === 0 ? 1 : 0 } }); }
      if (s.phase === 'day' && s.isHost && !voted.has('__started')) { voted.add('__started'); setTimeout(() => req('POST', '/api/action', { token: tk, type: 'startVote' }), 800); }
      if (s.phase === 'result') { result = s.result; if (!done) { done = true; finish(); } }
    }
  }));

  await new Promise(r => setTimeout(r, 300));
  await req('POST', '/api/action', { token: hostToken, type: 'setPreset', payload: { presetId: 'S1' } });
  await req('POST', '/api/action', { token: hostToken, type: 'start' });
  console.log('已发起 S1 对局，等待流程…');

  function finish() {
    clients.forEach(c => c.destroy());
    console.log('=== 校验：白天角色卡 vs 初始身份 ===');
    let pass = true;
    tokens.forEach(tk => {
      const init = initialByName[tk], card = dayCard[tk];
      const ok = init && card && init === card;
      if (!ok) pass = false;
      console.log(`  ${tk.slice(0,6)}: 初始=${init} 白天卡=${card} ${ok ? '✓' : '✗'}`);
    });
    // 失眠者 finalRole 校验
    const insomniacTk = tokens.find(tk => initialByName[tk] === '失眠者');
    if (insomniacTk) console.log(`  失眠者 finalRole=${finalRole[insomniacTk] || '(无)'} ${finalRole[insomniacTk] ? '✓' : '✗'}`);
    else console.log('  本局无失眠者，跳过 finalRole 校验');
    console.log(pass ? 'RESULT: PASS（白天恒定显示初始身份）' : 'RESULT: FAIL');
    process.exit(0);
  }
  setTimeout(() => { if (!done) { done = true; console.log('超时'); finish(); } }, 70000);
})();
