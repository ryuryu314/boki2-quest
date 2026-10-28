/* ドパミン演出エンジン。宅建版の SFX・粒子・Muse を土台に、合成効果音・ハンコ・コイン・バナーを拡張。
   効果音は Web Audio でその場で合成し、音源ファイルや外部通信は使わない。
   画面の動きは canvas と transform/opacity に限り、iPhone でも重くしない。 */
(function () {
'use strict';
const semi = (f, s) => f * Math.pow(2, s / 12), rand = (a, b) => a + Math.random() * (b - a);
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const HUES = ['#ff3d9a', '#ffb300', '#29a3f0', '#7c4dff', '#2ecc71', '#ff7a00'];
// コンプレッサー手前の音量。OfflineAudioContextで実測し、正解音が従来版と同じ大きさになる値（自動メイクアップは働かない）。
const TRIM = 1;

/* ================= synth: 合成効果音 ================= */
// ac は AudioContext（本番）か OfflineAudioContext（検証）。always は検証用で、状態や音量を問わず鳴らす。
function createSynth(ac, opt = {}) {
  const level = opt.level || (() => .6), always = !!opt.always, wall = () => performance.now();
  let master = null, bus = null, verbIn = null, noiseBuf = null, built = false, voices = [];
  if (ac) { master = ac.createGain(); master.gain.value = level(); master.connect(ac.destination); bus = master; }
  function build() {
    if (built) return; built = true;
    // 和音が重なっても割れないよう、穏やかなコンプレッサーを通す。
    try {
      const comp = ac.createDynamicsCompressor(), trim = ac.createGain();
      comp.threshold.value = -9; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = .003; comp.release.value = .22;
      trim.gain.value = TRIM; trim.connect(comp); comp.connect(master); bus = trim;
    } catch (e) { bus = master; }
    // 生成したインパルス応答による小部屋程度の残響。
    try {
      const rate = ac.sampleRate, len = Math.floor(rate * 1.4), ir = ac.createBuffer(2, len, rate), conv = ac.createConvolver(), wet = ac.createGain();
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      conv.buffer = ir; wet.gain.value = .28; verbIn = ac.createGain(); verbIn.connect(conv); conv.connect(wet); wet.connect(bus);
    } catch (e) { verbIn = null; }
    try { noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } catch (e) { noiseBuf = null; }
  }
  const live = () => !!ac && (always || (ac.state === 'running' && level() > 0));
  // 同時発音の目安。連打される小さな音だけを上限で間引く。
  function busy(cap) { const t = wall(); voices = voices.filter(e => e > t); return voices.length >= cap; }
  const claim = sec => { voices.push(wall() + sec * 1000 + 40); };
  function route(node, t, o) {
    let n = node;
    if (o.pan && ac.createStereoPanner) { try { const p = ac.createStereoPanner(); p.pan.setValueAtTime(Math.max(-1, Math.min(1, o.pan)), t); n.connect(p); n = p; } catch (e) { n = node; } }
    n.connect(bus);
    if (o.verb && verbIn) { const s = ac.createGain(); s.gain.value = o.verb; n.connect(s); s.connect(verbIn); }
  }
  function env(g, t, vol, a, dur) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(.0001, t + Math.max(a + .012, dur)); }
  function tone(f, dur, type = 'square', vol = .2, when = 0, slide = 0, o = {}) {
    if (!live()) return; build();
    const t = ac.currentTime + Math.max(0, when), osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
    if (o.detune && osc.detune) osc.detune.setValueAtTime(o.detune, t);
    let src = osc;
    if (o.lp) { const bq = ac.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.setValueAtTime(o.lp, t); bq.Q.value = o.q || .7; osc.connect(bq); src = bq; }
    src.connect(g); env(g, t, vol, o.attack || .006, dur); route(g, t, o);
    osc.start(t); osc.stop(t + dur + .05); claim(when + dur);
  }
  function noise(dur, vol = .2, when = 0, o = {}) {
    if (!live()) return; build(); if (!noiseBuf) return;
    const t = ac.currentTime + Math.max(0, when), src = ac.createBufferSource(), bq = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf; src.loop = true;
    bq.type = o.type || 'bandpass'; bq.frequency.setValueAtTime(o.f || 2000, t);
    if (o.to) bq.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    bq.Q.value = o.q == null ? 1 : o.q;
    src.connect(bq); bq.connect(g); env(g, t, vol, o.attack || .003, dur); route(g, t, o);
    src.start(t, Math.random() * .5); src.stop(t + dur + .05); claim(when + dur);
  }
  // ---- 楽器 ----
  const kick = (when = 0, vol = .4, f0 = 160, f1 = 45, dur = .16) => tone(f0, dur, 'sine', vol, when, f1 / f0, { attack: .002 });
  const crash = (when = 0, vol = .1, dur = 1.3) => noise(dur, vol, when, { type: 'highpass', f: 5200, q: .4, verb: .5 });
  const swish = (when = 0, vol = .08, up = true, dur = .22) => noise(dur, vol, when, { f: up ? 500 : 3200, to: up ? 3800 : 420, q: 1.3, attack: dur * .45 });
  const timp = (when = 0, f = 98, vol = .3) => { tone(f, .55, 'sine', vol, when, .8, { attack: .003, verb: .25 }); noise(.06, vol * .25, when, { type: 'lowpass', f: 700 }); };
  function bell(f, when = 0, vol = .1, dur = .9, pan = 0) {
    [[1, 1, 1], [2.76, .35, .5], [5.4, .15, .25]].forEach(([m, v, d]) => { if (f * m < 12000) tone(f * m, dur * d, 'sine', vol * v, when, 0, { attack: .002, verb: .32, pan }); });
  }
  function sparkle(n = 5, when = 0, vol = .04, base = 2093) {
    const top = Math.min(base, 2093);
    for (let i = 0; i < n; i++) tone(semi(top, PENTA[Math.random() * 6 | 0]), rand(.07, .15), 'sine', vol, when + i * rand(.025, .05), 0, { attack: .002, pan: rand(-.7, .7), verb: .45 });
  }
  function lead(f, when, dur, vol = .05) {
    tone(f, dur, 'sawtooth', vol, when, 0, { lp: Math.min(5000, f * 4), q: 1, attack: .015, verb: .2 });
    tone(f, dur, 'square', vol * .5, when, 0, { lp: Math.min(4000, f * 3), attack: .015, detune: 6 });
  }
  // 金管風の和音: ノコギリ波2本をずらし、フィルターを一瞬開いて閉じる。
  function brass(freqs, when = 0, dur = .5, vol = .03) {
    if (!live()) return; build();
    for (const f of freqs) for (const d of [-9, 9]) {
      const t = ac.currentTime + Math.max(0, when), o = ac.createOscillator(), bq = ac.createBiquadFilter(), g = ac.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); if (o.detune) o.detune.setValueAtTime(d, t);
      bq.type = 'lowpass'; bq.Q.value = 1.2; bq.frequency.setValueAtTime(Math.min(4000, f * 1.5), t);
      bq.frequency.exponentialRampToValueAtTime(Math.min(9000, f * 7), t + .05); bq.frequency.exponentialRampToValueAtTime(Math.min(6000, f * 2.6), t + dur);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .03); g.gain.setValueAtTime(vol, t + Math.max(.04, dur * .7)); g.gain.exponentialRampToValueAtTime(.0001, t + dur + .1);
      o.connect(bq); bq.connect(g); route(g, t, { pan: d / 25, verb: .22 }); o.start(t); o.stop(t + dur + .14); claim(when + dur + .1);
    }
  }
  const C5 = 523.25;
  const SFX = {
    // ---- 操作音: 宅建版の音階はそのまま、輪郭だけ足す ----
    move() { tone(rand(1150, 1300), .03, 'square', .045, 0, 0, { lp: 5200, pan: rand(-.2, .2) }); },
    bump() { tone(140, .07, 'square', .08, 0, 0, { lp: 1400 }); noise(.06, .05, 0, { type: 'lowpass', f: 380 }); },
    ok() { noise(.018, .03, 0, { type: 'highpass', f: 4500 }); tone(660, .05, 'square', .085, 0, 0, { lp: 5400 }); tone(990, .08, 'square', .085, .045, 0, { lp: 5400, verb: .1 }); },
    back() { tone(520, .05, 'square', .07, 0, 0, { lp: 4200 }); tone(350, .08, 'square', .07, .045, 0, { lp: 3600 }); noise(.05, .03, .02, { f: 1800, to: 600, q: 1.2 }); },
    tick() { tone(1800, .02, 'square', .04, 0, 0, { lp: 6500 }); },
    // テンキー: 打鍵音に、数字ごとに違う音程の粒を重ねる。
    key(d) {
      tone(1800, .02, 'square', .035, 0, 0, { lp: 6500 });
      const n = { '000': 10, '00': 9, '.': 8, '±': 6 }[d] ?? (d === 'C' || d === '⌫' ? -1 : +d);
      if (n >= 0) tone(semi(659.25, PENTA[n % PENTA.length]), .06, 'triangle', .06, .003, 0, { pan: (n % 10 - 4.5) / 8, verb: .06 });
      else tone(420, .06, 'triangle', .05, .003, .7);
    },
    select(i = 0) { const f = semi(880, PENTA[(+i || 0) % 5]); noise(.015, .03, 0, { type: 'highpass', f: 5000 }); tone(f, .07, 'triangle', .085, 0, 0, { attack: .002 }); tone(f * 2, .045, 'square', .025, .012, 0, { lp: 4500, verb: .12 }); },
    pick() { noise(.02, .03, 0, { type: 'highpass', f: 5000 }); tone(988, .1, 'triangle', .08, 0, 0, { attack: .002 }); tone(1319, .14, 'triangle', .075, .05, 0, { attack: .002, verb: .15 }); },
    add() { tone(520, .08, 'sine', .09, 0, 1.7, { attack: .003 }); tone(1568, .05, 'triangle', .04, .06, 0, { verb: .12 }); },
    remove() { swish(0, .05, false, .14); tone(500, .09, 'triangle', .06, 0, .55); },
    whoosh() { swish(0, .075, true, .2); },
    // ---- 正誤 ----
    // 正解: 打撃＋上昇アルペジオ＋きらめき。コンボで音程が上がり、5連続で低音、10連続で金管が加わる。
    correct(combo = 1) {
      const c = Math.max(1, combo | 0), base = semi(C5, PENTA[Math.min(c - 1, 8)]), fever = c >= 10;
      kick(0, .3, 170, 50, .13); noise(.03, .07, 0, { f: 3600, q: .8 });
      [0, 4, 7, 12].forEach((s, i) => { const f = semi(base, s), w = i * .05, p = -.3 + i * .2;
        tone(f, .11, 'square', .08, w, 0, { lp: 5600, pan: p });
        tone(f, .14, 'triangle', .05, w, 0, { detune: 7, pan: -p, verb: .15 }); });
      tone(semi(base, 12), .36, 'triangle', .08, .2, 0, { verb: .3 });
      sparkle(fever ? 7 : 4, .2, fever ? .042 : .032, semi(base, 12));
      if (c >= 5) tone(semi(base, -12), .32, 'triangle', .085);
      if (fever) brass([0, 4, 7].map(s => semi(base, s - 12)), .18, .45, .026);
    },
    wrong() { noise(.1, .09, 0, { type: 'lowpass', f: 450 }); tone(233, .2, 'sawtooth', .1, 0, .55, { lp: 1500 }); tone(155, .32, 'sawtooth', .095, .13, .5, { lp: 1100 }); tone(311, .24, 'sine', .07, .02, .5); },
    // コンボが途切れた: ガラスが割れる音から下降。
    comboBreak() {
      noise(.34, .14, 0, { type: 'highpass', f: 3600, q: .6, verb: .35 });
      for (let i = 0; i < 7; i++) tone(rand(2600, 5200), rand(.05, .12), 'sine', .035, .02 + i * rand(.02, .04), .7, { pan: rand(-.8, .8), verb: .3 });
      [7, 3, 0, -5].forEach((s, i) => tone(semi(440, s), .13, 'triangle', .065, .2 + i * .08, 0, { verb: .2 }));
    },
    combo(n = 3, when = 0) {
      const b = semi(659.25, Math.min(12, Math.floor(n / 3) * 2));
      swish(when, .05, true, .16); kick(when + .12, .16);
      [0, 4, 7, 11, 14].forEach((s, i) => tone(semi(b, s), .1, 'square', .05, when + .12 + i * .032, 0, { lp: 5600, pan: -.4 + i * .2, verb: .2 }));
    },
    crit() {
      swish(0, .08, true, .2); kick(.18, .36); crash(.18, .07, 1);
      [2093, 2637, 3136].forEach((f, i) => bell(f, .18 + i * .045, .055, 1, -.4 + i * .4));
      for (let i = 0; i < 8; i++) tone(rand(1800, 3200), .06, 'square', .03, .2 + i * .03, 0, { lp: 6500, pan: rand(-.6, .6) });
    },
    fever() {
      tone(200, .5, 'sawtooth', .06, 0, 6, { lp: 2600 }); noise(.5, .06, 0, { f: 400, to: 5200, q: 1.2, attack: .4 });
      kick(.5, .42); crash(.5, .11, 1.5);
      [0, 3, 7, 10, 12, 15, 19, 22, 24].forEach((s, i) => tone(semi(440, s), .09, 'square', .055, .52 + i * .04, 0, { lp: 5200, pan: -.5 + i * .12, verb: .2 }));
      brass([220, 261.63, 329.63, 392], .52, .7, .024);
    },
    level() {
      kick(0, .32); timp(0, 131, .2);
      [[0, 0], [4, .1], [7, .2], [12, .3], [7, .42], [12, .52], [16, .62], [19, .72], [24, .82]].forEach(([s, w], i) => tone(semi(C5, s), .16, 'square', .07, w, 0, { lp: 5400, pan: -.4 + i * .1, verb: .15 }));
      tone(semi(C5, 24), .7, 'triangle', .08, .95, 0, { verb: .35 });
      brass([261.63, 329.63, 392], .3, .2, .022); brass([261.63, 329.63, 392, 523.25], .82, 1, .03);
      kick(.82, .38); crash(.82, .1, 1.6); timp(.82, 98, .25); sparkle(10, .9, .036, 2093);
    },
    coin() { tone(1568, .04, 'square', .045, 0, 0, { lp: 6500 }); tone(2093, .1, 'square', .045, .04, 0, { lp: 6500, verb: .12 }); },
    // XPゲージへコインが届いた音。連続しても割れないよう間引く。
    coinTick(i = 0) { if (busy(44)) return; const f = semi(1568, PENTA[(i | 0) % 6]); tone(f, .035, 'square', .03, 0, 0, { lp: 6500, pan: rand(-.3, .3) }); tone(f * 1.335, .06, 'square', .028, .03, 0, { lp: 6500, verb: .1 }); },
    // レジの「ガチャ・チーン」。獲得XPの確定に使う。
    register(when = 0) {
      noise(.045, .09, when, { f: 1300, q: 1.6 }); tone(180, .04, 'square', .045, when, 0, { lp: 900 }); noise(.03, .06, when + .05, { f: 2600, q: 2 });
      bell(2637, when + .07, .09, 1.1, .15); bell(3951, when + .07, .045, .8, -.15); tone(1318.5, .5, 'triangle', .045, when + .07, 0, { verb: .3 });
    },
    chip(i = 0, when = 0) { const f = semi(1046.5, PENTA[Math.min(i | 0, 8)]); noise(.012, .025, when, { type: 'highpass', f: 6000 }); tone(f, .06, 'triangle', .07, when, 0, { attack: .002, pan: -.3 + (i % 4) * .2 }); tone(f * 1.5, .05, 'sine', .03, when + .02, 0, { verb: .2 }); },
    // ハンコ: 低い打撃と紙を叩く音。
    stamp(ok = true, when = 0) { kick(when, .45, 130, 38, .2); noise(.08, .2, when, { type: 'lowpass', f: 2400, q: .5 }); noise(.04, .05, when + .005, { type: 'highpass', f: 5200 }); if (ok) bell(1568, when + .05, .028, .5); },
    // 借方と貸方の合計がそろった。
    balance() { bell(1046.5, 0, .06, .7, -.2); bell(1568, .07, .055, .8, .2); sparkle(4, .12, .022, 2093); },
    start() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(semi(392, s), .12, 'square', .075, i * .045, 0, { lp: 5400, pan: -.45 + i * .15, verb: .1 })); },
    questStart() { swish(0, .06, true, .26); SFX.start(); kick(.32, .24); crash(.32, .05, .7); },
    ready() { tone(880, .11, 'square', .065, 0, 0, { lp: 4200 }); tone(880, .11, 'square', .065, .4, 0, { lp: 4200 }); },
    go() { kick(0, .4); crash(0, .1, 1); tone(1760, .32, 'square', .06, 0, 0, { lp: 5200, verb: .2 }); brass([440, 554.37, 659.25, 880], 0, .4, .026); },
    clock(hi) { tone(hi ? 1250 : 1000, .045, 'sine', .1, 0, 0, { attack: .001 }); noise(.015, .045, 0, { type: 'highpass', f: 4000 }); },
    timeUp() {
      [0, .14].forEach(w => { tone(587.33, .2, 'square', .07, w, 0, { lp: 2600 }); tone(739.99, .2, 'square', .05, w, 0, { lp: 2600 }); });
      kick(.3, .4); crash(.3, .11, 1.4); tone(220, .9, 'triangle', .09, .3, .5, { verb: .3 });
    },
    rank() { tone(80, .5, 'sawtooth', .12, 0, .4, { lp: 900 }); tone(160, .3, 'square', .08, 0, 0, { lp: 1300 }); kick(0, .45, 120, 35, .3); noise(.14, .1, 0, { type: 'lowpass', f: 1600 }); crash(0, .05, .9); },
    fanfare(r = 'A') {
      const big = r === 'S', seq = big ? [[0, 0, .14], [4, .14, .14], [7, .28, .14], [12, .42, .55]] : [[0, 0, .12], [7, .12, .12], [12, .24, .42]], hit = seq[seq.length - 1][1];
      seq.forEach(([s, w, d]) => lead(semi(C5, s), w, d, .05));
      brass([261.63, 329.63, 392, 523.25], hit, big ? 1 : .6, .028); kick(hit, .35);
      if (big) { crash(hit, .11, 1.6); timp(hit, 98, .25); sparkle(12, hit + .08, .036, 2093); } else sparkle(6, hit + .06, .032, 2093);
    },
    drumroll(dur = 1.5) {
      let t = 0, gap = .08, i = 0;
      while (t < dur && i < 64) { noise(.06, .035 + .085 * (t / dur), t, { f: 1700, q: .7, pan: i % 2 ? .15 : -.15 }); t += gap; gap = Math.max(.034, gap * .955); i++; }
      timp(0, 82, .12); timp(dur * .5, 82, .16);
    },
    count(p = 0) { if (busy(48)) return; tone(semi(880, Math.round(p * 14)), .03, 'square', .026, 0, 0, { lp: 6000 }); },
    pass() {
      kick(0, .45); timp(0, 98, .3); crash(0, .12, 2);
      brass([261.63, 329.63, 392], 0, .2, .026); brass([349.23, 440, 523.25], .22, .2, .026); brass([392, 493.88, 587.33], .44, .2, .026); brass([523.25, 659.25, 783.99, 1046.5], .66, 1.2, .03);
      [[392, 0, .2], [523.25, .22, .2], [587.33, .44, .2], [783.99, .66, .8]].forEach(([f, w, d]) => lead(f, w, d, .045));
      kick(.66, .42); crash(.66, .12, 2); timp(.66, 65.41, .3);
      bell(2093, .7, .07, 1.4, -.3); bell(2637, .82, .06, 1.3, .3); sparkle(14, .75, .035, 2093);
    },
    // 不合格でも責めない、やわらかい下降と和音。
    fail() { [12, 7, 4, 0].forEach((s, i) => bell(semi(C5, s), i * .13, .05, .8, -.3 + i * .2)); tone(261.63, 1.2, 'triangle', .045, .1, 0, { verb: .4, attack: .25 }); tone(392, 1.2, 'triangle', .03, .15, 0, { verb: .4, attack: .25 }); },
    record() { [0, 4, 7, 12, 16, 19, 24, 28].forEach((s, i) => tone(semi(659.25, s), .07, 'square', .045, i * .035, 0, { lp: 6500, pan: -.5 + i * .14 })); bell(2637, .3, .065, 1, 0); sparkle(8, .32, .032, 2093); },
    daily() { SFX.coin(); tone(2093, .1, 'square', .04, .12, 0, { lp: 6500 }); tone(2637, .16, 'square', .04, .2, 0, { lp: 6500, verb: .2 }); brass([523.25, 659.25, 783.99], .26, .5, .024); sparkle(8, .3, .032, 2093); },
    memo() { SFX.coin(); tone(660, .05, 'square', .07, .09, 0, { lp: 5400 }); tone(990, .08, 'square', .07, .135, 0, { lp: 5400, verb: .1 }); sparkle(4, .15, .03, 2093); },
    boom() { if (busy(50)) return; kick(0, .22, 110, 40, .25); noise(.5, .06, .01, { type: 'highpass', f: 3000, q: .5, verb: .4, attack: .01 }); sparkle(3, .06, .02, 1568); },
  };
  return { SFX, live, busy, setLevel(v) { if (master) master.gain.value = v; } };
}
window.BKSynth = createSynth;

window.createEffects = function (S) {
const $ = s => document.querySelector(s), app = $('#app'), now = () => performance.now(), shuffle = a => a.sort(() => Math.random() - .5);
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lite = () => !S.set.fx;
const motion = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!(motion && motion.matches);
// 「演出」オフ、または端末の「視差効果を減らす」では、揺れ・点滅・光線を出さない。
const calm = () => lite() || reduced();

/* ================= audio ================= */
let ac = null;
try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
const level = () => (S.set.vol / 100) * .6, syn = createSynth(ac, { level }), SFX = syn.SFX;
const setVol = () => { syn.setLevel(level()); if (ac) soundHint(); };
// iOS の古い版は無音バッファの再生を伴わないと解錠されないことがある。
function audioUnlock() {
  if (!ac || ac.state === 'running') return;
  try { const b = ac.createBuffer(1, 1, 22050), s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); } catch (e) { /* unsupported */ }
  try { const p = ac.resume(); return p && p.then ? p.catch(() => {}) : undefined; } catch (e) { return undefined; }
}
function soundHint() { $('#sound-hint').classList.toggle('show', !!ac && S.set.vol > 0 && ac.state !== 'running'); }
if (ac) { ac.onstatechange = soundHint; setTimeout(soundHint, 1500); }
addEventListener('touchend', audioUnlock, { passive: true });
addEventListener('keydown', audioUnlock);
function run(name, args) { try { SFX[name](...args); } catch (e) { /* 音が出なくても操作は止めない */ } }
// iOS等では最初の操作で再生が許可されるまで非同期に待つ。
function play(name, ...args) {
  if (!SFX[name] || !ac || S.set.vol <= 0) return;
  if (ac.state === 'running') run(name, args);
  else { const pending = audioUnlock(); if (pending) pending.then(() => { if (ac && ac.state === 'running') run(name, args); }); }
}
const sfx = Object.fromEntries(Object.keys(SFX).map(k => [k, (...a) => play(k, ...a)]));

/* ================= haptics ================= */
function rumble(strong, weak, ms) {
  if (!S.set.rumble || !navigator.getGamepads) return;
  for (const gp of navigator.getGamepads()) {
    if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
      try { gp.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); } catch (e) { /* unsupported */ }
    }
  }
}
const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let taptic = null;
// iPhone の Safari は vibrate 非対応。iOS 18 以降はスイッチ型チェックボックスの切替で触覚が返るため、タップ直後だけそれを使う。
function haptic(kind = 'light') {
  if (!S.set.rumble) return;
  rumble(...({ light: [.1, .2, 40], ok: [.25, .7, 110], good: [.5, .9, 160], bad: [1, .2, 260], big: [.8, .8, 500] }[kind] || [.2, .3, 60]));
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  try {
    if (!iOS) { if (navigator.vibrate) navigator.vibrate({ light: 10, ok: 25, good: [20, 40, 30], bad: [60, 40, 60], big: [40, 30, 40, 30, 90] }[kind] || 15); return; }
    if (!taptic) { taptic = document.createElement('label'); taptic.setAttribute('aria-hidden', 'true'); taptic.style.display = 'none'; const box = document.createElement('input'); box.type = 'checkbox'; box.setAttribute('switch', ''); box.tabIndex = -1; taptic.appendChild(box); document.head.appendChild(taptic); }
    taptic.click();
  } catch (e) { /* unsupported */ }
}

/* ================= fx canvas ================= */
// 粒子は最前面に描く（操作は透過）。何も飛んでいないときは描画しない。
const cv = $('#fx'), cx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, dirty = false, last = 0, feverOn = false, ambientAt = 0;
function resize() { DPR = lite() ? 1 : Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cx.setTransform(DPR, 0, 0, DPR, 0, 0); dirty = false; }
addEventListener('resize', resize);
const P = [];
const cap = () => lite() ? 260 : 900;
function applyFx() { document.body.classList.toggle('lite', lite()); if (P.length > cap()) P.length = cap(); resize(); }
applyFx();
const amount = n => Math.max(1, Math.round(n * (lite() ? .35 : 1)));
const add = p => { if (P.length < cap()) P.push(p); };
const sprites = {};
function sprite(key, size, paint) { if (!sprites[key]) { const c = document.createElement('canvas'); c.width = c.height = size; paint(c.getContext('2d'), size); sprites[key] = c; } return sprites[key]; }
const coinImg = () => sprite('coin', 64, (g, s) => {
  const r = s / 2 - 3, grd = g.createRadialGradient(s * .38, s * .34, 2, s / 2, s / 2, r);
  grd.addColorStop(0, '#fff6c2'); grd.addColorStop(.45, '#ffd23f'); grd.addColorStop(1, '#e09a00');
  g.fillStyle = grd; g.beginPath(); g.arc(s / 2, s / 2, r, 0, 6.283); g.fill(); g.lineWidth = 3; g.strokeStyle = '#b87400'; g.stroke();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(184,116,0,.55)'; g.beginPath(); g.arc(s / 2, s / 2, r - 7, 0, 6.283); g.stroke();
  g.fillStyle = '#a86400'; g.font = '900 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('¥', s / 2, s / 2 + 1);
});
const starImg = color => sprite('star' + color, 48, (g, s) => {
  const c = s / 2; g.fillStyle = color; g.beginPath(); g.moveTo(c, 2);
  g.quadraticCurveTo(c + 4, c - 4, s - 2, c); g.quadraticCurveTo(c + 4, c + 4, c, s - 2); g.quadraticCurveTo(c - 4, c + 4, 2, c); g.quadraticCurveTo(c - 4, c - 4, c, 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.arc(c, c, s * .09, 0, 6.283); g.fill();
});
function burst(x, y, color, n = 40, spd = 9) { for (let i = amount(n); i > 0; i--) { const a = Math.random() * 6.283, v = rand(spd * .25, spd); add({ t: 's', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, dec: rand(.012, .03), size: rand(2, 5.5), color }); } }
function stars(x, y, n = 10, spd = 8, cols = HUES) { for (let i = amount(n); i > 0; i--) { const a = Math.random() * 6.283, v = rand(spd * .3, spd); add({ t: 'st', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, g: .12, rot: rand(0, 6.283), vr: rand(-.18, .18), size: rand(10, 22), life: 1, dec: rand(.014, .026), img: starImg(cols[i % cols.length]) }); } }
// home を渡すと、飛び散ったあと目標（XPゲージ）へ吸い込まれる。到着数でゲージを伸ばすので本数は間引かない。
function coins(x, y, n = 8, home) {
  const homing = !!home && !lite();
  for (let i = homing ? n : amount(n); i > 0; i--) { const a = rand(-2.7, -.45), v = rand(5, 11); add({ t: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, spin: rand(0, 6.283), vs: rand(.16, .3), size: rand(15, 22), life: 1, dec: homing ? .004 : .009, age: 0, delay: homing ? rand(16, 24) + i * 1.4 : 0, home: homing ? home : null }); }
}
function ink(x, y, color = '#d7263d', n = 16) { for (let i = amount(n); i > 0; i--) { const a = Math.random() * 6.283, v = rand(1, 6.5); add({ t: 'ink', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rand(1.5, 5), life: 1, dec: rand(.02, .035), color }); } }
function ring(x, y, color, w = 5) { add({ t: 'r', x, y, r: 10, vr: 16, life: 1, dec: .028, color, w }); }
function streaks(x, y, color, n = 16) { for (let i = amount(n); i > 0; i--) add({ t: 'ln', x, y, a: Math.random() * 6.283, d: rand(10, 30), v: rand(12, 22), len: rand(18, 46), w: rand(1.5, 3.5), life: 1, dec: rand(.035, .05), color }); }
function rays(x, y, color, ms = 2000) { if (calm()) return; add({ t: 'ray', x, y, a: rand(0, 6.283), life: 1, dec: 16.7 / ms, color, n: 14 }); }
function confetti(n = 120) {
  if (!W) resize();
  for (let i = 0, m = amount(n); i < m; i++) add({ t: 'c', x: rand(0, W), y: rand(-H * .6, -10), vx: rand(-2, 2), vy: rand(2.5, 6), rot: rand(0, 6), vr: rand(-.2, .2), w: rand(6, 13), h: rand(3, 7), life: 1, dec: rand(.003, .006), color: HUES[i % HUES.length] });
}
function fireworks(n = 3) {
  if (!W) resize();
  for (let i = 0, m = amount(n); i < m; i++) add({ t: 'fw', x: rand(W * .15, W * .85), y: H + 8, vx: rand(-1.2, 1.2), vy: -Math.sqrt(2 * .16 * rand(H * .45, H * .7)), life: 1, dec: .002, age: 0, delay: i * 16, color: HUES[(Math.random() * HUES.length) | 0] });
}
function explode(x, y, color) {
  for (let i = 0, m = amount(44); i < m; i++) { const a = i / m * 6.283, v = rand(3.2, 5.6); add({ t: 's', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, dec: rand(.012, .02), size: rand(1.8, 3.4), color }); }
  stars(x, y, 6, 6); ring(x, y, color, 3); play('boom');
}
function dot(x, y, r, color) { cx.fillStyle = color; cx.beginPath(); cx.arc(x, y, r, 0, 6.283); cx.fill(); }
function blit(img, x, y, size, rot, sx = 1) { const c = Math.cos(rot) * DPR, s = Math.sin(rot) * DPR; cx.setTransform(c * sx, s * sx, -s, c, x * DPR, y * DPR); cx.drawImage(img, -size / 2, -size / 2, size, size); cx.setTransform(DPR, 0, 0, DPR, 0, 0); }
// 1粒を進めて描く。false で消す。k はフレーム時間の補正（60fps=1）。
function step(p, k, t) {
  switch (p.t) {
    case 's': p.x += p.vx * k; p.y += p.vy * k; p.vy += .17 * k; p.vx *= Math.pow(.98, k); if (p.y > H + 20) return false; cx.globalAlpha = p.life; dot(p.x, p.y, p.size * p.life + .5, p.color); return true;
    case 'st': { p.x += p.vx * k; p.y += p.vy * k; p.vy += p.g * k; p.vx *= Math.pow(.97, k); p.rot += p.vr * k; if (p.y > H + 30 || p.y < -80) return false; cx.globalAlpha = Math.min(1, p.life * 1.6) * (.7 + .3 * Math.sin(t / 70 + p.rot * 4)); blit(p.img, p.x, p.y, p.size * (.55 + .45 * p.life), p.rot); return true; }
    case 'r': p.r += p.vr * k; p.vr *= Math.pow(.93, k); cx.globalAlpha = p.life; cx.strokeStyle = p.color; cx.lineWidth = p.w * p.life; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.stroke(); return true;
    case 'c': {
      p.x += (p.vx + Math.sin(p.rot * 1.7) * .7) * k; p.y += p.vy * k; p.rot += p.vr * k; if (p.y > H + 20) return false;
      const c = Math.cos(p.rot) * DPR, s = Math.sin(p.rot) * DPR; cx.globalAlpha = Math.min(1, p.life * 2);
      cx.setTransform(c, s, -s, c, p.x * DPR, p.y * DPR); cx.fillStyle = p.color; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 1.3)) + .5); cx.setTransform(DPR, 0, 0, DPR, 0, 0); return true;
    }
    case 'coin': {
      p.age += k; p.spin += p.vs * k;
      if (p.home && p.age > p.delay) {
        const dx = p.home.target.x - p.x, dy = p.home.target.y - p.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(30, 7 + (p.age - p.delay) * 1.2), f = Math.min(1, .22 * k);
        p.vx += (dx / d * sp - p.vx) * f; p.vy += (dy / d * sp - p.vy) * f; p.life = Math.max(p.life, .6);
        if (d < 18 || p.age > p.delay + 120) { try { if (p.home.onArrive) p.home.onArrive(); } catch (e) { /* ignore */ } return false; }
      } else { p.vy += .32 * k; p.vx *= Math.pow(.985, k); if (p.y > H + 40) return false; }
      p.x += p.vx * k; p.y += p.vy * k; cx.globalAlpha = Math.min(1, p.life * 2);
      const sx = Math.abs(Math.cos(p.spin)); blit(coinImg(), p.x, p.y, p.size, 0, Math.max(.15, sx)); return true;
    }
    case 'ink': { p.x += p.vx * k; p.y += p.vy * k; const d = Math.pow(.8, k); p.vx *= d; p.vy *= d; cx.globalAlpha = Math.min(1, p.life * 1.5) * .9; dot(p.x, p.y, p.r * (1.25 - .25 * p.life), p.color); return true; }
    case 'ln': { p.d += p.v * k; p.v *= Math.pow(.92, k); const c = Math.cos(p.a), s = Math.sin(p.a), l = p.len * p.life; cx.globalAlpha = p.life; cx.strokeStyle = p.color; cx.lineWidth = p.w; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(p.x + c * p.d, p.y + s * p.d); cx.lineTo(p.x + c * (p.d + l), p.y + s * (p.d + l)); cx.stroke(); return true; }
    case 'ray': {
      p.a += .006 * k; const R = Math.hypot(W, H) * .75, g = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(255,255,255,0)'); cx.globalAlpha = Math.max(0, Math.min(1, (1 - p.life) * 6, p.life * 1.4)); cx.fillStyle = g; cx.beginPath();
      for (let i = 0; i < p.n; i++) { const a0 = p.a + i * 6.283 / p.n; cx.moveTo(p.x, p.y); cx.arc(p.x, p.y, R, a0, a0 + .17); cx.closePath(); }
      cx.fill(); return true;
    }
    case 'fw': {
      p.age += k; if (p.age < p.delay) return true;
      p.x += p.vx * k; p.y += p.vy * k; p.vy += .16 * k;
      cx.globalAlpha = 1; dot(p.x, p.y, 2.6, p.color); cx.globalAlpha = .45; dot(p.x - p.vx, p.y - p.vy * 1.5, 1.8, p.color);
      if (p.vy > -1.2) { explode(p.x, p.y, p.color); return false; }
      return true;
    }
  }
  return false;
}
function drawFx(t = now()) {
  const k = last ? Math.min(3, Math.max(.3, (t - last) / 16.667)) : 1; last = t;
  // フィーバー中は画面の両端から星がゆっくり昇る。
  if (feverOn && !lite() && t > ambientAt) { ambientAt = t + 180; const left = Math.random() < .5; add({ t: 'st', x: left ? rand(6, W * .12) : rand(W * .88, W - 6), y: H + 14, vx: rand(-.3, .3), vy: -rand(1.6, 3), g: 0, rot: rand(0, 6.283), vr: rand(-.05, .05), size: rand(8, 14), life: 1, dec: .006, img: starImg(HUES[Math.random() * HUES.length | 0]) }); }
  if (!P.length) { if (dirty) { cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, W, H); dirty = false; } return; }
  cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.clearRect(0, 0, W, H); dirty = true;
  const len = P.length; let n = 0;
  for (let i = 0; i < len; i++) { const p = P[i]; p.life -= p.dec * k; if (p.life > 0 && step(p, k, t)) P[n++] = p; }
  for (let j = len; j < P.length; j++) P[n++] = P[j]; // 描画中に生まれた粒（花火の破裂）
  P.length = n; cx.globalAlpha = 1; cx.setTransform(DPR, 0, 0, DPR, 0, 0);
}

/* ================= DOM effects ================= */
function pop(text, x, y, cls = '') { const el = document.createElement('div'); el.className = 'pop ' + cls; el.textContent = text; el.style.left = x + 'px'; el.style.top = y + 'px'; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); setTimeout(() => el.remove(), 1400); return el; }
const queue = []; let showing = false;
// 同時に起きた節目（クリティカル・フィーバー・レベルアップ等）は重ねず、順番に見せる。
// 連続で答えて溜まり過ぎたら、keep の付かない古いものから捨てて遅れを残さない。
function banner(html, cls = '', o = {}) {
  if (queue.length >= 3) { const i = queue.findIndex(b => !b.keep); queue.splice(i < 0 ? 0 : i, 1); }
  queue.push({ html, cls, ...o }); if (!showing) nextBanner();
}
function nextBanner() {
  const b = queue.shift(); if (!b) { showing = false; return; }
  showing = true;
  const el = document.createElement('div'); el.className = 'banner ' + b.cls; el.innerHTML = b.html; el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el);
  try { if (b.sfx) b.sfx(); if (b.fx) b.fx(); } catch (e) { /* 演出の失敗で進行を止めない */ }
  const ms = b.ms || 1500; setTimeout(() => el.remove(), ms); setTimeout(nextBanner, b.gap || Math.min(ms * .62, 980));
}
function flash(bg) { if (calm()) return; const f = $('#flash'); f.style.background = bg; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
function shake(el = app, big = false) {
  if (calm() || !el) return;
  el.classList.remove('shake', 'shake2'); void el.offsetWidth; el.classList.add(big ? 'shake2' : 'shake');
  clearTimeout(el.shakeEnd); el.shakeEnd = setTimeout(() => el.classList.remove('shake', 'shake2'), 560);
}
function bump(el, cls = 'bump') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function edge(el, kind) { if (!el) return; el.classList.remove('hit-ok', 'hit-ng'); void el.offsetWidth; el.classList.add('hit-' + kind); }
function toast(msg) { const t = document.createElement('div'); t.textContent = msg; $('#toast').appendChild(t); setTimeout(() => t.remove(), 2700); }
let aura = null;
function setFever(on) {
  feverOn = !!on; document.body.classList.toggle('fever', feverOn);
  if (feverOn && !aura) { aura = document.createElement('div'); aura.className = 'fx-aura'; aura.setAttribute('aria-hidden', 'true'); document.body.appendChild(aura); }
}
const center = el => { const r = el && el.isConnected ? el.getBoundingClientRect() : null; return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: W / 2, y: H / 2 }; };
let timers = [];
function later(fn, ms) { const id = setTimeout(() => { timers = timers.filter(t => t !== id); fn(); }, ms); timers.push(id); return id; }
// 数字を回して止める。演出オフでは即座に最終値。
function countUp(el, to, o = {}) {
  const { from = 0, ms = 900, fmt = v => String(v), tick = null, step: unit = 1 } = o;
  return new Promise(res => {
    if (!el) return res();
    if (lite() || ms <= 0) { el.textContent = fmt(to); return res(); }
    const t0 = now(); let shown = null, tickAt = 0;
    const frame = () => {
      if (!el.isConnected) return res();
      const p = Math.min(1, (now() - t0) / ms), v = p < 1 ? Math.floor((from + (to - from) * (1 - Math.pow(1 - p, 3))) / unit) * unit : to, text = fmt(v);
      if (text !== shown) { el.textContent = text; shown = text; if (tick && p < 1 && now() - tickAt > 55) { tickAt = now(); tick(p); } }
      if (p < 1) requestAnimationFrame(frame); else res();
    };
    requestAnimationFrame(frame);
  });
}
// ハンコ: 正解は朱色の「正解」、不正解は藍色の「要復習」。押した瞬間に音と墨の飛沫。
function stamp(host, ok, text, quiet) {
  if (!host) return null;
  const s = document.createElement('span'); s.className = 'b-stamp ' + (ok ? 'ok' : 'ng'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<b>' + escHtml(text) + '</b>'; host.appendChild(s);
  play('stamp', ok, .19);
  later(() => { if (!s.isConnected) return; const { x, y } = center(s); ink(x, y, ok ? '#d7263d' : '#3653c9', quiet ? 8 : 18); if (!quiet) ring(x, y, ok ? 'rgba(215,38,61,.5)' : 'rgba(54,83,201,.45)', 3); }, 190);
  return s;
}

/* ================= XPゲージ ================= */
const xp = { el: null, hide: 0, pay: 0 };
function xpEl() {
  if (xp.el) return xp.el;
  const e = document.createElement('div'); e.className = 'fx-xp'; e.setAttribute('aria-hidden', 'true');
  e.innerHTML = '<div class="fx-xp-in"><span class="fx-xp-lv">Lv <b></b></span><i class="fx-xp-bar"><u></u></i><span class="fx-xp-gain"></span></div>';
  document.body.appendChild(e); return (xp.el = e);
}
function xpBar(f, snap) { const e = xpEl(), u = e.querySelector('u'); if (snap) { e.classList.add('snap'); u.style.transform = `scaleX(${f})`; void u.offsetWidth; e.classList.remove('snap'); } else u.style.transform = `scaleX(${f})`; }
function xpHide() { clearTimeout(xp.hide); xp.pay++; if (xp.el) xp.el.classList.remove('show', 'lvup'); }
function levelUp(lv, title, titleUp) {
  banner(`LEVEL UP!<small>Lv.${lv}『${escHtml(title)}』</small>`, 'lv', { keep: true, ms: 1700, sfx: () => play('level'), fx: () => { confetti(110); rays(W / 2, H * .36, 'rgba(20,184,102,.22)'); burst(W / 2, H * .36, '#14b866', 70, 13); stars(W / 2, H * .36, 14, 10); } });
  if (titleUp) banner(`称号獲得<small>『${escHtml(title)}』</small>`, 'record', { keep: true, ms: 1600, sfx: () => play('record'), fx: () => stars(W / 2, H * .36, 24, 11) });
}
// 獲得XPを上部の小さなゲージへ集める。コインが届くたびに数字とゲージが伸び、最後にレジの音で確定。
function payout(info, origin) {
  const e = xpEl(), pay = ++xp.pay, end = info.up ? 1 : info.f1, gainEl = e.querySelector('.fx-xp-gain'), lvEl = e.querySelector('b'), total = Math.min(12, 3 + Math.round(info.gain / 6));
  clearTimeout(xp.hide); e.classList.remove('lvup'); lvEl.textContent = info.lv0; gainEl.textContent = '+0 XP'; xpBar(info.f0, true); e.classList.add('show');
  let got = 0, done = false;
  const finish = () => {
    if (done || pay !== xp.pay) return; done = true;
    gainEl.textContent = '+' + info.gain + ' XP'; xpBar(end); bump(e); play('register');
    if (info.up) later(() => { if (pay !== xp.pay) return; e.classList.add('lvup'); lvEl.textContent = info.lv1; xpBar(0, true); xpBar(info.f1); levelUp(info.lv1, info.title, info.titleUp); }, 320);
    xp.hide = setTimeout(() => { if (pay === xp.pay) e.classList.remove('show', 'lvup'); }, info.up ? 2800 : 1900);
  };
  const arrive = () => { if (done || pay !== xp.pay) return; got++; const p = Math.min(1, got / total); play('coinTick', got); gainEl.textContent = '+' + Math.round(info.gain * p) + ' XP'; xpBar(info.f0 + (end - info.f0) * p); bump(e); if (got >= total) finish(); };
  if (lite() || !origin) { later(finish, 450); return; }
  const r = e.getBoundingClientRect();
  coins(origin.x, origin.y, total, { target: { x: r.left + r.width * .45, y: r.top + r.height / 2 }, onArrive: arrive });
  later(finish, 1800); // 万一コインが届かなくても締める
}

/* ================= moments: 場面ごとの演出 ================= */
const TIER = c => c >= 10 ? '#ff3d9a' : c >= 5 ? '#ff7a00' : '#7c4dff';
const RANKCOL = { S: '#ff9500', A: '#ff3d9a', B: '#1a7fd6', C: '#15a35c', D: '#8a8fa8' };
const MISSBG = 'radial-gradient(ellipse at center, rgba(229,48,79,0) 45%, rgba(229,48,79,.4) 100%)';
const moment = {
  // 練習の開始。60秒チャレンジは READY → GO。
  start(mode) {
    if (mode === 'ta') {
      play('whoosh');
      banner('READY', 'go', { keep: true, ms: 800, gap: 720, sfx: () => play('ready') });
      banner('GO!!', 'go', { keep: true, ms: 900, sfx: () => play('go'), fx: () => { flash('rgba(41,163,240,.14)'); burst(W / 2, H * .42, '#29a3f0', 60, 12); ring(W / 2, H * .42, '#ffb300'); } });
      return;
    }
    play('questStart');
    banner('QUEST START', 'go', { ms: 1000, fx: () => { burst(W / 2, H * .42, '#7c4dff', 46, 11); ring(W / 2, H * .42, '#ff3d9a'); stars(W / 2, H * .42, 10, 9); } });
  },
  // 答え合わせ。ev は game.js の record() が返す結果に、位置と表示先を足したもの。
  answer(ev) {
    // panel は枠の光、stage は揺らす対象（入場アニメーションを持たない外枠）。
    const x = ev.x ?? W / 2, y = ev.y ?? H * .6, panel = ev.panel, stage = ev.stage || app;
    if (ev.assisted) { play(ev.ok ? 'correct' : 'wrong', 1); stamp(ev.host, ev.ok, ev.ok ? '正解' : '要復習', true); return; }
    haptic(ev.xp && ev.xp.up ? 'big' : ev.ok ? (ev.combo >= 10 ? 'good' : 'ok') : 'bad');
    if (ev.ok) {
      const c = ev.combo || 1, col = TIER(c);
      play('correct', c); stamp(ev.host, true, '正解');
      burst(x, y, col, 40 + Math.min(c * 5, 80), 9 + Math.min(c, 10) * .5); burst(x, y, '#ffc21a', 18, 7); stars(x, y, 8 + Math.min(c, 14)); ring(x, y, col);
      if (c >= 5) streaks(x, y, col, 10 + Math.min(c, 20));
      if (c >= 10) coins(x, y, 10);
      flash(c >= 10 ? 'rgba(255,61,154,.16)' : 'rgba(124,77,255,.11)'); edge(panel, 'ok');
      pop('+' + ev.gain + ' XP', x, y - 48, 'xp' + (ev.gain >= 50 ? ' big' : ''));
      if (ev.revenge) later(() => pop('REVENGE!', x, y - 96, 'revenge'), 220);
      (ev.chips || []).forEach((_, i) => play('chip', i, .3 + i * .08));
      if (ev.crit) banner('CRITICAL!!<small>経験値 3 倍</small>', 'crit', { sfx: () => play('crit'), fx: () => { burst(W / 2, H * .4, '#ffb300', 90, 15); rays(W / 2, H * .4, 'rgba(255,194,26,.24)'); } });
      if (ev.feverStart) banner('FEVER!!<small>XP 2倍モード突入</small>', 'fever', { ms: 1700, sfx: () => play('fever'), fx: () => { confetti(90); rays(W / 2, H * .4, 'rgba(255,61,154,.2)'); } });
      else if ([3, 5, 7].includes(c)) { play('combo', c, .45); later(() => pop(c + ' COMBO!', W / 2, H * .26, 'combo big'), 450); }
      else if (c === 15) banner('UNSTOPPABLE<small>15連続、貸借完全一致</small>', 'fever', { sfx: () => play('combo', c) });
      else if (c === 20) banner('GODLIKE<small>決算の神が微笑む</small>', 'crit', { sfx: () => play('crit'), fx: () => fireworks(2) });
      else if (c > 20 && c % 10 === 0) banner(c + ' COMBO<small>簿記神、降臨</small>', 'crit', { sfx: () => play('fever'), fx: () => { confetti(120); fireworks(2); } });
    } else {
      play('wrong'); stamp(ev.host, false, '要復習');
      shake(stage, true); edge(panel, 'ng'); flash(MISSBG);
      pop('MISS', x, y - 48, 'bad big');
      if (ev.broken >= 5) banner(`COMBO BREAK<small>${ev.broken} で途切れた…</small>`, 'sad', { sfx: () => play('comboBreak') });
    }
    if (ev.xp) payout(ev.xp, { x, y });
    if (ev.daily) banner(`DAILY CLEAR!<small>今日の目標 ${ev.goal}問 達成 · +30 XP</small>`, 'crit', { keep: true, ms: 1700, sfx: () => play('daily'), fx: () => confetti(140) });
  },
  // 借方・貸方の合計がそろった瞬間。
  balance(el) { play('balance'); if (!el) return; const { x, y } = center(el); stars(x, y, 10, 6, ['#2ecc71', '#ffb300', '#29a3f0']); pop('⚖ 貸借一致', x, y - 20, 'balance'); },
  memo(btn, existed) { play('memo'); haptic('light'); if (!btn) return; const { x, y } = center(btn); burst(x, y, '#7c4dff', 30, 8); ring(x, y, '#ff3d9a'); stars(x, y, 6, 6); pop(existed ? '上書き保存!' : '展示室へ!', x, y - 34, 'xp'); },
  // 60秒チャレンジの残り10秒。
  clock(sec, el) { play('clock', sec % 2 === 0); bump(el, 'beat'); if (sec <= 5) pop(String(sec), W / 2, H * .3, 'count big'); },
  timeUp() { banner('TIME UP!', 'crit', { keep: true, ms: 1300, sfx: () => play('timeUp'), fx: () => { flash('rgba(255,179,0,.18)'); shake(app, true); } }); },
  // 練習の結果: ランクを叩きつけ、数字を回し、XPをレジで確定。
  result(o) {
    const T = calm() ? .35 : 1;
    later(() => {
      if (!o.rankEl || !o.rankEl.isConnected) return;
      o.rankEl.classList.add('go'); play('rank'); shake(app, 'SA'.includes(o.letter));
      const { x, y } = center(o.rankEl), col = RANKCOL[o.letter] || '#7c4dff';
      burst(x, y, col, 80, 14); ring(x, y, col); stars(x, y, 'SA'.includes(o.letter) ? 22 : 8, 10);
      if ('SA'.includes(o.letter)) { streaks(x, y, col, 24); confetti(o.letter === 'S' ? 220 : 120); later(() => play('fanfare', o.letter), 280); if (o.letter === 'S') rays(x, y, 'rgba(255,194,26,.24)'); }
    }, 380 * T);
    later(() => o.counts.forEach((c, i) => countUp(c.el, c.to, { ms: 700 * T, fmt: c.fmt, tick: i === 0 ? p => play('count', p) : null })), 600 * T);
    later(() => countUp(o.xpEl, o.gain, { ms: 900 * T, fmt: n => '+' + n, tick: p => play('coinTick', Math.round(p * 5)) }).then(() => { if (o.xpEl && o.xpEl.isConnected) { play('register'); bump(o.xpEl.parentElement); } }), 900 * T);
    if (o.perfect) later(() => banner('PERFECT!!<small>全問正解</small>', 'crit', { keep: true, sfx: () => play('record'), fx: () => fireworks(3) }), 1500 * T);
    if (o.newRec) later(() => banner('NEW RECORD!<small>' + escHtml(o.newRec) + '</small>', 'record', { keep: true, sfx: () => play('record'), fx: () => confetti(100) }), 1700 * T);
  },
  // 模試の結果: ドラムロールで点数を回し、合格ならハンコ・花火・ファンファーレ。
  exam(o) {
    const dur = calm() ? 450 : 1700;
    if (!calm()) play('drumroll', dur / 1000);
    countUp(o.scoreEl, o.score, { ms: dur, fmt: o.fmt, step: .01, tick: p => play('count', p) });
    if (o.bar) { o.bar.style.transition = `transform ${dur}ms cubic-bezier(.25,1,.35,1)`; requestAnimationFrame(() => { o.bar.style.transform = `scaleX(${o.pct})`; }); }
    o.sections.forEach((s, i) => later(() => { s.el.style.transform = `scaleX(${s.frac})`; play('chip', i); }, 150 + i * (dur - 200) / Math.max(1, o.sections.length)));
    later(() => {
      if (o.verdict) o.verdict.classList.add('show');
      if (o.assisted) { play('rank'); return; }
      if (o.passed) {
        if (o.seal) { o.seal.classList.add('go'); play('stamp', true, .2); later(() => { const { x, y } = center(o.seal); ink(x, y, '#d7263d', 26); ring(x, y, 'rgba(215,38,61,.5)', 4); shake(app, true); }, 210); }
        later(() => {
          play('pass'); confetti(220); fireworks(4); const c = center(o.scoreEl); rays(c.x, c.y, 'rgba(255,194,26,.26)', 2600);
          banner('PASS!!<small>合格ライン 70点を突破</small>', 'pass', { keep: true, ms: 1900 });
          if (o.perfect) banner('PERFECT SCORE<small>100 / 100</small>', 'crit', { keep: true, sfx: () => play('record'), fx: () => fireworks(3) });
        }, 420);
      } else { play('fail'); banner(`あと ${escHtml(o.need)} 点<small>合格ラインまで、もう少し</small>`, 'sad', { keep: true, ms: 1800 }); const c = center(o.scoreEl); stars(c.x, c.y, 8, 6, ['#29a3f0', '#7c4dff']); }
      if (o.lvUp) later(() => levelUp(o.lvUp.lv, o.lvUp.title, o.lvUp.titleUp), 1400);
    }, dur + 120);
  },
  // 設定画面のサウンドテスト。
  preview(name, btn) {
    const { x, y } = center(btn); haptic('ok');
    if (name === 'correct') { play('correct', 3); burst(x, y, '#7c4dff', 46, 9); stars(x, y, 10); ring(x, y, '#7c4dff'); pop('+29 XP', x, y - 44, 'xp'); play('register', .75); }
    else if (name === 'combo') { play('correct', 7); play('combo', 7, .3); streaks(x, y, '#ff7a00', 18); later(() => pop('7 COMBO!', x, y - 50, 'combo big'), 300); }
    else if (name === 'fever') banner('FEVER!!<small>XP 2倍モード突入</small>', 'fever', { ms: 1600, sfx: () => play('fever'), fx: () => { confetti(90); rays(W / 2, H * .4, 'rgba(255,61,154,.2)'); } });
    else if (name === 'level') levelUp(12, '貸借の番人', false);
    else if (name === 'pass') { play('pass'); fireworks(3); confetti(140); banner('PASS!!<small>合格ライン 70点を突破</small>', 'pass', { ms: 1800 }); }
    else if (name === 'miss') { play('wrong'); shake(app, true); flash(MISSBG); pop('MISS', x, y - 44, 'bad big'); }
  },
};
// 画面を離れたら、予約中の演出・ゲージ・フィーバーを片付ける。
function reset() { timers.forEach(clearTimeout); timers = []; queue.length = 0; xpHide(); setFever(false); }

/* ================= muse: 浮遊する筋道 ================= */
// 出題中は数字を伏せて「筋道」だけを漂わせる。数字は解答後の筋道パネルで明かす。
const NUM_RE = /[0-9０-９〇一二三四五六七八九十百千万・.]+(?=年|か月|ヶ月|箇月|月|日|週間|割|分の|パーセント|%|平米|メートル|ｍ|m|㎡|円|倍|アール|歳|時間|回|階|人以上|人から)/g;
const maskNums = s => s.replace(NUM_RE, '……').replace(/半(?=年)/g, '……').replace(/分の[〇一二三四五六七八九十0-9]+/g, '分の……');
const Muse = {
  el: $('#muse'), lines: [], idx: 0, active: false, ambOnly: false, color: '#555', next: 0,
  start(lines, color, opt = {}) { this.lines = shuffle(lines.slice()); this.idx = 0; this.color = color; this.ambOnly = !!opt.ambOnly; this.active = true; this.next = now() + (opt.delay != null ? opt.delay : 700); },
  stop() { this.active = false; },
  clear() { this.el.querySelectorAll('.m').forEach(e => { e.classList.add('out'); setTimeout(() => e.remove(), 1250); }); },
  setLevel() { document.documentElement.style.setProperty('--muse-op', [0.4, 0.62, 0.85][S.set.museLv]); },
  tick(t) {
    if (!this.active || !S.set.muse || t < this.next) return;
    if (this.el.childElementCount >= (lite() ? 2 : 3)) { this.next = t + 600; return; }
    const amb = this.ambOnly || !this.lines.length || Math.random() < 0.2;
    const pool = BK.AMBIENT;
    const text = amb ? pool[Math.random() * pool.length | 0] : maskNums(this.lines[this.idx++ % this.lines.length]);
    this.spawn(text, amb);
    this.next = t + (amb && this.ambOnly ? rand(2600, 4200) : rand(1900, 3200));
  },
  zones() {
    const av = document.querySelector('.muse-avoid');
    const top = H * 0.1, bottom = H * 0.88;
    if (!av) return [{ x0: W * 0.03, x1: W * 0.97, y0: top, y1: bottom }];
    const r = av.getBoundingClientRect(), z = [];
    if (r.left > 90) z.push({ x0: 14, x1: r.left - 14, y0: top, y1: bottom });
    if (W - r.right > 90) z.push({ x0: r.right + 14, x1: W - 14, y0: top, y1: bottom });
    if (!z.length) { if (r.top > 70) z.push({ x0: 16, x1: W - 16, y0: 6, y1: r.top - 4 }); z.push({ x0: 16, x1: W - 16, y0: r.bottom + 4, y1: H - 50 }); }
    return z;
  },
  spawn(text, amb) {
    const zs = this.zones(); const z = zs[Math.random() * zs.length | 0];
    const zw = z.x1 - z.x0, zh = z.y1 - z.y0;
    const el = document.createElement('div');
    el.className = 'm' + (amb ? ' amb' : '');
    el.textContent = text;
    if (!amb) el.style.setProperty('--mc', this.color);
    el.style.visibility = 'hidden';
    this.el.appendChild(el);
    if (zh > 260 && Math.random() < (zw < 320 ? 0.85 : 0.5)) el.classList.add('v');
    if (!el.classList.contains('v') && el.offsetWidth > zw) { el.style.whiteSpace = 'normal'; el.style.width = zw + 'px'; }
    const ew = el.offsetWidth, eh = el.offsetHeight;
    const x = z.x0 + Math.max(0, zw - ew) * Math.random();
    const y = z.y0 + Math.max(0, zh - eh) * Math.random();
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.setProperty('--dur', rand(7, 9.5).toFixed(1) + 's');
    el.style.setProperty('--dx', rand(-24, 24).toFixed(0) + 'px');
    el.style.visibility = '';
    el.addEventListener('animationend', () => el.remove(), { once: true });
  },
};
Muse.setLevel();

return {
  SFX: sfx, play, audioUnlock, haptic, reduced,
  burst, stars, coins, ink, ring, streaks, rays, confetti, fireworks,
  banner, pop, toast, flash, shake, bump, stamp, countUp, setFever, drawFx, reset,
  moment, Muse, setVol, applyFx,
  debug: { particles: () => P.length, queued: () => queue.length + (showing ? 1 : 0), fever: () => feverOn },
};
};
})();
