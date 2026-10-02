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
