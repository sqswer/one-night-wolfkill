'use strict';
// 一夜狼人杀 · 在线版（零依赖 Node.js 服务器）
// 技术：内置 http + Server-Sent Events(SSE) + fetch(POST)。无需 npm install。
// 语音：客户端使用浏览器内置 Web Speech API（播报员 TTS / 玩家语音识别），无需密钥。

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ----------------------------- 角色定义 -----------------------------
// team: wolf(狼队) / village(好人) / tanner(皮匠) / vampire(吸血鬼队)
// nightOrder / duskOrder: 行动顺序（越小越先）。wake=true 表示会被唤醒执行动作。
// action: 夜晚/黄昏能力处理函数名（见 engine）。
const ROLES = {
  werewolf:            { name: '狼人',     team: 'wolf',    nightOrder: 30, wake: true,  action: 'werewolf',   hint: '狼人请睁眼，与其他狼人互相确认。若你是场上唯一的狼，请查看一张中央底牌。' },
  minion:              { name: '爪牙',     team: 'wolf',    nightOrder: 50, wake: true,  action: 'minion',     hint: '爪牙请睁眼，找出狼人是谁。' },
  alpha_wolf:          { name: '阿尔法狼', team: 'wolf',    nightOrder: 31, wake: true,  action: 'alphaWolf',  hint: '阿尔法狼请睁眼，将一张中央底牌与一名玩家交换。' },
  wolf_seer:           { name: '狼先知',   team: 'wolf',    nightOrder: 32, wake: true,  action: 'wolfSeer',   hint: '狼先知请睁眼，查看一名玩家的真实身份。' },
  mason:               { name: '守夜人',   team: 'village', nightOrder: 60, wake: true,  action: 'mason',      hint: '守夜人请睁眼，与你的同伴互相确认。' },
  seer:                { name: '预言家',   team: 'village', nightOrder: 70, wake: true,  action: 'seer',       hint: '预言家请睁眼，查看一名玩家的身份，或查看两张中央底牌。' },
  apprentice_seer:     { name: '见习预言家', team: 'village', nightOrder: 75, wake: true, action: 'apprenticeSeer', hint: '见习预言家请睁眼，查看一张中央底牌。' },
  paranormal_detective:{ name: '灵异侦探', team: 'village', nightOrder: 76, wake: true,  action: 'detective',  hint: '灵异侦探请睁眼，最多查看两名玩家的身份。' },
  robber:              { name: '强盗',     team: 'village', nightOrder: 80, wake: true,  action: 'robber',     hint: '强盗请睁眼，选择一名玩家交换身份，并查看换来的新身份。' },
  witch:               { name: '女巫',     team: 'village', nightOrder: 85, wake: true,  action: 'witch',      hint: '女巫请睁眼，查看一张中央底牌，并选择是否与一名玩家交换身份。' },
  troublemaker:        { name: '捣蛋鬼',   team: 'village', nightOrder: 90, wake: true,  action: 'troublemaker', hint: '捣蛋鬼请睁眼，悄悄交换另外两名玩家的身份。' },
  village_idiot:       { name: '村庄白痴', team: 'village', nightOrder: 92, wake: true,  action: 'idiot',      hint: '村庄白痴请睁眼，轮转所有其他玩家的身份牌。' },
  drunk:               { name: '酒鬼',     team: 'village', nightOrder: 95, wake: true,  action: 'drunk',      hint: '酒鬼请睁眼，与一张中央底牌交换身份。' },
  insomniac:           { name: '失眠者',   team: 'village', nightOrder: 97, wake: true,  action: 'insomniac',  hint: '失眠者请睁眼，查看你最终的身份。' },
  sentinel:            { name: '哨兵',     team: 'village', nightOrder: 10, wake: true,  action: 'sentinel',   hint: '哨兵请睁眼，选择一名玩家或一张中央底牌，放上一面盾牌封锁。' },
  doppelganger:        { name: '化身幽灵', team: 'village', nightOrder: 20, wake: true,  action: 'doppelganger', hint: '化身幽灵请睁眼，查看一名玩家的身份。' },
  revealer:            { name: '揭秘者',   team: 'village', nightOrder: 98, wake: true,  action: 'revealer',   hint: '揭秘者请睁眼，揭示一名玩家的身份。' },
  bodyguard:           { name: '保镖',     team: 'village', wake: false, dayAction: 'protect' },
  hunter:              { name: '猎人',     team: 'village', wake: false, deathAction: 'shoot' },
  villager:            { name: '村民',     team: 'village', wake: false },
  tanner:              { name: '皮匠',     team: 'tanner',  wake: false },
  prince:              { name: '王子',     team: 'village', wake: false, voteRule: 'defer' },
  cursed:              { name: '被诅咒者', team: 'village', wake: false, nightByWolf: 'becomeWolf' },
  vampire:             { name: '吸血鬼',   team: 'vampire', duskOrder: 20, wake: true, duskAction: 'vampireMark', hint: '吸血鬼请睁眼，把吸血鬼标记放到一名非吸血鬼玩家面前。' },
  count:               { name: '伯爵',     team: 'vampire', duskOrder: 30, wake: true, duskAction: 'countFear',  hint: '伯爵请睁眼，选择一名玩家施加恐惧封锁。' },
  renfield:            { name: '血奴',     team: 'vampire', duskOrder: 40, wake: true, duskAction: 'renfield',   hint: '血奴请睁眼，找出吸血鬼是谁。' },
  // ---- 吸血鬼扩展 · 黄昏标记系（官方顺序：吸血鬼→伯爵→血奴→丘比特→牧师→刺客）----
  cupid:               { name: '丘比特',   team: 'village', duskOrder: 45, wake: true, duskAction: 'cupidMark',   hint: '丘比特请睁眼，给两名玩家放上爱之标记，令二人同生共死。' },
  priest:              { name: '牧师',     team: 'village', duskOrder: 46, wake: true, duskAction: 'priestMark',  hint: '牧师请睁眼，先给自己放上清白标记，可再给一名玩家放清白标记以净化其标记。' },
  assassin:            { name: '刺客',     team: 'assassin', duskOrder: 47, wake: true, duskAction: 'assassinMark', hint: '刺客请睁眼，给一名玩家放上刺杀标记；该玩家死亡时你获胜。' },
  // ---- 吸血鬼扩展 · 夜晚标记系 ----
  sharpshooter:        { name: '神射手',   team: 'village', nightOrder: 95.2, wake: true, action: 'sharpshooter', hint: '神射手请睁眼，查看一名玩家的身份，并查看另一名玩家的状态标记。' },
  thief:               { name: '小偷',     team: 'village', nightOrder: 95.4, wake: true, action: 'thief',    hint: '小偷请睁眼，选择一名玩家，把其状态标记换到你面前并查看。' },
  gremlin:             { name: '小魔怪',   team: 'village', nightOrder: 95.6, wake: true, action: 'gremlin',    hint: '小魔怪请睁眼，交换两名玩家的身份牌，或交换两名玩家的状态标记。' },
  // ---- 破晓进阶 ----
  tracker:             { name: '循迹者',   team: 'village', nightOrder: 93,   wake: true, action: 'tracker',    hint: '循迹者请睁眼，查看任意两名玩家的身份牌是否本夜被对调。' },
};

// ----------------------------- 预设阵容（来自《5人版/4人版指南》） -----------------------------
// 每张预设固定若干张身份牌：发玩家人数 + 3 张中央底牌。
// forCount 标记该阵容专为几人局设计；前端按 cards.length === capacity + 3 过滤显示。
const PRESETS = [
  // ===== 3 人版（每局 6 张：3 玩家 + 3 中央）=====
  { id: 'S1', name: 'S1·经典三人(首推)',      forCount: 3, cards: ['werewolf','minion','seer','robber','troublemaker','insomniac'], hasDusk: false },
  { id: 'S2', name: 'S2·无爪牙信息局',        forCount: 3, cards: ['werewolf','seer','robber','troublemaker','drunk','insomniac'],       hasDusk: false },
  { id: 'S3', name: 'S3·皮匠搅局',            forCount: 3, cards: ['werewolf','minion','tanner','seer','robber','insomniac'],           hasDusk: false },
  { id: 'S4', name: 'S4·吸血鬼入门',          forCount: 3, cards: ['vampire','renfield','seer','robber','troublemaker','villager'],    hasDusk: true },
  // ===== 4 人版推荐阵容（每局 7 张：4 玩家 + 3 中央，来自《4人版指南》）=====
  { id: 'M1', name: 'M1·新手友好·明察(首推)', forCount: 5, cards: ['werewolf','minion','seer','robber','troublemaker','insomniac','mason','mason'], hasDusk: false },
  { id: 'M2', name: 'M2·双预言·信息局',       forCount: 5, cards: ['werewolf','minion','seer','apprentice_seer','robber','insomniac','troublemaker','villager'], hasDusk: false },
  { id: 'M3', name: 'M3·女巫搅局(破晓1)',     forCount: 5, cards: ['werewolf','minion','seer','witch','robber','troublemaker','insomniac','sentinel'], hasDusk: false },
  { id: 'M4', name: 'M4·灵异侦探局(破晓1)',   forCount: 5, cards: ['werewolf','minion','seer','paranormal_detective','witch','robber','insomniac','villager'], hasDusk: false },
  { id: 'M5', name: 'M5·保镖守护(破晓1)',     forCount: 5, cards: ['werewolf','minion','seer','robber','troublemaker','drunk','insomniac','bodyguard'], hasDusk: false },
  { id: 'M6', name: 'M6·基础纯净局(仅基础)',  forCount: 5, cards: ['werewolf','minion','seer','robber','troublemaker','drunk','insomniac','hunter'], hasDusk: false },
  { id: 'A',  name: 'A·化身幽灵 chaos',        forCount: 5, cards: ['doppelganger','werewolf','minion','seer','robber','witch','troublemaker','insomniac'], hasDusk: false },
  { id: 'B',  name: 'B·皮匠搅局(三阵营)',      forCount: 5, cards: ['werewolf','minion','tanner','seer','robber','troublemaker','drunk','insomniac'], hasDusk: false },
  { id: 'C',  name: 'C·猎人护航',              forCount: 5, cards: ['werewolf','minion','hunter','seer','robber','troublemaker','drunk','insomniac'], hasDusk: false },
  { id: 'D',  name: 'D·破晓重度(阿尔法+哨兵)', forCount: 5, cards: ['alpha_wolf','werewolf','minion','seer','witch','insomniac','sentinel','revealer'], hasDusk: false },
  { id: 'E',  name: 'E·王子与被诅咒者(破晓2)', forCount: 5, cards: ['werewolf','minion','prince','cursed','seer','robber','troublemaker','insomniac'], hasDusk: false },
  { id: 'F',  name: 'F·村庄白痴进阶(破晓)',    forCount: 5, cards: ['werewolf','minion','seer','robber','troublemaker','village_idiot','tracker','witch'], hasDusk: false },
  // 吸血鬼（5 人）
  { id: 'V1', name: 'V1·吸血鬼入门(简单)',     forCount: 5, cards: ['vampire','renfield','seer','robber','troublemaker','insomniac','sentinel','villager'], hasDusk: true },
  { id: 'V2', name: 'V2·伯爵控场(进阶1)',      forCount: 5, cards: ['vampire','count','renfield','priest','sharpshooter','robber','troublemaker','sentinel'], hasDusk: true },
  { id: 'V3', name: 'V3·刺客与爱神(进阶2)',    forCount: 5, cards: ['vampire','count','renfield','priest','sharpshooter','thief','cupid','assassin'], hasDusk: true },
  { id: 'V4', name: 'V4·标记混战(进阶3)',      forCount: 5, cards: ['vampire','count','renfield','priest','sharpshooter','thief','gremlin','drunk'], hasDusk: true },
  { id: 'V5', name: 'V5·狼血大战(史诗)',       forCount: 5, cards: ['werewolf','minion','vampire','renfield','priest','sharpshooter','robber','troublemaker'], hasDusk: true },
  // ===== 6 人版（每局 9 张：6 玩家 + 3 中央）参考《6人版指南》=====
  // 基础阵容 X1-X6（无吸血鬼）
  { id: 'X1', name: 'X1·新手友好·明察(首推)',      forCount: 6, cards: ['werewolf','minion','seer','robber','troublemaker','insomniac','mason','mason','villager'],                       hasDusk: false },
  { id: 'X2', name: 'X2·双预言·信息局',           forCount: 6, cards: ['werewolf','minion','seer','apprentice_seer','robber','troublemaker','insomniac','drunk','villager'],           hasDusk: false },
  { id: 'X3', name: 'X3·女巫搅局(破晓1)',         forCount: 6, cards: ['werewolf','minion','seer','witch','robber','troublemaker','insomniac','sentinel','villager'],                 hasDusk: false },
  { id: 'X4', name: 'X4·灵异侦探局(破晓1)',       forCount: 6, cards: ['werewolf','minion','seer','paranormal_detective','robber','troublemaker','insomniac','mason','mason'],       hasDusk: false },
  { id: 'X5', name: 'X5·保镖守护(破晓1)',         forCount: 6, cards: ['werewolf','minion','seer','robber','troublemaker','drunk','insomniac','bodyguard','villager'],               hasDusk: false },
  { id: 'X6', name: 'X6·基础纯净局(仅基础)',      forCount: 6, cards: ['werewolf','minion','seer','robber','troublemaker','drunk','insomniac','hunter','villager'],                  hasDusk: false },
  // 进阶阵容 Y1-Y6（无吸血鬼 · 破晓/机制堆叠）
  { id: 'Y1', name: 'Y1·狼先知控场局(破晓1)',     forCount: 6, cards: ['werewolf','minion','seer','wolf_seer','drunk','witch','robber','insomniac','troublemaker'],                 hasDusk: false },
  { id: 'Y2', name: 'Y2·化身幽灵 chaos',          forCount: 6, cards: ['doppelganger','werewolf','minion','seer','robber','witch','troublemaker','insomniac','drunk'],              hasDusk: false },
  { id: 'Y3', name: 'Y3·皮匠搅局(三阵营)',        forCount: 6, cards: ['werewolf','minion','tanner','seer','robber','troublemaker','drunk','insomniac','witch'],                   hasDusk: false },
  { id: 'Y4', name: 'Y4·破晓重度(阿尔法+哨兵)',   forCount: 6, cards: ['alpha_wolf','werewolf','minion','seer','witch','insomniac','sentinel','robber','paranormal_detective'],   hasDusk: false },
  { id: 'Y5', name: 'Y5·王子与被诅咒者(破晓2)',   forCount: 6, cards: ['werewolf','minion','prince','cursed','seer','robber','troublemaker','insomniac','witch'],                 hasDusk: false },
  { id: 'Y6', name: 'Y6·村庄白痴进阶(破晓)',      forCount: 6, cards: ['werewolf','minion','seer','robber','troublemaker','village_idiot','tracker','witch','insomniac'],          hasDusk: false },
  // 挑战阵容 U1-U5（吸血鬼扩展 · 含黄昏）
  { id: 'U1', name: 'U1·吸血鬼入门(简单)',        forCount: 6, cards: ['vampire','renfield','sentinel','insomniac','seer','robber','troublemaker','villager','witch'],            hasDusk: true },
  { id: 'U2', name: 'U2·吸血鬼标准平替(进阶1)',   forCount: 6, cards: ['vampire','count','renfield','priest','sharpshooter','robber','troublemaker','sentinel','villager'],       hasDusk: true },
  { id: 'U3', name: 'U3·爱神与刺客(进阶2)',       forCount: 6, cards: ['vampire','count','renfield','priest','sharpshooter','thief','cupid','assassin','robber'],               hasDusk: true },
  { id: 'U4', name: 'U4·标记混战(进阶3)',         forCount: 6, cards: ['vampire','count','renfield','priest','sharpshooter','thief','gremlin','robber','troublemaker'],          hasDusk: true },
  { id: 'U5', name: 'U5·狼血大战(史诗)',          forCount: 6, cards: ['vampire','renfield','werewolf','minion','priest','sharpshooter','robber','troublemaker','insomniac'],    hasDusk: true },
  // ===== 7 人版（每局 10 张：7 玩家 + 3 中央）=====
  { id: 'Z1', name: 'Z1·满员经典(首推)',       forCount: 7, cards: ['werewolf','minion','seer','robber','troublemaker','insomniac','mason','mason','drunk','villager'],     hasDusk: false },
  { id: 'Z2', name: 'Z2·全员能力',             forCount: 7, cards: ['werewolf','minion','seer','witch','robber','troublemaker','drunk','insomniac','hunter','bodyguard'], hasDusk: false },
  { id: 'Z3', name: 'Z3·史诗大战',             forCount: 7, cards: ['alpha_wolf','werewolf','minion','seer','witch','robber','troublemaker','insomniac','sentinel','revealer'], hasDusk: false },
  { id: 'W1', name: 'W1·吸血鬼满员局',        forCount: 7, cards: ['vampire','count','renfield','priest','sharpshooter','thief','cupid','assassin','seer','robber'],   hasDusk: true },
  // ===== 4 人版推荐阵容（每局 7 张：4 玩家 + 3 中央，来自《4人版指南》）=====
  { id: 'P1', name: 'P1·新手友好·守夜人互认',   forCount: 4, cards: ['werewolf','minion','mason','mason','seer','troublemaker','insomniac'], hasDusk: false },
  { id: 'P2', name: 'P2·双预言·信息局',         forCount: 4, cards: ['werewolf','minion','seer','apprentice_seer','robber','insomniac','villager'], hasDusk: false },
  { id: 'P3', name: 'P3·女巫搅局(破晓1)',       forCount: 4, cards: ['werewolf','minion','seer','witch','robber','sentinel','insomniac'], hasDusk: false },
  { id: 'P4', name: 'P4·灵异侦探局(破晓1)',     forCount: 4, cards: ['werewolf','minion','seer','paranormal_detective','witch','robber','insomniac'], hasDusk: false },
  { id: 'P5', name: 'P5·基础纯净局(仅基础)',    forCount: 4, cards: ['werewolf','minion','seer','robber','troublemaker','drunk','hunter'], hasDusk: false },
  { id: 'Q1', name: 'Q1·化身幽灵 chaos',        forCount: 4, cards: ['doppelganger','werewolf','minion','seer','robber','troublemaker','insomniac'], hasDusk: false },
  { id: 'Q2', name: 'Q2·皮匠搅局(三阵营)',      forCount: 4, cards: ['werewolf','minion','tanner','seer','robber','troublemaker','insomniac'], hasDusk: false },
  { id: 'Q3', name: 'Q3·阿尔法狼+哨兵(破晓1)',  forCount: 4, cards: ['alpha_wolf','minion','seer','witch','insomniac','sentinel','revealer'], hasDusk: false },
  { id: 'Q4', name: 'Q4·王子与被诅咒者(破晓2)', forCount: 4, cards: ['werewolf','minion','prince','cursed','seer','robber','insomniac'], hasDusk: false },
  { id: 'Q5', name: 'Q5·村庄白痴进阶(破晓)',    forCount: 4, cards: ['werewolf','minion','seer','robber','troublemaker','village_idiot','tracker'], hasDusk: false },
  { id: 'R1', name: 'R1·吸血鬼入门(简单)',      forCount: 4, cards: ['vampire','renfield','sentinel','insomniac','seer','robber','troublemaker'], hasDusk: true },
  { id: 'R2', name: 'R2·伯爵控场(进阶1)',       forCount: 4, cards: ['vampire','renfield','priest','sharpshooter','robber','troublemaker','sentinel'], hasDusk: true },
  { id: 'R3', name: 'R3·爱神与刺客(进阶2)',     forCount: 4, cards: ['vampire','count','renfield','priest','sharpshooter','cupid','assassin'], hasDusk: true },
  { id: 'R4', name: 'R4·标记混战(进阶3)',       forCount: 4, cards: ['vampire','renfield','priest','sharpshooter','thief','gremlin','drunk'], hasDusk: true },
  { id: 'R5', name: 'R5·狼血大战(史诗)',        forCount: 4, cards: ['vampire','renfield','werewolf','minion','priest','sharpshooter','robber'], hasDusk: true },
];

// ----------------------------- 房间存储 -----------------------------
const rooms = new Map(); // code -> room

function genCode() {
  let code;
  do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms.has(code));
  return code;
}
function genToken() { return crypto.randomBytes(16).toString('hex'); }

// 按人数返回该人数对应的首个推荐预设 ID（4人→P1、5人→M1；3/6/7人无预设返回 null）
function defaultPresetFor(capacity) {
  const p = PRESETS.find(x => x.forCount === capacity);
  return p ? p.id : null;
}

function makeRoom(hostName, capacity = 5) {
  const code = genCode();
  const room = {
    code,
    hostToken: null,
    players: [],            // {token, name, seat, connected, ready}
    presetId: defaultPresetFor(capacity) || 'M1',
    capacity,               // 创建时选定的本局人数上限（3-7）
    roleDeck: null,         // 房主自选身份牌列表（覆盖 presetId）；null 时用 presetId
    phase: 'lobby',         // lobby | dusk | night | day | vote | result
    log: [],                // 公共日志
    announce: '',
    createdAt: Date.now(),
    // 游戏状态
    deck: [],               // 发牌后：players 在前，中央在后
    centerCount: 0,
    centerCards: [],        // 中央牌（含是否被盾牌/恐惧封锁）
    currentRole: [],        // 每位玩家当前角色 key（下标=seat）
    initialRole: [],        // 发牌初始角色
    marks: {},              // seat -> { vampire,fear,clarity,love,assassin }（吸血鬼扩展标记）
    privateInfo: {},        // token -> [已见信息文本]
    // 流程控制
    queue: [],              // 待唤醒角色序列 [{role, seats:[], stage:'dusk'|'night'}]
    qIndex: -1,
    currentAction: null,    // {role, stage, seats, submissions, needsInput}
    nightTimer: null,
    votes: {},              // seat -> targetSeat
    voteTargetsOpen: false,
    protectTarget: null,    // 保镖保护
    hunterPending: null,    // 待猎人开枪
    discussionEndsAt: null,
    result: null,
    sse: [],                // {token, res}
    voice: new Set(),      // 开启语音的玩家 token 集合（WebRTC mesh 信令由服务器转发，音频走 P2P 不经过服务器）
  };
  rooms.set(code, room);
  return room;
}

function findPlayer(room, token) { return room.players.find(p => p.token === token); }
function broadcast(room, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of room.sse) { try { c.res.write(payload); } catch (_) {} }
}
function publicLog(room, text) {
  room.log.push(text);
  if (room.log.length > 200) room.log.shift();
  broadcast(room, 'log', { text });
}
function announce(room, text, step, kind, stage) {
  room.announce = text;
  const payload = { text, step: step || 0, kind: kind || null, stage: stage || null };
  broadcast(room, 'speak', payload);
  broadcast(room, 'announce', payload);
}

// 给单人推送私有信息（不公开）
function sendPrivate(room, token, text) {
  if (!room.privateInfo[token]) room.privateInfo[token] = [];
  room.privateInfo[token].push(text);
  for (const c of room.sse) {
    if (c.token === token) { try { c.res.write(`event: private\ndata: ${JSON.stringify({ text })}\n\n`); } catch (_) {} }
  }
}

// WebRTC 语音：点对点信令转发 + 成员查询
function pushTo(room, token, event, data) {
  const c = room.sse.find(x => x.token === token);
  if (!c) return;
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}
function voiceSeats(room) {
  const arr = [];
  for (const t of room.voice) { const pl = findPlayer(room, t); if (pl) arr.push(pl.seat); }
  return arr;
}
function seatToToken(room, seat) { const p = room.players.find(x => x.seat === seat); return p ? p.token : null; }

// 推送个性化状态给每位玩家
function pushState(room) {
  for (const c of room.sse) {
    const p = findPlayer(room, c.token);
    if (!p) continue;
    const state = buildState(room, p);
    try { c.res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`); } catch (_) {}
  }
}
function buildState(room, player) {
  const isHost = player.token === room.hostToken;
  const playersPub = room.players.map(p => ({
    seat: p.seat, name: p.name, ready: p.ready, connected: p.connected,
    isYou: p.token === player.token, isHost: p.token === room.hostToken,
    bot: !!p.bot,
  }));
  let you = null;
  if (room.phase !== 'lobby') {
    // 角色卡恒定显示【初始身份】（一夜狼人杀规则：白天界面不变，玩家据此推理）
    const rk = room.initialRole[player.seat];
    you = { seat: player.seat, role: rk ? { key: rk, name: ROLES[rk].name, team: ROLES[rk].team } : null };
    if (room.privateInfo[player.token]) you.seen = room.privateInfo[player.token];
    if (room.marks[player.seat]) you.mark = markDesc(room, player.seat);
    // 仅失眠者在白天补充"最终身份"小字（其能力为天亮前查看自身最终身份）
    if (rk === 'insomniac') {
      const fk = room.currentRole[player.seat];
      you.finalRole = fk ? { key: fk, name: ROLES[fk].name } : null;
    }
  }
  // 当前行动提示（仅行动者可见选项）
  let action = null;
  if (room.currentAction && room.currentAction.seats.includes(player.seat)) {
    action = buildActionPrompt(room, room.currentAction, player.seat);
    action.seats = room.currentAction.seats;
  }
  let votesView = null;
  if (room.phase === 'vote' || room.phase === 'result') {
    const mine = room.votes[player.seat] ?? undefined;
    votesView = {
      mine,
      abstained: mine === null,          // 本玩家已选择「不投票」
      total: room.players.length,
      cast: Object.keys(room.votes).length,
    };
  }
  const state = {
    code: room.code,
    phase: room.phase,
    isHost,
    hostName: room.players.find(p => p.token === room.hostToken)?.name || null,
    players: playersPub,
    centerCount: room.centerCount,
    capacity: room.capacity,
    customActive: !!(room.roleDeck && room.roleDeck.length),
    presetId: room.presetId,
    presetName: (room.roleDeck && room.roleDeck.length)
      ? `自定义阵容（${room.roleDeck.length} 张）`
      : (PRESETS.find(x => x.id === room.presetId)?.name || ''),
    you,
    action,
    announce: room.announce,
    log: room.log,
    votes: votesView,
    discussionEndsAt: room.discussionEndsAt,
    result: room.result,
    protectTarget: (room.phase === 'vote' && room.currentAction && room.currentAction.role === 'bodyguard' && room.currentAction.seats.includes(player.seat)) ? true : false,
    hunterShoot: (room.phase === 'result_pending_hunter' && room.hunterPending === player.seat) || false,
    nightInfo: null,
  };
  // 夜晚/黄昏唤醒进度（供前端"AI 引导进度条"使用）
  if ((room.phase === 'dusk' || room.phase === 'night') && room.queue.length) {
    const roleName = room.currentAction ? ROLES[room.currentAction.role].name : '';
    state.nightInfo = { stage: room.queue[0].stage, current: Math.min(room.qIndex + 1, room.queue.length), total: room.queue.length, roleName };
  }
  return state;
}

// ----------------------------- 游戏引擎 -----------------------------
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ----------------------------- 机器人（AI 补位）辅助 -----------------------------
function rnd(n) { return Math.floor(Math.random() * n); }
function otherSeats(room, seat) { return room.players.map(p => p.seat).filter(s => s !== seat); }
function randOther(room, seat) { const a = otherSeats(room, seat); return a[rnd(a.length)]; }
function twoDistinct(room, seat) {
  const a = otherSeats(room, seat);
  const x = a[rnd(a.length)]; let y; do { y = a[rnd(a.length)]; } while (y === x);
  return [x, y];
}
// 小魔怪专用：可包含自己的两人选择
function twoDistinctWithSelf(room) {
  const all = room.players.map((_, i) => i);
  const x = all[rnd(all.length)]; let y; do { y = all[rnd(all.length)]; } while (y === x);
  return [x, y];
}
function randCenter(room) { return rnd(room.centerCards.length); }
function hasCenter(room) { return room.centerCards.length > 0; }

// 为某个机器人座位生成一份合法的行动提交（与真人提交结构一致）
function botAutoSubmit(room, action, seat) {
  const r = action.role;
  switch (r) {
    case 'werewolf': return { center: randCenter(room) };
    case 'seer': {
      if (hasCenter(room) && Math.random() < 0.5) {
        const a = randCenter(room); let b; do { b = randCenter(room); } while (b === a);
        return { mode: 'center', centers: [a, b] };
      }
      return { mode: 'player', target: randOther(room, seat) };
    }
    case 'minion': return { center: hasCenter(room) ? randCenter(room) : null };
    case 'paranormal_detective': return { targets: [randOther(room, seat)] };
    case 'wolfSeer':
    case 'doppelganger': return { target: randOther(room, seat) };
    case 'robber': return { target: randOther(room, seat) };
    case 'witch': return { center: hasCenter(room) ? randCenter(room) : null, swapWith: null };
    case 'troublemaker': { const [a, b] = twoDistinct(room, seat); return { a, b }; }
    case 'sentinel': return (hasCenter(room) && Math.random() < 0.5)
      ? { kind: 'center', idx: randCenter(room) }
      : { kind: 'player', target: randOther(room, seat) };
    case 'alphaWolf': return { idx: randCenter(room), target: randOther(room, seat) };
    case 'vampire': return { target: randOther(room, seat) };
    case 'count': return { target: randOther(room, seat) };
    case 'cupid': { const [a, b] = twoDistinct(room, seat); return { targets: [a, b] }; }
    case 'priest': return { target: Math.random() < 0.5 ? randOther(room, seat) : null };
    case 'assassin': return { target: randOther(room, seat) };
    case 'sharpshooter': return { roleTarget: randOther(room, seat), markTarget: randOther(room, seat) };
    case 'thief': return { target: randOther(room, seat) };
    case 'gremlin': { const [a, b] = twoDistinctWithSelf(room); return { a, b, mode: Math.random() < 0.5 ? 'marks' : 'cards' }; }
    case 'tracker': { const [a, b] = twoDistinct(room, seat); return { a, b }; }
    default: return {};
  }
}

// 当前待执行动作中，凡是机器人座位且尚未提交，自动补一份随机合法提交
function fillBotActions(room) {
  const action = room.currentAction;
  if (!action || !action.needsInput) return;
  for (const seat of action.seats) {
    const p = room.players[seat];
    if (p && p.bot && action.submissions[seat] == null) {
      action.submissions[seat] = botAutoSubmit(room, action, seat);
    }
  }
}

function startGame(room) {
  const n = room.players.length;
  if (n < 3 || n > 7) { return { error: '人数需为 3-7 人' }; }
  // 牌堆来源：房主自选优先，否则用预设阵容
  const deckSrc = (room.roleDeck && room.roleDeck.length)
    ? room.roleDeck
    : (PRESETS.find(x => x.id === room.presetId) || PRESETS[0]).cards;
  if (!deckSrc || deckSrc.length < n) { return { error: '身份牌数量不足，至少需要与人数相等' }; }
  // 校验：牌堆大小必须等于 玩家人数 + 3（中央固定 3 张底牌）
  const expectedSize = n + 3;
  if (deckSrc.length !== expectedSize) {
    return { error: `当前${n}人局需要 ${expectedSize} 张身份牌（${n}玩家+3中央），但选中阵容有 ${deckSrc.length} 张。请切换阵容或调整自选角色。` };
  }
  // 牌堆 = 玩家人 + 中央底牌（牌堆长度可变：3 人局 6 张、4 人局 7 张…）
  const deck = shuffle(deckSrc.slice());
  const hasDusk = deck.some(k => ROLES[k] && ROLES[k].duskAction);
  room.deck = deck;
  room.centerCount = deck.length - n;
  room.centerCards = deck.slice(n).map(k => ({ role: k, locked: false }));
  room.currentRole = deck.slice(0, n).slice();
  room.initialRole = room.currentRole.slice();
  room.marks = {}; // 初始化标记（每位玩家默认清白标记）
  room.players.forEach(p => { room.marks[p.seat] = { vampire: false, fear: false, clarity: false, love: false, assassin: false }; });
  room.lovePair = null;
  room.assassinTarget = null;
  room.privateInfo = {};
  room.votes = {};
  room.protectTarget = null;
  room.hunterPending = null;
  room.result = null;
  room.log = [];
  room.announce = '';
  for (const p of room.players) p.ready = false;

  // 先通知客户端重置播报历史与语音队列（务必在任意 announce 之前发出，
  // 否则开场播报「游戏开始/天黑/狼人/爪牙」会被客户端在 lobby→night 切换时误清）
  broadcast(room, 'reset', {});

  // 给客户端留出约 150ms 处理 reset（清空旧队列/历史），避免开场播报紧接 reset 被误清或吞掉
  setTimeout(() => {
    const presetName = (room.roleDeck && room.roleDeck.length)
      ? `自定义阵容（${room.roleDeck.length} 张）`
      : (PRESETS.find(x => x.id === room.presetId) || PRESETS[0]).name;

    publicLog(room, '游戏开始，请各位查看自己的身份。');
    announce(room, '游戏开始，请各位查看自己的身份。');

    // 发牌：每位玩家可见自己身份（通过私有信息）
    for (const p of room.players) {
      const rk = room.currentRole[p.seat];
      sendPrivate(room, p.token, `游戏开始时，你的身份是【${ROLES[rk].name}】（阵营：${teamName(ROLES[rk].team)}）。`);
    }
    // 被诅咒者：若狼人选择标记则变狼（此处仅提示）
    if (hasDusk) {
      room.phase = 'dusk';
      setupStage(room, 'dusk');
    } else {
      room.phase = 'night';
      setupStage(room, 'night');
    }
    pushState(room);
  }, 150);
  return { ok: true };
}

function teamName(t) {
  return { wolf: '狼队', village: '好人', tanner: '皮匠(独立)', vampire: '吸血鬼队', assassin: '刺客(独立)' }[t] || t;
}

// ---- 标记子系统辅助 ----
// 判断某座位是否属于吸血鬼队（本人是吸血鬼队角色 或 被吸血鬼标记）
function isVampire(room, seat) {
  const rk = room.currentRole[seat];
  if (rk && ROLES[rk] && ROLES[rk].team === 'vampire') return true;
  const m = room.marks[seat];
  return !!(m && m.vampire);
}
// 判断"真吸血鬼"（吸血鬼/伯爵等，不含血奴本人、不含被标记者），供血奴认亲
function isTrueVampire(room, seat) {
  const rk = room.currentRole[seat];
  return rk === 'vampire' || rk === 'count';
}
// 玩家有效阵营（考虑吸血鬼标记改变阵营）
function playerTeam(room, seat) {
  if (isVampire(room, seat)) return 'vampire';
  const rk = room.currentRole[seat];
  return ROLES[rk] ? ROLES[rk].team : 'village';
}
// 标记文字描述（用于展示）
function markDesc(room, seat) {
  const m = room.marks[seat] || {};
  const tags = [];
  if (m.vampire) tags.push('吸血鬼');
  if (m.fear) tags.push('恐惧');
  if (m.clarity) tags.push('清白');
  if (m.love) tags.push('爱之');
  if (m.assassin) tags.push('刺杀');
  return tags.length ? tags.join('、') : '清白';
}
// 场上主要敌对阵营是否≥2（判定史诗战：狼队 + 吸血鬼队同时在场）
function isEpicBattle(room) {
  const hasWolf = room.players.some(p => playerTeam(room, p.seat) === 'wolf');
  const hasVamp = room.players.some(p => playerTeam(room, p.seat) === 'vampire');
  return hasWolf && hasVamp;
}

// 构建唤醒队列（按本局牌堆中所有需唤醒的角色生成，上帝视角：不论该角色在玩家手中还是中央，都完整播报）
function setupStage(room, stage) {
  const orderKey = stage === 'dusk' ? 'duskOrder' : 'nightOrder';
  const present = {}; // role -> [seats]（实际持有该角色的玩家座位）
  room.players.forEach(p => {
    // 恐惧标记：被标记者本夜不能行动（仅夜晚阶段生效；黄昏阶段恐惧标记尚未放）
    if (stage === 'night' && room.marks[p.seat] && room.marks[p.seat].fear) return;
    const rk = room.currentRole[p.seat];
    const r = ROLES[rk];
    if (r && r.wake && r[orderKey] != null) {
      (present[rk] = present[rk] || []).push(p.seat);
    }
  });
  // 从整副牌（玩家 + 中央）中取出所有需要唤醒的角色，去重后按官方顺序排序
  const queue = [...new Set(room.deck)]
    .filter(rk => { const r = ROLES[rk]; return r && r.wake && r[orderKey] != null; })
    .sort((a, b) => (ROLES[a][orderKey] - ROLES[b][orderKey]))
    .map(rk => ({ role: rk, seats: present[rk] || [], stage }));
  room.queue = queue;
  room.qIndex = -1;
  if (stage === 'dusk') announce(room, '天黑前，进入黄昏阶段。', 0, 'stage', 'dusk');
  else announce(room, '天黑请闭眼。', 0, 'stage', 'night');
  advanceQueue(room);
}

function advanceQueue(room) {
  if (room.nightTimer) { clearTimeout(room.nightTimer); room.nightTimer = null; }
  room.qIndex++;
  if (room.qIndex >= room.queue.length) {
    // 本阶段结束
    if (room.queue[0] && room.queue[0].stage === 'dusk') {
      room.phase = 'night';
      setupStage(room, 'night');
    } else {
      beginDay(room);
    }
    return;
  }
  const item = room.queue[room.qIndex];
  const r = ROLES[item.role];
  announce(room, r.hint || `请【${r.name}】睁眼。`, room.qIndex + 1, 'open', item.stage);
  // 没有玩家持有该角色时（只在中央），仅播报睁眼/闭眼流程，不请求输入也不执行效果
  const needsInput = item.seats.length > 0 && roleNeedsInput(item.role, room, item.seats);
  room.currentAction = { role: item.role, stage: item.stage, seats: item.seats, submissions: {}, needsInput };
  if (needsInput) {
    // 机器人座位自动补提交；若仍有人（真人）未提交则等待客户端 UI
    fillBotActions(room);
    const allIn = item.seats.every(s => room.currentAction.submissions[s] != null);
    if (!allIn) { pushState(room); return; }
    finishAutoAction(room, r);
  } else {
    // 仅播报后自动闭眼（信息类角色也稍作停留后揭示）
    const reveal = roleReveal(item.role, room, item.seats);
    if (reveal) {
      // 揭示私有信息给对应玩家
      item.seats.forEach(seat => { if (reveal[seat]) sendPrivate(room, room.players[seat].token, reveal[seat]); });
    }
    pushState(room);
    // 每个角色睁眼后停留 5 秒再闭眼，给玩家看清/听完播报的反应时间
    const delay = 5000;
    room.nightTimer = setTimeout(() => closeAndAdvance(room, r), delay);
  }
}

// 信息类角色闭眼后推进
function closeAndAdvance(room, r) {
  announce(room, `请【${r.name}】闭眼。`, room.qIndex + 1, 'close', room.queue[0].stage);
  room.currentAction = null;
  pushState(room);
  // 闭眼后统一停留 2 秒，再给下一位角色睁眼
  room.nightTimer = setTimeout(() => advanceQueue(room), 2000);
}

// 需要输入的角色（含机器人自动提交）执行完毕后闭眼并推进
function finishAutoAction(room, r) {
  applyAction(room, room.currentAction, room.currentAction.submissions);
  room.currentAction = null;
  pushState(room);
  // 操作完成后立即闭眼（不再额外停留）；闭眼后再统一停留 2 秒，给玩家反应时间，再进入下一位角色
  announce(room, `请【${r.name}】闭眼。`, room.qIndex + 1, 'close', room.queue[0].stage);
  room.nightTimer = setTimeout(() => advanceQueue(room), 2000);
}

function roleNeedsInput(role, room, seats) {
  // 爪牙：仅当场上没有狼人（狼全在中央）时才需行动——可查看一张中央底牌（类独狼）
  if (role === 'minion') return room.players.filter(p => room.currentRole[p.seat] === 'werewolf').length === 0;
  // 需要玩家做出选择的能力
  const inputRoles = {
    werewolf: seats.length === 1,        // 独狼需选择查看中央
    seer: true, apprentice_seer: false, paranormal_detective: true,
    robber: true, witch: true, troublemaker: true, village_idiot: false,
    drunk: false, insomniac: false, sentinel: true, alphaWolf: true,
    wolfSeer: true, doppelganger: true, revealer: false,
    vampire: true, count: true, renfield: false, mason: false, minion: false,
    cupid: true, priest: true, assassin: true, sharpshooter: true,
    thief: true, gremlin: true, tracker: true,
  };
  return !!inputRoles[role];
}

// 信息类角色（无输入）揭示给对应玩家
function roleReveal(role, room, seats) {
  const out = {};
  if (role === 'minion') {
    const wolves = room.players.filter(p => room.currentRole[p.seat] === 'werewolf').map(p => p.seat);
    seats.forEach(s => { out[s] = wolves.length ? `你是爪牙。狼人是：${wolves.map(w => seatName(room, w)).join('、')}。` : '你是爪牙，但场上没有狼人（狼都在中央）。'; });
  } else if (role === 'mason') {
    const mates = seats.filter(s => room.currentRole[s] === 'mason');
    seats.forEach(s => { out[s] = `你是守夜人。你的搭档是：${mates.filter(m => m !== s).map(m => seatName(room, m)).join('、') || '（无，搭档在中央）'}。`; });
  } else if (role === 'apprentice_seer') {
    // 看一张中央
    const c = room.centerCards[Math.floor(Math.random() * room.centerCards.length)];
    seats.forEach(s => { out[s] = `见习预言家：你查看的中央底牌是【${ROLES[c.role].name}】。`; });
  } else if (role === 'insomniac') {
    seats.forEach(s => { out[s] = `失眠者：天亮前你最后的身份是【${ROLES[room.currentRole[s]].name}】。`; });
  } else if (role === 'drunk') {
    // 强制盲换中央（随机一张）
    const ci = Math.floor(Math.random() * room.centerCards.length);
    const oldR = room.currentRole[seats[0]];
    const newR = room.centerCards[ci].role;
    room.currentRole[seats[0]] = newR;
    room.centerCards[ci].role = oldR;
    seats.forEach(s => { out[s] = `酒鬼：你已与中央一张底牌交换，你现在实际身份是【${ROLES[newR].name}】。`; });
  } else if (role === 'village_idiot') {
    // 轮转所有其他玩家牌（不动中央）
    const order = room.players.map(p => p.seat);
    const rolesArr = order.map(s => room.currentRole[s]);
    const shifted = [rolesArr[rolesArr.length - 1], ...rolesArr.slice(0, -1)];
    order.forEach((s, i) => { room.currentRole[s] = shifted[i]; });
    seats.forEach(s => { out[s] = `村庄白痴：你已轮转所有其他玩家的身份牌（你自身不变）。`; });
  } else if (role === 'renfield') {
    const vamps = room.players.filter(p => isTrueVampire(room, p.seat)).map(p => p.seat);
    seats.forEach(s => { out[s] = `血奴：吸血鬼是 ${vamps.map(v => seatName(room, v)).join('、') || '（无，吸血鬼在中央）'}。`; });
  } else if (role === 'revealer') {
    seats.forEach(s => { out[s] = `你的身份是【${ROLES[room.currentRole[s]].name}】。`; });
  }
  return out;
}

function seatName(room, seat) { const p = room.players[seat]; return p ? p.name : `座位${seat + 1}`; }

// 构建给行动者的 UI 提示
function buildActionPrompt(room, action, seat) {
  const r = ROLES[action.role];
  const players = room.players.map(p => ({ seat: p.seat, name: p.name, isSelf: p.seat === seat }));
  const centers = room.centerCards.map((c, i) => ({ idx: i, locked: c.locked }));
  const base = { role: action.role, roleName: r.name, stage: action.stage, seat, type: '' };
  switch (action.role) {
    case 'werewolf': // 独狼看中央
      return { ...base, type: 'werewolf', text: '你是唯一狼人，选择查看一张中央底牌：', centers };
    case 'minion': {
      const wolves = room.players.filter(p => room.currentRole[p.seat] === 'werewolf').length;
      if (wolves === 0) return { ...base, type: 'minionCenter', text: '你是爪牙，但场上没有狼人（狼都在中央）。查看一张中央底牌：', centers };
      return { ...base, type: 'none', text: r.name };
    }
    case 'seer':
      return { ...base, type: 'seer', text: '预言家：查看一名玩家，或选择 1–2 张中央底牌查看。', players, centers, canCenter: true };
    case 'paranormal_detective':
      return { ...base, type: 'detective', text: '灵异侦探：最多查看 2 名玩家身份。', players, max: 2 };
    case 'wolfSeer':
      return { ...base, type: 'seePlayer', text: '狼先知：查看一名玩家身份。', players };
    case 'robber':
      return { ...base, type: 'robber', text: '强盗：与一名玩家交换身份，并查看新身份。', players };
    case 'witch':
      return { ...base, type: 'witch', text: '女巫：查看一张中央底牌，并选择是否与一名玩家交换。', players, centers };
    case 'troublemaker':
      return { ...base, type: 'troublemaker', text: '捣蛋鬼：交换两名玩家的身份牌（自己不变）。', players };
    case 'sentinel':
      return { ...base, type: 'shield', text: '哨兵：选择一名玩家上盾封锁（本夜不可被查/换）。', players };
    case 'alphaWolf':
      return { ...base, type: 'alphaWolf', text: '阿尔法狼：将一张中央底牌与一名非狼、非自己的玩家交换（把中央牌塞入玩家堆）。', players, centers };
    case 'doppelganger':
      return { ...base, type: 'seePlayer', text: '化身幽灵：查看一名玩家身份（原版复制其能力，本作简化为仅查看）。', players };
    case 'vampire':
      return { ...base, type: 'vampireMark', text: '吸血鬼：将吸血鬼标记放到一名非吸血鬼玩家面前（其变为吸血鬼队）。', players };
    case 'count':
      return { ...base, type: 'fear', text: '伯爵：选择一名玩家施加恐惧标记（其本夜不能行动）。', players };
    case 'cupid':
      return { ...base, type: 'cupid', text: '丘比特：选择两名玩家放上爱之标记（二人同生共死）。', players };
    case 'priest':
      return { ...base, type: 'priest', text: '牧师：你将给自己放清白标记；可选再净化一名玩家（清除其标记）。', players };
    case 'assassin':
      return { ...base, type: 'assassin', text: '刺客：给一名玩家放上刺杀标记（该玩家死亡时你获胜）。', players };
    case 'sharpshooter':
      return { ...base, type: 'sharpshooter', text: '神射手：查看一名玩家的身份，并查看另一名玩家的状态标记。', players };
    case 'thief':
      return { ...base, type: 'thief', text: '小偷：与一名玩家交换状态标记，并查看你的新标记。', players };
    case 'gremlin':
      return { ...base, type: 'gremlin', text: '小魔怪：盲交换任意两名玩家的角色牌或状态标记（可含自己，不看牌）。', players };
    case 'tracker':
      return { ...base, type: 'tracker', text: '循迹者：查看本夜哪些玩家动过牌（无需选择，直接查看结果）。', players };
    case 'bodyguard':
      return { ...base, type: 'protect', text: '保镖：选择保护目标（其获最高票时不会被放逐，由次高票≥2票者替死）。', players };
    default:
      return { ...base, type: 'none', text: r.name };
  }
}

// 处理行动者提交
function handleNightAction(room, token, payload) {
  const p = findPlayer(room, token);
  if (!p || !room.currentAction) return { error: '当前无待执行动作' };
  const action = room.currentAction;
  if (!action.seats.includes(p.seat)) return { error: '现在不是你的行动回合' };
  action.submissions[p.seat] = payload;
  // 机器人座位自动补提交
  fillBotActions(room);
  // 是否全部提交
  const allIn = action.seats.every(s => action.submissions[s] != null);
  if (!allIn) { pushState(room); return { ok: true, waiting: true }; }
  finishAutoAction(room, ROLES[action.role]);
  return { ok: true };
}

function applyAction(room, action, subs) {
  // 收集本夜实际执行过行动/动过牌的角色座位，供循迹者查看“谁在晚上有动作”
  if (!room.nightActors) room.nightActors = new Set();
  action.seats.forEach(seat => { if (subs[seat] != null) room.nightActors.add(seat); });
  const r = action.role;
  if (r === 'werewolf') {
    const ci = subs[action.seats[0]].center;
    if (ci != null && room.centerCards[ci]) sendPrivate(room, room.players[action.seats[0]].token, `你查看的中央底牌是【${ROLES[room.centerCards[ci].role].name}】。`);
  } else if (r === 'minion') {
    action.seats.forEach(seat => {
      const sub = subs[seat];
      if (sub && sub.center != null && room.centerCards[sub.center]) {
        sendPrivate(room, room.players[seat].token, `爪牙：你查看的中央底牌是【${ROLES[room.centerCards[sub.center].role].name}】。`);
      }
    });
  } else if (r === 'seer') {
    const s = action.seats[0]; const sub = subs[s];
    if (sub.mode === 'player' && sub.target != null) {
      const tr = room.currentRole[sub.target];
      sendPrivate(room, room.players[s].token, `预言家：你查看 ${seatName(room, sub.target)} 的身份是【${ROLES[tr].name}】。`);
    } else if (sub.mode === 'center' && sub.centers && sub.centers.length) {
      const names = sub.centers.map(ci => ROLES[room.centerCards[ci].role].name);
      sendPrivate(room, room.players[s].token, `预言家：你查看的中央底牌是【${names.join('、')}】。`);
    }
  } else if (r === 'paranormal_detective') {
    const s = action.seats[0]; const targets = subs[s].targets || [];
    const results = targets.map(t => ({ seat: t, role: room.currentRole[t] }));
    const names = results.map(x => `${seatName(room, x.seat)}→${ROLES[x.role].name}`);
    // 检查是否看到狼人或皮匠（官方规则：变阵营）
    const sawWolf = results.find(x => x.role === 'werewolf' || x.role === 'alpha_wolf' || x.role === 'wolf_seer');
    const sawTanner = results.find(x => x.role === 'tanner');
    let extra = '';
    if (sawWolf) extra = ' ⚠️ 你看到了狼人——你已加入狼人阵营！';
    if (sawTanner) extra = ' ⚠️ 你看到了皮匠——你已变成皮匠！';
    sendPrivate(room, room.players[s].token, `灵异侦探：${names.join('；') || '（未查看）'}。${extra}`);
  } else if (r === 'wolfSeer' || r === 'doppelganger') {
    const s = action.seats[0]; const t = subs[s].target;
    if (t != null) sendPrivate(room, room.players[s].token, `你查看 ${seatName(room, t)} 的身份是【${ROLES[room.currentRole[t]].name}】。`);
  } else if (r === 'robber') {
    const s = action.seats[0]; const t = subs[s].target;
    const a = room.currentRole[s], b = room.currentRole[t];
    room.currentRole[s] = b; room.currentRole[t] = a;
    sendPrivate(room, room.players[s].token, `强盗：你与 ${seatName(room, t)} 交换身份，你换来的角色是【${ROLES[b].name}】。`);
  } else if (r === 'witch') {
    const s = action.seats[0]; const sub = subs[s];
    if (sub.center != null) sendPrivate(room, room.players[s].token, `女巫：你查看的中央底牌是【${ROLES[room.centerCards[sub.center].role].name}】。`);
    if (sub.swapWith != null && sub.swapWith !== s) {
      const a = room.currentRole[s], b = room.currentRole[sub.swapWith];
      room.currentRole[s] = b; room.currentRole[sub.swapWith] = a;
      sendPrivate(room, room.players[s].token, `女巫：你与 ${seatName(room, sub.swapWith)} 交换了身份。`);
    }
  } else if (r === 'troublemaker') {
    const s = action.seats[0]; const sub = subs[s];
    if (sub.a != null && sub.b != null && sub.a !== sub.b) {
      const x = room.currentRole[sub.a], y = room.currentRole[sub.b];
      room.currentRole[sub.a] = y; room.currentRole[sub.b] = x;
      publicLog(room, `捣蛋鬼悄悄交换了两名玩家的身份。`);
    }
  } else if (r === 'sentinel') {
    const s = action.seats[0]; const sub = subs[s];
    if (sub.kind === 'player' && sub.target != null && room.currentRole[sub.target]) room.players[sub.target]._shield = true;
    publicLog(room, `哨兵设置了一面盾牌。`);
  } else if (r === 'alphaWolf') {
    const s = action.seats[0]; const sub = subs[s];
    if (sub.idx != null && sub.target != null && room.centerCards[sub.idx]) {
      const a = room.centerCards[sub.idx].role, b = room.currentRole[sub.target];
      room.centerCards[sub.idx].role = b; room.currentRole[sub.target] = a;
      publicLog(room, `阿尔法狼将一张中央底牌塞入了玩家堆。`);
    }
  } else if (r === 'vampire') {
    const s = action.seats[0]; const t = subs[s].target;
    if (t != null && !isVampire(room, t)) {
      room.marks[t].vampire = true;
      sendPrivate(room, room.players[t].token, `你被吸血鬼标记，现属于【吸血鬼队】！`);
      publicLog(room, `一名玩家被吸血鬼标记。`);
    }
  } else if (r === 'count') {
    const s = action.seats[0]; const t = subs[s].target;
    if (t != null) { room.marks[t].fear = true; publicLog(room, `伯爵对某位玩家施加了恐惧标记。`); }
  } else if (r === 'cupid') {
    const s = action.seats[0]; const sub = subs[s];
    const targets = sub.targets || [];
    if (targets.length === 2 && targets[0] !== targets[1]) {
      room.marks[targets[0]].love = true;
      room.marks[targets[1]].love = true;
      room.lovePair = [targets[0], targets[1]];
      publicLog(room, `丘比特让两名玩家坠入爱河。`);
    }
  } else if (r === 'priest') {
    const s = action.seats[0]; const sub = subs[s];
    room.marks[s].clarity = true;
    const t = sub.target;
    if (t != null && t !== s) {
      // 净化：清除该玩家所有标记
      room.marks[t] = { vampire: false, fear: false, clarity: true, love: false, assassin: false };
      if (room.lovePair && room.lovePair.includes(t)) {
        const other = room.lovePair[0] === t ? room.lovePair[1] : room.lovePair[0];
        room.marks[other].love = false;
        room.lovePair = null;
      }
      sendPrivate(room, room.players[t].token, `牧师净化了你，你的标记已被清除。`);
      publicLog(room, `牧师净化了一名玩家。`);
    }
  } else if (r === 'assassin') {
    const s = action.seats[0]; const t = subs[s].target;
    if (t != null) { room.marks[t].assassin = true; room.assassinTarget = t; }
  } else if (r === 'sharpshooter') {
    const s = action.seats[0]; const sub = subs[s];
    const parts = [];
    if (sub.roleTarget != null) {
      const tr = room.currentRole[sub.roleTarget];
      parts.push(`${seatName(room, sub.roleTarget)} 的身份是【${ROLES[tr].name}】`);
    }
    if (sub.markTarget != null) {
      parts.push(`${seatName(room, sub.markTarget)} 的标记是【${markDesc(room, sub.markTarget)}】`);
    }
    sendPrivate(room, room.players[s].token, `神射手：${parts.join('；') || '（未查看）'}。`);
  } else if (r === 'thief') {
    const s = action.seats[0]; const t = subs[s].target;
    if (t != null && t !== s) {
      const tmp = room.marks[s];
      room.marks[s] = room.marks[t];
      room.marks[t] = tmp;
      // 若交换涉及爱之配对，同步
      if (room.lovePair) {
        const a = room.lovePair[0], b = room.lovePair[1];
        if (a === s || a === t || b === s || b === t) {
          const na = a === s ? t : (a === t ? s : a);
          const nb = b === s ? t : (b === t ? s : b);
          room.lovePair = [na, nb];
        }
      }
      sendPrivate(room, room.players[s].token, `小偷：你现在的标记是【${markDesc(room, s)}】。`);
    }
  } else if (r === 'gremlin') {
    const s = action.seats[0]; const sub = subs[s];
    const a = sub.a, b = sub.b;
    if (a != null && b != null && a !== b) {
      if (sub.mode === 'marks') {
        const tmp = room.marks[a]; room.marks[a] = room.marks[b]; room.marks[b] = tmp;
        if (room.lovePair) {
          const x = room.lovePair[0], y = room.lovePair[1];
          if (x === a || x === b || y === a || y === b) {
            const nx = x === a ? b : (x === b ? a : x);
            const ny = y === a ? b : (y === b ? a : y);
            room.lovePair = [nx, ny];
          }
        }
        publicLog(room, `小魔怪交换了两名玩家的标记。`);
      } else {
        const x = room.currentRole[a], y = room.currentRole[b];
        room.currentRole[a] = y; room.currentRole[b] = x;
        publicLog(room, `小魔怪交换了两名玩家的身份牌。`);
      }
    }
  } else if (r === 'tracker') {
    const s = action.seats[0];
    // 查看本夜实际执行过行动/动过牌的玩家（排除循迹者自己）
    const actors = [...(room.nightActors || new Set())].filter(x => x !== s);
    const names = actors.map(seat => seatName(room, seat));
    sendPrivate(room, room.players[s].token, names.length
      ? `循迹者：本夜在晚上有动作的玩家是 ${names.join('、')}。`
      : `循迹者：本夜似乎没有玩家动过牌。`);
  }
}

function beginDay(room) {
  room.phase = 'day';
  room.currentAction = null;
  room.nightActors = new Set();
  if (room.nightTimer) { clearTimeout(room.nightTimer); room.nightTimer = null; }
  announce(room, '天亮了，请睁眼。现在是白天发言阶段，请大家依次发言。');
  publicLog(room, '天亮了，进入白天发言阶段。');
  // 注意：白天角色卡恒定显示初始身份（见 buildState）。最终身份仅失眠者可在天亮前查看，
  // 已由夜晚 roleReveal('insomniac') 以私有信息告知，此处不再向全员广播。
  room.discussionEndsAt = Date.now() + 5 * 60 * 1000; // 默认 5 分钟讨论
  pushState(room);
}

function startVote(room) {
  if (room.phase !== 'day') return { error: '当前不在发言阶段' };
  room.phase = 'vote';
  room.votes = {};
  room.voteTargetsOpen = true;
  room.discussionEndsAt = null;
  announce(room, '发言结束，现在开始投票。');
  publicLog(room, '进入投票阶段。');
  // 保镖保护行动（机器人保镖自动保护，真人保镖由 UI 选择）
  const bodyguards = room.players.filter(p => room.currentRole[p.seat] === 'bodyguard');
  const humanBG = bodyguards.filter(p => !p.bot);
  const botBG = bodyguards.filter(p => p.bot);
  if (botBG.length) {
    // 机器人保镖随机保护一名其他玩家
    room.protectTarget = randOther(room, botBG[0].seat);
    publicLog(room, '保镖已就位（机器人自动保护）。');
  }
  if (humanBG.length) {
    room.currentAction = { role: 'bodyguard', seats: humanBG.map(p => p.seat), submissions: {} };
    announce(room, '保镖请选择要保护的人（其本票不被放逐）。');
  }
  pushState(room);
  // 机器人自动投票（错峰延时，便于真人观察与参与）
  scheduleBotVotes(room);
  return { ok: true };
}

// 安排所有机器人依次自动投票（不可投自己；阶段变化或已投则跳过）
function scheduleBotVotes(room) {
  const bots = room.players.filter(p => p.bot);
  bots.forEach((p, i) => {
    setTimeout(() => {
      if (room.phase !== 'vote') return;            // 已结算则跳过
      if (room.votes[p.seat] != null) return;        // 已投则跳过
      // 约 15% 概率选择「不投票」（模拟无辜玩家不愿滥投）
      if (Math.random() < 0.15) { handleVote(room, p.token, null); return; }
      const target = randOther(room, p.seat);
      handleVote(room, p.token, target);
    }, 1000 + i * 650);
  });
}

function handleVote(room, token, target) {
  const p = findPlayer(room, token);
  if (!p) return { error: '未知玩家' };
  if (room.phase !== 'vote') return { error: '当前不在投票阶段' };
  // target === null 表示「不投票（弃票）」
  if (target === null) {
    room.votes[p.seat] = null;
    pushState(room);
    if (Object.keys(room.votes).length >= room.players.length) finalizeVote(room);
    return { ok: true };
  }
  if (target === p.seat) return { error: '不能投自己' };
  if (target < 0 || target >= room.players.length) return { error: '目标无效' };
  room.votes[p.seat] = target;
  pushState(room);
  // 所有人都做了选择（含弃票）-> 结算
  if (Object.keys(room.votes).length >= room.players.length) {
    finalizeVote(room);
  }
  return { ok: true };
}

function handleProtect(room, token, target) {
  const p = findPlayer(room, token);
  if (!room.currentAction || room.currentAction.role !== 'bodyguard' || !room.currentAction.seats.includes(p.seat)) return { error: '当前不可保护' };
  room.currentAction.submissions[p.seat] = target;
  if (room.currentAction.seats.every(s => room.currentAction.submissions[s] != null)) {
    // 取第一个保镖的保护目标
    room.protectTarget = room.currentAction.seats.map(s => room.currentAction.submissions[s]).find(t => t != null);
    room.currentAction = null;
    pushState(room);
  }
  return { ok: true };
}

function handleSpeech(room, token, text) {
  const p = findPlayer(room, token);
  if (!p || !text) return { error: 'empty' };
  const line = `🗣 ${p.name}：${text}`;
  publicLog(room, line);
  broadcast(room, 'speech', { name: p.name, text, seat: p.seat });
  return { ok: true };
}

// 投票结算
// 计票：返回最高票（史诗战返回最高+次高）座位数组
function tallyVotes(room) {
  const counts = {};
  for (const seat in room.votes) {
    const t = room.votes[seat];
    if (t == null) continue;
    counts[t] = (counts[t] || 0) + 1;
  }
  const sorted = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a]);
  if (sorted.length === 0) return [];
  const max = counts[sorted[0]];
  const firstTier = sorted.filter(k => counts[k] === max);
  if (!isEpicBattle(room)) return firstTier;
  // 史诗战：至少票死 2 人
  if (firstTier.length >= 2) { publicLog(room, '史诗战：票数最高的玩家将被放逐。'); return firstTier; }
  const top = firstTier.slice();
  const rest = sorted.filter(k => counts[k] < max);
  if (rest.length) {
    const secondMax = counts[rest[0]];
    top.push(...rest.filter(k => counts[k] === secondMax));
  }
  publicLog(room, '史诗战：票数最高的两名玩家将同时被放逐。');
  return top;
}

// 应用王子顺延 / 保镖保护 / 爱之同死 修正，返回最终出局座位 Set
function applyOutModifiers(room, top) {
  let list = top.slice();
  const counts = {};
  for (const seat in room.votes) { const t = room.votes[seat]; if (t != null) counts[t] = (counts[t] || 0) + 1; }
  // 王子顺延
  const princeSeats = room.players.filter(p => room.currentRole[p.seat] === 'prince').map(p => p.seat);
  if (list.length === 1 && princeSeats.includes(list[0])) {
    const others = Object.keys(counts).filter(k => Number(k) !== list[0]).map(Number);
    if (others.length) {
      let m2 = 0; others.forEach(k => m2 = Math.max(m2, counts[k]));
      list = others.filter(k => counts[k] === m2);
      publicLog(room, '王子获得最高票，按规则顺延，由次高票者被放逐。');
    }
  }
  let out = new Set(list);
  // 保镖保护：被保护者不被放逐；若其获最高票，则次高票（≥2票）替死
  if (room.protectTarget != null && out.has(room.protectTarget)) {
    out.delete(room.protectTarget);
    publicLog(room, `保镖保护了 ${seatName(room, room.protectTarget)}，其不被放逐。`);
    // 若出局列表为空（被保护者是唯一最高票），顺延到次高票（需至少2票）
    if (out.size === 0) {
      const counts = {};
      for (const seat in room.votes) { const t = room.votes[seat]; if (t != null) counts[t] = (counts[t] || 0) + 1; }
      const sorted = Object.keys(counts).map(Number).filter(s => s !== room.protectTarget).sort((a, b) => counts[b] - counts[a]);
      if (sorted.length > 0 && counts[sorted[0]] >= 2) {
        out.add(sorted[0]);
        publicLog(room, `保镖替死：${seatName(room, room.protectTarget)} 被保，${seatName(room, sorted[0])}（${counts[sorted[0]]}票）被放逐。`);
      } else {
        publicLog(room, '保镖保护了最高票玩家，且次高票不足2票——无人被放逐。');
      }
    }
  }
  // 爱之标记同生共死
  if (room.lovePair) {
    const [a, b] = room.lovePair;
    if (out.has(a) && !out.has(b)) { out.add(b); publicLog(room, `爱之标记：${seatName(room, b)} 与恋人同死。`); }
    else if (out.has(b) && !out.has(a)) { out.add(a); publicLog(room, `爱之标记：${seatName(room, a)} 与恋人同死。`); }
  }
  return out;
}

function finalizeVote(room) {
  room.voteTargetsOpen = false;
  const top = tallyVotes(room);
  let out = applyOutModifiers(room, top);
  // 猎人：若猎人被放逐，可开枪带一人
  const hunterSeats = room.players.filter(p => room.currentRole[p.seat] === 'hunter').map(p => p.seat);
  const hunterOut = hunterSeats.find(s => out.has(s));
  if (hunterOut != null) {
    const hp = room.players[hunterOut];
    if (hp && hp.bot) {
      // 机器人猎人自动开枪带走一名其他玩家
      const others = otherSeats(room, hunterOut);
      const target = others[rnd(others.length)];
      const top = tallyVotes(room);
      let outSet = applyOutModifiers(room, top);
      outSet.add(target);
      room.hunterPending = null;
      computeResult(room, outSet);
      return;
    }
    room.hunterPending = hunterOut;
    room.phase = 'result_pending_hunter';
    pushState(room);
    broadcast(room, 'hunter', { seat: hunterOut, name: seatName(room, hunterOut) });
    announce(room, `猎人 ${seatName(room, hunterOut)} 被放逐，可以开枪带走一名玩家。`);
    publicLog(room, `猎人 ${seatName(room, hunterOut)} 被放逐，等待开枪。`);
    return;
  }
  computeResult(room, out);
}

function handleHunterShot(room, token, target) {
  const p = findPlayer(room, token);
  if (room.hunterPending == null || p.seat !== room.hunterPending) return { error: '当前猎人不可开枪' };
  const top = tallyVotes(room);
  let outSet = applyOutModifiers(room, top);
  outSet.add(target); // 猎人带人
  room.hunterPending = null;
  computeResult(room, outSet);
  return { ok: true };
}

function computeResult(room, outSet) {
  room.phase = 'result';
  const out = [...outSet];
  const outSeatSet = new Set(out);
  // 出局阵营判定（用最终有效阵营；被吸血鬼标记的狼人视为吸血鬼队，不算狼人死亡）
  const werewolfOut = out.filter(s => room.currentRole[s] === 'werewolf' && !isVampire(room, s));
  const tannerOut = out.filter(s => room.currentRole[s] === 'tanner');
  const vampireOut = out.filter(s => isVampire(room, s));
  const wolvesOnField = room.players.some(p => playerTeam(room, p.seat) === 'wolf');
  const vampsOnField = room.players.some(p => playerTeam(room, p.seat) === 'vampire');
  const epic = wolvesOnField && vampsOnField;

  let winners = [];
  let summary = '';

  if (epic) {
    // 史诗战（狼队 + 吸血鬼队 + 村民 三主要阵营）
    const wolfDied = werewolfOut.length > 0;
    const vampDied = vampireOut.length > 0;
    if (wolfDied && vampDied) { winners = ['village']; summary = '狼人与吸血鬼双双出局，好人（村民）阵营获胜！'; }
    else if (wolfDied && !vampDied) { winners = ['vampire']; summary = '狼人出局、吸血鬼无损，吸血鬼队获胜！'; }
    else if (!wolfDied && vampDied) { winners = ['wolf']; summary = '吸血鬼出局、狼人无损，狼队获胜！'; }
    else { winners = ['wolf', 'vampire']; summary = '狼人与吸血鬼均无损，狼队与吸血鬼队共同获胜！'; }
  } else if (vampsOnField) {
    // 纯吸血鬼局（无狼队）
    if (vampireOut.length) { winners = ['village']; summary = '有吸血鬼被放逐，好人阵营获胜！'; }
    else { winners = ['vampire']; summary = '无吸血鬼被放逐，吸血鬼队获胜！'; }
  } else {
    // 纯狼人局（无吸血鬼）
    if (tannerOut.length && werewolfOut.length === 0) { winners = ['tanner']; summary = '皮匠被放逐且无狼死亡，皮匠独赢！'; }
    else if (werewolfOut.length) { winners = ['village']; summary = '有狼人被放逐，好人阵营获胜！'; }
    else if (!wolvesOnField) {
      // 官方规则：场上无狼（全在中央）时，无人死→好人胜；有人死→狼队(爪牙)胜
      if (out.length === 0) { winners = ['village']; summary = '场上没有狼人，且无人被放逐，好人阵营获胜！'; }
      else { winners = ['wolf']; summary = '场上没有狼人，但有人被放逐（爪牙阴谋得逞），狼队获胜！'; }
    }
    else { winners = ['wolf']; summary = '无狼人被放逐，狼队（含爪牙）获胜！'; }
  }

  // 刺客（独立阵营，可叠加）：刺杀标记目标死亡则刺客获胜
  let assassinWins = false;
  if (room.assassinTarget != null && outSeatSet.has(room.assassinTarget)) {
    assassinWins = true;
    summary += ' 刺客标记目标死亡，刺客同时获胜！';
  }

  // 每个玩家胜负
  const perPlayer = room.players.map(p => {
    const rk = room.currentRole[p.seat];
    const r = ROLES[rk];
    const team = playerTeam(room, p.seat);
    let win = false;
    if (team === 'wolf') win = winners.includes('wolf');
    else if (team === 'vampire') win = winners.includes('vampire');
    else if (team === 'tanner') win = winners.includes('tanner');
    else if (team === 'assassin') win = assassinWins;
    else win = winners.includes('village');
    return { seat: p.seat, name: p.name, role: rk, roleName: r.name, team, out: outSeatSet.has(p.seat), win, bot: !!p.bot };
  });

  room.result = { summary, winners: winners.concat(assassinWins ? ['assassin'] : []), out, perPlayer, center: room.centerCards.map(c => ({ role: c.role, name: ROLES[c.role].name })) };
  announce(room, '投票结束。' + summary);
  publicLog(room, '游戏结束：' + summary);
  pushState(room);
}

function restartGame(room) {
  room.phase = 'lobby';
  room.currentAction = null;
  room.result = null;
  room.votes = {};
  room.privateInfo = {};
  room.queue = []; room.qIndex = -1;
  if (room.nightTimer) { clearTimeout(room.nightTimer); room.nightTimer = null; }
  pushState(room);
}

// 玩家离开房间（房主可随时退出回首页）
function removePlayer(room, p) {
  const idx = room.players.findIndex(x => x.token === p.token);
  if (idx < 0) return;
  room.players.splice(idx, 1);
  room.sse = room.sse.filter(c => c.token !== p.token);
  room.voice.delete(p.token);
  if (room.players.length === 0) { rooms.delete(room.code); return; }
  // 重新编排座位号（删掉被移除者，其余前移）
  room.players.forEach((pl, i) => pl.seat = i);
  if (room.phase !== 'lobby' && room.phase !== 'result') shiftSeat(room, idx);
  if (room.hostToken === p.token) room.hostToken = room.players[0].token;
  if (room.players.length) broadcast(room, 'voice', { seats: voiceSeats(room) });
  pushState(room);
}

// 游戏中途移除某座位后，按新座位号平移各数组/映射
function shiftSeat(room, removed) {
  const shiftArr = (arr) => { if (Array.isArray(arr)) arr.splice(removed, 1); };
  shiftArr(room.currentRole); shiftArr(room.initialRole);
  const m = {};
  for (const k in room.marks) { const s = Number(k); if (s === removed) continue; m[s > removed ? s - 1 : s] = room.marks[k]; }
  room.marks = m;
  const v = {};
  for (const k in room.votes) { const s = Number(k); if (s === removed) continue; v[s > removed ? s - 1 : s] = room.votes[k]; }
  room.votes = v;
  if (Array.isArray(room.lovePair)) room.lovePair = room.lovePair.filter(s => s !== removed).map(s => s > removed ? s - 1 : s);
  if (room.currentAction && Array.isArray(room.currentAction.seats)) {
    room.currentAction.seats = room.currentAction.seats.filter(s => s !== removed).map(s => s > removed ? s - 1 : s);
  }
}

// ----------------------------- HTTP / SSE -----------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// 基于文件内容生成短哈希，用作静态资源版本号（内容变化→URL 变化→绕过任何平台层强缓存）
function fileHash(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 8); } catch (_) { return '0'; }
}

// 全局资源版本号：每次部署/重启都不同，拼到静态资源 URL 上形成 cache-busting，
// 彻底解决“换了头像但浏览器/平台仍显示旧图”的强缓存问题。
function getAssetVer() {
  try {
    const { execSync } = require('child_process');
    const h = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
    if (h) return h;
  } catch (_) {}
  return String(Date.now());
}
const ASSET_VER = getAssetVer();

function serveStatic(req, res, pathname, isVersioned) {
  let f = pathname === '/' ? '/index.html' : pathname;
  const fp = path.join(PUBLIC_DIR, path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(fp);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') {
      // 将引用的 CSS/JS 内联进 HTML，把 4 次请求（HTML+3资源）压成 1 次，显著加快首屏；
      // 同时整个应用只由 index.html 这一份 no-cache 文件承载，彻底规避平台层对单独 JS 的强缓存
      // 导致的“更新后按钮失效 / 页面加载慢（多轮次代理延迟）”问题。源文件仍保持模块化，便于维护。
      let html = data.toString('utf8');
      html = html.replace(/<link\b[^>]*\shref="(\/[^"]+\.css)"[^>]*>/g, (m, href) => {
        try { const css = fs.readFileSync(path.join(PUBLIC_DIR, href), 'utf8'); return `<style>\n${css}\n</style>`; } catch (_) { return m; }
      });
      html = html.replace(/<script\b[^>]*\ssrc="(\/[^"]+\.js)"[^>]*><\/script>/g, (m, src) => {
        try { const js = fs.readFileSync(path.join(PUBLIC_DIR, src), 'utf8').replace(/<\/script/gi, '<\\/script'); return `<script>\n${js}\n</script>`; } catch (_) { return m; }
      });
      data = Buffer.from(html, 'utf8');
      // 注入资源版本号，供前端拼到头像等静态资源 URL 上做 cache-busting
      data = Buffer.concat([Buffer.from(`<script>window.__ASSET_VER__=${JSON.stringify(ASSET_VER)};</script>`), data]);
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else if (ext === '.js' || ext === '.css') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else {
      // 版本化资源（URL 带 ?v=，即内容稳定，如角色头像）：长缓存，图鉴/重复访问秒出，绝不反复重下
      headers['Cache-Control'] = isVersioned ? 'public, max-age=86400' : 'no-cache, no-store, must-revalidate';
    }
    // 对未版本化的响应（首页 HTML / 内联 JS / CSS）加 ETag 协商缓存：
    // 弱网/部署环境下重复访问返回 304（不重传），显著加快“首页→开局”的响应。
    if (!isVersioned) {
      const etag = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
      headers['ETag'] = etag;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function sendJSON(res, obj, code = 200) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS（便于本地跨设备访问）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && pathname === '/api/presets') {
    return sendJSON(res, PRESETS.map(p => ({ id: p.id, name: p.name, forCount: p.forCount, cards: p.cards.map(c => ROLES[c].name), hasDusk: p.hasDusk })));
  }
  if (req.method === 'GET' && pathname === '/api/stream') {
    const { code, token } = parsed.query;
    const room = rooms.get(code);
    if (!room || !token || !findPlayer(room, token)) { res.writeHead(400); res.end('invalid'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const client = { token, res };
    room.sse.push(client);
    const p = findPlayer(room, token); if (p) p.connected = true;
    // 立即推送当前状态
    res.write(`event: state\ndata: ${JSON.stringify(buildState(room, p))}\n\n`);
    req.on('close', () => {
      room.sse = room.sse.filter(c => c !== client);
      const pp = findPlayer(room, token); if (pp) pp.connected = room.sse.some(c => c.token === token);
      if (room.voice.has(token)) { room.voice.delete(token); broadcast(room, 'voice', { seats: voiceSeats(room) }); }
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/create') {
    let body = ''; req.on('data', d => body += d);
    req.on('end', () => {
      let name = '玩家', capacity = 5;
      try { const o = JSON.parse(body); name = (o.name || '玩家').toString().slice(0, 16); capacity = Number(o.capacity) || 5; } catch (_) {}
      if (capacity < 3 || capacity > 7) capacity = 5;
      const room = makeRoom(name, capacity);
      const token = genToken();
      room.hostToken = token;
      room.players.push({ token, name, seat: 0, connected: true, ready: false });
      sendJSON(res, { code: room.code, token, seat: 0 });
      pushState(room);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/join') {
    let body = ''; req.on('data', d => body += d);
    req.on('end', () => {
      let name = '玩家', code = '';
      try { const o = JSON.parse(body); name = (o.name || '玩家').toString().slice(0, 16); code = (o.code || '').toString(); } catch (_) {}
      const room = rooms.get(code);
      if (!room) return sendJSON(res, { error: '房间不存在' }, 404);
      if (room.phase !== 'lobby') return sendJSON(res, { error: '游戏已开始，无法加入' }, 409);
      if (room.players.length >= room.capacity) return sendJSON(res, { error: `房间已满（最多 ${room.capacity} 人）` }, 409);
      const token = genToken();
      const seat = room.players.length;
      room.players.push({ token, name, seat, connected: true, ready: false });
      sendJSON(res, { code: room.code, token, seat });
      pushState(room);
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/action') {
    let body = ''; req.on('data', d => body += d);
    req.on('end', () => {
      let o; try { o = JSON.parse(body); } catch (_) { return sendJSON(res, { error: 'bad json' }, 400); }
      const { token, type, payload } = o;
      const room = [...rooms.values()].find(r => findPlayer(r, token));
      if (!room) return sendJSON(res, { error: '房间不存在' }, 404);
      const p = findPlayer(room, token);
      if (!p) return sendJSON(res, { error: '玩家不存在' }, 404);
      let result = { ok: true };
      switch (type) {
        case 'setPreset':
          if (room.phase !== 'lobby') return sendJSON(res, { error: '游戏中不可改阵容' });
          if (p.token !== room.hostToken) return sendJSON(res, { error: '仅房主可操作' });
          if (PRESETS.find(x => x.id === payload.presetId)) { room.presetId = payload.presetId; room.roleDeck = null; pushState(room); }
          break;
        case 'setCustom': {
          if (room.phase !== 'lobby') return sendJSON(res, { error: '游戏中不可改阵容' });
          if (p.token !== room.hostToken) return sendJSON(res, { error: '仅房主可操作' });
          const roles = Array.isArray(payload && payload.roles) ? payload.roles.filter(k => ROLES[k]) : [];
          if (roles.length < 3) return sendJSON(res, { error: '至少选择 3 个角色' }, 400);
          const expected = room.capacity + 3;
          if (roles.length !== expected) {
            // 软提示：不拒绝（玩家可能还在加入），但返回警告
            room.roleDeck = roles; room.presetId = null; pushState(room);
            return sendJSON(res, { ok: true, warning: `当前${room.capacity}人局建议选 ${expected} 张牌（你选了 ${roles.length} 张），开始游戏时会严格校验。` });
          }
          room.roleDeck = roles; room.presetId = null; pushState(room);
          break;
        }
        case 'ready':
          p.ready = !p.ready; pushState(room); break;
        case 'leave':
          removePlayer(room, p); break;
        case 'addBot': {
          if (p.token !== room.hostToken) return sendJSON(res, { error: '仅房主可操作' }, 403);
          if (room.phase !== 'lobby') return sendJSON(res, { error: '游戏中无法添加机器人' }, 400);
          let count = 0;
          if (payload && payload.fill) count = room.capacity - room.players.length;
          else count = Number(payload && payload.count) || 1;
          if (count < 1) return sendJSON(res, { error: '无法再添加机器人' }, 409);
          let added = 0;
          while (added < count && room.players.length < room.capacity) {
            const seat = room.players.length;
            const token = genToken();
            const name = `🤖机器人${room.players.length + 1}`;
            room.players.push({ token, name, seat, connected: true, ready: true, bot: true });
            added++;
          }
          if (added === 0) return sendJSON(res, { error: '房间已满，无法再添加机器人' }, 409);
          pushState(room);
          return sendJSON(res, { ok: true, added });
        }
        case 'start':
          if (p.token !== room.hostToken) return sendJSON(res, { error: '仅房主可开始' });
          result = startGame(room); if (result.error) return sendJSON(res, result, 400); break;
        case 'nightAction':
          result = handleNightAction(room, token, payload || {}); if (result.error) return sendJSON(res, result, 400); break;
        case 'speech':
          result = handleSpeech(room, token, (payload && payload.text) || ''); break;
        case 'startVote':
          if (p.token !== room.hostToken) return sendJSON(res, { error: '仅房主可发起投票' });
          result = startVote(room); if (result.error) return sendJSON(res, result, 400); break;
        case 'vote':
          result = handleVote(room, token, payload && payload.target); if (result.error) return sendJSON(res, result, 400); break;
        case 'protect':
          result = handleProtect(room, token, payload && payload.target); if (result.error) return sendJSON(res, result, 400); break;
        case 'hunterShot':
          result = handleHunterShot(room, token, payload && payload.target); if (result.error) return sendJSON(res, result, 400); break;
        case 'restart':
          if (p.token !== room.hostToken) return sendJSON(res, { error: '仅房主可重开' });
          restartGame(room); break;
        case 'ping': break;
      case 'voice': {
        const sub = payload && payload.subtype;
        if (sub === 'join') { room.voice.add(token); broadcast(room, 'voice', { seats: voiceSeats(room) }); }
        else if (sub === 'leave') { room.voice.delete(token); broadcast(room, 'voice', { seats: voiceSeats(room) }); }
        else if (sub === 'invite') {
          // 发起者邀请房间内其他玩家加入语音通话
          const payloadStr = `event: voice_invite\ndata: ${JSON.stringify({ fromSeat: p.seat, fromName: p.name })}\n\n`;
          for (const c of room.sse) { if (c.token !== token) try { c.res.write(payloadStr); } catch (_) {} }
        }
        else if (sub === 'signal') { const to = seatToToken(room, payload.to); if (to && to !== token) pushTo(room, to, 'signal', { from: p.seat, data: payload.data }); }
        break;
      }
        default: return sendJSON(res, { error: 'unknown action' }, 400);
      }
      return sendJSON(res, result);
    });
    return;
  }

  if (req.method === 'GET') {
    const isVersioned = !!(parsed.query && parsed.query.v);
    return serveStatic(req, res, pathname, isVersioned);
  }
  res.writeHead(405); res.end('method not allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`一夜狼人杀在线版已启动： http://localhost:${PORT}`);
  console.log(`同局域网手机访问： http://<本机IP>:${PORT}`);
});
