// Deviled Egg Russian Roulette v1.6 — Round 8 playtest v3 (Pablo QA)
// Fresh chrome per run, reload after connect, state-machine driven.
const { spawn, execSync } = require('child_process');
const CHROME = '/usr/bin/chromium';
const URL = 'file:///workspace/round8/index.html';
const PORT = 9500 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let fails = 0;
const ok = (cond, label, extra) => {
  if (cond) console.log('  PASS', label);
  else { fails++; console.log('  FAIL', label, extra !== undefined ? JSON.stringify(extra) : ''); }
};

async function main() {
  try { execSync('pkill -f "pablo-r8" 2>/dev/null; true'); } catch (e) {}
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=' + PORT,
    '--window-size=412,780',
    '--user-data-dir=/tmp/pablo-r8-' + PORT, URL
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = list.find(t => t.type === 'page'); } catch (e) {}
  }
  if (!target) { console.log('NO TARGET'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      fails++; console.log('PAGE EXCEPTION:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  };
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.reload'); await sleep(1200);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) { console.log('EVAL EXC:', r.exceptionDetails.exception?.description || r.exceptionDetails.text); return null; }
    return r.result.value;
  };

  const snap = () => ev(`(() => {
    const od = document.getElementById('od');
    const os = document.getElementById('os');
    return {
      st: JSON.parse(JSON.stringify(st)), lg: JSON.parse(JSON.stringify(lg)), best,
      eggs: Array.from(document.querySelectorAll('#pt .eg')).map(e => ({ cr: !!e.cr })),
      odVisible: !od.classList.contains('hi'),
      odt: od.classList.contains('hi') ? null : document.getElementById('odt').innerHTML,
      osVisible: !os.classList.contains('hi'),
      ui: {
        sc: document.getElementById('sc').textContent,
        pl: document.getElementById('pl').textContent,
        lv: document.getElementById('lv').textContent,
        star: document.getElementById('stt').textContent
      },
      propsHidden: document.getElementById('sy').classList.contains('hi') && document.getElementById('cn').classList.contains('hi'),
      cn: (() => { const r = document.getElementById('cn').getBoundingClientRect(); return { t: r.top, b: r.bottom }; })(),
      sy: (() => { const r = document.getElementById('sy').getBoundingClientRect(); return { t: r.top, b: r.bottom }; })(),
      hu: (() => { const r = document.getElementById('hu').getBoundingClientRect(); return { t: r.top, b: r.bottom }; })(),
      plEl: (() => { const r = document.getElementById('pl').getBoundingClientRect(); return { t: r.top, b: r.bottom }; })()
    };
  })()`);

  const waitStable = async () => {
    for (let i = 0; i < 40; i++) {
      const s = await snap();
      if (s.odVisible || s.osVisible || !s.st.bs) { await sleep(300); return s; }
      await sleep(150);
    }
    return snap();
  };

  const clickEgg = async (idx) => {
    await ev(`(() => { const es = document.querySelectorAll('#pt .eg'); if (es[${idx}]) es[${idx}].click(); })()`);
    return waitStable();
  };

  const clearPlate = async (label) => {
    let guard = 0;
    while (guard++ < 8) {
      const s = await snap();
      if (s.odVisible || s.osVisible) return s;
      const clean = s.eggs.findIndex(e => !e.cr);
      if (clean === -1) { await sleep(400); continue; }
      const after = await clickEgg(clean);
      if (after.lg.length > s.lg.length && after.lg[after.lg.length - 1].wa === 0) return after;
      if (after.odVisible || after.osVisible) return after;
    }
    return snap();
  };

  const deal = async (take, label) => {
    await ev(`document.getElementById('${take ? 'ody' : 'odp'}').click()`);
    const s = await waitStable();
    ok(!s.odVisible, `overlay closed after ${take ? 'TAKE' : 'DECLINE'} @${label}`);
    return s;
  };

  const assertDealCounts = (s, nw, label) => {
    ok(s.odt && s.odt.includes(`next plate: 6 eggs, ${nw} wasabi`) && s.odt.includes(`the devil's plate: 6 eggs, ${nw + 1} wasabi`),
       `deal states real counts (${nw} vs ${nw + 1}) @${label}`, s.odt);
  };

  const dieOnPlate = async (label) => {
    const s0 = await snap();
    const was = s0.eggs.findIndex(e => e.cr);
    if (was === -1) { console.log('  NOTE no wasabi @' + label); return null; }
    const after = await clickEgg(was);
    const en = after.lg[after.lg.length - 1];
    ok(en.dv === true && en.wa === s0.st.pp + 1 && en.eg === s0.st.pp && en.pl === s0.st.pl,
       `ledger: devil death truthful @${label}`, { en, b: s0.st });
    return { before: s0, after };
  };

  const reset = async () => {
    const vis = await ev(`document.getElementById('os').classList.contains('hi') ? 'ts' : 'os'`);
    await ev(`document.getElementById('${vis}').click()`);
    return waitStable();
  };

  const cc = (p) => p >= 5 ? 3 : p >= 3 ? 2 : 1;

  // ===== RUN 1: scripted full contract =====
  console.log('=== RUN 1: scripted contract ===');
  let s = await reset();
  ok(s.st.pl === 1 && s.st.cu === 1 && s.st.sc === 0 && s.st.lv === 3 && s.st.star === 0, 'fresh game: plate 1, 1 wasabi, 3 lives, 0 stars', s.st);
  const title = await ev(`document.querySelector('#ts .su').textContent`);
  ok(/then two\. then three\./i.test(title) && /devil deals/i.test(title), 'title truth: "then two. then three." + devil deals', title);

  // A: clear p1 -> decline x2 (deal states real counts every offer)
  for (const [pl, nw] of [[1, 1], [2, 2], [3, 2]]) {
    s = await clearPlate('p' + pl);
    ok(s.odVisible, `deal offered after clearing plate ${pl}`);
    assertDealCounts(s, nw, 'p' + pl);
    if (pl < 3) {
      s = await deal(false, 'p' + pl);
      ok(s.st.dv === false && s.st.pl === pl + 1 && s.st.cu === cc(pl + 1), `declined: plate ${pl + 1} normal difficulty`, s.st);
    }
  }
  // B: take on p3 -> die on devil p4 (3->2), respawn normal
  s = await deal(true, 'p3');
  ok(s.st.dv === true && s.st.pl === 4 && s.st.cu === 3, 'TAKE: devil plate 4, 3 wasabi', s.st);
  const d1 = await dieOnPlate('devil p4');
  ok(d1.after.st.lv === 2, 'death: 3->2 lives');
  ok(d1.after.st.dv === false && d1.after.st.cu === 2 && d1.after.st.pp === 0 && d1.after.st.pl === 4, 'respawn: plate 4 normal, dv cleared, pp reset', d1.after.st);
  // C: clear p4 -> take -> die on devil p5 (2->1)
  s = await clearPlate('p4');
  ok(s.odVisible, 'deal offered after p4'); assertDealCounts(s, 3, 'p4');
  s = await deal(true, 'p4');
  ok(s.st.pl === 5 && s.st.cu === 4, 'TAKE: devil plate 5, 4 wasabi', s.st);
  const d2 = await dieOnPlate('devil p5');
  ok(d2.after.st.lv === 1, 'death: 2->1 lives');
  ok(d2.after.st.dv === false && d2.after.st.cu === 3, 'respawn: plate 5 normal, dv cleared', d2.after.st);
  // D: clear p5 -> take -> CLEAR devil p6 -> star, header star live, no new deal
  s = await clearPlate('p5');
  ok(s.odVisible, 'deal offered after p5'); assertDealCounts(s, 3, 'p5');
  s = await deal(true, 'p5');
  ok(s.st.pl === 6 && s.st.cu === 4, 'TAKE: devil plate 6, 4 wasabi', s.st);
  s = await clearPlate('devil p6');
  ok(s.st.star === 1, 'star earned for clearing the devil plate', s.st);
  ok(s.ui.star === '\u2605 1', 'header shows live star', s.ui);
  const starEntry = s.lg[s.lg.length - 1];
  ok(starEntry.dv === true && starEntry.wa === 0 && starEntry.pl === 6 && starEntry.eg === 2, 'ledger: star entry {pl:6, eg:2, wa:0, dv:true}', starEntry);
  ok(!s.odVisible && s.st.pl === 7 && s.st.dv === false && s.st.cu === 3, 'no new deal after devil clear; plate 7 normal', s.st);
  // E: clear p7 -> take -> die on devil p8 as LAST life -> game over, devil collects, star entry visible
  s = await clearPlate('p7');
  ok(s.odVisible, 'deal offered after p7'); assertDealCounts(s, 3, 'p7');
  s = await deal(true, 'p7');
  ok(s.st.pl === 8 && s.st.cu === 4, 'TAKE: devil plate 8, 4 wasabi', s.st);
  const d3 = await dieOnPlate('devil p8');
  ok(d3.after.osVisible && d3.after.st.lv === 0, 'final devil-plate death: game over');
  const ep = await ev(`document.getElementById('ep').textContent`);
  ok(ep === 'the devil collects. no star for you.', 'epitaph: devil collects, no star', ep);
  const fn = await ev(`document.getElementById('fn').textContent`);
  ok(fn === 'you ate ' + d3.after.st.sc + ' eggs.', 'fn text == st.sc', { fn, sc: d3.after.st.sc });
  const gos = await snap();
  ok(gos.propsHidden, 'candle + soy hidden on game over');
  const footer = await ev(`document.getElementById('lgd').textContent`);
  ok(footer.includes('1 star in the book. the devil respects you.'), 'footer: 1 star in the book, devil respects you', footer);
  // stars render on the visible star entry (should be in window: entries = p1c,p2c,p3c,p4d,p4c,p5d,p5c,p6*C,p7c,p8d = 10, window shows last 6 -> p6*C visible)
  const lgHtml = await ev(`document.getElementById('lgd').innerHTML`);
  const starMarks = (lgHtml.match(/\u2605/g) || []).length;
  ok(starMarks === 1, 'exactly one rendered star mark (the cleared devil plate entry)', { starMarks, lgHtml: lgHtml.slice(0, 700) });
  ok(/PLATE 6 \u00b7 2 EGGS \u00b7 PLATE CLEAR \u00b7 DEVIL \u2605/.test(lgHtml), 'star entry line renders "PLATE CLEAR · DEVIL ★"', lgHtml);
  const br = await ev(`document.getElementById('br').textContent`);
  ok(br.includes('new record'), 'best: new record on first game over', br);
  // ledger star-truth: st.star equals count of star entries; all entries bounded
  const starCount = gos.lg.filter(en => en.dv && en.wa === 0).length;
  ok(starCount === gos.st.star, 'st.star == number of devil-clear entries', { starCount, star: gos.st.star });
  let ledgerOk = true;
  for (const en of gos.lg) {
    if (en.wa === 0) { if (en.eg < 0 || en.eg > 5 || en.eg !== 6 - (cc(en.pl) + (en.dv ? 1 : 0))) ledgerOk = false; }
    else if (en.wa < 1 || en.wa > 6 || en.eg !== en.wa - 1) ledgerOk = false;
  }
  ok(ledgerOk, 'every ledger entry matches true plate geometry (eg = 6 - wasabi count)', gos.lg);

  // ===== RUN 2: blind run =====
  console.log('=== RUN 2: blind run (first egg, alternate deals) ===');
  s = await reset();
  ok(s.st.pl === 1 && s.st.sc === 0 && s.st.lv === 3 && s.st.star === 0, 'reset clears everything');
  let take = false, clicks = 0;
  while (clicks < 60) {
    s = await snap();
    if (s.osVisible) break;
    if (s.odVisible) { s = await deal(take, 'blind#' + clicks); take = !take; continue; }
    if (s.eggs.length === 0) { await sleep(400); continue; }
    const before = s;
    const after = await clickEgg(0);
    clicks++;
    if (after.lg.length > before.lg.length) {
      const en = after.lg[after.lg.length - 1];
      const died = before.st.lv > after.st.lv;
      if (died) ok(en.wa === before.st.pp + 1 && en.eg === before.st.pp && en.pl === before.st.pl, `blind death entry truthful @${clicks}`, { en, b: before.st });
      else {
        ok(en.wa === 0 && en.eg === before.st.pp + 1 && en.pl === before.st.pl, `blind clear entry truthful @${clicks}`, { en, b: before.st });
        if (en.dv) ok(after.st.star === before.st.star + 1, `star incremented on devil clear @${clicks}`);
      }
    }
    const ui = (await snap());
    ok(ui.ui.sc === 'eggs: ' + ui.st.sc && ui.ui.pl === 'PLATE ' + ui.st.pl && ui.ui.lv === '\u2665'.repeat(Math.max(0, ui.st.lv)) && ui.ui.star === '\u2605 ' + ui.st.star,
       `UI/st consistent @blind@${clicks}`, { ui: ui.ui, st: ui.st });
  }
  ok(s.osVisible, 'blind run reached game over');
  console.log('  blind summary: clicks=' + clicks + ' sc=' + s.st.sc + ' star=' + s.st.star + ' entries=' + s.lg.length);
  let blindOk = true;
  for (const en of s.lg) {
    if (en.wa === 0) { if (en.eg < 0 || en.eg > 5) blindOk = false; }
    else if (en.wa < 1 || en.wa > 6 || en.eg !== en.wa - 1) blindOk = false;
  }
  ok(blindOk, 'blind ledger entries truthful', s.lg);
  const bestText = await ev(`document.getElementById('br').textContent`);
  ok(/best:/i.test(bestText), 'best text now shows previous best', bestText);

  // ===== viewport geometry =====
  console.log('=== viewport geometry ===');
  s = await reset();
  for (const [w, h, name] of [[412, 780, 'phone'], [412, 600, 'short-phone'], [1280, 600, 'landscape']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const g = await snap();
    const cnOver = g.cn.b > g.hu.t && g.cn.t < g.plEl.b;
    const syOver = g.sy.b > g.hu.t && g.sy.t < g.plEl.b;
    console.log(`  ${name} ${w}x${h}: candle ${Math.round(g.cn.t)}-${Math.round(g.cn.b)} header ${Math.round(g.hu.t)}-${Math.round(g.plEl.b)} -> ${cnOver ? 'OVERLAP' : 'clear'}`);
    ok(!cnOver && !syOver, `no header/label overlap @${name}`);
  }

  console.log('\nRESULT:', fails === 0 ? 'ALL PASS — CLEAN PLATE' : fails + ' FAIL(S)');
  chrome.kill();
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(e => { console.log('FATAL', e); process.exit(2); });