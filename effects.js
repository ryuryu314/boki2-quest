window.createEffects = function(S) { const $ = s => document.querySelector(s), app = $('#app'), rand = (a,b) => a+Math.random()*(b-a), now=()=>performance.now(), shuffle=a=>a.sort(()=>Math.random()-.5);
/* ================= audio ================= */
let ac = null, master = null;
try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.connect(ac.destination); } catch (e) { ac = null; }
const setVol = () => { if (master) master.gain.value = (S.set.vol / 100) * 0.6; };
setVol();
function audioUnlock() { if (ac && ac.state !== 'running') ac.resume().catch(() => {}); }
function soundHint() { $('#sound-hint').classList.toggle('show', !!ac && ac.state !== 'running'); }
if (ac) { ac.onstatechange = soundHint; setTimeout(soundHint, 1500); }
function tone(f, dur, type = 'square', vol = 0.2, when = 0, slide = 0) {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}
const semi = (f, s) => f * Math.pow(2, s / 12);
const SFX = {
  move() { tone(rand(1150, 1300), 0.03, 'square', 0.05); },
  bump() { tone(140, 0.07, 'square', 0.08); },
  ok() { tone(660, 0.05, 'square', 0.09); tone(990, 0.08, 'square', 0.09, 0.045); },
  back() { tone(520, 0.05, 'square', 0.07); tone(350, 0.08, 'square', 0.07, 0.045); },
  start() { [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(semi(392, s), 0.12, 'square', 0.08, i * 0.045)); },
  correct(combo) {
    const base = semi(523.25, Math.min(combo, 24));
    [0, 4, 7, 12].forEach((s, i) => tone(semi(base, s), 0.11, 'square', 0.11, i * 0.05));
    tone(semi(base, 24), 0.3, 'triangle', 0.09, 0.2);
  },
  wrong() { tone(233, 0.2, 'sawtooth', 0.13, 0, 0.55); tone(155, 0.32, 'sawtooth', 0.12, 0.13, 0.5); },
  crit() { for (let i = 0; i < 10; i++) tone(rand(1800, 3200), 0.06, 'square', 0.05, i * 0.03); tone(1046, 0.4, 'triangle', 0.1, 0.05); },
  fever() { tone(200, 0.6, 'sawtooth', 0.1, 0, 6); [0, 3, 7, 10, 12, 15, 19, 22, 24].forEach((s, i) => tone(semi(440, s), 0.09, 'square', 0.07, 0.1 + i * 0.04)); },
  level() { [[0, 0], [4, .1], [7, .2], [12, .3], [7, .42], [12, .52], [16, .62], [19, .72], [24, .82]].forEach(([s, w]) => tone(semi(523.25, s), 0.16, 'square', 0.1, w)); tone(semi(523.25, 24), 0.6, 'triangle', 0.1, 0.95); },
  coin() { tone(1568, 0.04, 'square', 0.05); tone(2093, 0.1, 'square', 0.05, 0.04); },
  rank() { tone(80, 0.5, 'sawtooth', 0.15, 0, 0.4); tone(160, 0.3, 'square', 0.1); },
  tick() { tone(1800, 0.02, 'square', 0.04); },
};

/* ================= rumble ================= */
function rumble(strong, weak, ms) {
  if (!S.set.rumble || !navigator.getGamepads) return;
  for (const gp of navigator.getGamepads()) {
    if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
      try { gp.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); } catch (e) { /* unsupported */ }
    }
  }
}

/* ================= fx ================= */
// 背景は CSS の静止グラデーション。キャンバスは粒子が飛んでいる間だけ描き、何も無いときは描画しない。
const cv = $('#fx'), cx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, dirty = false;
const lite = () => !S.set.fx;
function resize() { DPR = lite() ? 1 : Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0); dirty = false; }
addEventListener('resize', resize);
function applyFx() { document.body.classList.toggle('lite', lite()); resize(); }
applyFx();
const P = [];
const amount = n => Math.round(n * (lite() ? 0.35 : 1));
const add = p => { if (P.length < (lite() ? 220 : 700)) P.push(p); };
function burst(x, y, color, n = 40, spd = 9) {
  for (let i = amount(n); i > 0; i--) { const a = Math.random() * 6.283, v = rand(spd * 0.25, spd); add({ t: 's', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, dec: rand(0.012, 0.03), size: rand(2, 5.5), color }); }
}
function ring(x, y, color) { add({ t: 'r', x, y, r: 10, vr: 16, life: 1, dec: 0.028, color }); }
function confetti(n = 120) {
  const cols = ['#ff4f8b', '#29a3f0', '#2ecc71', '#ffc21a', '#7c4dff', '#ff8a3d'];
  for (let i = 0, m = amount(n); i < m; i++) add({ t: 'c', x: rand(0, W), y: rand(-H * 0.6, -10), vx: rand(-2, 2), vy: rand(2.5, 6), rot: rand(0, 6), vr: rand(-0.2, 0.2), w: rand(6, 13), h: rand(3, 7), life: 1, dec: rand(0.003, 0.006), color: cols[i % cols.length] });
}
function drawFx() {
  if (!P.length) { if (dirty) { cx.clearRect(0, 0, W, H); dirty = false; } return; }
  cx.clearRect(0, 0, W, H); dirty = true;
  let n = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i]; p.life -= p.dec;
    if (p.life <= 0) continue;
    cx.globalAlpha = Math.min(1, p.life * (p.t === 'c' ? 2 : 1));
    if (p.t === 's') { p.x += p.vx; p.y += p.vy; p.vy += 0.17; p.vx *= 0.98; cx.fillStyle = p.color; cx.beginPath(); cx.arc(p.x, p.y, p.size * p.life + 0.5, 0, 6.283); cx.fill(); }
    else if (p.t === 'r') { p.r += p.vr; p.vr *= 0.93; cx.strokeStyle = p.color; cx.lineWidth = 5 * p.life; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.283); cx.stroke(); }
    else {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; if (p.y > H + 20) continue;
      const c = Math.cos(p.rot) * DPR, s = Math.sin(p.rot) * DPR;
      cx.setTransform(c, s, -s, c, p.x * DPR, p.y * DPR); cx.fillStyle = p.color; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    P[n++] = p;
  }
  P.length = n;
  cx.globalAlpha = 1;
}
function pop(text, x, y, cls = '') { const el = document.createElement('div'); el.className = 'pop ' + cls; el.textContent = text; el.style.left = x + 'px'; el.style.top = y + 'px'; document.body.appendChild(el); setTimeout(() => el.remove(), 1400); }
function banner(html, cls = '') { const el = document.createElement('div'); el.className = 'banner ' + cls; el.innerHTML = html; document.body.appendChild(el); setTimeout(() => el.remove(), 1550); }
function shake(big) { if (lite()) return; app.classList.remove('shake', 'shake2'); void app.offsetWidth; app.classList.add(big ? 'shake2' : 'shake'); }
function flash(color) { const f = $('#flash'); f.style.background = color; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
function toast(msg) { const t = document.createElement('div'); t.textContent = msg; $('#toast').appendChild(t); setTimeout(() => t.remove(), 2700); }
function setFever(on) { document.body.classList.toggle('fever', on); }
// パッドのボタンはブラウザの「ユーザー操作」に数えられず全画面を断られることがあるので、そのときは F11 を案内する
function toggleFull() {
  const fail = () => toast('F11 でウィンドウ／全画面を切り替えられます');
  if (document.fullscreenElement) document.exitFullscreen().catch(fail);
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(fail);
  else fail();
}

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


return {SFX, audioUnlock, burst, confetti, banner, pop, toast, setFever, drawFx, Muse, setVol, applyFx}; };