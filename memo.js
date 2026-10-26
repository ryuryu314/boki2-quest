/* 問題の横のメモ帳。Spiral Paint のメモ描画（MemoDocument / MemoRenderer / FlipbookMemoComponent）を
   ブラウザ用に移植したもの。描画コアは illustration-core.js（SpiralIllustrationCore の移植）を使う。
   パラパラ漫画のコマ・オニオンスキン・画像の読み込みは、問題のメモには要らないので移していない。 */
(() => {
  'use strict';
  const BK = window.BK = window.BK || {};
  const I = BK.ill;

  /* ---------- MemoRenderer.cpp の定数 ---------- */
  const INK = 'rgb(73, 92, 117)';            // メモの線の色
  const SOFTWARE_BG = 'rgb(232, 234, 236)';  // 縮小したときにキャンバスの外に見える地
  const TOOL_SCALE = { pen: 1.0, brushSoft: 2.4, brushFlat: 3.1, brushWide: 4.1, eraserSharp: 2.6, eraserSoft: 2.1, eraserBlock: 3.2 };
  const CORNER_START_DOT = 0.72, CORNER_FULL_DOT = 0.28;
  const MAX_UNDO = 64;
  // 太さの基準になる標準キャンバス。太さはおおよそこの大きさでのピクセル幅。
  const REF_W = 640, REF_H = 360, ASPECT = REF_W / REF_H;
  const MIN_ZOOM = 0.5, MAX_ZOOM = 5;
  const TOOLS = [
    ['pen', 'ペン', 'ふつうのメモペンで描く'],
    ['brushSoft', 'やわ筆', 'やわらかい丸筆。塗りに'],
    ['brushFlat', '平筆', '角のある平筆。ふちがくっきり'],
    ['brushWide', '太筆', '幅の広い丸筆'],
    ['eraserSharp', '鋭消し', '角がとがった消しゴム'],
    ['eraserSoft', '柔消し', 'やわらかい丸消しゴム'],
  ];
  const family = tool => (I.isBrushTool(tool) ? 'brush' : I.isEraserTool(tool) ? 'eraser' : 'pen');
  const FAMILY_NAME = { pen: 'ペン', brush: '筆', eraser: '消しゴム' };

  function toolLocalThicknessScale(tool, thickness) {
    const raw = I.clampStrokeThickness(thickness) / I.defaultStrokeThickness;
    if (tool === 'pen') return raw;
    const adjusted = raw >= 1 ? 1 + (raw - 1) * 1.75 : 1 - (1 - raw) * 1.25;
    // 昔の太さの範囲を超えたら、筆も消しゴムもペンと同じ幅まで太くなる
    return Math.max(Math.min(3, Math.max(0.22, adjusted)), raw / TOOL_SCALE[tool]);
  }
  const effectiveThickness = (tool, thickness, canvasScale) => I.defaultStrokeThickness * canvasScale * toolLocalThicknessScale(tool, thickness) * TOOL_SCALE[tool];
  const canvasThicknessScale = (w, h, rw = REF_W, rh = REF_H) => (w <= 1 || h <= 1 || rw <= 1 || rh <= 1 ? 1 : Math.sqrt((w / rw) * (h / rh)));
  const isSquareDab = tool => tool === 'brushFlat' || tool === 'eraserSharp' || tool === 'eraserBlock';
  const lineJoin = s => (s.sharp ? 'miter' : s.tool === 'brushFlat' || s.tool === 'eraserBlock' ? 'bevel' : s.tool === 'eraserSharp' ? 'miter' : 'round');
  const lineCap = tool => (isSquareDab(tool) ? 'square' : 'round');

  function cornerSmoothingScale(p, c, n) {
    const ix = c.x - p.x, iy = c.y - p.y, ox = n.x - c.x, oy = n.y - c.y;
    const il = Math.hypot(ix, iy), ol = Math.hypot(ox, oy);
    if (il <= 0.00001 || ol <= 0.00001) return 1;
    const dot = (ix * ox + iy * oy) / (il * ol);
    if (dot >= CORNER_START_DOT) return 1;
    if (dot <= CORNER_FULL_DOT) return 0;
    return (dot - CORNER_FULL_DOT) / (CORNER_START_DOT - CORNER_FULL_DOT);
  }

  // 手ぶれ補正: 1-2-1 の平均を最大3回。曲がり角は補正を弱めて角を残す。
  function smoothStrokePoints(points, amount) {
    if (points.length < 3) return points;
    const a = I.clampStrokeSmoothingAmount(amount);
    const blend = a * 0.86, passes = Math.min(3, Math.max(0, Math.round(a * 3 + 0.35)));
    if (blend <= 0.001 || passes <= 0) return points;
    let out = points.slice();
    for (let pass = 0; pass < passes; ++pass) {
      const src = out.slice();
      for (let i = 1; i + 1 < src.length; ++i) {
        const p = src[i - 1], c = src[i], n = src[i + 1];
        const b = blend * cornerSmoothingScale(p, c, n);
        out[i] = { x: c.x + (p.x * 0.25 + c.x * 0.5 + n.x * 0.25 - c.x) * b, y: c.y + (p.y * 0.25 + c.y * 0.5 + n.y * 0.25 - c.y) * b };
      }
    }
    return out;
  }

  // 1本の線を描く。消しゴムはそのレイヤーのインクだけを削る（destination-out）。
  function strokeTo(ctx, r, s, scale) {
    if (!s.points.length || s.opacity <= 0) return;
    const eff = effectiveThickness(s.tool, s.thickness, scale);
    const pts = smoothStrokePoints(s.points, s.smoothingAmount);
    ctx.globalAlpha = I.clampStrokeOpacity(s.opacity);
    ctx.globalCompositeOperation = I.isEraserTool(s.tool) ? 'destination-out' : 'source-over';
    ctx.fillStyle = ctx.strokeStyle = INK;
    const X = p => r.x + p.x * r.w, Y = p => r.y + p.y * r.h;
    if (pts.length === 1) {
      const d = eff * 1.1, x = X(pts[0]), y = Y(pts[0]);
      if (isSquareDab(s.tool)) ctx.fillRect(x - d / 2, y - d / 2, d, d);
      else { ctx.beginPath(); ctx.arc(x, y, d / 2, 0, Math.PI * 2); ctx.fill(); }
      return;
    }
    ctx.lineWidth = eff; ctx.lineJoin = lineJoin(s); ctx.lineCap = lineCap(s.tool);
    ctx.beginPath(); ctx.moveTo(X(pts[0]), Y(pts[0]));
    for (let i = 1; i < pts.length; ++i) ctx.lineTo(X(pts[i]), Y(pts[i]));
    ctx.stroke();
  }
  function strokesTo(ctx, r, strokes, scale) {
    ctx.save();
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    for (const s of strokes) strokeTo(ctx, r, s, scale);
    ctx.restore();
  }

  // 入力中、ほぼ一直線に並んだ点は1つにまとめる（FlipbookMemoComponent の canReplacePreviousStrokePoint）
  function canReplacePreviousStrokePoint(points, next) {
    if (points.length < 2) return false;
    const bp = points[points.length - 2], prev = points[points.length - 1];
    const sx = next.x - bp.x, sy = next.y - bp.y, lsq = sx * sx + sy * sy;
    if (lsq <= 0.000001) return false;
    const progress = ((prev.x - bp.x) * sx + (prev.y - bp.y) * sy) / lsq;
    if (progress <= 0 || progress >= 1) return false;
    const px = bp.x + sx * progress, py = bp.y + sy * progress;
    return Math.hypot(prev.x - px, prev.y - py) < 0.0009 && Math.hypot(prev.x - next.x, prev.y - next.y) < 0.018;
  }

  /* ---------- MemoDocument.cpp: 取り消し64回の編集履歴 ---------- */
  const sameStroke = (l, r) => l === r || (l.tool === r.tool && Math.abs(l.thickness - r.thickness) <= 0.00001 && Math.abs(l.opacity - r.opacity) <= 0.00001
    && Math.abs(l.smoothingAmount - r.smoothingAmount) <= 0.00001 && l.sharp === r.sharp && l.points.length === r.points.length
    && l.points.every((p, i) => Math.abs(p.x - r.points[i].x) <= 0.00001 && Math.abs(p.y - r.points[i].y) <= 0.00001));
  const sameStrokes = (l, r) => l === r || (l.length === r.length && l.every((s, i) => sameStroke(s, r[i])));
  class MemoDocument {
    constructor() { this.strokes = []; this.undoHistory = []; this.redoHistory = []; }
    pushEdit(before, after) {
      if (sameStrokes(before, after)) return false;
      this.strokes = after;
      if (this.undoHistory.length >= MAX_UNDO) this.undoHistory.shift();
      this.undoHistory.push({ before, after });
      this.redoHistory = [];
      return true;
    }
    appendStroke(stroke) { return stroke.points.length ? this.pushEdit(this.strokes, this.strokes.concat([stroke])) : false; }
    clear() { return this.strokes.length ? this.pushEdit(this.strokes, []) : false; }
    undo() {
      const c = this.undoHistory.pop(); if (!c) return false;
      this.strokes = c.before;
      if (this.redoHistory.length >= MAX_UNDO) this.redoHistory.shift();
      this.redoHistory.push(c); return true;
    }
    redo() {
      const c = this.redoHistory.pop(); if (!c) return false;
      this.strokes = c.after;
      if (this.undoHistory.length >= MAX_UNDO) this.undoHistory.shift();
      this.undoHistory.push(c); return true;
    }
  }

  /* ---------- 保存形式: 座標は 1/4096 単位の整数（キャンバス外の QuickShape 点もそのまま） ---------- */
  const QUANT = 4096;
  const encodeStroke = s => ({ t: s.tool, w: s.thickness, o: Math.round(s.opacity * 100) / 100, m: Math.round(s.smoothingAmount * 100) / 100, k: s.sharp ? 1 : 0,
    p: s.points.flatMap(p => [Math.round(p.x * QUANT), Math.round(p.y * QUANT)]) });
  function decodeStroke(e) {
    const points = [];
    for (let i = 0; i + 1 < e.p.length; i += 2) points.push({ x: e.p[i] / QUANT, y: e.p[i + 1] / QUANT });
    return { tool: TOOL_SCALE[e.t] ? e.t : 'pen', thickness: I.clampStrokeThickness(+e.w || I.defaultStrokeThickness), opacity: I.clampStrokeOpacity(e.o == null ? 1 : +e.o),
      smoothingAmount: I.clampStrokeSmoothingAmount(e.m == null ? I.defaultStrokeSmoothingAmount : +e.m), sharp: !!e.k, points };
  }

  /* ---------- メモの保管（このPCのブラウザ内。問題ごとに1枚） ---------- */
  const STORE_KEY = 'boki2DopaQuest.memos.v1';
  let cache = null;
  function readAll() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { cache = {}; }
    if (!cache || typeof cache.items !== 'object' || !cache.items) cache = { items: {} };
    return cache;
  }
  function writeAll(next) { localStorage.setItem(STORE_KEY, JSON.stringify(next)); cache = next; }
  const store = {
    get: id => readAll().items[id] || null,
    list: () => Object.values(readAll().items).sort((a, b) => b.at - a.at),
    count: () => Object.keys(readAll().items).length,
    put(rec) { try { writeAll({ items: { ...readAll().items, [rec.id]: rec } }); return true; } catch (e) { return false; } },
    remove(id) { const items = { ...readAll().items }; delete items[id]; try { writeAll({ items }); return true; } catch (e) { return false; } },
    bytes() { try { return (localStorage.getItem(STORE_KEY) || '').length * 2; } catch (e) { return 0; } },
  };

  // 保存したメモを任意の大きさの canvas に描く（展示室のサムネイル・拡大表示・PNG書き出し）
  function renderRecord(canvas, rec, cssW, cssH, dpr = Math.min(2, window.devicePixelRatio || 1)) {
    canvas.width = Math.max(1, Math.round(cssW * dpr)); canvas.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cssW, cssH);
    const layer = document.createElement('canvas'); layer.width = canvas.width; layer.height = canvas.height;
    const lctx = layer.getContext('2d'); lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    strokesTo(lctx, { x: 0, y: 0, w: cssW, h: cssH }, (rec.s || []).map(decodeStroke), canvasThicknessScale(cssW, cssH, rec.rw || REF_W, rec.rh || REF_H));
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(layer, 0, 0);
    return canvas;
  }
  function exportPng(rec, filename) {
    const c = renderRecord(document.createElement('canvas'), rec, 1280, 720, 1);
    return new Promise(resolve => c.toBlob(blob => {
      if (!blob) { resolve(false); return; }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000); resolve(true);
    }, 'image/png'));
  }

  /* ---------- 道具の状態（ペン・筆・消しゴムで太さと濃さを別々に覚える） ---------- */
  const TOOL_KEY = 'boki2DopaQuest.memoTools.v1';
  function loadToolState() {
    const d = { tool: 'pen', smooth: I.defaultStrokeSmoothingAmount, pen: { t: I.defaultStrokeThickness, o: 1 }, brush: { t: I.defaultStrokeThickness, o: 1 }, eraser: { t: I.defaultStrokeThickness, o: 1 } };
    try { const s = JSON.parse(localStorage.getItem(TOOL_KEY) || '{}'); for (const k of ['pen', 'brush', 'eraser']) d[k] = Object.assign(d[k], s[k] || {}); if (TOOL_SCALE[s.tool]) d.tool = s.tool; if (s.smooth != null) d.smooth = +s.smooth; } catch (e) { /* 既定値のまま */ }
    if (d.tool === 'eraserBlock') d.tool = 'eraserSharp';
    return d;
  }
  const saveToolState = st => { try { localStorage.setItem(TOOL_KEY, JSON.stringify(st)); } catch (e) { /* 保存できなくても描ける */ } };

  /* ---------- メモ帳パネル（FlipbookMemoComponent の入力処理） ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function create(host, opt) {
    const q = opt.question;
    const st = loadToolState();
    const doc = new MemoDocument();
    let savedStrokes = null; // 最後に保存した（または開いた）ときの線。dirty 判定は参照の比較で足りる
    host.innerHTML = `<div class="memo">
      <div class="memo-bar">
        <div class="memo-tools">${TOOLS.map(([id, name, tip]) => `<button type="button" data-tool="${id}" title="${tip}">${name}</button>`).join('')}</div>
        <div class="memo-acts"><button type="button" data-cmd="undo" title="元に戻す（Ctrl+Z）">↶</button><button type="button" data-cmd="redo" title="やり直す（Ctrl+Y / Ctrl+Shift+Z）">↷</button><button type="button" data-cmd="clear" title="キャンバスを消す（元に戻せます）">全消し</button></div>
      </div>
      <div class="memo-bar">
        <div class="memo-step" data-cmd="step"><i></i><span class="d1"></span><b></b><span class="d2"></span></div>
        <label class="memo-range" title="次に描く線の濃さ（ダブルクリックで100%）"><span>濃さ</span><input type="range" min="0" max="100" step="1" data-k="opacity"></label>
        <label class="memo-range" title="線の手ぶれ補正の強さ（ダブルクリックで55%）"><span>補正</span><input type="range" min="0" max="100" step="1" data-k="smooth"></label>
        <div class="memo-acts">
          <button type="button" data-cmd="prev" title="この問題で前に保存したメモを開く（解答後）" hidden>📒 前回</button>
          <button type="button" data-cmd="save" class="memo-save" title="この問題とセットでメモ展示室に保存">💾 保存</button>
        </div>
      </div>
      <div class="memo-paper"><canvas></canvas><p class="memo-hint">ここに描けます。押したまま止めると、線・角・曲線・円・四角に整います</p><button type="button" class="memo-zoom" hidden title="拡大縮小をもとに戻す">等倍</button></div>
    </div>`;
    const root = host.firstElementChild, paper = root.querySelector('.memo-paper'), canvas = paper.querySelector('canvas'), ctx = canvas.getContext('2d');
    const layer = document.createElement('canvas'), lctx = layer.getContext('2d');
    const tmp = document.createElement('canvas'), tctx = tmp.getContext('2d');
    const $ = s => root.querySelector(s);
    const stepEl = $('.memo-step'), opRange = $('[data-k="opacity"]'), smRange = $('[data-k="smooth"]');

    let W = 1, H = 1, dpr = 1, layerDirty = true, drawPending = false;
    let zoom = 1, zoomAnchorN = { x: 0.5, y: 0.5 }, zoomAnchorPos = null;
    let active = null, qsKind = I.QuickShapeKind.none, qsSource = [], qsTarget = [], lastInputMs = 0, morphStartMs = 0, timer = 0;
    let preview = null, previewAngle = 0, answered = !!opt.answered;

    const baseRect = () => ({ x: 0, y: 0, w: W, h: H });
    function canvasRect() {
      const b = baseRect();
      if (Math.abs(zoom - 1) < 0.001) return b;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)), w = b.w * z, h = b.h * z, a = zoomAnchorPos || { x: b.w / 2, y: b.h / 2 };
      return { x: a.x - zoomAnchorN.x * w, y: a.y - zoomAnchorN.y * h, w, h };
    }
    const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    const toNormalized = (p, r) => ({ x: (Math.min(r.x + r.w, Math.max(r.x, p.x)) - r.x) / Math.max(1, r.w), y: (Math.min(r.y + r.h, Math.max(r.y, p.y)) - r.y) / Math.max(1, r.h) });
    const scaleNow = () => { const r = canvasRect(); return canvasThicknessScale(r.w, r.h); };
    const local = e => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };

    /* --- 描画 --- */
    function requestDraw() { if (!drawPending) { drawPending = true; requestAnimationFrame(draw); } }
    function rebuildLayer() {
      lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      strokesTo(lctx, canvasRect(), doc.strokes, scaleNow());
      layerDirty = false;
    }
    function activeStrokes() {
      if (!active) return [];
      const out = [active];
      // 点は少し動くまで足されないので、最後の点からペン先までを「しっぽ」で見せる（QuickShape 中は出さない）
      if (preview && qsKind === I.QuickShapeKind.none && active.points.length) {
        const last = active.points[active.points.length - 1], tail = toNormalized(preview, canvasRect());
        if (Math.hypot(tail.x - last.x, tail.y - last.y) >= 0.0001) out.push({ ...active, points: [last, tail] });
      }
      return out;
    }
    function drawPreview() {
      if (!preview) return;
      const r = canvasRect(); if (!contains(r, preview)) return;
      const tool = active ? active.tool : st.tool, thickness = active ? active.thickness : st[family(tool)].t;
      const size = Math.max(6, effectiveThickness(tool, thickness, scaleNow()) * 1.1), eraser = I.isEraserTool(tool);
      const outline = eraser ? 'rgba(219,102,102,0.52)' : 'rgba(68,92,118,0.47)', fill = eraser ? 'rgba(255,255,255,0.36)' : 'rgba(95,131,168,0.07)';
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.translate(preview.x, preview.y);
      ctx.fillStyle = fill; ctx.strokeStyle = outline; ctx.lineWidth = 1.4; ctx.beginPath();
      if (isSquareDab(tool)) { ctx.rotate(previewAngle); ctx.rect(-size / 2, -size / 2, size, size); } else ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      const c = Math.min(6, Math.max(2, size * 0.16));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 0.65; ctx.fillStyle = outline;
      ctx.beginPath(); ctx.arc(preview.x, preview.y, c / 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function draw() {
      drawPending = false;
      if (!canvas.isConnected) return;
      const r = canvasRect();
      if (layerDirty) rebuildLayer();
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (Math.abs(zoom - 1) >= 0.001) { ctx.fillStyle = SOFTWARE_BG; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = '#fff'; ctx.fillRect(r.x, r.y, r.w, r.h);
      const act = activeStrokes();
      let src = layer;
      if (act.length && I.isEraserTool(act[0].tool)) {
        // 消しゴムは確定済みのインクの写しから削って見せる（紙は削らない）
        tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, tmp.width, tmp.height); tctx.drawImage(layer, 0, 0);
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0); strokesTo(tctx, r, act, scaleNow()); src = tmp;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(src, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (act.length && !I.isEraserTool(act[0].tool)) strokesTo(ctx, r, act, scaleNow());
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      drawPreview();
      paper.classList.toggle('empty', !doc.strokes.length && !active);
    }
    // 紙は 16:9 のまま、カードの見えている高さに収まる大きさにする。
    // 紙の上（ツールバー）と下にあるメモ帳自身の高さを、メモ帳の枠の中で測って差し引く（列の余白は数えない）
    function fit() {
      const box = opt.fitIn;
      if (!box || !root.isConnected) return;
      if (window.innerWidth <= 760) { paper.style.width = ''; return; } // 1列表示のときはスクロールで見る
      const own = root.getBoundingClientRect(), p = paper.getBoundingClientRect();
      const maxW = paper.parentElement.clientWidth, maxH = box.clientHeight - (p.top - own.top) - (own.bottom - p.bottom) - 6;
      paper.style.width = Math.round(Math.max(Math.min(240, maxW), Math.min(maxW, maxH * ASPECT))) + 'px';
    }
    function resize() {
      const b = paper.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return;
      dpr = Math.min(2, window.devicePixelRatio || 1); W = b.width; H = b.height;
      for (const c of [canvas, layer, tmp]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      layerDirty = true; draw();
    }

    /* --- 線の入力（beginStroke / appendStrokePoint / QuickShape / finishStroke） --- */
    const resetQuickShape = () => { qsSource = []; qsTarget = []; qsKind = I.QuickShapeKind.none; lastInputMs = 0; morphStartMs = 0; };
    const noteInput = () => { lastInputMs = performance.now(); };
    function beginStroke(pos) {
      const r = canvasRect();
      if (!contains(r, pos)) return;
      resetQuickShape();
      const f = st[family(st.tool)];
      active = { tool: st.tool, thickness: I.clampStrokeThickness(f.t), opacity: I.clampStrokeOpacity(f.o), smoothingAmount: I.clampStrokeSmoothingAmount(st.smooth), sharp: false, points: [toNormalized(pos, r)] };
      noteInput();
      clearInterval(timer); timer = setInterval(onTimer, 1000 / 30);
      requestDraw();
    }
    function appendStrokePoint(pos) {
      if (!active) return;
      const n = toNormalized(pos, canvasRect()), pts = active.points, last = pts[pts.length - 1];
      if (last && Math.hypot(last.x - n.x, last.y - n.y) < 0.0035) return;
      if (canReplacePreviousStrokePoint(pts, n)) pts[pts.length - 1] = n; else pts.push(n);
      noteInput();
    }
    function tryActivateQuickShape() {
      if (!active || qsKind !== I.QuickShapeKind.none || I.isEraserTool(active.tool) || active.points.length < 2 || lastInputMs <= 0) return false;
      const t = performance.now();
      if (t - lastInputMs < I.quickShapeHoldMilliseconds) return false;
      qsSource = active.points.slice();
      const kind = I.classifyQuickShape(qsSource);
      if (kind === I.QuickShapeKind.none) { lastInputMs = t; return false; }
      qsTarget = I.makeQuickShapePoints(kind, qsSource, qsSource[qsSource.length - 1], false);
      morphStartMs = t;
      active.points = I.interpolatePointVectors(qsSource, qsTarget, 0);
      active.smoothingAmount = 0;
      active.sharp = I.quickShapeHasSharpCorners(kind);
      qsKind = kind;
      if (opt.onQuickShape) {
        // 判定は 0〜1 の座標（16:9 の紙では丸も「楕円」になる）なので、知らせる名前は画面上の丸さで決める
        let shown = kind;
        if (kind === I.QuickShapeKind.ellipse || kind === I.QuickShapeKind.circle) {
          const r = canvasRect(), f = I.fitEllipse(qsTarget.map(p => ({ x: p.x * r.w, y: p.y * r.h })));
          shown = f.valid && f.majorRadius > 0 && f.minorRadius / f.majorRadius > 0.82 ? I.QuickShapeKind.circle : I.QuickShapeKind.ellipse;
        }
        opt.onQuickShape(shown);
      }
      return true;
    }
    function applyQuickShapeMorph() {
      if (!active || !qsSource.length || !qsTarget.length) return;
      const progress = Math.min(1, Math.max(0, (performance.now() - morphStartMs) / I.quickShapeMorphMilliseconds));
      active.points = I.interpolatePointVectors(qsSource, qsTarget, progress);
      if (progress >= 1) morphStartMs = 0;
    }
    function updateQuickShapePreview(pos) {
      if (!active || qsKind === I.QuickShapeKind.none || !qsSource.length) return;
      qsTarget = I.makeQuickShapePoints(qsKind, qsSource, toNormalized(pos, canvasRect()));
      if (morphStartMs > 0) applyQuickShapeMorph(); else active.points = qsTarget;
    }
    function onTimer() {
      let changed = tryActivateQuickShape();
      if (qsKind !== I.QuickShapeKind.none && morphStartMs > 0) { applyQuickShapeMorph(); changed = true; }
      if (changed) requestDraw();
    }
    function finishStroke() {
      clearInterval(timer); timer = 0;
      if (!active) { resetQuickShape(); return; }
      if (qsKind !== I.QuickShapeKind.none && qsTarget.length) active.points = qsTarget;
      const stroke = active; active = null;
      const before = doc.strokes;
      if (doc.appendStroke(stroke)) {
        // 追加だけなら、確定レイヤーに1本描き足せば済む
        if (!layerDirty && doc.strokes.length === before.length + 1) { lctx.setTransform(dpr, 0, 0, dpr, 0, 0); strokesTo(lctx, canvasRect(), [stroke], scaleNow()); }
        else layerDirty = true;
      }
      resetQuickShape(); refresh(); requestDraw();
    }

    /* --- ポインター（マウス・ペン・タッチ） --- */
    function updatePreview(pos) {
      if (preview && pos) { const dx = pos.x - preview.x, dy = pos.y - preview.y; if (Math.hypot(dx, dy) >= 0.75) previewAngle = Math.atan2(dy, dx); }
      preview = pos; requestDraw();
    }
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const pos = local(e);
      updatePreview(pos);
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
      beginStroke(pos);
    });
    canvas.addEventListener('pointermove', e => {
      const pos = local(e);
      updatePreview(pos);
      if (!active) return;
      if (qsKind !== I.QuickShapeKind.none) { updateQuickShapePreview(pos); return; }
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of list.length ? list : [e]) appendStrokePoint(local(ev));
    });
    const up = e => {
      const pos = local(e);
      if (active && qsKind !== I.QuickShapeKind.none) updateQuickShapePreview(pos);
      finishStroke(); updatePreview(e.pointerType === 'mouse' ? pos : null);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', () => { if (!active) { preview = null; requestDraw(); } });
    // ホイールで、ポインターの位置を中心に 0.5〜5 倍
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const pos = local(e), notches = -e.deltaY / (e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 0.3 : 100);
      if (Math.abs(notches) < 0.001) return;
      zoomAnchorN = toNormalized(pos, canvasRect()); zoomAnchorPos = pos;
      const step = 1 + Math.min(0.75, Math.abs(notches) * 0.25) * 0.72;
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (notches > 0 ? step : 1 / step)));
      layerDirty = true; refresh(); updatePreview(pos);
    }, { passive: false });
    // メモ帳の中のクリック・右クリックは、ゲーム側（次の問題へ・一時停止）に渡さない
    root.addEventListener('click', e => e.stopPropagation());
    root.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });

    /* --- ボタン類 --- */
    function setActiveTool(tool) { st.tool = tool === 'eraserBlock' ? 'eraserSharp' : tool; saveToolState(st); refresh(); requestDraw(); }
    function undo() { const had = !!active; active = null; resetQuickShape(); clearInterval(timer); if (!doc.undo() && !had) return false; layerDirty = true; refresh(); requestDraw(); return true; }
    function redo() { const had = !!active; active = null; resetQuickShape(); clearInterval(timer); if (!doc.redo() && !had) return false; layerDirty = true; refresh(); requestDraw(); return true; }
    function clearCanvas() { active = null; resetQuickShape(); if (doc.clear()) { layerDirty = true; refresh(); requestDraw(); } }
    function saveMemo() {
      if (active) finishStroke();
      if (!doc.strokes.length) { if (opt.toast) opt.toast('まだ何も描かれていません'); return; }
      const rec = { v: 1, id: q.id, cat: q.cat, q: q.q, a: q.a, e: q.e, at: Date.now(), ar: ASPECT, rw: REF_W, rh: REF_H, s: doc.strokes.map(encodeStroke) };
      const existed = !!store.get(q.id);
      if (!store.put(rec)) { if (opt.toast) opt.toast('保存できませんでした。展示室で古いメモを消すと空きができます'); return; }
      savedStrokes = doc.strokes; refresh();
      if (opt.onSaved) opt.onSaved(rec, existed, $('[data-cmd="save"]'));
    }
    function openSaved() {
      const rec = store.get(q.id); if (!rec) return;
      active = null; resetQuickShape();
      if (doc.pushEdit(doc.strokes, rec.s.map(decodeStroke))) { savedStrokes = doc.strokes; layerDirty = true; refresh(); requestDraw(); }
    }
    root.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => setActiveTool(b.dataset.tool)));
    root.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
      const c = b.dataset.cmd;
      if (c === 'undo') undo(); else if (c === 'redo') redo(); else if (c === 'clear') clearCanvas(); else if (c === 'save') saveMemo();
      else if (c === 'prev') openSaved();
    }));
    $('.memo-zoom').addEventListener('click', () => { zoom = 1; zoomAnchorN = { x: 0.5, y: 0.5 }; zoomAnchorPos = null; layerDirty = true; refresh(); requestDraw(); });

    // 太さ20段階: 左半分をタップで細く、右半分で太く、横になぞると続けて変わる（ThicknessStepper）
    let stepDrag = null;
    const stepOf = () => I.getNearestStrokeThicknessStep(st[family(st.tool)].t);
    function chooseStep(n) {
      n = Math.min(I.strokeThicknessSteps.length, Math.max(1, n));
      if (n === stepOf()) return;
      st[family(st.tool)].t = I.strokeThicknessSteps[n - 1]; saveToolState(st); refresh(); requestDraw();
    }
    stepEl.addEventListener('pointerdown', e => { e.preventDefault(); stepDrag = { x: e.clientX, start: stepOf(), dragged: false }; try { stepEl.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ } });
    stepEl.addEventListener('pointermove', e => {
      if (!stepDrag) return;
      const dx = e.clientX - stepDrag.x;
      if (!stepDrag.dragged && Math.abs(dx) <= 4) return;
      stepDrag.dragged = true; chooseStep(stepDrag.start + Math.round(dx / 6));
    });
    stepEl.addEventListener('pointerup', e => {
      if (stepDrag && !stepDrag.dragged) { const b = stepEl.getBoundingClientRect(); chooseStep(stepOf() + (e.clientX - b.left < b.width / 2 ? -1 : 1)); }
      stepDrag = null;
    });
    opRange.addEventListener('input', () => { st[family(st.tool)].o = I.clampStrokeOpacity(opRange.value / 100); saveToolState(st); refresh(); });
    smRange.addEventListener('input', () => { st.smooth = I.clampStrokeSmoothingAmount(smRange.value / 100); saveToolState(st); refresh(); });
    opRange.addEventListener('dblclick', () => { st[family(st.tool)].o = I.defaultStrokeOpacity; saveToolState(st); refresh(); });
    smRange.addEventListener('dblclick', () => { st.smooth = I.defaultStrokeSmoothingAmount; saveToolState(st); refresh(); });

    function refresh() {
      root.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === st.tool));
      const fam = family(st.tool), step = stepOf(), last = I.strokeThicknessSteps.length;
      stepEl.querySelector('i').style.width = ((step - 1) / (last - 1) * 100) + '%';
      stepEl.querySelector('b').textContent = step;
      stepEl.title = `${FAMILY_NAME[fam]}の太さ: ${last}段階中 ${step}段目。左半分で細く、右半分で太く、横になぞると続けて変わる`;
      opRange.value = Math.round(st[fam].o * 100); opRange.previousElementSibling.textContent = `濃さ ${opRange.value}%`;
      smRange.value = Math.round(st.smooth * 100); smRange.previousElementSibling.textContent = `補正 ${smRange.value}%`;
      $('[data-cmd="undo"]').disabled = !doc.undoHistory.length;
      $('[data-cmd="redo"]').disabled = !doc.redoHistory.length;
      $('[data-cmd="clear"]').disabled = !doc.strokes.length;
      const saved = store.get(q.id), dirty = doc.strokes.length > 0 && doc.strokes !== savedStrokes;
      const sv = $('[data-cmd="save"]');
      sv.textContent = !dirty && saved && doc.strokes === savedStrokes ? '✓ 保存済み' : saved ? '💾 上書き保存' : '💾 保存';
      sv.classList.toggle('dirty', dirty);
      const prev = $('[data-cmd="prev"]');
      prev.hidden = !saved; prev.disabled = !answered;
      prev.title = answered ? 'この問題で前に保存したメモを開く' : '前に保存したメモは、解答したあとで開けます';
      $('.memo-zoom').hidden = Math.abs(zoom - 1) < 0.001;
      $('.memo-zoom').textContent = `等倍に戻す（${Math.round(zoom * 100)}%）`;
    }

    // Ctrl+Z / Ctrl+Y は、ゲームのキー操作より先に受け取る
    const onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !root.isConnected) return;
      if (e.code === 'KeyZ' && !e.shiftKey) undo();
      else if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') redo();
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const ro = new ResizeObserver(resize); ro.observe(paper);
    const fo = new ResizeObserver(() => fit()); if (opt.fitIn) fo.observe(opt.fitIn);
    refresh(); fit(); resize();

    return {
      save: saveMemo,
      openSaved,
      setAnswered(v) { answered = !!v; refresh(); },
      isDirty: () => doc.strokes.length > 0 && doc.strokes !== savedStrokes,
      strokeCount: () => doc.strokes.length,
      destroy() { clearInterval(timer); window.removeEventListener('keydown', onKey, true); ro.disconnect(); fo.disconnect(); },
    };
  }

  BK.memo = {
    create, store, renderRecord, exportPng, ASPECT,
    // テスト用に中身も出しておく
    _: { MemoDocument, smoothStrokePoints, effectiveThickness, toolLocalThicknessScale, canvasThicknessScale, canReplacePreviousStrokePoint, encodeStroke, decodeStroke, lineJoin, lineCap, TOOL_SCALE, REF_W, REF_H, esc },
  };
})();
