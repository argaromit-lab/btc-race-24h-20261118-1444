// Development-only swing audit. Runtime main.ts imports no verifier or data file.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';

const root=new URL('./',import.meta.url);
const source=readFileSync(new URL('main.ts',root),'utf8');
const shared=readFileSync(new URL('verify.mjs',root),'utf8');
const common=shared.slice(shared.indexOf('const source ='),shared.indexOf('// Reproduce an earlier'))
  .replace("const source = readFileSync(new URL('main.ts', root), 'utf8');",'')
  .replace("assert.equal(qty, 0n, 'strategy must not pyramid');",'');
const factory=new Function('source','root','assert','readFileSync','stripTypeScriptTypes','vm','gunzipSync','createHash',common+'\nreturn {simulate,originalBars,helloTemplate};');
const{simulate,originalBars:bars,helloTemplate}=factory(source,root,assert,readFileSync,stripTypeScriptTypes,vm,gunzipSync,createHash);
const reference=JSON.parse(readFileSync(new URL('local-grade-swing/result.json',root),'utf8'));
const log=JSON.parse(readFileSync(new URL('local-grade-swing/action-log.json',root),'utf8'));
const full=simulate(bars,{capture:true});
assert.equal(Math.round(full.pnl*1e6).toString(),reference.performance.metrics.net_pnl_quote_units);
assert.deepEqual(full.replies,log.replies,'Exact official order parity failed');
assert.equal(full.wire,simulate(bars).wire,'Repeat order bytes differ');
for(const cut of [64,240,480,1000]){
  const changed=structuredClone(bars);
  for(let i=cut;i<changed.length;i++)for(const field of ['o','h','l','c'])changed[i][field]=(BigInt(changed[i][field])*2n).toString();
  assert.deepEqual(full.replies.slice(0,cut),simulate(changed).replies.slice(0,cut),'Future suffix changed earlier orders');
}
assert.equal(full.wire,simulate(bars.map(bar=>({...bar,t:bar.t+10*86400000}))).wire,'Timestamp shift changed orders');
let maximumNormalImpact=0,scaleIns=0,partialExits=0;
for(const reply of full.replies){
  const batch=full.inputs[reply.seq+1];
  const next=full.inputs[reply.seq+2];
  for(const order of reply.orders){
    const held=batch.account.positions.find(p=>p.symbol==='CBBTC');
    if(order.side==='buy'){
      const heldValue=held?BigInt(held.qty)*BigInt(bars[reply.seq].c)*1000000n/10000000000000n:0n;
      const target=BigInt(batch.account.equity_quote_units)*9000n/10000n;
      assert(heldValue+BigInt(order.notional_quote_units)<=target,'Build exceeded target room');
      if(held){assert(heldValue>=BigInt(held.cost_quote_units),'Added to a losing position');scaleIns++;}
    }else if(held&&BigInt(order.qty)<BigInt(held.qty))partialExits++;
    const filled=next?.fills?.find(f=>f.client_id===order.client_id&&f.status==='filled');
    if(!filled||order.max_slippage_bps>=10000)continue;
    const at=bars[reply.seq+1];
    const amount=order.side==='buy'?BigInt(order.notional_quote_units)*9996n/10000n:BigInt(order.qty)*BigInt(at.o)*1000000n/10000000000000n;
    const impact=Number(amount)*at.o_depth.reduce((sum,raw)=>sum+1/Number(raw),0)*10000;
    maximumNormalImpact=Math.max(maximumNormalImpact,impact);
  }
}
assert(maximumNormalImpact<5,'Observed normal fill exceeded 5 bps impact');
const native=spawnSync(process.execPath,['main.ts'],{cwd:root,input:full.inputs.map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',maxBuffer:10000000,timeout:30000});
assert.equal(native.status,0,native.stderr);assert.equal(native.stdout,full.wire);
const bad={type:'batch',seq:0,t:bars[0].t,bars:[{...bars[0],t:bars[0].t+60000}],fills:[],account:{cash_quote_units:'1000000000',equity_quote_units:'1000000000',positions:[]}};
const malformed=spawnSync(process.execPath,['main.ts'],{cwd:root,input:[helloTemplate,bad,{type:'done',seq:1,reason:'end_of_data',account:bad.account}].map(m=>JSON.stringify(m)).join('\n')+'\n',encoding:'utf8',timeout:30000});
assert.notEqual(malformed.status,0,'Future-dated input accepted');
const summarize=r=>({pnl:r.pnl,returnPct:r.returnPct,maxDrawdownPct:r.maxDrawdownPct,trades:r.trades,fees:r.fees,rejected:r.rejected,utilization:r.utilization});
const folds=[];
for(let from=0;from<1440;from+=240){const begin=Math.max(0,from-120);folds.push({from,to:from+239,...summarize(simulate(bars.slice(begin,from+240),{warmup:from-begin}))});}
const report={schema:'cb-btc-swing-audit/v1',node:process.version,officialOrderParity:true,deterministic:true,prefixCausal:true,timestampShiftInvariant:true,nativeOutputParity:true,futureInputRejected:true,scalingVerified:scaleIns,partialExitsVerified:partialExits,maximumNormalFillImpactBps:maximumNormalImpact,dev:summarize(full),folds,conditionalMergeThresholdMet:full.pnl>15&&full.maxDrawdownPct<=12,interpretation:'A correctness and historical diagnostic report, not a guarantee of future profit. The main branch may change only if the official full dev score and pre-submit check meet the user\'s conditions.'};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--save'))writeFileSync(new URL('audit/swing-validation.json',root),JSON.stringify(report,null,2)+'\n');
