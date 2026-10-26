(() => {
 const E=BK.engine;
 E.number=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;const s=String(v??'').normalize('NFKC').replace(/,/g,'').trim();return /^-?\d+(\.\d+)?$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;};
 E.grade=(q,input)=>{
  if(q.type==='journal'){
   const j={dr:[],cr:[]};
   for(const side of ['dr','cr'])j[side]=(input?.[side]||[]).filter(r=>r[0]||String(r[1]??'').trim()).map(([a,v])=>[a,E.number(v)]);
   const same=(x,y)=>x[0]===y[0]&&x[1]===y[1];
   const alternatives=q.ans;let best={ratio:0,correct:false,checks:[]};
   for(const a of alternatives){
    const checks=[];let hits=0,total=a.dr.length+a.cr.length,extra=0;
    for(const side of ['dr','cr']){
     const unused=j[side].slice();
     for(const row of a[side]){const i=unused.findIndex(x=>same(x,row));const ok=i>=0;if(ok){hits++;unused.splice(i,1);}checks.push({label:side+' '+row[0],ok});}
     extra+=Math.max(0,j[side].length-a[side].length);
    }
    const ratio=Math.max(0,(hits-extra)/total),correct=ratio===1&&!E.validateJournal(j).length;
    if(ratio>best.ratio||correct||!best.checks.length)best={ratio,correct,checks};
   }
   return best;
  }
  if(q.type==='tf'){const ok=typeof input==='boolean'&&input===q.ans;return {ratio:+ok,correct:ok,checks:[{label:'判定',ok}]};}
  if(q.type==='choice'){const a=Array.isArray(input)?[...new Set(input)].sort():[];const ok=JSON.stringify(a)===JSON.stringify(q.ans.slice().sort());return {ratio:+ok,correct:ok,checks:[{label:'選択',ok}]};}
  const checks=q.parts.map((p,i)=>{const v=p.kind==='account'?String(input?.[i]??''):E.number(input?.[i]);return {label:p.label,ok:p.kind==='account'?v===p.ans:v!==null&&Math.abs(v-p.ans)<=(p.tol||0)};});
  const ratio=checks.filter(c=>c.ok).length/checks.length;return {ratio,correct:ratio===1,checks};
 };
 E.examScore=(set,answers)=>{
  const topics={};const sections=set.sections.map(s=>{
   const items=s.items.map(item=>{const q=BK.Q.find(q=>q.id===item.id);const grade=E.grade(q,answers[item.id]);const score=grade.ratio*item.points;topics[q.cat]??={score:0,max:0};topics[q.cat].score+=score;topics[q.cat].max+=item.points;return {...item,grade,score};});
   return {...s,items,score:E.sum(items.map(i=>i.score))};
  });
  const score=Math.round(E.sum(sections.map(s=>s.score))*100)/100;return {sections,topics,score,passed:score>=70};
 };
})();
