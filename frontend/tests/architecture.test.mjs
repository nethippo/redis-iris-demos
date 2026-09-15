import test from 'node:test';
import assert from 'node:assert/strict';
import { architectureEvent, buildSpans, project, redisAccess } from '../src/architecture.ts';

test('parallel calls with the same name retain their own terminal events', () => {
  const events=[];
  for(const ev of [
    {type:'tool-call',callId:'a',toolName:'filter_bet',ts:10},
    {type:'tool-call',callId:'b',toolName:'filter_bet',ts:20},
    {type:'tool-result',callId:'a',toolName:'filter_bet',ts:30},
    {type:'tool-result',callId:'b',toolName:'filter_bet',ts:50},
  ]) events.push(architectureEvent({...ev,toolKind:'mcp_tool'},events));
  const spans=buildSpans(events,true);
  assert.deepEqual(spans.map(s=>[s.id,s.start,s.end,s.status]),[['a',10,30,'success'],['b',20,50,'success']]);
});
test('cache hit does not invent a model call or memory operation', () => {
  const events=[];
  for(const type of ['tool-call','tool-result'])events.push(architectureEvent({type,toolName:'semantic_cache_search',toolKind:'langcache',payload:{hit:true},ts:100},events));
  const spans=buildSpans(events,true);
  assert.equal(spans.length,1);assert.equal(spans[0].to,'cache');assert.equal(spans[0].outcome,'Cache hit');
});
test('telemetry contains metadata only, never tool payloads',()=>{
  const e=architectureEvent({type:'tool-result',toolName:'filter_bet',toolKind:'mcp_tool',payload:{secret:'do-not-render',query:'private-message'}},[]);
  assert.ok(!JSON.stringify(e).includes('do-not-render'));assert.ok(!JSON.stringify(e).includes('private-message'));
});
test('remember demo stub is local, not a successful managed memory write',()=>{
  const e=architectureEvent({type:'tool-result',toolName:'remember_customer_detail',toolKind:'memory',payload:{demo_blocked:true}},[]);
  assert.equal(e.to,'agent');assert.equal(e.outcome,'Simulated tool');
});
test('failed and unfinished operations never show successful completion',()=>{
  const events=[{id:'a',from:'agent',to:'openai',label:'Chat model',phase:'start',ts:1}];
  assert.equal(buildSpans(events,true)[0].status,'interrupted');
  assert.equal(buildSpans([...events,{...events[0],phase:'error',ts:2}],true)[0].status,'error');
  assert.equal(buildSpans(events,false)[0].status,'running');
});
test('3D camera rotation changes projection without nonfinite coordinates',()=>{
  const a=project([200,40,-100],700,420,0,.6,1);
  const b=project([200,40,-100],700,420,.6,.6,1);
  assert.notEqual(a.x,b.x);assert.notEqual(a.depth,b.depth);assert.ok(Object.values(b).every(Number.isFinite));
});

test('Redis access requires SDK events; MCP activity stays linked and separate',()=>{
  const spans=buildSpans([
    {id:'route-api',from:'api',to:'router',label:'guardrail_check',phase:'end',ts:10},
    {id:'route-redis',from:'router',to:'redis',label:'Route vector search',phase:'end',ts:9,durationMs:4},
    {id:'checkpoint',from:'agent',to:'redis',label:'Read checkpoint',phase:'error',ts:30},
    {id:'mcp',from:'agent',to:'retriever',label:'filter_bet',phase:'start',ts:20},
    {id:'cache',from:'api',to:'cache',label:'semantic_cache_search',phase:'end',ts:14},
  ]);
  const [router,agent,retriever]=redisAccess(spans);
  assert.equal(router.calls.length,1);
  assert.equal(agent.status,'error');
  assert.equal(retriever.status,'running');
  assert.equal(retriever.linked,true);
  assert.equal(spans.filter(s=>s.to==='redis').length,2);
  assert.ok(redisAccess([]).every(a=>a.status==='idle'&&a.calls.length===0));
});
test('concurrent Redis operations remain active until every call terminates',()=>{
  const make=(id,phase,ts)=>({id,from:'agent',to:'redis',label:'Write checkpoint',phase,ts});
  const events=[make('a','start',0),make('b','start',1),make('b','end',2)];
  assert.equal(redisAccess(buildSpans(events))[1].status,'running');
  assert.equal(redisAccess(buildSpans(events,true))[1].calls[0].status,'interrupted');
});
