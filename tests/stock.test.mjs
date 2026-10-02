import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { inspectAlertExecution, findMatchingItems } from '../stock-utils.js';
import sendAlert from '../functions/send_stock_alert/src/main.js';

test('An Appwrite completion does not prove email acceptance', () => {
  for (const execution of [
    {status:'completed',responseStatusCode:500,responseBody:'{"ok":false,"error":{"message":"Resend error"}}'},
    {status:'completed',responseStatusCode:200,responseBody:'{"ok":false}'},
    {status:'completed',responseStatusCode:200,responseBody:'not JSON'},
    {status:'processing'}, {status:'failed'},
    {status:'completed',responseStatusCode:200,responseBody:'{"ok":true}'}
  ]) assert.notEqual(inspectAlertExecution(execution).state, 'accepted');
  assert.equal(inspectAlertExecution({status:'completed',responseStatusCode:200,responseBody:'{"ok":true,"id":"email-1"}'}).state,'accepted');
});

test('Resend rejection details and execution ID survive the UI boundary', () => {
  const result=inspectAlertExecution({$id:'execution-1',status:'completed',responseStatusCode:500,responseBody:JSON.stringify({ok:false,message:'Erreur Resend.',error:{message:'You can only send testing emails to your own email address'}})});
  assert.equal(result.state,'failed'); assert.equal(result.executionId,'execution-1');
  assert.match(result.message,/domaine expéditeur vérifié/);
});

test('Legacy duplicate references require selection; individual QR identifies one document', () => {
  const items=[{$id:'one',itemCode:'M5305',barcodeValue:'M5305'},{$id:'two',itemCode:'M5305',barcodeValue:'M5305'}];
  assert.equal(findMatchingItems(items,' m5305 ').length,2);
  assert.deepEqual(findMatchingItems(items,'BIOID:two'),[items[1]]);
  assert.deepEqual(findMatchingItems(items,'unknown'),[]);
});

test('Function handles provider rejection, accepted send, fixed recipient, test and malformed input', async () => {
  const oldFetch=globalThis.fetch;const oldKey=process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY='test-mocked-key';
  const invoke = body => sendAlert({req:{bodyJson:body},res:{json:(body,status=200)=>({body,status})},log:()=>{},error:()=>{}});
  try {
    globalThis.fetch=async()=>({ok:false,status:403,json:async()=>({message:'You can only send testing emails to your own email address'})});
    const payload={to:'unwanted@example.com',item:{itemCode:'REF',itemName:'<img src=x onerror=alert(1)>'}};
    const failed=await invoke(payload);assert.equal(failed.status,500);assert.equal(failed.body.providerStatus,403);
    let sent;
    globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({id:'accepted-1'})};};
    const success=await invoke(payload);assert.equal(success.body.ok,true);
    assert.deepEqual(sent.to,['biomed-pole2607@ramsaysante.fr']);assert.ok(!sent.html.includes('<img'));
    await invoke({...payload,movementType:'TEST_EMAIL'});assert.match(sent.subject,/Test/);assert.match(sent.text,/Aucun mouvement/);
    assert.equal((await invoke({})).status,400);
    const invalid=await sendAlert({req:{bodyText:'{'},res:{json:(body,status)=>({body,status})},log:()=>{},error:()=>{}});assert.equal(invalid.status,400);
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;}
});

test('Pagination loads beyond 100 and offline snapshot excludes contacts', async () => {
  let source=await readFile(new URL('../index.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\n/gm,'').replace('initStockPage();\ninitGestionPage();','');
  const storage=new Map();let calls=0;
  const all=Array.from({length:201},(_,i)=>({$id:String(i),itemCode:`REF${i}`,itemName:'Item',Email:'private@example.com',unitPrice:99}));
  class Client {setEndpoint(){return this}setProject(){return this}}
  class Databases {async listDocuments(db,col,queries){const start=calls++*100;return {documents:all.slice(start,start+100)}}}
  const context=vm.createContext({Client,Databases,Functions:class{},ID:{},Query:{orderAsc:x=>x,limit:x=>x,cursorAfter:x=>x},navigator:{onLine:true},document:{body:{classList:{toggle(){}}},querySelector(){return null}},localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)},console});
  vm.runInContext(source,context);
  assert.equal((await vm.runInContext('listItems()',context)).length,201);assert.equal(calls,3);
  assert.ok(![...storage.values()][0].includes('private@example.com'));
  assert.ok(![...storage.values()][0].includes('unitPrice'));
  context.navigator.onLine=false;
  assert.equal((await vm.runInContext('listItems()',context)).length,201);
  assert.throws(()=>vm.runInContext('requireOnline()',context),/Connexion/);
});

test('PWA precache includes every local file and application path stays within repository', async () => {
  const manifest=JSON.parse(await readFile(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.start_url,'./index.html');assert.equal(manifest.scope,'./');
  const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  const files=vm.runInNewContext(source.slice(0,source.indexOf('self.addEventListener'))+'LOCAL_FILES');
  for(const file of files) if(file!=='./' && !file.includes('hopital_')) await readFile(new URL('../'+file.split('?')[0],import.meta.url));
});

test('A failed email or history write cannot repeat an already saved stock movement', async () => {
  let source=await readFile(new URL('../index.js',import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'');
  const elements=new Map();
  function element() {return {value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,style:{},classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},replaceChildren(){},append(){},focus(){}};}
  for(const id of ['qrSearch','currentCode','stockNotification','pendingQuantity','startScannerBtn','stopScannerBtn','qrReader','addStockBtn','removeStockBtn','validateStockBtn','retryAlertBtn','alertResult','matchChoices','searchRefBtn','refreshStockBtn','dataStatus'])elements.set('#'+id,element());
  let doc={$id:'item1',itemCode:'REF1',itemName:'Article',stockQuantity:2,alertThreshold:1};let writes=0;let sends=0;
  class Client {setEndpoint(){return this}setProject(){return this}}
  class Databases {async listDocuments(){return {documents:[doc]}}async getDocument(){return {...doc}}async updateDocument(db,col,id,data){writes++;doc={...doc,...data};return doc}async createDocument(){throw new Error('History failure')}}
  class Functions {async createExecution(){sends++;return {status:'completed',responseStatusCode:500,responseBody:'{"ok":false,"message":"RESEND_API_KEY manquante."}'}}}
  const context=vm.createContext({Client,Databases,Functions,ID:{unique:()=> 'id'},Query:{orderAsc:x=>x,limit:x=>x},navigator:{onLine:true},document:{body:{classList:{toggle(){}}},querySelector:id=>elements.get(id)||null},localStorage:{setItem(){},getItem(){return null}},window:{},console,inspectAlertExecution,findMatchingItems,describeAlertError: x=>x});
  vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));
  elements.get('#qrSearch').value='REF1';await elements.get('#startScannerBtn').listeners.click();
  elements.get('#removeStockBtn').listeners.click();
  await elements.get('#validateStockBtn').listeners.click();
  assert.equal(writes,1);assert.equal(doc.stockQuantity,1);assert.equal(sends,1);
  assert.match(elements.get('#stockNotification').textContent,/historique non enregistré/);
  assert.match(elements.get('#alertResult').textContent,/non confirmée/);
  assert.equal(elements.get('#retryAlertBtn').hidden,false);
  await elements.get('#validateStockBtn').listeners.click();assert.equal(writes,1);
});

test('Installation is exclusive to home; all three destinations and one stock table exist', async () => {
  const home=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(home,/id="installAppBtn"/);
  for(const page of ['stock.html','ajouter-consommable.html','gestion-stock.html']) {
    assert.ok(home.includes(`href="${page}"`));
    const html=await readFile(new URL('../'+page,import.meta.url),'utf8');
    assert.ok(!html.includes('id="installAppBtn"'));
    assert.ok(!html.includes('id="installHelp"'));
    assert.ok(html.includes('class="quick-nav"'));
    assert.ok(html.includes('id="backToTopBtn"'));
  }
  const management=await readFile(new URL('../gestion-stock.html',import.meta.url),'utf8');
  assert.equal((management.match(/<table\b/g)||[]).length,1);
  assert.ok(!management.includes('id="showItemsBtn"'));
  assert.match(management,/<dialog id="editDialog"/);
  const stock=await readFile(new URL('../stock.html',import.meta.url),'utf8');
  assert.ok(!stock.includes('id="searchRefBtn"'));
});

test('PWA script works on pages without installation controls', async () => {
  const source=await readFile(new URL('../pwa.js',import.meta.url),'utf8');
  const handlers={};const label={textContent:'',classList:{toggle(){}}};
  const context=vm.createContext({document:{querySelector:id=>id==='#connectionStatus'?label:null,body:{classList:{toggle(){}}}},navigator:{onLine:true},window:{addEventListener:(key,handler)=>handlers[key]=handler,matchMedia:()=>({matches:false})}});
  vm.runInContext(source,context);
  assert.equal(label.textContent,'En ligne');
  handlers.beforeinstallprompt({preventDefault(){}});
  handlers.appinstalled();
  context.navigator.onLine=false;handlers.offline();assert.match(label.textContent,/Hors connexion/);
});

test('PWA upgrades automatically, refreshes stale HTML and keeps each page available offline', async () => {
  const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  const handlers={}; const entries=new Map(); const requests=[]; let offline=false; let skips=0;
  const scope='https://example.test/stock-biomedical/';
  const key = request => typeof request==='string' ? request : request.url;
  const cache={
    async put(request,response){entries.set(key(request),response.clone());},
    async match(request){return entries.get(key(request))?.clone();},
    async addAll(requests){for(const request of requests)await this.put(request,new Response('cdn'));}
  };
  const context=vm.createContext({URL,Request,Response,AbortSignal,Date,
    self:{registration:{scope},location:{origin:'https://example.test'},clients:{claim:async()=>{}},skipWaiting:async()=>{skips++},addEventListener:(type,fn)=>handlers[type]=fn},
    caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},
    fetch:async request=>{requests.push(request);if(offline)throw new Error('offline');return new Response('fresh:'+new URL(request.url).pathname);}
  });
  vm.runInContext(source,context);
  let installation;handlers.install({waitUntil:promise=>installation=promise});await installation;
  assert.equal(skips,1);
  assert.ok([...entries.keys()].every(url=>!url.includes('__pwa')));
  assert.ok(requests.every(request=>request.cache==='reload'));
  const visit=async(path,mode='navigate')=>{
    let result;handlers.fetch({request:{url:new URL(path,scope).href,method:'GET',mode},respondWith:promise=>result=promise});
    return result;
  };
  entries.set(scope+'gestion-stock.html',new Response('obsolete HTML'));
  assert.equal(await (await visit('gestion-stock.html')).text(),'fresh:/stock-biomedical/gestion-stock.html');
  assert.equal(requests.at(-1).cache,'no-store');
  offline=true;
  assert.equal(await (await visit('gestion-stock.html')).text(),'fresh:/stock-biomedical/gestion-stock.html');
  assert.equal(await (await visit('ajouter-consommable.html')).text(),'fresh:/stock-biomedical/ajouter-consommable.html');
  assert.equal(await (await visit('./')).text(),'fresh:/stock-biomedical/index.html');
  // A different asset version must not silently reuse an older cached script.
  await assert.rejects(visit('pwa.js?v=999','cors'),/offline/);
  let intercepted=false;
  handlers.fetch({request:{url:'https://cloud.appwrite.io/v1/databases',method:'GET'},respondWith(){intercepted=true;}});
  assert.equal(intercepted,false);
});

async function loadPwaNotice(storage = new Map(), controlled = true) {
  const source = await readFile(new URL('../pwa.js', import.meta.url), 'utf8');
  const handlers = {}; const timers = new Map(); const nodes = new Map();
  let timerId = 0; let reloads = 0;
  const label = {textContent:'', classList:{toggle(){}}};
  const controller = {postMessage(){}};
  const reg = {waiting:null, installing:null, addEventListener(){}, update:async()=>{}};
  const context = vm.createContext({
    document:{querySelector:id=>id==='#connectionStatus'?label:nodes.get(id)||null,
      createElement:()=>({setAttribute(){},hidden:false}),
      body:{classList:{toggle(){}},append:node=>nodes.set('#'+node.id,node)},
      addEventListener(){},visibilityState:'visible'},
    navigator:{onLine:true,serviceWorker:{controller:controlled?controller:null,register:async()=>reg,addEventListener:(key,fn)=>handlers[key]=fn}},
    window:{addEventListener(){},matchMedia:()=>({matches:false}),setInterval(){},
      setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id)},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    location:{reload(){reloads++}}
  });
  vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));
  return {handlers,timers,nodes,reloads:()=>reloads};
}

test('Update notices disappear after five seconds, do not reload, and do not repeat the same version', async () => {
  const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  const version=/const CACHE = '([^']+)'/.exec(source)[1];
  const ui=await loadPwaNotice(new Map([['biomed-app-version',version]]));
  assert.equal(ui.nodes.size,0);
  ui.handlers.controllerchange();assert.equal(ui.reloads(),0);
  ui.handlers.message({data:{type:'APP_VERSION',version}});assert.equal(ui.nodes.size,0);
  ui.handlers.message({data:{type:'APP_VERSION',version:'biomed-pwa-v999'}});
  const notice=ui.nodes.get('#appUpdateNotice');assert.equal(notice.hidden,false);
  assert.match(notice.textContent,/Mise à jour prête/);
  const timeout=[...ui.timers.values()][0];assert.equal(timeout.delay,5000);timeout.fn();
  assert.equal(notice.hidden,true);
  ui.handlers.message({data:{type:'APP_VERSION',version:'biomed-pwa-v999'}});
  assert.equal(notice.hidden,true);assert.equal(ui.reloads(),0);
});

test('A loaded new version has one transient confirmation; a first installation has none', async () => {
  const storage=new Map([['biomed-app-version','biomed-pwa-v1']]);
  const first=await loadPwaNotice(storage);
  assert.match(first.nodes.get('#appUpdateNotice').textContent,/Application mise à jour/);
  [...first.timers.values()][0].fn();assert.equal(first.nodes.get('#appUpdateNotice').hidden,true);
  assert.equal((await loadPwaNotice(storage)).nodes.size,0);
  assert.equal((await loadPwaNotice(new Map(),false)).nodes.size,0);
});
