/* 問題を丸ごと抽出する。数値・正解・配点を乱数で加工しない。 */
(() => {
 'use strict';
 const byId=Object.fromEntries(BK.Q.map(q=>[q.id,q]));
 const family=id=>id.replace(/-\d+$/,'');
 const copy=x=>JSON.parse(JSON.stringify(x));
 function parse(code){
  const m=/^BQ1-([CF])-([0-9A-F]{8})$/.exec(String(code).trim().toUpperCase());
  if(!m)throw Error('再現コードは BQ1-C-1234ABCD の形式で入力してください');
  return {scope:m[1]==='F'?'future':'current',seed:parseInt(m[2],16),code:m[0]};
 }
 function generate(scope,seed){
  if(!['current','future'].includes(scope)||!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('模試の範囲・シードが不正です');
  // v1の乱数手順と固定候補は変更しない。同一コードは同一順序・問題IDに対応する。
  let state=seed>>>0;
  const random=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const pick=a=>{if(!a.length)throw Error('模試の候補問題が不足しています');return a[Math.floor(random()*a.length)];};
  const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
  const active=ids=>ids.filter(id=>byId[id]&&BK.inScope(byId[id],scope));
  const grouped=groups=>groups.map(active).filter(a=>a.length);
  const p=BK.EXAM_POOL_V1;
  // 商業仕訳は異なる5論点から。各論点内でも原稿系列を先に選び、数値版の多さで偏らせない。
  const commercial=shuffle(grouped(p.q1)).slice(0,5).map(ids=>{
   const selectedFamily=pick([...new Set(ids.map(family))]);return pick(ids.filter(id=>family(id)===selectedFamily));
  });
  const q2=pick(pick(grouped(p.q2))),q3=pick(active(p.q3));
  const industrial=p.q4journals.map(ids=>pick(active(ids))),q4=pick(active(p.q4grid));
  const q5=pick(pick(grouped(p.q5)));
  const item=(id,points)=>({id,points});
  const sections=[
   {name:'第1問 商業仕訳',points:20,items:commercial.map(id=>item(id,4))},
   {name:'第2問 '+BK.nodes[byId[q2].cat].name,points:20,items:[item(q2,20)]},
   {name:'第3問 決算・財務諸表',points:20,items:[item(q3,20)]},
   {name:'第4問 工業仕訳・製造原価',points:28,items:[...industrial.map(id=>item(id,4)),item(q4,16)]},
   {name:'第5問 '+BK.nodes[byId[q5].cat].name,points:12,items:[item(q5,12)]}
  ];
  const code='BQ1-'+(scope==='future'?'F':'C')+'-'+seed.toString(16).toUpperCase().padStart(8,'0');
  return {id:'random-'+code,name:'ランダム模試',format:'random-v1',scope,minutes:90,code,sections};
 }
 function fromCode(code){const p=parse(code);return generate(p.scope,p.seed);}
 function restore(snapshot){
  if(!snapshot||snapshot.format!=='random-v1')return null;
  try{
   const expected=fromCode(snapshot.code);
   if(snapshot.id!==expected.id||snapshot.scope!==expected.scope||JSON.stringify(snapshot.sections)!==JSON.stringify(expected.sections))return null;
   return expected;
  }catch{return null;}
 }
 BK.examFactory={generate,fromCode,restore,parse,legacy:id=>{const e=BK.EXAMS.find(e=>e.id===id);return e?copy(e):null;}};
})();
