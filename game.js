/* 簿記ドパミンクエスト。お手本から白テーマ・演出・Muse・描画メモを継承。 */
(() => {
 'use strict';
 const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
 const app=$('#app'), modalRoot=$('#modal-root'), E=BK.engine;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=n=>Number(n).toLocaleString('ja-JP',{maximumFractionDigits:2});
 const KEY='boki2DopaQuest.v1',EXAMKEY='boki2DopaQuest.exam.v1';
 const byId=Object.fromEntries(BK.Q.map(q=>[q.id,q]));
 const day=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
 const defaults=()=>({version:1,xp:0,total:0,correct:0,bestCombo:0,bestTA:0,q:{},days:{},goals:{},history:[],recent:[],set:{scope:'current',count:10,vol:45,fx:1,muse:true,museLv:0,memo:true,emph:false,rumble:true,examDate:'2026-10-29',method:'ネット試験',goal:20}});
 let storageError=false;
 function getJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
 function validateState(raw){
  const d=defaults();if(!raw||typeof raw!=='object')return d;
  for(const k of ['xp','total','correct','bestCombo','bestTA'])if(Number.isSafeInteger(raw[k])&&raw[k]>=0&&raw[k]<1e10)d[k]=raw[k];
  for(const [id,r]of Object.entries(raw.q||{}))if(Object.hasOwn(byId,id)&&r&&['c','w','s'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0)&&[0,1].includes(r.l))d.q[id]={c:r.c,w:r.w,s:r.s,l:r.l};
  for(const [date,n]of Object.entries(raw.days||{}))if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isSafeInteger(n)&&n>=0)d.days[date]=n;
  for(const [date,v]of Object.entries(raw.goals||{}))if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&v===true)d.goals[date]=true;
  d.history=(Array.isArray(raw.history)?raw.history:[]).filter(h=>h&&typeof h.name==='string'&&typeof h.at==='string'&&Number.isFinite(h.score)&&Number.isFinite(h.max)).slice(-100);
  d.recent=(Array.isArray(raw.recent)?raw.recent:[]).filter(a=>BK.accounts[a]).slice(0,12);
  const s=raw.set||{};d.set.scope=s.scope==='future'?'future':'current';
  for(const k of ['memo','emph','rumble','muse'])if(typeof s[k]==='boolean')d.set[k]=s[k];
  if([0,1].includes(s.fx))d.set.fx=s.fx;if(Number.isFinite(s.vol))d.set.vol=Math.max(0,Math.min(100,s.vol));
  if([5,10,20,50].includes(s.count))d.set.count=s.count;if([10,20,30,50].includes(s.goal))d.set.goal=s.goal;
  if(/^\d{4}-\d{2}-\d{2}$/.test(s.examDate||''))d.set.examDate=s.examDate;
  return d;
 }
 const S=validateState(getJSON(KEY,null));
 const F=createEffects(S);
 function store(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{if(!storageError){storageError=true;F.toast('保存できません。設定から記録を書き出してください');}return false;}}
 const save=()=>store(KEY,S);
 function examSet(x=session){return x?.exam||BK.examFactory.legacy(x?.setId);}
 function validExam(x){
  const set=x?.exam?BK.examFactory.restore(x.exam):BK.examFactory.legacy(x?.setId);if(!set||!Number.isFinite(x.remaining)||x.remaining<0||x.remaining>5400000)return null;
  const ids=set.sections.flatMap(s=>s.items.map(i=>i.id)),answers={};
  for(const id of ids)if(x.answers&&Object.hasOwn(x.answers,id))answers[id]=sanitizeAnswer(byId[id],x.answers[id]);
  return {kind:'exam',setId:set.id,exam:set.format?set:undefined,scope:set.scope,ids,answers,revealed:Array.isArray(x.revealed)?[...new Set(x.revealed.filter(id=>ids.includes(id)))]:[],index:Math.max(0,Math.min(ids.length-1,Math.floor(x.index)||0)),remaining:x.remaining,paused:true,interrupted:true,started:typeof x.started==='string'?x.started:new Date().toISOString(),flags:Array.isArray(x.flags)?x.flags.filter(id=>ids.includes(id)):[],memoIds:Array.isArray(x.memoIds)?x.memoIds.filter(id=>ids.includes(id)):[]};
 }
 function sanitizeAnswer(q,a){
  if(q.type==='journal')return Object.fromEntries(['dr','cr'].map(side=>[side,(Array.isArray(a?.[side])?a[side]:[]).slice(0,8).filter(r=>Array.isArray(r)).map(r=>[BK.accounts[r[0]]?r[0]:'',String(r[1]??'').slice(0,18)])]));
  if(q.type==='tf')return typeof a==='boolean'?a:null;
  if(q.type==='choice')return Array.isArray(a)?a.filter(n=>Number.isInteger(n)&&n>=0&&n<q.choices.length):[];
  return q.parts.map((p,i)=>String(a?.[i]??'').slice(0,40));
 }
 let savedExam=validExam(getJSON(EXAMKEY,null)),session=null,screen='menu',memo=null,lastTick=performance.now(),saveTick=0,modal=null,category='',lastResult=null,fresh='',swUpdated=false;
 const currentScope=()=>session?.kind==='exam'?session.scope:S.set.scope;
 const pool=()=>BK.Q.filter(q=>BK.inScope(q,S.set.scope));
 const scopeLabel=s=>s==='future'?'2027年度範囲':'現行範囲';
 const level=()=>{let xp=S.xp,lv=1,need=60;while(xp>=need){xp-=need;lv++;need=60+(lv-1)*35;}return {lv,xp,need};};
 const rank=lv=>lv>=30?'原価計算の守護者':lv>=20?'決算の賢者':lv>=10?'貸借の番人':lv>=5?'仕訳ハンター':'簿記ひよこ';
 // スピードボーナスの基準時間（問題タイプ別）と、練習結果のランク表示。
 const SPEED={journal:45000,calc:60000,grid:180000,tf:8000,choice:12000};
 const RANKMSG={S:'完璧。帳簿があなたに頭を下げている',A:'あと一歩で、決算の景色が変わる',B:'貸借は、もう足もとで揃いはじめている',C:'迷った仕訳の数だけ、地図は詳しくなる',D:'間違いは、次の正解の種'};
 const tier=c=>c>=10?3:c>=5?2:c>=3?1:0;
 function streak(){const d=new Date();let n=0;const key=()=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');if(!S.days[key()])d.setDate(d.getDate()-1);while(S.days[key()]){n++;d.setDate(d.getDate()-1);}return n;}
 const disclaimer='本アプリは非公式の学習用教材です。日本商工会議所・検定の主催団体とは関係ありません。問題は独自作成で、実際の試験の内容・難易度・合否を保証しません。';
 const button=(label,action,cls='',attrs='')=>`<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
 const header=()=>`<header class="b-header"><div class="b-brand"><span class="b-mark">▤</span><b>簿記ドパミンクエスト</b></div><div class="b-toptools"><span class="b-pill b-scopebadge">${scopeLabel(currentScope())}</span>${screen==='menu'?button('設定','settings'):button('ホーム','home')}</div></header>`;
 function shell(html,cls=''){
  if(memo){if(memo.isDirty())memo.save();memo.destroy();memo=null;}
  F.Muse.stop();F.Muse.clear();F.setFever(false);
  app.innerHTML=`<main class="b-shell ${cls}"><div class="b-wrap">${header()}${html}</div></main>`;
 }
 function go(name){if(name==='menu'&&swUpdated){location.reload();return;}F.reset();screen=name;closeModal();if(name==='menu')menu();else if(name==='genre')genre(category);else if(name==='stats')stats();else if(name==='gallery')gallery();else if(name==='settings')settings();else if(name==='mocks')mocks();}
 function menu(){
  const L=level(),active=pool(),daily=S.days[day()]||0;
  shell(`<section class="b-hero"><div><p class="b-kicker">LEARN · BALANCE · LEVEL UP</p><h1>今日の一問が、<br><em>明日の自信</em>になる。</h1><p class="b-sub">仕訳を重ねて、決算の景色へ。<br>日商簿記2級の範囲に沿った練習 · 非公式</p></div><div class="b-panel"><div class="b-progress"><div class="b-orb"><small>LEVEL</small>${L.lv}</div><div><p class="b-muted">いまの称号</p><strong>${rank(L.lv)}</strong><div class="b-meter"><i style="width:${L.xp/L.need*100}%"></i></div><p class="b-muted">次のレベルまで ${L.need-L.xp} XP</p></div></div><div class="b-goal"><span>今日の目標 <b>${Math.min(daily,S.set.goal)} / ${S.set.goal}</b> 問</span><span>${streak()} 日継続</span></div></div></section>
   ${savedExam?`<div class="b-panel b-resume"><div><strong>中断した模試があります</strong><p class="b-muted">${esc(examSet(savedExam).name)} · 残り ${time(savedExam.remaining)}</p></div>${button('続きを解く →','resumeExam','b-primary')}</div>`:''}
   <div class="b-sectiontitle"><h2>今日のクエスト</h2><span class="b-muted">${active.length}問 · ${scopeLabel(S.set.scope)}</span></div>
   <div class="b-cards">${[
    ['↔','仕訳ドリル','勘定の動きを、手で覚える。','drill',true],['◈','論点から選ぶ','商業と工業、気になるところから。','genre'],['◷','90分の模試','5大問・100点。本番へのリハーサル。','mocks'],['↻','苦手をほどく',`間違えた ${active.filter(q=>S.q[q.id]?.l===0).length} 問を、次の得点へ。`,'weak'],['✦','一問一答','理論と用語を短いリズムで。','theory'],['⚡','60秒チャレンジ','仕訳の瞬発力を、少しずつ。','ta']
   ].map(([icon,title,desc,act,featured])=>button(`<span class="b-icon">${icon}</span><span class="b-arrow">↗</span><strong>${title}</strong><small>${desc}</small>`,act,'b-card'+(featured?' featured':''))).join('')}</div>
   <div class="b-actions">${button('▥ 学習の記録','stats')}${button('▧ メモの展示室','gallery')}${button('使い方','help')}</div>
   <footer class="b-foot"><p>受験設定: ${esc(S.set.examDate)} · ${esc(S.set.method)}　練習配分: 商業60% / 工業40%</p><p>${disclaimer}</p><p>外部通信・広告なし。記録はこのブラウザに保存されます。設定から定期的に書き出してください。</p></footer>`);
  F.Muse.start([], '#9a8fb5',{ambOnly:true,delay:7000});
 }
 function nodeStats(path){const qs=pool().filter(q=>q.cat===path||q.cat.startsWith(path+'/'));const seen=qs.filter(q=>S.q[q.id]),master=seen.filter(q=>S.q[q.id].s>=2);return {n:qs.length,seen:seen.length,master:master.length,pct:qs.length?master.length/qs.length:0};}
 function genre(path=''){
  category=path;screen='genre';const node=BK.nodes[path],kids=(node?.kids||BK.CATS).filter(n=>!n.scope||BK.inScope(n,S.set.scope));
  const breadcrumb=path?path.split('/').map((_,i)=>{const p=path.split('/').slice(0,i+1).join('/');return esc(BK.nodes[p].name);}).join(' › '):'全分野';
  shell(`<div class="b-stephead"><p class="b-kicker">TOPIC MAP</p><h1>論点を選ぶ</h1></div><p class="b-breadcrumb">${breadcrumb}</p><div class="b-actions" style="margin:0 0 20px">${button('← 一つ上','categoryUp')}${path?button('この分野を練習','categoryPractice','b-primary'):button('全分野から練習','mixed','b-primary')}</div><div class="b-list">${(node&&!node.kids?[node]:kids).map(n=>{const st=nodeStats(n.path);return button(`<div><strong>${esc(n.icon||'◇')} ${esc(n.name)}</strong><span class="b-muted">${st.n}問 · 習得 ${st.master}問</span></div><span class="b-stars">${st.pct===1?'★★★':st.pct>=.67?'★★☆':st.pct>=.34?'★☆☆':'☆☆☆'}　›</span>`,'category:'+n.path,'b-row');}).join('')}</div>`);
 }
 function shuffle(list){const a=list.slice();for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];}return a;}
 function pick(list,n){return list.map(q=>({q,key:Math.random()**(1/(S.q[q.id]?.l===0?5:S.q[q.id]?.s>=2?1:3))})).sort((a,b)=>b.key-a.key).slice(0,n).map(o=>o.q);}
 function balanced(list,n){const sh=list.filter(q=>q.cat.startsWith('shoji/')),ko=list.filter(q=>q.cat.startsWith('kogyo/'));let selected=[...pick(sh,Math.round(n*.6)),...pick(ko,n-Math.round(n*.6))];if(selected.length<n)selected=selected.concat(pick(list.filter(q=>!selected.includes(q)),n-selected.length));return shuffle(selected);}
 function startPractice(mode,path=''){
  let list=pool();if(mode==='drill'||mode==='ta')list=list.filter(q=>q.type==='journal');if(mode==='theory')list=list.filter(q=>['tf','choice'].includes(q.type));if(mode==='weak')list=list.filter(q=>S.q[q.id]?.l===0);if(path)list=list.filter(q=>q.cat===path||q.cat.startsWith(path+'/'));
  if(!list.length){F.play('bump');F.toast(mode==='weak'?'苦手問題はまだありません。まず練習を始めましょう':'この範囲に問題はありません');return;}
  const qs=balanced(list,mode==='ta'?list.length:S.set.count);
  session={kind:'practice',mode,scope:S.set.scope,ids:qs.map(q=>q.id),index:0,answers:{},grades:{},combo:0,maxCombo:0,earned:0,correct:0,paused:false,remaining:mode==='ta'?60000:null,started:new Date().toISOString(),questionAt:performance.now(),questionElapsed:0,xp0:S.xp,lv0:level().lv,best0:S.bestCombo,bestTA0:S.bestTA,holdUntil:mode==='ta'?performance.now()+1500:0};
  F.reset();F.moment.start(mode);lastTick=performance.now();renderQuiz();
 }
 const modeLabel=()=>session?.kind==='exam'?examSet().name:({drill:'仕訳ドリル',theory:'一問一答',weak:'苦手克服',ta:'60秒チャレンジ',mixed:'全分野',topic:'論点別'}[session?.mode]||'論点別');
 const qNow=()=>byId[session.ids[session.index]];
 function blank(q){return q.type==='journal'?{dr:[['','']],cr:[['','']]}:q.type==='tf'?null:[];}
 function answerFor(q){if(!Object.hasOwn(session.answers,q.id))session.answers[q.id]=blank(q);return session.answers[q.id];}
 function persistExam(){if(session?.kind==='exam'){savedExam={...session,paused:true,interrupted:true};store(EXAMKEY,savedExam);}}
 function updateAnswer(){if(session?.kind==='exam')persistExam();}
 const time=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;};
 function renderQuiz(){
  const scroll=screen==='quiz'?$('.b-shell')?.scrollTop:0;
  screen='quiz';const q=qNow(),exam=session.kind==='exam',grade=session.grades?.[q.id],node=BK.nodes[q.cat];
  answerFor(q);
  let nav='';if(exam){const set=examSet();nav=`<nav class="b-mocknav" aria-label="模試の大問">${set.sections.map((s,i)=>button(`第${i+1}問 <small>${s.points}点</small>`,'section:'+i,s.items.some(it=>it.id===q.id)?'on':'')).join('')}</nav><nav class="b-mocknav" aria-label="模試の小問">${session.ids.map((id,i)=>button(`${i+1}${session.flags.includes(id)?' ⚑':''}`,'jump:'+i,(i===session.index?'on ':'')+(hasAnswer(id)?'done':''))).join('')}</nav>`;}
  shell(`<div class="b-questionbar"><div><h2>${esc(modeLabel())}</h2><p class="b-muted" id="quiz-status">${exam?'採点は提出後'+(session.revealed?.length?' · 解答参照あり':''):'一つずつ、確かな得点へ'}${exam&&examSet().code?'<br>再現コード: '+esc(examSet().code):''}</p></div><div class="b-sessionline"><span>Q ${session.index+1} / ${session.ids.length}</span>${!exam?`<span id="combo-label" class="b-combo" data-tier="${tier(session.combo)}"><b>${session.combo}</b> COMBO</span>`:''}${session.remaining!==null?`<span class="b-timer${session.mode==='ta'?' ta':''}" id="timer">${time(session.remaining)}</span>`:''}${button('中断','pause')}</div></div>${nav}${!exam?speedBar(q,grade):''}
   <div class="b-quizlayout"><section class="b-panel b-qpanel muse-avoid"><p class="b-qtag">${esc(node.name)} · ${q.type==='journal'?'仕訳':q.type==='calc'?'数値':q.type==='grid'?'表の穴埋め':q.type==='tf'?'○×':'選択'} · ${'◆'.repeat(q.diff)}</p><h1 class="b-qtitle">${esc(BK.TITLES[q.id])}</h1><p class="b-qtext">${esc(q.q)}</p>
   ${q.sourceTable?table(q.sourceTable):''}${q.instructions?`<ul class="b-instructions">${q.instructions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<div class="b-divider"></div><div id="answer-area"></div><div id="feedback-area"></div>
   <div class="b-actions b-answer-controls">${exam?`${button('← 前へ','prev','',session.index===0?'disabled':'')}${button(session.flags.includes(q.id)?'⚑ 見直し済み':'⚑ あとで見直す','flag')}${button(session.index===session.ids.length-1?'提出する':'次へ →',session.index===session.ids.length-1?'submitExam':'nextExam','b-primary')}`:button(grade?'次へ →':'答え合わせ',grade?'next':'grade','b-primary')}</div></section>
   <aside class="b-memoaside"><div class="b-panel"><h3>計算用紙</h3>${S.set.memo?'<div id="memo-host"></div>':'<p class="b-muted">設定からメモ帳を有効にできます。</p>'}<p class="b-mini-note">紙の中は指で描く。スクロールは紙の外で。<br>移動時に自動保存します。</p><div class="b-actions b-study-tools">${button('▦ 電卓を開く','calculator')}${button('解答を見る','revealAnswer')}</div></div>${!exam?`<p class="b-muse-lines">${q.p.map(esc).join('<br>')}</p>`:''}</aside></div>`,exam?'b-exam':'');
  renderAnswer();
  if(S.set.memo){memo=BK.memo.create($('#memo-host'),{question:{...q,e:q.exp},toast:F.toast,onSaved:(rec,existed,btn)=>{if(exam&&session?.kind==='exam'){session.memoIds??=[];if(!session.memoIds.includes(q.id))session.memoIds.push(q.id);persistExam();}else if(!exam)F.moment.memo(btn,existed);}});memo.setAnswered(!!grade);if(exam&&session.memoIds?.includes(q.id))memo.openSaved();}
  if(grade)renderFeedback(grade);else if(!exam)F.Muse.start(q.p,'#8c78b4',{delay:4000});
  if(!exam)F.setFever(session.combo>=10);
  // 問題ごとの高さが変わる場合は、ブラウザが新しい末尾に収まる位置まで丸める。
  if(scroll)$('.b-shell').scrollTop=scroll;
 }
 // スピードボーナスの残り時間。経過はCSSアニメーションの遅延で合わせ、毎フレームDOMを書き換えない。
 function speedBar(q,graded){const late=session.holdUntil&&!session.questionElapsed?Math.max(0,session.holdUntil-performance.now()):-session.questionElapsed;return `<div class="b-speed${graded?' done':''}${session.paused?' paused':''}" id="speedbar" style="--spd:${SPEED[q.type]}ms;--late:${Math.round(late)}ms" aria-hidden="true"><i></i><span>⚡ SPEED BONUS</span></div>`;}
 function updateCombo(){const el=$('#combo-label');if(!el)return;el.dataset.tier=tier(session.combo);el.innerHTML=`<b>${session.combo}</b> COMBO`;F.bump(el);}
 function table(t){return `<div class="b-scrolltable"><table class="b-table"><thead><tr>${t.headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(x=>`<td>${esc(typeof x==='number'?fmt(x):x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
 function amount(value,key,label,disabled=false){return `<input class="b-amount" readonly inputmode="none" aria-label="${esc(label)}" data-number="${key}" value="${esc(value===''||value==null?'':E.number(value)===null?value:fmt(E.number(value)))}" placeholder="タップして入力" ${disabled?'disabled':''}>`;}
 function renderAnswer(){
  const q=qNow(),a=answerFor(q),locked=!!session.grades?.[q.id];let html='';
  const sum=side=>a[side].reduce((n,r)=>n+(E.number(r[1])||0),0),balanced=q.type==='journal'&&sum('dr')>0&&sum('dr')===sum('cr');
  if(q.type==='journal')html=`<div class="b-entry${balanced?' balanced':''}">${['dr','cr'].map((side,k)=>`<div class="b-entry-side"><h3>${k===0?'借方':'貸方'}</h3>${a[side].map(([account,n],i)=>`<div class="b-jrow${fresh===side+':'+i?' new':''}">${button(esc(account),'account:'+side+':'+i,'b-account',`${locked?'disabled':''} aria-label="${k===0?'借方':'貸方'}${i+1}行目の勘定科目"`)}${amount(n,side+':'+i,(k===0?'借方':'貸方')+(i+1)+'行目の金額',locked)}${button('×','remove:'+side+':'+i,'',`${locked?'disabled':''} aria-label="${k===0?'借方':'貸方'}${i+1}行目を削除"`)}</div>`).join('')}${button('＋ 行を追加','add:'+side,'b-add',locked||a[side].length>=8?'disabled':'')}<p class="b-jtotal">合計 ${fmt(sum(side))} 円</p></div>`).join('')}</div>`;
  else if(q.type==='tf')html=`<div class="b-tf">${[true,false].map((v,i)=>button(i===0?'○ 正しい':'× 誤り','tf:'+v,'b-choice'+(a===v?' selected':'')+(S.set.emph&&session.kind!=='exam'&&q.ans===v?' emph':''),locked?'disabled':'')).join('')}</div>`;
  else if(q.type==='choice')html=`<p class="b-muted" style="margin-bottom:12px">${q.ans.length>1?'当てはまるものをすべて選択':'一つ選択'}</p><div class="b-choices">${q.choices.map((c,i)=>button(`<b>${i+1}</b><span>${esc(c)}</span>`,'choice:'+i,'b-choice'+(a.includes(i)?' selected':'')+(S.set.emph&&session.kind!=='exam'&&q.ans.includes(i)?' emph':''),locked?'disabled':'')).join('')}</div>`;
  else if(q.type==='grid')html=`<p class="b-muted">表の空欄をタップして入力。横に長い表は表内でスクロールできます。</p><div class="b-scrolltable"><table class="b-table"><thead><tr><th>項目</th><th>解答</th><th>単位</th></tr></thead><tbody>${q.parts.map((p,i)=>`<tr><td>${esc(p.label)}</td><td>${p.kind==='account'?button(esc(a[i]||'科目を選択'),'partAccount:'+i,'',locked?'disabled':''):amount(a[i],String(i),p.label,locked)}</td><td>${esc(p.unit||'')}</td></tr>`).join('')}</tbody></table></div>`;
  else html=`<div class="b-fields">${q.parts.map((p,i)=>`<label class="b-field"><span>${esc(p.label)}</span>${amount(a[i],String(i),p.label,locked)}<span>${esc(p.unit)}</span></label>`).join('')}</div>`;
  $('#answer-area').innerHTML=html;fresh='';
  // 借方と貸方の合計がそろった瞬間を、練習では音と星で知らせる（模試は合計の色だけ）。
  if(q.type==='journal'&&!locked){if(balanced&&session.balanced!==q.id){session.balanced=q.id;if(session.kind==='practice')F.moment.balance($('.b-entry'));}else if(!balanced&&session.balanced===q.id)session.balanced=null;}
 }
 function answerText(q){
  if(q.type==='journal')return q.ans.map((a,i)=>(i?'別解\n':'')+'借方: '+a.dr.map(r=>`${r[0]} ${fmt(r[1])}`).join(' / ')+'\n貸方: '+a.cr.map(r=>`${r[0]} ${fmt(r[1])}`).join(' / ')).join('\n');
  if(q.type==='tf')return q.ans?'○ 正しい':'× 誤り';if(q.type==='choice')return q.ans.map(i=>`${i+1}. ${q.choices[i]}`).join('\n');
  return q.parts.map(p=>p.label+': '+(p.kind==='account'?p.ans:fmt(p.ans))+' '+(p.unit||'')).join('\n');
 }
 function revealAnswer(){
  if(!session||session.paused)return;const q=qNow();session.revealed??=[];if(!session.revealed.includes(q.id))session.revealed.push(q.id);persistExam();
  if(session.kind==='exam')$('#quiz-status').innerHTML=`採点は提出後 · 解答参照あり${examSet().code?'<br>再現コード: '+esc(examSet().code):''}`;
  openModal('解答と解説',`<p class="b-notice">${session.kind==='exam'?'この模試は「解答参照あり」の参考点として記録します。':'解答を見た問題は習得判定・経験値に加算しません。'}${session.remaining!==null?' 時計は進み続けます。':''}</p><p class="b-muted">${esc(BK.TITLES[q.id])}</p><pre class="b-answer-key b-solution">${esc(answerText(q))}</pre><pre class="b-solution">${esc(q.exp)}</pre><p class="b-mini-note"><b>もし忘れたら</b><br>${esc(BK.WHATIF[q.id])}</p><div class="b-actions">${button('問題に戻る','closeModal','b-primary')}</div>`);
 }
 function renderFeedback(g,ev){const q=qNow(),c=ev?.combo||0,praise=g.correct&&!ev?.assisted&&c>=3?`<p class="b-praise">${c>=10?'神正解!!!':c>=5?'連続正解!!':'いい流れ!'} ${c} COMBO</p>`:'',chips=ev?.chips?.length?`<div class="b-chips">${ev.chips.map(([t,cls],i)=>`<span class="${cls}" style="animation-delay:${(.3+i*.08).toFixed(2)}s">${esc(t)}</span>`).join('')}</div>`:'';$('#feedback-area').innerHTML=`<div class="b-feedback ${g.correct?'':'wrong'}"><h3>${g.correct?'✓ 正解！':'もう一度、流れをたどろう'}</h3>${praise}${chips}<div class="b-checks">${g.checks.map(c=>`<span class="${c.ok?'b-correct':'b-wrong'}">${c.ok?'✓':'×'} ${esc(c.label)}</span>`).join('')}</div><pre class="b-answer-key">${esc(answerText(q))}</pre><pre>${esc(q.exp)}</pre><p class="b-mini-note"><b>もし忘れたら</b><br>${esc(BK.WHATIF[q.id])}</p></div>`;memo?.setAnswered(true);}
 // 正誤を記録し、演出用の結果（XPの内訳・コンボ・レベルの変化）を返す。XPの計算式は従来どおり。
 function record(q,g,elapsed,game=true){
  const old=S.q[q.id],r=old||{c:0,w:0,s:0,l:0},revenge=old?.l===0,L0=level(),ev={ok:g.correct,chips:[]};
  if(g.correct){r.c++;r.s++;r.l=1;}else{r.w++;r.s=0;r.l=0;}
  S.q[q.id]=r;S.total++;S.correct+=+g.correct;S.days[day()]=(S.days[day()]||0)+1;
  let gain=g.correct?10:2;
  if(game){
   if(g.correct){
    session.correct++;session.combo++;session.maxCombo=Math.max(session.maxCombo,session.combo);S.bestCombo=Math.max(S.bestCombo,session.combo);
    const combo=1+Math.min(3,Math.floor(session.combo/5)*.5),fever=session.combo>=10?2:1;ev.chips.push(['BASE +10','']);
    if(elapsed<SPEED[q.type]){gain+=4;ev.chips.push(['⚡SPEED +4','gold']);}
    if(revenge){gain+=6;ev.chips.push(['REVENGE +6','pink']);}
    if(!old){gain+=5;ev.chips.push(['NEW +5','']);}
    if(combo>1)ev.chips.push(['COMBO ×'+combo,'pink']);if(fever>1)ev.chips.push(['FEVER ×2','pink']);
    gain=Math.round(gain*combo*fever);
    if(Math.random()<.08){gain*=3;ev.crit=true;ev.chips.push(['CRITICAL ×3','gold']);}
    ev.chips.push(['+'+gain+' XP','tot']);Object.assign(ev,{combo:session.combo,feverStart:session.combo===10,revenge});
   }else{ev.broken=session.combo;session.combo=0;ev.chips.push(['反省XP +2','']);}
   session.earned+=gain;
  }
  S.xp+=gain;ev.gain=gain;
  if(!S.goals[day()]&&S.days[day()]>=S.set.goal){S.goals[day()]=true;S.xp+=30;ev.daily=true;ev.goal=S.set.goal;if(game)F.toast('今日の目標達成！ +30 XP');}
  const L1=level();ev.xp={lv0:L0.lv,f0:L0.xp/L0.need,lv1:L1.lv,f1:L1.xp/L1.need,gain:gain+(ev.daily?30:0),up:L1.lv>L0.lv,title:rank(L1.lv),titleUp:rank(L1.lv)!==rank(L0.lv)};
  return ev;
 }
 function grade(){
  if(session.paused||session.over)return;const q=qNow();if(session.grades[q.id])return;
  const at=$('[data-action="grade"]')?.getBoundingClientRect(),g=E.grade(q,answerFor(q));session.grades[q.id]=g;
  let ev;if(session.revealed?.includes(q.id)){session.correct+=+g.correct;session.combo=0;ev={ok:g.correct,assisted:true};}else ev=record(q,g,session.questionElapsed);
  save();renderAnswer();renderFeedback(g,ev);$('.b-answer-controls').innerHTML=button('次へ →','next','b-primary');$('#speedbar')?.classList.add('done');updateCombo();F.Muse.stop();F.setFever(session.combo>=10);
  F.moment.answer({...ev,x:at?at.left+at.width/2:innerWidth/2,y:at?at.top+at.height/2:innerHeight*.6,host:$('.b-feedback'),panel:$('.b-qpanel'),stage:$('.b-quizlayout')});
 }
 function next(){if(session.over||!session.grades[qNow().id])return;if(session.index===session.ids.length-1){finishPractice();return;}session.index++;session.questionElapsed=0;F.play('whoosh');renderQuiz();}
 function finishPractice(){
  const answered=Object.keys(session.grades),ta=session.mode==='ta',n=session.correct,acc=answered.length?n/answered.length:0,result={kind:'practice',name:modeLabel(),score:session.correct,max:answered.length,combo:session.maxCombo,earned:session.earned,items:answered.map(id=>({id,grade:session.grades[id]})),scope:session.scope,assisted:!!session.revealed?.length,at:new Date().toISOString()};
  // 60秒チャレンジは正解数、ほかは正答率でランクを付ける。
  result.letter=ta?(n>=5?'S':n>=3?'A':n>=2?'B':n>=1?'C':'D'):(answered.length>=5&&acc===1?'S':acc>=.8?'A':acc>=.6?'B':acc>=.4?'C':'D');
  result.perfect=!ta&&answered.length>=5&&acc===1;result.lv0=session.lv0;
  result.newRec=result.assisted?'':ta&&n>session.bestTA0?`60秒で ${n} 問`:session.maxCombo>session.best0&&session.maxCombo>=5?`最高コンボ ${session.maxCombo}`:'';
  if(session.mode==='ta'&&!result.assisted)S.bestTA=Math.max(S.bestTA,session.correct);S.history.push({name:result.name,score:result.score,max:result.max,at:result.at,scope:result.scope,assisted:result.assisted});S.history=S.history.slice(-100);save();session=null;showResult(result);
 }
 function hasAnswer(id){const a=session.answers[id];if(a===true||a===false)return true;if(Array.isArray(a))return a.some(x=>x!==''&&x!=null);return a&&['dr','cr'].some(s=>a[s]?.some(r=>r[0]||r[1]));}
 function mocks(){shell(`<div class="b-stephead"><p class="b-kicker">MOCK EXAM</p><h1>毎回、新しい90分。</h1><p class="b-sub">商業60点・工業40点。5大問、70点以上で合格判定。</p></div><div class="b-notice">検算済みの問題を大問ごとの分野・配点に沿って抽出します。数値は変更しません。問題と部分点は独自のため、本試験の難易度・採点を完全には再現しません。中断時は時計が止まり、「中断あり」と記録します。</div>${savedExam?`<div class="b-actions" style="margin-bottom:20px">${button('中断した模試を再開','resumeExam','b-primary')}${button('中断データを破棄','discardExam','b-danger')}</div>`:''}<div class="b-panel"><h2>ランダム模試</h2><p class="b-sub">${scopeLabel(S.set.scope)} · 90分 · 100点<br>商業仕訳5題は異なる論点から。総合問題は資料と設問をまとめて抽出します。</p><div class="b-actions">${button('ランダム模試をはじめる','exam:random','b-primary',savedExam?'disabled':'')}</div></div><div class="b-panel" style="margin-top:16px"><h2>同じ問題でもう一度</h2><p class="b-sub">模試中・結果・履歴に表示される再現コードを入力すると、同じ範囲・問題・順序・配点で始められます。コードの C は現行、F は2027年度です。</p><label class="b-muted" for="exam-code">再現コード</label><input id="exam-code" class="b-search" placeholder="BQ1-C-1234ABCD" maxlength="14" autocapitalize="characters" spellcheck="false"><p id="exam-code-error" class="b-error" role="status"></p>${button('このコードで始める','replayExam','',savedExam?'disabled':'')}</div><p class="b-mini-note">電卓の隣の「解答を見る」で正解と解説を表示できます。参照した模試は参考点として記録します。</p>`);}
 function startExam(id='random',code){
  if(savedExam)return;let set;
  if(code!==undefined){set=BK.examFactory.fromCode(code);}
  else if(id==='random'){
   const previous=getJSON('boki2DopaQuest.lastExamCode',null);let seed=crypto.getRandomValues(new Uint32Array(1))[0];set=BK.examFactory.generate(S.set.scope,seed);
   if(set.code===previous)set=BK.examFactory.generate(S.set.scope,(seed+1)>>>0);
  }else set=BK.examFactory.legacy(id);
  if(!set)return;if(set.code)store('boki2DopaQuest.lastExamCode',set.code);
  session={kind:'exam',setId:set.id,exam:set.format?set:undefined,scope:set.scope,ids:set.sections.flatMap(s=>s.items.map(i=>i.id)),answers:{},revealed:[],index:0,remaining:set.minutes*60000,paused:false,interrupted:false,started:new Date().toISOString(),flags:[],memoIds:[]};lastTick=performance.now();persistExam();F.reset();F.play('start');renderQuiz();
 }
 function resumeExam(){if(!savedExam)return;session=validExam(savedExam);if(!session){savedExam=null;F.toast('中断データを読み込めませんでした');go('mocks');return;}session.paused=false;session.interrupted=true;lastTick=performance.now();renderQuiz();}
 function jump(i){session.index=Math.max(0,Math.min(session.ids.length-1,i));persistExam();renderQuiz();}
 function finishExam(){
  closeModal();const set=examSet(),result=E.examScore(set,session.answers);result.lv0=level().lv;
  result.kind='exam';result.name=set.name;result.scope=session.scope;result.interrupted=session.interrupted;result.at=new Date().toISOString();result.max=100;result.items=result.sections.flatMap(s=>s.items);result.answers=clone(session.answers);result.code=set.code;result.assisted=!!session.revealed?.length;result.revealed=session.revealed||[];
  for(const i of result.items)if(!result.revealed.includes(i.id))record(byId[i.id],i.grade,Infinity,false);
  S.history.push({name:result.name,score:result.score,max:100,at:result.at,scope:result.scope,interrupted:result.interrupted,assisted:result.assisted,code:result.code});S.history=S.history.slice(-100);save();savedExam=null;session=null;try{localStorage.removeItem(EXAMKEY);}catch{}
  showResult(result);
 }
 const clone=x=>JSON.parse(JSON.stringify(x));
 function showResult(result){
  screen='result';lastResult=result;const isExam=result.kind==='exam',pct=result.max?result.score/result.max:0,anim=!!S.set.fx,L=level(),lvUp=!!result.lv0&&L.lv>result.lv0,passed=isExam&&result.passed&&!result.assisted,letter=result.letter||'B';
  // 演出ありでは数字を0から回す。最終値は moment 側が必ず書き込む。
  shell(`<section class="b-panel b-result-hero${isExam?' b-examhero'+(anim?' anim':''):''}"><p class="b-kicker">${isExam?'MOCK EXAM RESULT':'QUEST COMPLETE'}</p>${passed?'<span class="b-seal" id="seal" aria-hidden="true">合格</span>':''}${isExam?'':`<div class="b-rank r-${letter}" id="rank" role="img" aria-label="ランク ${letter}">${letter}</div><p class="b-rankmsg">${RANKMSG[letter]}</p>`}<p class="b-score"><span id="score-n">${anim?0:fmt(result.score)}</span><small> / ${result.max}</small></p>${isExam?`<div class="b-passbar" aria-hidden="true"><i id="passfill" style="transform:scaleX(${anim?0:Math.min(1,pct)})"></i><b></b></div>`:''}<h1 class="b-verdict" id="verdict">${isExam?(result.assisted?'解答を参照した参考点です':result.passed?'合格ラインに到達！':'次の一歩が、見えてきた。'):pct>=.8?'よく積み重ねました。':'この一問も、力になる。'}</h1><p class="b-muted">${esc(result.name)} · ${scopeLabel(result.scope)}${isExam?' · '+(result.interrupted?'中断あり':'中断なし'):''}${result.assisted?' · 解答参照あり':''}${result.code?'<br>再現コード: <span class="b-code">'+esc(result.code)+'</span>':''}</p><div class="b-actions" style="justify-content:center">${button('苦手を練習する','weak','b-primary')}${button('ホームへ','home')}${isExam?button('模試を選ぶ','mocks'):button('もう一度仕訳','drill')}</div></section>
   ${!isExam?`<div class="b-summary"><div class="b-panel b-stat"><strong id="st-combo">${anim?0:result.combo}</strong><span class="b-muted">最高コンボ</span></div><div class="b-panel b-stat b-xpstat"><strong id="st-xp">+${anim?0:result.earned}</strong><span class="b-muted">獲得XP</span></div><div class="b-panel b-stat"><strong id="st-acc">${anim?0:Math.round(pct*100)}%</strong><span class="b-muted">正答率</span></div></div><div class="b-panel b-lvrow">Lv.${L.lv}『${rank(L.lv)}』${lvUp?`<b class="b-lvup">▲${L.lv-result.lv0} UP</b>`:''}<div class="b-meter"><i style="width:${L.xp/L.need*100}%"></i></div></div>`:`<div class="b-sectiontitle"><h2>大問ごとの結果</h2></div><div class="b-list">${result.sections.map(s=>{const f=s.points?Math.max(0,Math.min(1,s.score/s.points)):0;return `<div class="b-panel b-row b-secrow"><strong>${esc(s.name)}</strong><span>${fmt(s.score)} / ${s.points}</span><i class="b-secbar"><u data-frac="${f}" style="transform:scaleX(${anim?0:f})"></u></i></div>`;}).join('')}</div><div class="b-sectiontitle"><h2>論点ごとの結果</h2></div><div class="b-list">${Object.entries(result.topics).map(([cat,t])=>button(`<span>${esc(BK.nodes[cat].name)}</span><span>${fmt(t.score)} / ${t.max} →</span>`,'practice:'+cat,'b-row')).join('')}</div>`}
   <div class="b-sectiontitle"><h2>解答と解説</h2><span class="b-muted">タップして振り返る</span></div>${result.items.map(i=>{const q=byId[i.id];return `<details class="b-panel b-review"><summary><span class="${i.grade.correct?'b-correct':'b-wrong'}">${i.grade.correct?'✓':'△'}</span> ${esc(BK.TITLES[i.id])}${i.points?' · '+fmt(i.score)+' / '+i.points+'点':''}</summary><p>${esc(q.q)}</p><p><b>正解</b><br>${esc(answerText(q))}</p><p>${esc(q.exp)}</p><p><b>もし忘れたら</b><br>${esc(BK.WHATIF[i.id])}</p></details>`;}).join('')}`);
  if(isExam)F.moment.exam({scoreEl:$('#score-n'),score:result.score,fmt,bar:$('#passfill'),pct:Math.min(1,pct),sections:$$('.b-secbar u').map(u=>({el:u,frac:+u.dataset.frac})),passed,assisted:result.assisted,seal:$('#seal'),need:fmt(Math.max(0,70-result.score)),perfect:result.score===100,verdict:$('#verdict'),lvUp:lvUp?{lv:L.lv,title:rank(L.lv),titleUp:rank(L.lv)!==rank(result.lv0)}:null});
  else F.moment.result({letter,rankEl:$('#rank'),counts:[{el:$('#score-n'),to:result.score,fmt},{el:$('#st-combo'),to:result.combo,fmt:String},{el:$('#st-acc'),to:Math.round(pct*100),fmt:n=>n+'%'}],xpEl:$('#st-xp'),gain:result.earned,newRec:result.newRec,perfect:result.perfect});
 }
 function pause(){if(!session||session.paused||session.over)return;session.paused=true;session.interrupted=true;persistExam();$('#speedbar')?.classList.add('paused');F.Muse.stop();openModal('一時停止',`<p class="b-sub">時計は止まっています。${session.kind==='exam'?'解答をこのブラウザに保存しました。':'ここまでの学習記録は保存されています。'}</p><div class="b-actions">${button('続ける','continue','b-primary')}${button('ホームへ戻る','leaveSession')}</div>`,{dismiss:()=>resumeClock()});}
 function resumeClock(){if(!session)return;session.paused=false;lastTick=performance.now();$('#speedbar')?.classList.remove('paused');if(screen==='quiz'&&session.kind!=='exam'&&!session.grades[qNow().id])F.Muse.start(qNow().p,'#8c78b4');}
 function stats(){
  const active=pool(),mastered=active.filter(q=>S.q[q.id]?.s>=2).length;
  shell(`<div class="b-stephead"><p class="b-kicker">YOUR JOURNEY</p><h1>積み重ねた記録</h1></div><div class="b-summary"><div class="b-panel b-stat"><strong>${S.total}</strong><span class="b-muted">解いた問題</span></div><div class="b-panel b-stat"><strong>${S.total?Math.round(S.correct/S.total*100):0}%</strong><span class="b-muted">累計正答率</span></div><div class="b-panel b-stat"><strong>${mastered}</strong><span class="b-muted">習得した問題</span></div></div><p class="b-notice">習得は2回連続正解。最高コンボ ${S.bestCombo} · 60秒の最高記録 ${S.bestTA}問 · ${streak()}日継続</p><div class="b-sectiontitle"><h2>分野ごとの習得度</h2></div><div class="b-list">${BK.CATS.flatMap(n=>n.kids).map(n=>{const st=nodeStats(n.path);return button(`<div style="flex:1"><strong>${esc(n.name)}</strong><div class="b-chartbar"><i style="width:${st.pct*100}%"></i></div></div><span class="b-muted">${st.master} / ${st.n}</span>`,'practice:'+n.path,'b-row');}).join('')}</div><div class="b-sectiontitle"><h2>最近のクエスト</h2></div><div class="b-list">${S.history.slice(-20).reverse().map(h=>`<div class="b-panel b-row"><div><strong>${esc(h.name)}</strong><span class="b-muted">${esc(h.at.slice(0,10))} · ${scopeLabel(h.scope)}${h.interrupted?' · 中断あり':''}${h.assisted?' · 解答参照あり':''}${h.code?'<br>再現コード: <span class="b-code">'+esc(h.code)+'</span>':''}</span></div><span>${fmt(h.score)} / ${h.max}</span></div>`).join('')||'<p class="b-empty">最初のクエストを終えると、ここに記録が残ります。</p>'}</div>`);
 }
 function gallery(){const records=BK.memo.store.list();shell(`<div class="b-stephead"><p class="b-kicker">MEMO GALLERY</p><h1>考えた跡の展示室</h1><p class="b-sub">${records.length}枚 · 約${fmt(Math.round(BK.memo.store.bytes()/1024))} KB</p></div><div class="b-gallery">${records.map((r,i)=>`<article class="b-panel"><canvas data-memo-index="${i}"></canvas><h3>${esc(BK.TITLES[r.id]||r.id)}</h3><div class="b-actions">${button('PNG保存','memoExport:'+r.id)}${button('削除','memoDelete:'+r.id,'b-danger')}</div></article>`).join('')||'<p class="b-empty">計算用紙に描いたメモが、ここに集まります。</p>'}</div>`);$$('[data-memo-index]').forEach(c=>BK.memo.renderRecord(c,records[+c.dataset.memoIndex],640,360,1));}
 function settings(){
  shell(`<div class="b-stephead"><p class="b-kicker">SETTINGS</p><h1>自分のペースで</h1></div><div class="b-settings b-panel"><div class="b-setting"><label for="scope">試験の範囲</label><select id="scope" data-setting="scope"><option value="current" ${S.set.scope==='current'?'selected':''}>現行（2027年3月まで）</option><option value="future" ${S.set.scope==='future'?'selected':''}>2027年度（4月から）</option></select></div><div class="b-setting"><label for="examdate">受験予定日 · ネット試験</label><input id="examdate" type="date" data-setting="examDate" value="${esc(S.set.examDate)}"></div>${[['count','一回の問題数',[5,10,20,50]],['goal','一日の目標',[10,20,30,50]]].map(([key,title,values])=>`<div class="b-setting"><label for="set-${key}">${title}</label><select id="set-${key}" data-setting="${key}">${values.map(n=>`<option value="${n}" ${S.set[key]===n?'selected':''}>${n}問</option>`).join('')}</select></div>`).join('')}<div class="b-setting"><label for="volume">効果音</label><input id="volume" aria-label="効果音の音量" type="range" data-setting="vol" min="0" max="100" value="${S.set.vol}"></div><div class="b-soundtest"><span class="b-muted">サウンドテスト（演出も一緒に出ます）</span><div class="b-actions">${[['correct','正解'],['combo','コンボ'],['fever','フィーバー'],['level','レベルアップ'],['pass','合格'],['miss','ミス']].map(([k,t])=>button(t,'sfx:'+k)).join('')}</div></div><p class="b-mini-note">iPhoneは消音モード（本体の消音スイッチ・アクションボタン）の間、効果音が鳴りません。音が出ないときは消音を解除して画面を一度タップしてください。</p>${[['memo','計算用紙'],['muse','浮かぶ言葉'],['rumble','振動'],['fx','派手な演出'],['emph','選択・○×の正解を先に強調']].map(([key,title])=>`<div class="b-setting"><label for="set-${key}">${title}</label><input id="set-${key}" type="checkbox" data-setting="${key}" ${S.set[key]?'checked':''}></div>`).join('')}<p class="b-mini-note">振動はiPhoneではiOS 18以降のSafariで軽い触覚として返ります（ホーム画面版を含む）。派手な演出をオフにすると粒子を減らし、揺れ・点滅を止めます。${F.reduced()?'端末の「視差効果を減らす」が有効なため、揺れ・点滅・光線は控えめにしています。':''}模試の解答中は操作音だけにして、演出は結果発表で行います。<br>正解の先行強調は模試では無効です。模試中は範囲が開始時の設定に固定されます。2027年度より先の出題範囲は未確認です。</p><div class="b-divider"></div><h2 style="font-size:18px">記録のバックアップ</h2><p class="b-muted">iPhoneで長期間使わないと保存データが消えることがあります。学習記録・メモ・中断模試をまとめて書き出せます。</p><div class="b-actions">${button('JSONを書き出す','export','b-primary')}${button('JSONを読み込む','import')}</div><p class="b-mini-note">宅建版の保存データは対象に含みません。読み込みは簿記版の記録を置き換えます。</p><div class="b-actions">${button('学習記録を初期化','reset','b-danger')}</div></div><footer class="b-foot">${disclaimer}<br>模試の部分点は独自方式です。実際の採点方法を再現するものではありません。</footer>`);
 }
 function openModal(title,html,opt={}){
  closeModal(false);const focus=document.activeElement;modal={...opt,focus};app.inert=true;
  modalRoot.innerHTML=`<div class="b-overlay"><section class="b-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="b-sheethead"><h2 id="modal-title">${esc(title)}</h2>${button('×','closeModal','', 'aria-label="閉じる"')}</header>${html}</section></div>`;
  requestAnimationFrame(()=>$('.b-sheet input:not([readonly]),.b-sheet button')?.focus({preventScroll:true}));
 }
 function closeModal(dismiss=true){if(!modal)return;const old=modal;modal=null;modalRoot.innerHTML='';app.inert=false;if(old.focus?.isConnected)old.focus.focus({preventScroll:true});if(dismiss)old.dismiss?.();}
 function accountSheet(setter){
  let tab='all',search='';const available=Object.values(BK.accounts).filter(a=>BK.inScope(a,currentScope()));
  openModal('勘定科目を選ぶ',`<input class="b-search" id="account-search" aria-label="勘定科目を検索" placeholder="科目名を検索"><div class="b-tabs">${[['all','すべて'],['recent','最近'],['asset','資産'],['liability','負債'],['equity','純資産'],['revenue','収益'],['expense','費用'],['industrial','工業']].map(([id,name])=>button(name,'accountTab:'+id,id==='all'?'on':'')).join('')}</div><div class="b-accountlist" id="account-list"></div>`);
  function draw(){const items=available.filter(a=>(tab==='all'||tab==='recent'&&S.recent.includes(a.name)||tab==='industrial'&&a.industrial||a.group===tab)&&a.name.includes(search));$('#account-list').innerHTML=items.map(a=>button(esc(a.name),'selectAccount:'+a.name)).join('')||'<p class="b-muted">該当する科目はありません</p>';}
  modal.accountChoose=name=>{setter(name);S.recent=[name,...S.recent.filter(a=>a!==name)].slice(0,12);save();closeModal();renderAnswer();updateAnswer();};
  modal.accountTab=id=>{tab=id;$$('[data-action^="accountTab:"]').forEach(b=>b.classList.toggle('on',b.dataset.action==='accountTab:'+id));draw();};
  $('#account-search').addEventListener('input',e=>{search=e.target.value.normalize('NFKC');draw();});draw();
 }
 function numberSheet(key){
  const q=qNow(),a=answerFor(q),[side,idx]=key.split(':'),journal=q.type==='journal';
  let value=String((journal?a[side][+idx][1]:a[+key])??'');const label=journal?(side==='dr'?'借方':'貸方')+'の金額':q.parts[+key].label;
  openModal(label,`<div class="b-numdisplay" id="number-display">${esc(value?fmt(Number(value)):'0')}</div><div class="b-keypad">${['7','8','9','4','5','6','1','2','3','±','0','000','C','.','⌫'].map(k=>button(k,'num:'+k,['C','⌫','±','.'].includes(k)?'subkey':'')).join('')}</div><div class="b-actions">${button('入力を確定','numberDone','b-primary')}</div><p class="b-mini-note">負の差異は ±、小数は「.」。PCでは数字キーでも入力できます。</p>`);
  modal.numberKey=k=>{if(k==='C')value='';else if(k==='⌫')value=value.slice(0,-1);else if(k==='±')value=value.startsWith('-')?value.slice(1):'-'+(value||'0');else if(k==='.') {if(!value.includes('.'))value=(value||'0')+'.';}else if(value.replace(/[-.]/g,'').length+k.length<=12)value=(value==='0'?'':value)+k;$('#number-display').textContent=value===''?'0':value==='-'||value.endsWith('.')?value:fmt(Number(value));if(session?.kind==='practice')F.bump($('#number-display'));};
  modal.numberDone=()=>{if(value!==''&&E.number(value)===null){F.toast('数値を入力してください');return;}if(journal)a[side][+idx][1]=value;else a[+key]=value;closeModal();renderAnswer();updateAnswer();};
 }
 function calculator(){
  let value='0',stored=null,operator=null,fresh=true;
  openModal('電卓',`<div class="b-numdisplay" id="calc-display">0</div><div class="b-keypad calc">${['C','±','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','00','.','='].map(k=>button(k,'calc:'+k,/^[0-9.]$/.test(k)?'':'subkey')).join('')}</div><p class="b-mini-note">四則演算は入力した順に計算。%は表示値を100で割ります。模試の時計は電卓使用中も進みます。</p>`);
  const apply=()=>{const n=Number(value);if(stored!==null&&operator){value=String(operator==='+'?stored+n:operator==='−'?stored-n:operator==='×'?stored*n:n===0?NaN:stored/n);if(!Number.isFinite(Number(value)))value='エラー';else value=String(Number(Number(value).toPrecision(12)));}operator=null;stored=null;};
  modal.calcKey=k=>{if(k==='C'){value='0';stored=null;operator=null;fresh=true;}else if(['+','−','×','÷'].includes(k)){if(!fresh)apply();if(value!=='エラー'){stored=Number(value);operator=k;fresh=true;}}else if(k==='='){apply();fresh=true;}else if(k==='±'){value=String(-Number(value));}else if(k==='%'){value=String(Number(value)/100);}else{if(fresh||value==='エラー'){value=k==='.'?'0.':k;fresh=false;}else if(k==='.'&&!value.includes('.'))value+='.';else if(k!=='.'&&value.length<14)value=(value==='0'?'':value)+k;}$('#calc-display').textContent=value;};
 }
 function backup(){const data={app:'boki2DopaQuest',version:1,exportedAt:new Date().toISOString(),state:S,memos:getJSON('boki2DopaQuest.memos.v1',{items:{}}),memoTools:getJSON('boki2DopaQuest.memoTools.v1',{}),exam:savedExam};return JSON.stringify(data,null,2);}
 function exportRecords(){const text=backup();openModal('記録を書き出す',`<p class="b-muted">JSONをファイル保存するか、コピーして保管してください。</p><textarea id="backup-text" aria-label="バックアップJSON" readonly></textarea><div class="b-actions">${button('ファイル保存','downloadBackup','b-primary')}${button('コピー','copyBackup')}${button('共有','shareBackup')}</div>`);$('#backup-text').value=text;modal.backup=text;}
 function importRecords(){openModal('記録を読み込む',`<p class="b-notice">読み込み前に現在の記録を書き出すことをおすすめします。下にJSONを貼り付けるか、ファイルを選択してください。</p><input id="import-file" type="file" accept="application/json,.json" aria-label="JSONファイルを選択"><textarea id="import-text" aria-label="読み込むJSON" placeholder="ここにJSONを貼り付け"></textarea><p id="import-error" class="b-error"></p><div class="b-actions">${button('内容を確認する','checkImport','b-primary')}</div>`);$('#import-file').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>4e6){$('#import-error').textContent='4MB以下のファイルを指定してください';return;}$('#import-text').value=await f.text();};}
 function parseBackup(text){
  if(text.length>4e6)throw Error('4MB以下のJSONにしてください');const raw=JSON.parse(text);
  if(raw.app!=='boki2DopaQuest'||raw.version!==1||!raw.state)throw Error('簿記クエストv1の記録ではありません');
  const state=validateState(raw.state),memos={items:{}};
  for(const [id,r]of Object.entries(raw.memos?.items||{})){
   if(!Object.hasOwn(byId,id)||!r||!Array.isArray(r.s)||r.s.length>20000)throw Error('メモの形式が不正です');
   for(const s of r.s)if(!s||!Array.isArray(s.p)||s.p.length>100000||s.p.length%2||!s.p.every(n=>Number.isFinite(n)&&Math.abs(n)<1e7)||['w','o','m'].some(key=>s[key]!=null&&!Number.isFinite(s[key])))throw Error('メモの座標・道具が不正です');
   memos.items[id]={...r,id,q:byId[id].q,e:byId[id].exp,cat:byId[id].cat};
  }
  const importedExam=raw.exam?validExam(raw.exam):null;if(raw.exam&&!importedExam)throw Error('中断模試の問題構成が不正です');
  return {state,memos,exam:importedExam,memoTools:raw.memoTools&&typeof raw.memoTools==='object'?raw.memoTools:{}};
 }
 async function doImport(){
  const data=modal.importData,keys=[KEY,'boki2DopaQuest.memos.v1',EXAMKEY,'boki2DopaQuest.memoTools.v1'],values=[data.state,data.memos,data.exam,data.memoTools],before=[];
  try{keys.forEach(k=>before.push(localStorage.getItem(k)));keys.forEach((k,i)=>localStorage.setItem(k,JSON.stringify(values[i])));}catch{try{keys.forEach((k,i)=>before[i]==null?localStorage.removeItem(k):localStorage.setItem(k,before[i]));}catch{}F.toast('容量不足のため読み込めませんでした');return;}
  // reload直前のpagehide保存で、読み込み前の状態に上書きしない。
  Object.assign(S,data.state);savedExam=data.exam;
  location.reload();
 }
 function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
 const help=()=>openModal('遊び方',`<p class="b-sub">① 仕訳ドリルや論点別から始めます。<br>② 科目を選び、金額欄をタップしてテンキー入力。<br>③ 答え合わせで解説を読み、苦手をほどきます。<br>④ 模試では大問を移動しながら解答し、最後に提出。<br><br>計算用紙は指やマウスで描けます。PCはTabで移動、Enterで操作できます。iPhoneのSafariでは共有メニューから「ホーム画面に追加」が使えます。</p>`);
 async function action(raw,el){
  const [act,...args]=raw.split(':'),arg=args.join(':');
  if(act==='closeModal'){closeModal();return;}
  if(act==='sfx'){F.moment.preview(arg,el);return;}
  if(act==='accountTab'){modal?.accountTab(arg);return;}if(act==='selectAccount'){modal?.accountChoose(arg);return;}if(act==='num'){modal?.numberKey(arg);return;}if(act==='numberDone'){modal?.numberDone();return;}if(act==='calc'){modal?.calcKey(arg);return;}
  if(act==='continue'){closeModal(false);resumeClock();return;}
  if(act==='leaveSession'){closeModal(false);if(session.kind==='exam')persistExam();session=null;go('menu');return;}
  if(act==='home'){if(session){pause();return;}go('menu');return;}
  if(['settings','stats','gallery','mocks'].includes(act)){go(act);return;}
  if(act==='genre'){category='';go('genre');return;}
  if(act==='category'){if(BK.nodes[arg]?.kids)genre(arg);else startPractice('topic',arg);return;}
  if(act==='categoryUp'){genre(category.split('/').slice(0,-1).join('/'));return;}
  if(act==='categoryPractice'){startPractice('topic',category);return;}
  if(act==='practice'){startPractice('topic',arg);return;}
  if(['drill','theory','weak','ta','mixed'].includes(act)){startPractice(act);return;}
  if(act==='help'){help();return;}if(act==='calculator'){calculator();return;}if(act==='revealAnswer'){revealAnswer();return;}
  if(act==='grade'){grade();return;}if(act==='next'){next();return;}
  if(act==='pause'){pause();return;}
  if(act==='replayExam'){try{startExam('random',$('#exam-code').value);}catch(e){$('#exam-code-error').textContent=e.message;}return;}
  if(act==='exam'){startExam(arg);return;}if(act==='resumeExam'){resumeExam();return;}
  if(act==='discardExam'){openModal('中断データを破棄',`<p class="b-sub">中断した模試の解答を削除します。学習記録は残ります。</p><div class="b-actions">${button('破棄する','confirmDiscard','b-danger')}</div>`);return;}
  if(act==='confirmDiscard'){savedExam=null;try{localStorage.removeItem(EXAMKEY);}catch{}go('mocks');return;}
  if(act==='prev'){jump(session.index-1);return;}if(act==='nextExam'){jump(session.index+1);return;}if(act==='jump'){jump(+arg);return;}
  if(act==='section'){const set=examSet();jump(session.ids.indexOf(set.sections[+arg].items[0].id));return;}
  if(act==='flag'){const id=qNow().id;session.flags=session.flags.includes(id)?session.flags.filter(x=>x!==id):[...session.flags,id];persistExam();$('[data-action="flag"]').textContent=session.flags.includes(id)?'⚑ 見直し済み':'⚑ あとで見直す';$(`[data-action="jump:${session.index}"]`).textContent=`${session.index+1}${session.flags.includes(id)?' ⚑':''}`;return;}
  if(act==='submitExam'){const empty=session.ids.filter(id=>!hasAnswer(id)).length;openModal('模試を提出する',`<p class="b-sub">未入力の小問: ${empty}個<br>見直しマーク: ${session.flags.length}個<br>提出すると解答を確定し、採点します。</p><div class="b-actions">${button('提出して採点','confirmExam','b-primary')}${button('解答に戻る','closeModal')}</div>`);return;}
  if(act==='confirmExam'){finishExam();return;}
  if(act==='export'){exportRecords();return;}if(act==='import'){importRecords();return;}
  if(act==='downloadBackup'){download(modal.backup,'boki2-records-'+day()+'.json');return;}
  if(act==='copyBackup'){try{await navigator.clipboard.writeText(modal.backup);F.toast('コピーしました');}catch{$('#backup-text').select();F.toast('選択したJSONをコピーしてください');}return;}
  if(act==='shareBackup'){try{const file=new File([modal.backup],'boki2-records.json',{type:'application/json'});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else F.toast('共有非対応です。ファイル保存かコピーをご利用ください');}catch(e){if(e.name!=='AbortError')F.toast('共有できませんでした');}return;}
  if(act==='checkImport'){try{const data=parseBackup($('#import-text').value);openModal('この記録に置き換えます',`<p class="b-sub">解答回数 ${data.state.total}回<br>メモ ${Object.keys(data.memos.items).length}枚<br>中断模試 ${data.exam?'あり':'なし'}</p><div class="b-actions">${button('置き換えて読み込む','confirmImport','b-primary')}${button('やめる','closeModal')}</div>`);modal.importData=data;}catch(e){$('#import-error').textContent='読み込めません: '+e.message;}return;}
  if(act==='confirmImport'){await doImport();return;}
  if(act==='reset'){openModal('学習記録を初期化',`<p class="b-sub">経験値・正誤履歴・模試履歴を消します。メモと設定は残ります。先にバックアップを作成できます。</p><div class="b-actions">${button('初期化する','confirmReset','b-danger')}${button('やめる','closeModal')}</div>`);return;}
  if(act==='confirmReset'){const settings=S.set;Object.assign(S,defaults(),{set:settings});save();go('settings');return;}
  if(act==='memoExport'){const rec=BK.memo.store.get(arg);if(rec)await BK.memo.exportPng(rec,'boki2-'+arg+'.png');return;}
  if(act==='memoDelete'){openModal('このメモを削除',`<p class="b-sub">${esc(BK.TITLES[arg])} の計算用紙を削除します。</p><div class="b-actions">${button('削除する','confirmMemoDelete:'+arg,'b-danger')}</div>`);return;}
  if(act==='confirmMemoDelete'){BK.memo.store.remove(arg);go('gallery');return;}
  if(!session||session.paused||session.grades?.[qNow().id])return;
  const q=qNow(),a=answerFor(q);
  if(act==='add'){a[arg].push(['','']);fresh=arg+':'+(a[arg].length-1);renderAnswer();updateAnswer();}
  if(act==='remove'){const [side,i]=args;a[side].splice(+i,1);if(!a[side].length)a[side].push(['','']);renderAnswer();updateAnswer();}
  if(act==='account'){const [side,i]=args;accountSheet(name=>a[side][+i][0]=name);}
  if(act==='partAccount')accountSheet(name=>a[+arg]=name);
  if(act==='tf'){session.answers[q.id]=arg==='true';renderAnswer();updateAnswer();}
  if(act==='choice'){const i=+arg;session.answers[q.id]=q.ans.length>1?(a.includes(i)?a.filter(n=>n!==i):[...a,i]):[i];renderAnswer();updateAnswer();}
 }
 // メモ帳はクリック伝播を止めるため、捕捉段階で共通の操作音を鳴らす。練習中の入力は音程つきの専用音（模試は従来の操作音）。
 document.addEventListener('click',e=>{
  const control=e.target.closest('button,summary,[data-number]');if(!control||control.disabled)return;
  const [act,arg]=(control.dataset.action||'').split(':'),fun=session?.kind==='practice';
  if(['grade','exam','replayExam','drill','theory','weak','ta','mixed','practice','categoryPractice','confirmExam','sfx'].includes(act))return;
  if(control.matches('[data-number]')&&session?.paused)return;
  if(fun&&act==='num'){F.play('key',arg);F.haptic('light');return;}
  if(fun&&(act==='tf'||act==='choice')){F.play('select',arg==='false'?1:+arg||0);return;}
  if(fun&&['selectAccount','add','remove'].includes(act)){F.play({selectAccount:'pick',add:'add',remove:'remove'}[act]);return;}
  const name=control.matches('[data-number],.memo button')||['num','calc','accountTab'].includes(act)?'tick':
   ['closeModal','home','categoryUp','pause','leaveSession','prev'].includes(act)?'back':
   ['jump','section','tf','choice','selectAccount'].includes(act)?'move':'ok';
  F.play(name);
 },true);
 document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled){F.audioUnlock();action(b.dataset.action,b).catch(err=>{console.error(err);F.toast('操作できませんでした。ホームから再度お試しください');});}const n=e.target.closest('[data-number]');if(n&&!n.disabled&&!session?.paused)numberSheet(n.dataset.number);});
 document.addEventListener('change',e=>{const key=e.target.dataset.setting;if(!key){if(e.target.matches('.memo input[type=range]'))F.play('tick');return;}const target=e.target;S.set[key]=target.type==='checkbox'?(key==='fx'?+target.checked:target.checked):['count','goal','vol'].includes(key)?+target.value:target.value;save();if(key==='vol')F.setVol();if(key==='fx')F.applyFx();F.play('tick');if(key==='scope')F.toast(scopeLabel(S.set.scope)+'に変更しました');});
 document.addEventListener('keydown',e=>{
  if(modal){
   if(e.key==='Escape'){e.preventDefault();F.play('back');closeModal();return;}
   if(e.key==='Tab'){const els=$$('button,input,select,textarea,a[href]',modalRoot).filter(el=>!el.disabled&&!el.hidden),first=els[0],last=els[els.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}return;}
   if(modal.numberKey){if(/^\d$/.test(e.key)||e.key==='.'||e.key==='Backspace'||e.key==='Delete'||e.key==='-'){e.preventDefault();F.play('tick');modal.numberKey(e.key==='Backspace'?'⌫':e.key==='Delete'?'C':e.key==='-'?'±':e.key);}else if(e.key==='Enter'){e.preventDefault();F.play('ok');modal.numberDone();}return;}
   if(modal.calcKey){const map={'Enter':'=','*':'×','/':'÷','-':'−','Backspace':'C'};if(/^[0-9.+%]$/.test(e.key)||map[e.key]){e.preventDefault();F.play('tick');modal.calcKey(map[e.key]||e.key);}return;}
  }else if(e.key==='Escape'&&session){e.preventDefault();F.play('back');pause();}
  else if(e.target.matches('[data-number]')&&(e.key==='Enter'||/^\d$/.test(e.key))){e.preventDefault();F.play('tick');numberSheet(e.target.dataset.number);if(/^\d$/.test(e.key))modal.numberKey(e.key);}
 });
 document.addEventListener('pointerdown',e=>{document.body.dataset.input=e.pointerType==='touch'||e.pointerType==='pen'?'touch':'kb';F.audioUnlock();});
 document.body.dataset.input=matchMedia('(pointer:coarse)').matches?'touch':'kb';
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&session&&!session.paused){closeModal(false);pause();}});
 addEventListener('pagehide',()=>{if(memo?.isDirty())memo.save();if(session?.kind==='exam'){session.interrupted=true;persistExam();}save();});
 let padPrev=[];
 function pollPad(){const p=navigator.getGamepads?.()?.[0];if(!p)return;const buttons=p.buttons.map(b=>b.pressed);const pressed=[12,13,0,1].filter(i=>buttons[i]&&!padPrev[i]);if(pressed.length){const controls=$$('button,input,select',modal?modalRoot:app).filter(b=>!b.disabled&&b.getClientRects().length);for(const idx of pressed){const focused=controls.indexOf(document.activeElement);if(idx===12||idx===13){F.play('move');controls[(focused+(idx===12?-1:1)+controls.length)%controls.length]?.focus();}if(idx===0)document.activeElement?.click();if(idx===1){F.play('back');if(modal)closeModal();else if(session)pause();else go('menu');}}}padPrev=buttons;}
 let lastTimerEl=null,lastTimerText='';
 function frame(t){
  const delta=Math.max(0,t-lastTick);lastTick=t;
  if(session&&screen==='quiz'&&!session.paused&&!session.over){
   const held=t<session.holdUntil; // 60秒チャレンジの READY/GO 中は時計を止める
   if(session.kind==='practice'&&!held&&!session.grades[qNow().id])session.questionElapsed+=delta;
   if(session.remaining!==null&&!held){
    session.remaining=Math.max(0,session.remaining-delta);const el=$('#timer'),shown=time(session.remaining);
    if(el&&(el!==lastTimerEl||shown!==lastTimerText)){
     const sec=Math.ceil(session.remaining/1000),hurry=session.mode==='ta'&&sec<=10;
     el.textContent=shown;el.classList.toggle('urgent',session.kind==='exam'&&session.remaining<60000);el.classList.toggle('hurry',hurry);lastTimerEl=el;lastTimerText=shown;
     if(hurry&&sec>0&&sec!==session.lastSec){session.lastSec=sec;F.moment.clock(sec,el);}
    }
    if(session.remaining===0){if(session.kind==='exam')finishExam();else{session.over=true;closeModal(false);F.moment.timeUp();setTimeout(()=>{if(session?.over)finishPractice();},1300);}}
   }
   if(session?.kind==='exam'&&t-saveTick>10000){persistExam();saveTick=t;}
  }
  F.drawFx();F.Muse.tick(t);pollPad();requestAnimationFrame(frame);
 }
 menu();requestAnimationFrame(frame);
 // 自動検証用の公開API。解答そのものは静的教材なのでクライアントに含まれる。
 window.__BK={state:()=>S,session:()=>session,go,startPractice,startExam,finishExam,grade,jump,answerFor,parseBackup,backup,renderQuiz,fx:()=>F};
 // 新しい版が届いたら、ホーム画面のiPhone版でもメニューにいる時点で読み込み直す（解答中は次にメニューへ戻ったとき）。
 if('serviceWorker' in navigator&&location.protocol.startsWith('http')){
  const hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').then(reg=>document.addEventListener('visibilitychange',()=>{if(!document.hidden)reg.update().catch(()=>{});})).catch(()=>{});
  // 表示中の版が最新のページ本体と同じJS/CSSを読んでいれば、再読み込みは不要。
  const stale=async()=>{try{const html=await (await fetch('./',{cache:'no-cache'})).text();return [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].some(e=>!html.includes(e.getAttribute('src')||e.getAttribute('href')));}catch{return true;}};
  navigator.serviceWorker.addEventListener('controllerchange',async()=>{if(!hadController||!(await stale()))return;swUpdated=true;if(screen==='menu'&&!session&&!modal)location.reload();});
 }
})();
