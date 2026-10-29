/* BGM: Web Audio でその場で合成するループ曲（音源ファイル・外部通信なし、iPhoneの消音モードに従う）。
   画面ごとに曲を切り替え（メニュー・練習・フィーバー・60秒・模試）、ファンファーレ中は少し下げる。 */
(function () {
'use strict';
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const MAJ = [0, 4, 7, 12], MIN = [0, 3, 7, 12];
// 曲: bpm、小節ごとのコード [ルートのMIDI番号, 和音]、メロディ（小節ごとに [16分の位置, MIDI, 長さ(16分)]）、style。
const SONGS = {
  // メニュー: のんびりしたハ長調。鐘のメロディとやわらかい和音。
  menu: { bpm: 92, style: 'calm', chords: [[48, MAJ], [45, MIN], [41, MAJ], [43, MAJ], [48, MAJ], [45, MIN], [50, MIN], [43, MAJ]],
    melody: [[[0, 76, 4], [4, 79, 4], [8, 81, 4], [12, 79, 4]], [[0, 76, 6], [6, 74, 2], [8, 72, 8]], [[0, 81, 4], [4, 84, 4], [8, 81, 4], [12, 77, 4]], [[0, 79, 6], [6, 81, 2], [8, 83, 4], [12, 86, 4]],
      [[0, 84, 4], [4, 79, 4], [8, 76, 4], [12, 79, 4]], [[0, 81, 6], [6, 79, 2], [8, 76, 8]], [[0, 77, 4], [4, 81, 4], [8, 86, 4], [12, 84, 4]], [[0, 83, 8], [8, 79, 4], [12, 74, 4]]] },
  // 練習: 弾むト長調のチップチューン。
  practice: { bpm: 126, style: 'pop', chords: [[43, MAJ], [50, MAJ], [52, MIN], [48, MAJ], [43, MAJ], [50, MAJ], [52, MIN], [48, MAJ]],
    melody: [[[0, 79, 2], [2, 83, 2], [4, 86, 4], [8, 83, 2], [10, 81, 2], [12, 79, 4]], [[0, 78, 2], [2, 81, 2], [4, 86, 4], [8, 81, 4], [12, 78, 4]],
      [[0, 79, 2], [2, 83, 2], [4, 88, 4], [8, 86, 2], [10, 83, 2], [12, 81, 4]], [[0, 79, 4], [4, 76, 2], [6, 79, 2], [8, 81, 8]],
      [[0, 86, 2], [2, 83, 2], [4, 79, 2], [6, 83, 2], [8, 86, 4], [12, 88, 4]], [[0, 86, 4], [4, 81, 2], [6, 78, 2], [8, 81, 8]],
      [[0, 83, 2], [2, 86, 2], [4, 88, 4], [8, 91, 4], [12, 88, 4]], [[0, 84, 4], [4, 83, 2], [6, 81, 2], [8, 79, 8]]] },
  // 模試: パチスロ風のイ短調。4つ打ちとうねるベース、鐘のリフ。
  exam: { bpm: 132, style: 'slot', chords: [[45, MIN], [43, MAJ], [41, MAJ], [40, MAJ], [45, MIN], [43, MAJ], [41, MAJ], [40, MAJ]],
    melody: [[[0, 81, 2], [3, 84, 1], [4, 88, 2], [6, 84, 2], [8, 81, 2], [10, 79, 2], [12, 76, 4]], [[0, 79, 2], [3, 83, 1], [4, 86, 2], [6, 83, 2], [8, 79, 4], [12, 74, 4]],
      [[0, 77, 2], [3, 81, 1], [4, 84, 2], [6, 81, 2], [8, 77, 2], [10, 76, 2], [12, 72, 4]], [[0, 76, 2], [2, 80, 2], [4, 83, 2], [6, 88, 2], [8, 86, 2], [10, 83, 2], [12, 80, 4]],
      [[0, 81, 2], [3, 84, 1], [4, 88, 2], [6, 84, 2], [8, 81, 2], [10, 79, 2], [12, 76, 4]], [[0, 79, 2], [3, 83, 1], [4, 86, 2], [6, 83, 2], [8, 79, 4], [12, 74, 4]],
      [[0, 77, 2], [3, 81, 1], [4, 84, 2], [6, 81, 2], [8, 77, 2], [10, 76, 2], [12, 72, 4]], [[0, 88, 2], [2, 86, 2], [4, 83, 2], [6, 80, 2], [8, 76, 8]]] },
};
SONGS.fever = Object.assign({}, SONGS.practice, { bpm: 140, transpose: 2, hot: true });
SONGS.ta = Object.assign({}, SONGS.exam, { bpm: 150, transpose: 2, hot: true });

// ac は AudioContext（本番）か OfflineAudioContext（検証）。level は 0〜1 の音量。
function createBgm(ac, opt = {}) {
  const level = opt.level || (() => .2), live = () => !!ac && (opt.always || ac.state === 'running');
  let out = null, duckG = null, songG = null, nb = null, timer = 0, cur = null, want = null, step = 0, nextT = 0;
  function ensure() {
    if (out) return;
    out = ac.createGain(); out.gain.value = level(); duckG = ac.createGain(); duckG.gain.value = 1; out.connect(duckG); duckG.connect(ac.destination);
    nb = ac.createBuffer(1, Math.floor(ac.sampleRate * .5), ac.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function env(g, t, vol, a, dur) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(.0001, t + Math.max(a + .02, dur)); }
  function note(type, f, t, dur, vol, o = {}) {
    const osc = ac.createOscillator(), g = ac.createGain(); osc.type = type; osc.frequency.setValueAtTime(f, t);
    let src = osc; if (o.lp) { const bq = ac.createBiquadFilter(); bq.type = 'lowpass'; bq.frequency.setValueAtTime(o.lp, t); bq.Q.value = .7; osc.connect(bq); src = bq; }
    src.connect(g); env(g, t, vol, o.attack || .005, dur); g.connect(songG); osc.start(t); osc.stop(t + dur + .05);
  }
  const bell = (f, t, dur, vol) => { note('sine', f, t, dur, vol); note('sine', f * 2.76, t, dur * .35, vol * .22); };
  function kick(t, vol) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + .12); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + .16); o.connect(g); g.connect(songG); o.start(t); o.stop(t + .2); }
  function hit(t, dur, vol, type, f) { const s = ac.createBufferSource(), bq = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nb; bq.type = type; bq.frequency.setValueAtTime(f, t); bq.Q.value = .8; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); s.connect(bq); bq.connect(g); g.connect(songG); s.start(t, Math.random() * .3); s.stop(t + dur + .02); }
  // 16分音符1つ分を予約する。
  function schedule(song, n, t) {
    const bars = song.chords.length, bar = Math.floor(n / 16) % bars, s = n % 16, spb = 60 / song.bpm / 4, tr = song.transpose || 0;
    const [r0, ch] = song.chords[bar], root = r0 + tr;
    for (const [at, m, len] of song.melody[bar]) if (at === s) {
      if (song.style === 'pop') note('square', midi(m + tr), t, len * spb * .9, .045, { lp: 3200 });
      else bell(midi(m + tr), t, Math.max(.25, len * spb * 1.2), song.style === 'calm' ? .07 : .06);
    }
    if (song.style === 'calm') {
      if (s === 0) for (const k of ch.slice(0, 3)) note('triangle', midi(root + 12 + k), t, spb * 15, .022, { attack: .25 });
      if (s === 0 || s === 8) note('triangle', midi(s ? root + 7 : root), t, spb * 6, .1);
      if (s === 12) note('triangle', midi(root + 12), t, spb * 4, .07);
      if (s === 0 || s === 8) kick(t, .09);
      if (s === 4 || s === 12) hit(t, .04, .03, 'bandpass', 2600);
      if (s % 2 === 0) hit(t, .03, .012, 'highpass', 7000);
    } else if (song.style === 'pop') {
      if (s % 2 === 0) note('square', midi(root + (s % 4 ? 12 : 0)), t, spb * 1.6, .05, { lp: 700 });
      if (song.hot || bar >= 4) note('square', midi(root + 24 + ch[s % 4]), t, spb * .8, .012, { lp: 2600 });
      if (s === 0 || s === 8 || s === 10) kick(t, .14);
      if (s === 4 || s === 12) hit(t, .12, .05, 'highpass', 1500);
      if (song.hot ? true : s % 2 === 0) hit(t, s === 14 ? .12 : .03, .016, 'highpass', 8000);
    } else {
      if ([0, 3, 6, 8, 10, 13, 14].includes(s)) note('sawtooth', midi(root + [0, 0, 12, 0, 7, 12, 0][[0, 3, 6, 8, 10, 13, 14].indexOf(s)]), t, spb * 1.4, .045, { lp: 520 });
      if (s % 4 === 2) for (const k of ch.slice(0, 3)) note('square', midi(root + 24 + k), t, spb * .9, .01, { lp: 2200 });
      if (s % 4 === 0) kick(t, .14);
      if (s === 4 || s === 12) hit(t, .1, .05, 'bandpass', 1500);
      if (s % 2 === 1 || song.hot) hit(t, s % 4 === 2 ? .09 : .03, .014, 'highpass', 7500);
    }
  }
  function begin(name, t) {
    if (songG) { const old = songG; old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(old.gain.value || 1, t); old.gain.linearRampToValueAtTime(.0001, t + .35); setTimeout(() => { try { old.disconnect(); } catch (e) { /* 既に切断 */ } }, 900); }
    songG = ac.createGain(); songG.gain.setValueAtTime(.0001, t); songG.gain.linearRampToValueAtTime(1, t + .4); songG.connect(out);
    cur = name; step = 0; nextT = t + .05;
  }
  function tick() {
    if (!want || level() <= 0 || !live() || (typeof document !== 'undefined' && document.hidden)) return;
    ensure(); const now = ac.currentTime;
    if (cur !== want) begin(want, now);
    if (nextT < now) nextT = now + .05; // 裏に回っていた間の分は鳴らさない
    const song = SONGS[cur], spb = 60 / song.bpm / 4;
    while (nextT < now + .3) { schedule(song, step, nextT); step = (step + 1) % (song.chords.length * 16); nextT += spb; }
  }
  return {
    songs: Object.keys(SONGS),
    play(name) { if (!SONGS[name]) return; want = name; if (!timer && !opt.always) timer = setInterval(tick, 60); tick(); },
    stop() { want = null; },
    current: () => want,
    setLevel() { if (out) out.gain.value = level(); if (level() <= 0) cur = null; },
    // ファンファーレの間だけ少し下げる。
    duck(to = .35, sec = 1.4) {
      if (!duckG || !live()) return; const t = ac.currentTime, g = duckG.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(to, t + .06); g.setValueAtTime(to, t + sec); g.linearRampToValueAtTime(1, t + sec + .5);
    },
    // 検証用: 指定の曲を sec 秒分まとめて予約する（OfflineAudioContext 向け）。
    prime(name, sec) { if (!SONGS[name]) return; ensure(); begin(name, 0); const song = SONGS[name], spb = 60 / song.bpm / 4; while (nextT < sec) { schedule(song, step, nextT); step = (step + 1) % (song.chords.length * 16); nextT += spb; } },
  };
}
window.createBgm = createBgm;
})();
