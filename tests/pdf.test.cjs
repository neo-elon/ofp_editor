const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const lib=require('pdf-lib');
const pdfjs=require('pdfjs-dist/build/pdf.js');
// Browser worker/assets use CDN URLs; Node uses the same pinned files installed locally.
const browserPdfjs={GlobalWorkerOptions:{},getDocument(options){
 assert.equal(options.isEvalSupported,false);
 return pdfjs.getDocument({...options,cMapUrl:path.join(__dirname,'../node_modules/pdfjs-dist/cmaps/'),standardFontDataUrl:path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts/')});
}};
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

// Execute the exact shipped inline app with a minimal DOM and capture the download.
function app(pdfjsLib=browserPdfjs){
 const elements={};let blob,download;
 const element=()=>({style:{},classList:{add(){},remove(){}},click(){},remove(){}});
 const document={getElementById(id){return elements[id]??=element()},body:{appendChild(){}},createElement(){const a=element();a.click=()=>{download=a.download};return a}};
 const URL={createObjectURL(b){blob=b;return 'blob:test'},revokeObjectURL(){}};
 const exports='return {readOutline,readLines,mapPages,findCFP,validPage,parseCFP,parseATS,compare,drawRoute,addBookmarks,run};';
 const api=new Function('document','window','URL','setTimeout',script.replace(/\}\)\(\);\s*$/,exports+'})();').replace('(function(){','return (function(){'))(document,{pdfjsLib,PDFLib:lib},URL,()=>{});
 return {api,elements,get blob(){return blob},get download(){return download}};
}
const cfpLines=['CFP PLAN 1234','FLIGHT RELEASE KAL123 RKSI/RJAA ON 15/NOV/26','DISC 42','ETD RKSI 0100Z ETA RJAA 0300Z','2ND-$','RKSI DCT ABC A1 DEF DCT RJAA','DIST LATITUDE'];
const atsLines=['(FPL-KAL123-IS','-N0450F350 ABC A1 DEF','-RJAA0200'];

async function fixture({mismatch=false,lastATS=false,malformedCmap=false}={}){
 const doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 for(let i=0;i<7;i++)doc.addPage([595,842]);
 const write=(i,lines)=>lines.forEach((s,j)=>doc.getPage(i).drawText(s,{x:30,y:760-j*16,size:10,font}));
 write(0,cfpLines);write(lastATS?6:3,mismatch?atsLines.map(s=>s.replace('DEF','XYZ')):atsLines);
 write(2,['WEATHER BRIEFING']);write(1,['w i n t e m 1']);write(4,['c r o s s']);write(5,['KOREAN AIR NOTAM PACKAGE 1']);
 // A seven-page PDF carrying a leftover destination for page index 58.
 const ctx=doc.context,N=lib.PDFName,root=ctx.obj({Type:'Outlines',Count:2}),rootRef=ctx.register(root);
 const first=ctx.obj({Title:lib.PDFHexString.fromText('FlightPlan'),Parent:rootRef,Dest:[58,N.of('Fit')]}),firstRef=ctx.register(first);
 const second=ctx.obj({Title:lib.PDFHexString.fromText('OceanicTracks'),Parent:rootRef,Dest:[doc.getPage(6).ref,N.of('Fit')],Prev:firstRef}),secondRef=ctx.register(second);
 first.set(N.of('Next'),secondRef);root.set(N.of('First'),firstRef);root.set(N.of('Last'),secondRef);doc.catalog.set(N.of('Outlines'),rootRef);
 if(malformedCmap){
  await font.embed();
  const broken=ctx.flateStream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 beginbfchar /bad <0041> endbfchar endcmap end end');
  ctx.lookup(font.ref).set(N.of('ToUnicode'),ctx.register(broken));
 }
 return doc.save({useObjectStreams:false});
}
function file(bytes){return {name:'input.pdf',type:'application/pdf',arrayBuffer:async()=>Uint8Array.from(bytes).buffer}}
async function inspect(bytes,fn){
 const task=browserPdfjs.getDocument({data:Uint8Array.from(bytes),isEvalSupported:false});
 try{return await fn(await task.promise)}finally{await task.destroy()}
}

test('outline handles zero, named/ref destinations, invalid indices and broken outline',async()=>{
 const {api}=app();const resolved=[];
 const found=await api.readOutline({numPages:7,getOutline:async()=>[
  {title:'zero',dest:[0]}, {title:'named',dest:'named'}, {title:'ref',dest:[{num:20,gen:0}]},
  ...[58,-1,7,1.5].map((n)=>({title:'bad'+n,dest:[n]})),
  {title:'parent',items:[{title:'nested',dest:[6]}]}
 ],getDestination:async()=>[0],getPageIndex:async ref=>{resolved.push(ref);return ref.num===20?2:58}});
 assert.equal(found.zero,0);assert.equal(found.named,0);assert.equal(found.ref,2);assert.equal(found.nested,6);
 assert.equal(Object.keys(found).length,4);assert.equal(resolved.length,2);
 assert.deepEqual(Object.keys(await api.readOutline({getOutline:async()=>{throw Error('broken')}})),[]);
});

test('CFP discovery ignores stale and wrong-page bookmarks, including first page',()=>{
 const {api}=app();
 assert.equal(api.findCFP({0:cfpLines,1:['cover']},58).page,0);
 assert.equal(api.findCFP({0:cfpLines,1:['cover']},1).page,0);
 assert.throws(()=>api.findCFP({0:['unreadable text']},0),/텍스트 추출/);
});

test('page identity mapping handles different parser order; rejects missing/duplicate pages',async()=>{
 const {api}=app(),doc=await lib.PDFDocument.create();doc.addPage();doc.addPage();
 const pages=doc.getPages(),ref=i=>({num:pages[i].ref.objectNumber,gen:pages[i].ref.generationNumber});
 assert.deepEqual(await api.mapPages({numPages:2,getPage:async n=>({ref:ref(2-n)})},doc),[1,0]);
 await assert.rejects(api.mapPages({numPages:59},doc),/페이지 구조가 일치하지/);
 await assert.rejects(api.mapPages({numPages:2,getPage:async()=>({ref:ref(0)})},doc),/참조가 일치하지/);
 await assert.rejects(api.readLines({numPages:7,getPage(){throw Error('should not read')}},58),/페이지 범위/);
});

test('route comparison, Checked position and mismatch red underline remain intact',()=>{
 const {api}=app(),cfp=api.parseCFP(cfpLines),ats=api.parseATS(atsLines,cfp.dest);
 const good=api.compare(cfp.route,ats,cfp.origin,cfp.dest);assert.equal(good.match,true);
 const font={widthOfTextAtSize:s=>s.length*5},texts=[],lines=[];
 const page={getHeight:()=>842,getWidth:()=>595,drawText:(s,opts)=>texts.push({s,...opts}),drawLine:opts=>lines.push(opts)};
 api.drawRoute(page,cfp.route,good,font,lib);
 assert.equal(texts.at(-1).s,'(Checked)');assert.ok(texts.at(-2).s.endsWith('RJAA'));assert.ok(texts.at(-1).x>texts.at(-2).x);
 texts.length=0;
 const bad=api.compare(cfp.route,ats.replace('DEF','XYZ'),cfp.origin,cfp.dest);assert.equal(bad.match,false);
 api.drawRoute(page,cfp.route,bad,font,lib);assert.ok(lines.length>0);assert.equal(lines[0].color.red,.85);
 assert.ok(!texts.some(t=>t.s==='(Checked)'));
});

test('real PDF libraries: stale index 58 on seven-page PDF, save/reopen, annotations/bookmarks/filename',async()=>{
 const bytes=await fixture(),original=Uint8Array.from(bytes),ui=app();
 await ui.api.run(file(bytes));assert.ok(ui.blob,ui.elements.status.textContent);
 assert.equal(ui.download,'1234 KAL123 RKSI-RJAA 15 Nov 2026.pdf');assert.deepEqual(bytes,original);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  assert.equal(read.numPages,7);
  const text=async i=>(await read.getPage(i+1)).getTextContent().then(c=>c.items.map(t=>t.str).join(' '));
  assert.match(await text(3),/RJAA\s*\(Checked\)/);assert.match(await text(5),/DISC 42/);
  assert.match(await text(2),/ETD RKSI 0100Z ETA RJAA 0300Z/);
  const outline=await ui.api.readOutline(read);
  for(const [title,index] of Object.entries({FlightPlan:0,'ATS FLIGHT PLAN':3,Header:4,'Weather Briefing':2,'Weather Charts':1,'Cross Chart':4,'Notam 1':5,OceanicTracks:6}))assert.equal(outline[title],index,title);
 });
 assert.equal(ui.elements.choose.disabled,false);
});

test('ATS on final page: no out-of-range Header or DISC and no Checked on mismatch',async()=>{
 const ui=app();await ui.api.run(file(await fixture({mismatch:true,lastATS:true})));
 assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  const outline=await ui.api.readOutline(read);assert.equal(outline.Header,undefined);assert.equal(outline['ATS FLIGHT PLAN'],6);
  const text=(await (await read.getPage(7)).getTextContent()).items.map(t=>t.str).join(' ');assert.ok(!text.includes('(Checked)'));
 });
});

test('incompatible parser page counts stop before writing/downloading and release worker',async()=>{
 let destroyed=false;const ui=app({GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:59,getOutline:async()=>null}),destroy:async()=>{destroyed=true}})});
 await ui.api.run(file(await fixture()));assert.equal(ui.blob,undefined);assert.match(ui.elements.status.textContent,/PDF.js 59 \/ pdf-lib 7/);assert.equal(destroyed,true);
});

test('malformed embedded CMap warning is recoverable when font encoding still yields valid OFP text',async()=>{
 const ui=app();await ui.api.run(file(await fixture({malformedCmap:true})));
 assert.ok(ui.blob,ui.elements.status.textContent);assert.equal(ui.download,'1234 KAL123 RKSI-RJAA 15 Nov 2026.pdf');
});

test('concurrent drops cannot start a second PDF job',async()=>{
 const ui=app();let release,reads=0;
 const pending=new Promise(resolve=>{release=resolve});
 const first=ui.api.run({name:'one.pdf',arrayBuffer:async()=>{reads++;return pending}});
 await ui.api.run({name:'two.pdf',arrayBuffer:async()=>{reads++;throw Error('second job started')}});
 assert.equal(reads,1);release(Uint8Array.from(await fixture()).buffer);await first;
 assert.ok(ui.blob,ui.elements.status.textContent);
});
