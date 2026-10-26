(() => {
 'use strict';
 const sum=a=>a.reduce((s,x)=>s+x,0), E=BK.engine={sum};
 E.validateJournal=j=>{
  const errors=[];
  for(const side of ['dr','cr']){
   if(!Array.isArray(j?.[side])||!j[side].length){errors.push(side+'が空です');continue;}
   const seen=new Set();
   for(const row of j[side]){
    if(!Array.isArray(row)||row.length!==2){errors.push('行形式が不正');continue;}
    const [a,v]=row;
    if(!BK.accounts[a])errors.push('未登録科目: '+a);
    if(!Number.isSafeInteger(v)||v<=0)errors.push('金額は正の整数');
    if(seen.has(a))errors.push('同じ側の科目重複');seen.add(a);
   }
  }
  if(!errors.length&&sum(j.dr.map(r=>r[1]))!==sum(j.cr.map(r=>r[1])))errors.push('借方・貸方が一致しません');
  return errors;
 };
 E.ledger=(opening,journals)=>{
  const balances={...opening};
  Object.entries(balances).forEach(([a,v])=>{if(!BK.accounts[a]||!Number.isSafeInteger(v))throw Error('不正な開始残高');});
  if(sum(Object.values(balances))!==0)throw Error('開始試算表が不一致');
  for(const j of journals){const errors=E.validateJournal(j);if(errors.length)throw Error(errors.join('/'));for(const side of ['dr','cr'])for(const [a,v]of j[side])balances[a]=(balances[a]||0)+(side==='dr'?v:-v);}
  const trial=Object.entries(balances).map(([account,balance])=>({account,dr:Math.max(0,balance),cr:Math.max(0,-balance)}));
  let assets=0,liabilities=0,equity=0,revenue=0,expense=0;
  for(const [a,v]of Object.entries(balances)){const g=BK.accounts[a].group;if(g==='asset')assets+=v;if(g==='liability')liabilities-=v;if(g==='equity')equity-=v;if(g==='revenue')revenue-=v;if(g==='expense')expense+=v;}
  const profit=revenue-expense;
  return {balances,trial,assets,liabilities,equity:equity+profit,openingEquity:equity,revenue,expense,profit,balanced:assets===liabilities+equity+profit};
 };
 E.journal=(p)=>{
  const j=(dr,cr)=>({dr,cr}), one=(a,b,v)=>j([[a,v]],[[b,v]]), n=p.n;
  switch(p.kind){
   case 'transfer':return one(p.dr,p.cr,n);
   case 'taxSale':return j([['売掛金',n*1.1]],[['売上',n],['仮受消費税',n/10]]);
   case 'taxBuy':return j([['仕入',n],['仮払消費税',n/10]],[['買掛金',n*1.1]]);
   case 'creditSale':return j([['クレジット売掛金',n*(1-p.rate)],['支払手数料',n*p.rate]],[['売上',n]]);
   case 'discount':return j([['当座預金',n-p.fee],[p.loss,p.fee]],[[p.account,n]]);
   case 'badDebt':return j([['貸倒引当金',p.allowance],['貸倒損失',n-p.allowance]],[['売掛金',n]]);
   case 'allowance':return one('貸倒引当金繰入','貸倒引当金',n*p.rate-p.balance);
   case 'assetBuy':return one(p.account,p.payment,n+p.fee);
   case 'assetSell':{const book=n-p.acc,jr=j([[p.payment,p.price],[p.accAccount,p.acc]],[[p.account,n]]);const gain=p.price-book; if(gain>0)jr.cr.push(['固定資産売却益',gain]);if(gain<0)jr.dr.push(['固定資産売却損',-gain]);return jr;}
   case 'depreciate':return one('減価償却費',p.accAccount,p.method==='rate'?(n-p.acc)*p.rate:p.method==='units'?(n-p.residual)*p.units/p.totalUnits:(n-p.residual)/p.years*p.months/12);
   case 'disposal':return j([[p.accAccount,p.acc],['固定資産除却損',n-p.acc]],[[p.account,n]]);
   case 'securitySell':return p.price>n?j([['普通預金',p.price]],[[p.account,n],['有価証券売却益',p.price-n]]):j([['普通預金',p.price],['有価証券売却損',n-p.price]],[[p.account,n]]);
   case 'securityValue':return p.price>n?one('売買目的有価証券','有価証券評価益',p.price-n):one('有価証券評価損','売買目的有価証券',n-p.price);
   case 'bond':return one('満期保有目的債券','有価証券利息', (p.face-n)/p.years);
   case 'leaseStart':return one(p.future?'使用権資産':'リース資産',p.future?'リース負債':'リース債務',p.annual*p.years-p.interest);
   case 'leasePay':return j([[p.future?'リース負債':'リース債務',p.annual-p.interest/p.years],['支払利息',p.interest/p.years]],[['普通預金',p.annual]]);
   case 'currency':{const diff=p.units*(p.newRate-p.oldRate);return diff>=0?one('売掛金','為替差損益',diff):one('為替差損益','売掛金',-diff);}
   case 'issue':return j([['当座預金',n]],[['資本金',n/2],['資本準備金',n/2]]);
   case 'dividend':{const reserve=Math.min(n/10,Math.max(0,p.capital/4-p.reserves));return j([['繰越利益剰余金',n+reserve]],[['未払配当金',n],...(reserve?[['利益準備金',reserve]]:[])]);}
   case 'taxClose':return j([['法人税等',n]],[['仮払法人税等',p.paid],['未払法人税等',n-p.paid]]);
   case 'vatClose':return j([['仮受消費税',n]],[['仮払消費税',p.input],['未払消費税',n-p.input]]);
   case 'taxEffect':return one('繰延税金資産','法人税等調整額',n*p.rate);
   case 'consolidate':return j([['資本金',p.capital],['利益剰余金',p.retained],['のれん',p.price-(p.capital+p.retained)*p.share]],[['子会社株式',p.price],['非支配株主持分',(p.capital+p.retained)*(1-p.share)]]);
   case 'unrealized':return one('売上原価','商品',n*p.margin);
   case 'factoryLabor':return j([['仕掛品',p.direct],['製造間接費',p.indirect]],[['賃金',p.direct+p.indirect]]);
   default:throw Error('未知の仕訳関数 '+p.kind);
  }
 };
 // 浮動小数点誤差だけを丸める。小数円そのものを隠さない。
 E.clean=x=>typeof x==='number'?(Math.abs(x-Math.round(x))<1e-7?Math.round(x):x):Array.isArray(x)?x.map(E.clean):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,E.clean(v)])):x;
 E.answer=q=>E.clean(q.type==='journal'?E.journal(q.params):q.type==='tf'||q.type==='choice'?q.ans:E.solve(q.solve,q.params||q.scenario));
})();
