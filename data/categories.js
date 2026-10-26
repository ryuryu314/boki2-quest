/* 問題追加: data/questions.js に固定id/type/cat/q/ans/params/solve/exp/diffを追加。
 * data/titles.js、data/whatif.jsにも同じIDを追加。node --test tests/*.test.jsで検算。
 * tools/make-data.cjs は初期問題の原稿。再生成する場合も既存ID/入力を変えない。
 * scope省略は両範囲共通。数字違いも固定問題として固定IDを割り当てる。 */
window.BK = { Q: [], CATS: [], AMBIENT: ['数字の向こうに、誰かの仕事がある','左右の釣り合いに、小さな宇宙を見る','遠い星の光も、いま帳面に届く','流れをたどれば、残ったものが見える','一つの線が、昨日と明日を結ぶ'] };
BK.CATS = [
 {id:'shoji',name:'商業簿記',icon:'◈',color:'#7850da',kids:[
  {id:'baibai',name:'商品売買・債権',kids:[{id:'goods',name:'売買・棚卸'},{id:'claims',name:'電子債権・貸倒れ'},{id:'notes',name:'手形・小切手',scope:'until-2027-03'},{id:'revenue',name:'収益認識'}]},
  {id:'cash',name:'現預金・経過勘定'}, {id:'securities',name:'有価証券'},
  {id:'assets',name:'固定資産',kids:[{id:'tangible',name:'取得・償却・売却'},{id:'intangible',name:'無形資産・研究開発'},{id:'lease',name:'リース'}]},
  {id:'provision',name:'引当金・保証'}, {id:'foreign',name:'外貨建取引'}, {id:'capital',name:'株式会社会計'}, {id:'tax',name:'税金・税効果'}, {id:'branch',name:'本支店会計'}, {id:'consolidation',name:'連結会計'}, {id:'closing',name:'決算・財務諸表'}
 ]},
 {id:'kogyo',name:'工業簿記',icon:'⚙',color:'#15977c',kids:[
  {id:'elements',name:'原価の基礎・費目別'}, {id:'overhead',name:'製造間接費'}, {id:'department',name:'部門別原価計算'}, {id:'job',name:'個別原価計算'},
  {id:'process',name:'総合原価計算',kids:[{id:'average',name:'平均法・修正FIFO'},{id:'loss',name:'正常仕損・減損'},{id:'types',name:'工程別・等級別・組別'}]},
  {id:'standard',name:'標準原価・差異'}, {id:'cvp',name:'直接原価・CVP'}, {id:'factory',name:'製造報告・工場独立'}
 ]}
];
BK.nodes=Object.create(null);
(function walk(ns,parent=''){ns.forEach(n=>{n.path=parent?parent+'/'+n.id:n.id; BK.nodes[n.path]=n;if(n.kids)walk(n.kids,n.path);});})(BK.CATS);
BK.inScope=(q,scope)=>!q.scope || q.scope===(scope==='future'?'from-2027-04':'until-2027-03');
