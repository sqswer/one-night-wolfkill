// 验证所有预设的牌数 = forCount + 3
const fs = require('fs');
const code = fs.readFileSync('server.js', 'utf8');

// 用简单字符串匹配统计每个预设
const lines = code.split('\n');
let currentCount = 0;
let currentCards = [];
let total = 0;
let allOk = true;

for (const line of lines) {
  const fcMatch = line.match(/forCount:\s*(\d+)/);
  if (fcMatch) {
    currentCount = parseInt(fcMatch[1]);
  }
  const cardsMatch = line.match(/cards:\s*\[(.*)\]/);
  if (cardsMatch) {
    const cardStr = cardsMatch[1];
    const cc = (cardMatch = cardStr.match(/'([^']+)'/g)) ? cardMatch.length : 0;
    const expected = currentCount + 3;
    const ok = cc === expected;
    total++;
    if (!ok) {
      console.log(`❌ ${currentCount}人预设: ${cc}张牌 (需${expected}张)`);
      allOk = false;
    } else {
      console.log(`✅ ${currentCount}人预设: ${cc}张牌`);
    }
  }
}
console.log(`\n共 ${total} 套预设, ${allOk ? '全部正确' : '有错误'}`);
