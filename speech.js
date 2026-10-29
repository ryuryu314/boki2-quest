/* 問題文の読み上げ（ブラウザ内蔵の Web Speech API）。
   自動では端末内の日本語の女性の声を選び、高品質な声（拡張・プレミアム等）を優先する。
   オンラインの声は文章が提供元へ送られるため、設定で明示的に選んだときだけ使う。 */
(function () {
'use strict';
const FEMALE = /kyoko|o-?ren|nanami|haruka|ayumi|sayaka|mizuki|aoi|mayu|shiori|nanako|女性|female/i;
const MALE = /ichiro|keita|otoya|hattori|daichi|naoki|男性|\bmale\b/i;
const QUALITY = /premium|enhanced|natural|neural|拡張|高品質|プレミアム/i;
// 自動選択の点数: 女性・高品質・日本(ja-JP)を上位、男性の声は下位。
function score(v) {
  const n = v.name || '';
  return (FEMALE.test(n) ? 40 : 0) - (MALE.test(n) ? 60 : 0) + (QUALITY.test(n) ? 20 : 0) + (/^ja[-_]JP$/i.test(v.lang || '') ? 5 : 0) + (v.default ? 2 : 0);
}
// 読みやすく整える: 括弧は区切りに、連続する区切りや先頭の区切りは詰める。
function clean(text) {
  return String(text || '').replace(/[【】「」『』〔〕［］]/g, '、').replace(/\s+/g, ' ').replace(/[、,]\s*(?=[、。])/g, '').replace(/^[、。\s]+/, '').replace(/、{2,}/g, '、').trim();
}
// 長い文章は一部のブラウザで途中で切れるため、文ごと（約100字まで）に分けて順に読む。
function chunks(text, max = 100) {
  const out = []; let cur = '';
  // 文末の直後で区切る（古いiPhoneのSafariは後読みの正規表現に未対応なので印をはさんで分ける）。
  for (const part of clean(text).replace(/([。！？!?\n])/g, '$1\u0000').split('\u0000')) {
    const p = part.trim(); if (!p) continue;
    if ((cur + p).length > max && cur) { out.push(cur); cur = ''; }
    if (p.length > max) { for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max)); continue; }
    cur += p;
  }
  if (cur) out.push(cur);
  return out;
}
window.createSpeech = function (S, hooks = {}) {
  const synth = window.speechSynthesis, Utter = window.SpeechSynthesisUtterance, supported = !!(synth && Utter);
  let voices = [], speaking = false, token = 0;
  function read() { try { voices = supported ? synth.getVoices().filter(v => /^ja([-_]|$)/i.test(v.lang || '')) : []; } catch (e) { voices = []; } }
  function load() { read(); if (hooks.onVoices) hooks.onVoices(); }
  if (supported) { load(); try { synth.addEventListener ? synth.addEventListener('voiceschanged', load) : (synth.onvoiceschanged = load); } catch (e) { synth.onvoiceschanged = load; } }
  const local = () => voices.filter(v => v.localService !== false);
  // 設定で選んだ声（オンライン含む）→ なければ端末内の声から自動で選ぶ。
  const auto = () => local().slice().sort((a, b) => score(b) - score(a))[0] || null;
  function pick() {
    if (S.set.ttsVoice) { const v = voices.find(v => v.voiceURI === S.set.ttsVoice || v.name === S.set.ttsVoice); if (v) return v; }
    return auto();
  }
  function set(on) { speaking = on; if (hooks.onState) hooks.onState(on); }
  // 読んでいないときは cancel を呼ばない（cancel の直後の読み上げが鳴らないことがあるブラウザ向け）。
  function stop() { token++; if (supported && (speaking || synth.speaking || synth.pending)) { try { synth.cancel(); } catch (e) { /* ignore */ } } if (speaking) set(false); }
  // 端末内の日本語の声がないときは読まない（オンラインの声に勝手に送らない）。
  function speak(text) {
    stop(); if (!supported) return 'unsupported';
    if (!voices.length) read(); // 一覧の通知が来ない端末でも、押した時点の一覧で選ぶ
    const v = pick(); if (!v) return 'novoice';
    const parts = chunks(text); if (!parts.length) return 'empty';
    const my = ++token, done = () => { if (my === token) set(false); };
    parts.forEach((p, i) => {
      const u = new Utter(p); u.lang = v.lang || 'ja-JP'; u.voice = v;
      u.volume = Math.max(0, Math.min(1, (S.set.tts ?? 80) / 100)); u.rate = S.set.ttsRate || 1; u.pitch = 1;
      if (i === 0) u.onstart = () => { if (my === token) set(true); };
      if (i === parts.length - 1) { u.onend = done; }
      u.onerror = done;
      synth.speak(u);
    });
    set(true);
    return 'ok';
  }
  return {
    supported, speak, stop, pick, auto, toggle(text) { if (speaking) { stop(); return 'stopped'; } return speak(text); },
    speaking: () => speaking,
    // 設定画面の一覧: 端末内の声を先に、オンラインの声は印をつけて後ろに。
    voices: () => { if (!voices.length) read(); return voices.slice().sort((a, b) => (b.localService !== false) - (a.localService !== false) || score(b) - score(a)).map(v => ({ id: v.voiceURI || v.name, name: v.name, online: v.localService === false, female: FEMALE.test(v.name || '') && !MALE.test(v.name || '') })); },
  };
};
window.createSpeech.clean = clean; window.createSpeech.chunks = chunks; window.createSpeech.score = score;
})();
