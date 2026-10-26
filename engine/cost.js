(() => {
 const E=BK.engine, C=E.cost={};
 C.material=p=>(p.begin+p.purchased-p.end)*p.price;
 C.wages=p=>p.paid+p.endAccrued-p.beginAccrued;
 C.overhead=p=>({applied:p.rate*p.hours,difference:p.actual-p.rate*p.hours});
 C.department=(p)=>{
  // 簡便相互配賦: 第一次で補助部門間も配賦、第二次で受領分だけを製造部門へ。
  const result=p.production.slice();
  const count=p.services.length;
  const received=Array(count).fill(0);
  p.services.forEach((s,i)=>{
   const weights=p.method==='direct'?s.toProduction:[...s.toProduction,...s.toServices];
   const total=E.sum(weights);
   s.toProduction.forEach((w,k)=>result[k]+=s.cost*w/total);
   if(p.method==='reciprocal')s.toServices.forEach((w,k)=>received[k]+=s.cost*w/total);
  });
  if(p.method==='reciprocal')p.services.forEach((s,i)=>s.toProduction.forEach((w,k)=>result[k]+=received[i]*w/E.sum(s.toProduction)));
  return result;
 };
 C.process=p=>{
  // 材料始点投入。正常仕損の度外視法。完成品のみ負担は別関数。
  const matUnits=p.completed+p.endQty, convUnits=p.completed+p.endQty*p.endRate;
  if(p.method==='fifo'){
   const mr=p.material/(matUnits-p.beginQty), cr=p.conversion/(convUnits-p.beginQty*p.beginRate);
   const endMat=mr*p.endQty,endConv=cr*p.endQty*p.endRate;
   return {completed:p.beginMaterial+p.beginConversion+p.material+p.conversion-endMat-endConv,endMaterial:endMat,endConversion:endConv,end:endMat+endConv};
  }
  const mr=(p.beginMaterial+p.material)/matUnits,cr=(p.beginConversion+p.conversion)/convUnits;
  return {completed:p.completed*(mr+cr),endMaterial:p.endQty*mr,endConversion:p.endQty*p.endRate*cr,end:p.endQty*mr+p.endQty*p.endRate*cr};
 };
 C.normalLoss=p=>{
  // 月初なし、材料始点投入、仕損は終点・評価額ゼロ、完成品のみ負担。
  const mr=p.material/(p.completed+p.loss+p.endQty),cr=p.conversion/(p.completed+p.loss+p.endQty*p.endRate);
  const end=p.endQty*mr+p.endQty*p.endRate*cr;
  return {completed:p.material+p.conversion-end,end};
 };
 C.standard=p=>({price:(p.actualPrice-p.standardPrice)*p.actualQty,quantity:(p.actualQty-p.standardQty)*p.standardPrice});
 C.overheadVariance=p=>({budget:p.actual-(p.fixed+p.variableRate*p.actualHours),efficiency:(p.actualHours-p.standardHours)*(p.variableRate+p.fixed/p.normalHours),volume:(p.normalHours-p.actualHours)*p.fixed/p.normalHours});
 C.cvp=p=>{const contribution=p.price-p.variable;return {breakEvenUnits:p.fixed/contribution,breakEvenSales:p.fixed/contribution*p.price,targetUnits:(p.fixed+p.target)/contribution,profit:p.units*contribution-p.fixed};};
 C.highLow=p=>{const variable=(p.highCost-p.lowCost)/(p.highUnits-p.lowUnits);return {variable,fixed:p.highCost-variable*p.highUnits};};
 C.equivalent=p=>{const unit=p.cost/E.sum(p.quantities.map((n,i)=>n*p.weights[i]));return p.quantities.map((n,i)=>n*p.weights[i]*unit);};
 C.manufacturing=p=>{const total=p.material+p.labor+p.overhead;return {total,completed:p.beginWip+total-p.endWip,cogs:p.beginGoods+p.beginWip+total-p.endWip-p.endGoods};};
 E.solve=(name,p)=>{
  switch(name){
   case 'material':return [C.material(p)];
   case 'wages':return [C.wages(p)];
   case 'expense':return [p.paid+p.endAccrued-p.beginAccrued+p.beginPrepaid-p.endPrepaid];
   case 'overhead':{const a=C.overhead(p);return [a.applied,a.difference];}
   case 'department':return C.department(p);
   case 'job':return [p.material+p.labor+p.hours*p.rate+p.repair];
   case 'process':{const a=C.process(p);return [a.completed,a.end];}
   case 'normalLoss':{const a=C.normalLoss(p);return [a.completed,a.end];}
   case 'equivalent':return C.equivalent(p);
   case 'group':return p.costs.map((c,i)=>c/p.quantities[i]);
   case 'stages':return [p.stage1+p.stage2,p.stage1+p.stage2-p.end];
   case 'standard':{const a=C.standard(p);return [a.price,a.quantity];}
   case 'overheadVariance':return Object.values(C.overheadVariance(p));
   case 'cvp':{const a=C.cvp(p);return p.fields.map(f=>a[f]);}
   case 'highLow':return Object.values(C.highLow(p));
   case 'direct':return [p.sales-p.variableProduction-p.variableSelling-p.fixed,p.endStockFixed-p.beginStockFixed];
   case 'manufacturing':return Object.values(C.manufacturing(p));
   case 'inventory':return [p.begin+p.purchases-p.end,p.bookQty*p.unit-p.realQty*p.unit,p.realQty*(p.unit-p.market)];
   case 'averageInventory':return [(p.beginValue+p.purchaseValue)/(p.beginQty+p.purchaseQty)*p.usedQty];
   case 'fifoInventory':return [p.beginQty*p.beginPrice+(p.usedQty-p.beginQty)*p.buyPrice];
   case 'bank':return [p.book+p.receipt-p.fee];
   case 'interest':return [p.face*p.rate*p.days/365];
   case 'revenueAllocation':return [p.total*p.a/(p.a+p.b),p.total*p.b/(p.a+p.b)];
   case 'progressRevenue':return [p.contract*p.progress];
   case 'goodwill':return [p.price-p.net*p.share,(p.price-p.net*p.share)/p.years,p.net*(1-p.share)];
   case 'nciProfit':return [p.profit*(1-p.share)];
   case 'upstream':return [p.stock*p.margin,p.stock*p.margin*(1-p.share)];
   case 'equity':return [p.begin+p.profit-p.dividend-p.reserve,p.reserve];
   case 'valuation':return [(p.market-p.book)*(1-p.rate),(p.market-p.book)*p.rate];
   case 'statement':{const a=E.ledger(p.opening,p.adjustments);return p.fields.map(f=>f.startsWith('balance:')?a.balances[f.slice(8)]:a[f]);}
   case 'financialGrid':{const a=E.ledger(p.opening,p.adjustments);return [a.balances['仕入'],a.profit,a.assets,a.liabilities,a.equity,a.balances['商品'],a.balances['売掛金'],-a.balances['貸倒引当金'],a.balances['備品']+a.balances['備品減価償却累計額'],a.expense];}
   case 'consolidatedGrid':{const goodwill=p.price-p.net*p.share,nci=p.net*(1-p.share);return [goodwill,goodwill/p.years,nci,p.profit*(1-p.share),p.dividend*(1-p.share),nci+(p.profit-p.dividend)*(1-p.share),p.stock*p.margin,goodwill-goodwill/p.years];}
   case 'manufacturingGrid':{const a=C.manufacturing(p);return [p.material,p.labor,p.overhead,a.total,p.beginWip,p.endWip,a.completed,a.cogs];}
   case 'standardGrid':{const a=C.standard(p),b=C.overheadVariance(p);return [p.standardPrice*p.standardQty,p.actualPrice*p.actualQty,a.price,a.quantity,b.budget,b.efficiency,b.volume,b.budget+b.efficiency+b.volume];}
   case 'capitalGrid':{const capital=p.capital+p.issue/2,capitalReserve=p.capitalReserve+p.issue/2,legal=p.legalReserve+p.reserve,retained=p.retained+p.profit-p.dividend-p.reserve;return [capital,capitalReserve,legal,retained,capital+capitalReserve+legal+retained];}
   case 'securitiesGrid':{const accrual=(p.face-p.bond)/p.years,diff=p.otherMarket-p.other;return [p.tradingMarket-p.trading,accrual,p.bond+accrual,diff*(1-p.rate),diff*p.rate];}
   case 'branchGrid':{const sales=p.headSales+p.branchSales,cost=p.headExternalCost+p.branchExternalCost,expense=p.headExpense+p.branchExpense;return [sales,cost,sales-cost,expense,sales-cost-expense];}
   case 'cvpGrid':{const a=C.cvp(p);return [p.price-p.variable,a.breakEvenUnits,a.breakEvenSales,a.targetUnits,a.profit,p.units*p.price-a.breakEvenSales];}
   case 'directGrid':{const margin=p.sales-p.variableProduction-p.variableSelling,profit=margin-p.fixed,adj=p.endStockFixed-p.beginStockFixed;return [margin,profit,adj,profit+adj];}
   default:throw Error('未知の計算関数 '+name);
  }
 };
})();
