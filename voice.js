/* 問題文の録音（VOICEVOX:四国めたん で作った voice/<ID>.mp3）を Web Audio で再生する。
   一覧とクレジットは data/voice.js（BK.VOICE）。録音がない・読み込めないときは、呼び出し側が端末の声（speech.js）に切り替える。
   音量は読み上げのスライダーに従い、iPhoneの消音モード中は効果音と同じく鳴らない。 */
(function () {
'use strict';
window.createVoice = function (opt) {
  const list = () => (window.BK && window.BK.VOICE && window.BK.VOICE.files) || {};
  let token = 0, src = null, gain = null, playing = false;
  function set(on) { if (playing === on) return; playing = on; if (opt.onState) opt.onState(on); }
  function release() {
    if (src) { src.onended = null; try { src.stop(); } catch (e) { /* 再生前・再生済み */ } try { src.disconnect(); } catch (e) { /* 切断済み */ } src = null; }
    if (gain) { try { gain.disconnect(); } catch (e) { /* 切断済み */ } gain = null; }
  }
  function stop() { token++; release(); set(false); }
  const has = id => Object.prototype.hasOwnProperty.call(list(), id);
  const url = id => (opt.base || 'voice/') + encodeURIComponent(id) + '.mp3?v=' + list()[id].v;
  // 古いSafariの decodeAudioData はコールバック形式だけなので、両方の形に対応する。
  const decode = (ac, data) => new Promise((ok, ng) => { const p = ac.decodeAudioData(data, ok, ng); if (p && p.then) p.then(ok, ng); });
  // 押した時点で「■ 停止」にし、読み込みが終わってから鳴らす。途中で止めた・次を押した読み込みは捨てる。
  async function play(id) {
    stop(); const my = token, ac = opt.ac && opt.ac();
    if (!has(id) || !ac) throw Error('novoice');
    set(true);
    try {
      const res = await (opt.fetch || window.fetch)(url(id));
      if (!res.ok) throw Error('HTTP ' + res.status);
      const buf = await decode(ac, await res.arrayBuffer());
      if (my !== token) return 'stale';
      if (ac.state !== 'running' && ac.resume) { try { await ac.resume(); } catch (e) { /* 次の操作で解錠される */ } }
      if (my !== token) return 'stale';
      gain = ac.createGain(); gain.gain.value = opt.level(); gain.connect(ac.destination);
      src = ac.createBufferSource(); src.buffer = buf; src.connect(gain);
      src.onended = () => { if (my === token) { release(); set(false); } };
      src.start(0); return 'ok';
    } catch (e) { if (my === token) set(false); throw e; }
  }
  return { has, play, stop, speaking: () => playing, setLevel() { if (gain) gain.gain.value = opt.level(); } };
};
})();
