const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const lib=require('pdf-lib');
const pdfjs=require('pdfjs-dist/build/pdf.js');
const safety=require('../pdf-safety.js');
const {createCanvas,DOMMatrix,Path2D}=require('@napi-rs/canvas');
globalThis.DOMMatrix=DOMMatrix;globalThis.Path2D=Path2D;
class CanvasFactory{
 create(width,height){const canvas=createCanvas(width,height);return {canvas,context:canvas.getContext('2d')}}
 reset(target,width,height){target.canvas.width=width;target.canvas.height=height}
 destroy(target){target.canvas.width=0;target.canvas.height=0}
}
// Browser worker/assets use CDN URLs; Node uses the same pinned files installed locally.
const browserPdfjs={GlobalWorkerOptions:{},getDocument(options){
 assert.equal(options.isEvalSupported,false);
 return pdfjs.getDocument({...options,CanvasFactory,cMapUrl:path.join(__dirname,'../node_modules/pdfjs-dist/cmaps/'),standardFontDataUrl:path.join(__dirname,'../node_modules/pdfjs-dist/standard_fonts/')});
}};
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

// Execute the exact shipped inline app with a minimal DOM and capture the download.
function app(pdfjsLib=browserPdfjs,safetyLib=safety){
 const elements={};let blob,download;
 const element=()=>({style:{},classList:{add(){},remove(){}},click(){},remove(){}});
 const document={getElementById(id){return elements[id]??=element()},body:{appendChild(){}},createElement(tag){if(tag==='canvas')return createCanvas(1,1);const a=element();a.click=()=>{download=a.download};return a}};
 const URL={createObjectURL(b){blob=b;return 'blob:test'},revokeObjectURL(){}};
 const exports='return {readOutline,readLines,mapPages,findCFP,validPage,parseCFP,parseATS,compare,drawRoute,addBookmarks,run};';
 const api=new Function('document','window','URL','setTimeout',script.replace(/\}\)\(\);\s*$/,exports+'})();').replace('(function(){','return (function(){'))(document,{pdfjsLib,PDFLib:lib,OFPSafety:safetyLib},URL,()=>{});
 return {api,elements,document,get blob(){return blob},get download(){return download}};
}
const cfpLines=['CFP PLAN 1234','FLIGHT RELEASE KAL123 RKSI/RJAA ON 15/NOV/26','DISC 42','ETD RKSI 0100Z ETA RJAA 0300Z','2ND-$','RKSI DCT ABC A1 DEF DCT RJAA','DIST LATITUDE'];
const atsLines=['(FPL-KAL123-IS','-N0450F350 ABC A1 DEF','-RJAA0200'];

async function fixture({mismatch=false,lastATS=false,malformedCmap=false,pages=7,atsIndex=3,staleObjectStream=false}={}){
 const doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 for(let i=0;i<pages;i++){const p=doc.addPage([595,842]);p.drawText('ORIGINAL PAGE '+(i+1),{x:30,y:400,size:10,font})}
 const write=(i,lines)=>lines.forEach((s,j)=>doc.getPage(i).drawText(s,{x:30,y:760-j*16,size:10,font}));
 write(0,cfpLines);write(lastATS?pages-1:atsIndex,mismatch?atsLines.map(s=>s.replace('DEF','XYZ')):atsLines);
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
 const saved=await doc.save({useObjectStreams:false});
 if(!staleObjectStream)return saved;
 // Active xref still points to the 61-page tree. An inactive ObjStm contains an old
 // seven-page version of that same ref: a sequential scanner must not overwrite it.
 const treeRef=doc.catalog.get(N.of('Pages')),objectNumber=ctx.largestObjectNumber+1;
 const header=Buffer.from(treeRef.objectNumber+' 0 '),oldTree=Buffer.from('<< /Type /Pages /Count 7 /Kids ['+doc.getPages().slice(0,7).map(p=>String(p.ref)).join(' ')+'] >>');
 const payload=Buffer.concat([header,oldTree]);
 const object=Buffer.concat([Buffer.from('\n'+objectNumber+' 0 obj\n<< /Type /ObjStm /N 1 /First '+header.length+' /Length '+payload.length+' >>\nstream\n'),payload,Buffer.from('\nendstream\nendobj\n')]);
 const previous=Number(Buffer.from(saved).toString('latin1').match(/startxref\s+(\d+)\s+%%EOF\s*$/)[1]);
 const tail='xref\n'+objectNumber+' 1\n'+String(saved.length+1).padStart(10,'0')+' 00000 n \ntrailer\n<< /Size '+(objectNumber+1)+' /Root '+String(ctx.trailerInfo.Root)+' /Prev '+previous+' >>\nstartxref\n'+(saved.length+object.length)+'\n%%EOF\n';
 return new Uint8Array(Buffer.concat([Buffer.from(saved),object,Buffer.from(tail)]));
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
 let destroyed=false;const ui=app({GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:59,getOutline:async()=>null}),destroy:async()=>{destroyed=true}})},{...safety,normalize:async()=>{throw Error('PDF.js 59 / pdf-lib 7: QPDF unavailable')}});
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

async function normalize(bytes){
 const createQpdf=require('../vendor/qpdf/qpdf.js');
 const qpdf=await createQpdf({noInitialRun:true,locateFile:()=>path.join(__dirname,'../vendor/qpdf/qpdf.wasm')});
 return safety.normalizeWithModule(qpdf,bytes);
}

test('61 vs 7 reproduced: inactive object stream overwrites pdf-lib tree; QPDF preserves active xref',async()=>{
 const bytes=await fixture({pages:61,atsIndex:58,staleObjectStream:true});
 const broken=await lib.PDFDocument.load(bytes);assert.equal(broken.getPageCount(),7);
 await inspect(bytes,async read=>{
  assert.equal(read.numPages,61);
  const diagnostic=await safety.diagnose(read,broken,bytes,lib);
  assert.equal(diagnostic.missingRefs.length,54);assert.equal(diagnostic.pageLeafObjects,61);assert.ok(diagnostic.syntaxHints.prev>=1);
 });
 const repaired=await normalize(bytes);assert.equal((await lib.PDFDocument.load(repaired)).getPageCount(),61);
 await inspect(bytes,async before=>inspect(repaired,async after=>{
  const report=await safety.verify(before,after,{document:app().document});assert.equal(report.pages,61);
 }));
 const ui=app(browserPdfjs,{...safety,normalize});await ui.api.run(file(bytes));
 assert.ok(ui.blob,ui.elements.status.textContent);assert.match(ui.elements.status.textContent,/61 → 61 \(QPDF 정상화\)/);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  assert.equal(read.numPages,61);
  for(const [page,text] of [[59,'(Checked)'],[61,'DISC 42'],[3,'ETD RKSI 0100Z ETA RJAA 0300Z']]){
   const items=(await (await read.getPage(page)).getTextContent()).items;
   assert.ok(items.some(item=>item.str===text),text+' on page '+page);
  }
  const outline=await ui.api.readOutline(read);assert.equal(outline['ATS FLIGHT PLAN'],58);assert.equal(outline.Header,59);
 });
});

test('verification blocks page loss, reorder, original text changes, and graphic-only changes',async()=>{
 const bytes=await fixture(),document=app().document;
 await inspect(bytes,async before=>{
  await assert.rejects(safety.verify(before,{numPages:6},{document}),/원본 7 \/ 결과 6/);
  const reordered=await lib.PDFDocument.load(bytes),kids=reordered.catalog.Pages().Kids();
  const first=kids.get(0);kids.set(0,kids.get(1));kids.set(1,first);
  await inspect(await reordered.save({useObjectStreams:false}),async after=>{
   await assert.rejects(safety.verify(before,after,{document}),/텍스트 또는 위치/);
  });
  const changed=await lib.PDFDocument.load(bytes);changed.getPage(0).drawRectangle({x:300,y:300,width:20,height:20,color:lib.rgb(1,0,0)});
  await inspect(await changed.save({useObjectStreams:false}),async after=>{
   await assert.rejects(safety.verify(before,after,{document}),/표시 영역 밖/);
  });
 });
});

test('verification blocks drawing over original content and wrong annotation locations',async()=>{
 const bytes=await fixture(),document=app().document;
 const changed=await lib.PDFDocument.load(bytes),font=await changed.embedFont(lib.StandardFonts.Helvetica),edits=[];
 safety.recordPage(changed.getPage(0),0,edits,[0,0,595,842]).drawText('OVERLAP',{x:30,y:400,size:10,font,color:lib.rgb(0,0,1)});
 await inspect(bytes,async before=>inspect(await changed.save({useObjectStreams:false}),async after=>{
  await assert.rejects(safety.verify(before,after,{document,edits}),/기존 내용/);
  edits[0].x=200;
  await assert.rejects(safety.verify(before,after,{document,edits}),/표시 위치가 다릅니다/);
 }));
});

test('QPDF warnings are blocking and vendored binaries match the pinned package',()=>{
 assert.throws(()=>safety.normalizeWithModule({FS:{writeFile(){}},callMain:()=>3},new Uint8Array()),/경고 또는 오류/);
 for(const name of ['qpdf.js','qpdf.wasm'])assert.deepEqual(fs.readFileSync(path.join(__dirname,'../vendor/qpdf',name)),fs.readFileSync(require.resolve('@neslinesli93/qpdf-wasm/dist/'+name)));
});

test('download gate rejects incomplete normalization and a failed final verification',async()=>{
 const ui=app(browserPdfjs,{...safety,normalize:()=>fixture()});
 await ui.api.run(file(await fixture({pages:61,atsIndex:58,staleObjectStream:true})));
 assert.equal(ui.blob,undefined);assert.match(ui.elements.status.textContent,/원본 61 \/ 결과 7/);
 const final=app(browserPdfjs,{...safety,verify:async()=>{throw Error('forced verification failure')}});
 await final.api.run(file(await fixture()));assert.equal(final.blob,undefined);assert.match(final.elements.status.textContent,/forced verification failure/);
});

test('shipped worker executes browser WASM path and only fetches its static WASM asset',async()=>{
 const vm=require('node:vm'),requests=[];let result;
 const context=vm.createContext({console:{log(){},error(){}},URL,TextEncoder,TextDecoder,WebAssembly,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,WorkerGlobalScope:function(){},
  fetch:async url=>{
   requests.push(String(url));assert.equal(String(url),'https://local.test/vendor/qpdf/qpdf.wasm');
   return new Response(fs.readFileSync(path.join(__dirname,'../vendor/qpdf/qpdf.wasm')),{headers:{'Content-Type':'application/wasm'}});
  },self:{location:{href:'https://local.test/qpdf-worker.js'},postMessage:message=>{result=message}}
 });
 context.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context));
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../qpdf-worker.js'),'utf8'),context);
 await context.self.onmessage({data:{bytes:await fixture({pages:61,staleObjectStream:true})}});
 assert.ok(!result.error,result.error);assert.equal((await lib.PDFDocument.load(Uint8Array.from(result.bytes))).getPageCount(),61);
 assert.deepEqual(requests,['https://local.test/vendor/qpdf/qpdf.wasm']);
});
