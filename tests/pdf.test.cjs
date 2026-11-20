const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {app,browserPdfjs,inspect,normalize,lib,safety}=require('./app-harness.cjs');
const cfpLines=['CFP PLAN 1234','FLIGHT RELEASE KAL123 RKSI/RJAA ON 15/NOV/26','DISC 42','ETD RKSI 0100Z ETA RJAA 0300Z','2ND-$','RKSI DCT ABC A1 DEF DCT RJAA','DIST LATITUDE'];
const atsLines=['(FPL-KAL123-IS','-N0450F350 ABC A1 DEF','-RJAA0200'];

async function fixture({mismatch=false,lastATS=false,malformedCmap=false,pages=7,atsIndex=3,staleObjectStream=false,longRoute=false,routeWords=55,blockedMargin=false,discPageIndex=atsIndex+2}={}){
 const doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 for(let i=0;i<pages;i++){const p=doc.addPage([595,842]);p.drawText('ORIGINAL PAGE '+(i+1),{x:30,y:400,size:10,font})}
 const write=(i,lines)=>lines.forEach((s,j)=>doc.getPage(i).drawText(s,{x:30,y:760-j*16,size:10,font}));
 const route=Array(routeWords).fill('ABCDE').join(' ');
 const split=s=>s.split(' ').reduce((lines,word,i)=>{if(i%12===0)lines.push([]);lines.at(-1).push(word);return lines},[]).map(words=>words.join(' '));
 write(0,longRoute?[...cfpLines.slice(0,5),...split('RKSI '+route+' RJAA'),cfpLines[6]]:cfpLines);
 write(lastATS?pages-1:atsIndex,longRoute?[atsLines[0],...split('-N0450F350 '+(mismatch?route.replace('ABCDE','XYZ'):route)),atsLines[2]]:mismatch?atsLines.map(s=>s.replace('DEF','XYZ')):atsLines);
 if(longRoute)doc.getPage(atsIndex).drawText('ORIGINAL BLACK HEADER',{x:25,y:775,size:10,font});
 if(blockedMargin)doc.getPage(atsIndex).drawRectangle({x:0,y:772,width:595,height:70,color:lib.rgb(0,0,0)});
 write(2,['WEATHER BRIEFING']);write(1,['w i n t e m 1']);write(4,['c r o s s']);write(5,['KOREAN AIR NOTAM PACKAGE 1']);
 if(!lastATS&&discPageIndex<pages)doc.getPage(discPageIndex).drawText('- DISC FUEL DUE TO WEATHER',{x:45,y:180,size:10,font});
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

test('browser safety asset URL tracks its content and exports the required whitespace API',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const src=html.match(/<script src="(pdf-safety\.js\?v=[a-f0-9]+)"><\/script>/)[1];
 const url=new URL(src,'https://local.test/ofp_editor/');
 const source=fs.readFileSync(path.join(__dirname,'..',path.basename(url.pathname)),'utf8');
 // Git may check out CRLF on Windows; use canonical LF content on every platform.
 assert.equal(url.searchParams.get('v'),require('node:crypto').createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex').slice(0,16));
 const context=require('node:vm').createContext({});
 require('node:vm').runInContext(source,context);
 assert.equal(typeof context.OFPSafety.whitespace,'function');
});

test('stale safety asset stops before reading the PDF and shows a refresh instruction',async()=>{
 let reads=0;
 const ui=app(browserPdfjs,{...safety,whitespace:undefined});
 await ui.api.run({name:'input.pdf',type:'application/pdf',arrayBuffer:async()=>{reads++;throw Error('must not read')}});
 assert.equal(reads,0);assert.equal(ui.blob,undefined);
 assert.match(ui.elements.status.textContent,/모듈 버전이 일치하지 않습니다/);
 assert.match(ui.elements.status.textContent,/새로고침/);
 assert.equal(ui.elements.choose.disabled,false);
});


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

test('DISC follows the complete matching row, including split text items and trailing reason',async()=>{
 const {api}=app(),doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 const item=(str,x,y,width)=>({str,width,transform:[10,0,0,10,x,y]});
 const items=[item('WEATHER',160,310,60),item('OTHER ROW',400,280,80),item('DISC',40,310,25),item('FUEL DUE TO',70,310,80)];
 const page={view:[0,0,595,842],getTextContent:async()=>({items})};
 const layout=await api.discLayout(page,'DISC 42',font);
 assert.equal(layout.x,230);assert.equal(layout.y,310);assert.equal(layout.size,10);
 await assert.rejects(api.discLayout({...page,getTextContent:async()=>({items:[]})},'DISC 42',font),/확정하지 못/);
 await assert.rejects(api.discLayout({...page,view:[0,0,240,842]},'DISC 42',font),/여백이 부족/);
});

test('DISC follows its label when the label is on a different page from the old fixed target',async()=>{
 const ui=app();await ui.api.run(file(await fixture({discPageIndex:6})));
 assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  const text=async n=>(await(await read.getPage(n)).getTextContent()).items.map(t=>t.str).join(' ');
  assert.match(await text(7),/DISC 42/);assert.doesNotMatch(await text(6),/DISC 42/);
 });
});

test('ATS discovery distinguishes standalone submitted copy from CFP and FlightInfo repeats',()=>{
 const {api}=app(),cfp=api.parseCFP(cfpLines);
 const texts={5:['CFP continuation',...atsLines],8:atsLines,58:['FlightInfo continuation',...atsLines]};
 assert.equal(api.findATS(texts,cfp,53),8);
 assert.equal(api.findATS({5:atsLines},cfp),5);
 assert.throws(()=>api.findATS({5:atsLines,8:atsLines},cfp),/候補|후보/);
 assert.throws(()=>api.findATS({5:atsLines.map(t=>t.replace('KAL123','KAL999'))},cfp),/찾지 못/);
});

test('ATS discovery rejects different origins and never resolves ambiguity by route agreement',()=>{
 const {api}=app(),cfp=api.parseCFP(cfpLines);
 const full=origin=>[atsLines[0],'-'+origin+'0100',...atsLines.slice(1)];
 assert.equal(api.findATS({3:full('RKSS'),8:full('RKSI')},cfp),8);
 assert.throws(()=>api.findATS({3:full('RKSS')},cfp),/찾지 못/);
 assert.throws(()=>api.findATS({3:full('RKSI'),8:full('RKSI').map(line=>line.replace('DEF','XYZ'))},cfp),/후보 페이지: 4, 9/);
 // Missing Item 13 must not turn the destination into an inferred departure.
 assert.equal(api.findATS({3:atsLines},cfp),3);
});

test('ambiguous ATS candidates block download and identify candidate pages',async()=>{
 const doc=await lib.PDFDocument.load(await fixture()),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 for(const [i,line] of atsLines.entries())doc.getPage(6).drawText(line,{x:30,y:760-i*16,size:10,font});
 const ui=app();await ui.api.run(file(await doc.save({useObjectStreams:false})));
 assert.equal(ui.blob,undefined);assert.match(ui.elements.status.textContent,/후보 페이지: 4, 7/);
});

test('ATS discovery prioritizes COPY OF ATS FPL including split lines and punctuation',()=>{
 const {api}=app(),cfp=api.parseCFP(cfpLines);
 const marked=['ATS FLIGHT PLAN',...atsLines.map(line=>line.replace('DEF','XYZ')),'*** copy of','ATS FPL, SUBMITTED ***'];
 assert.equal(api.findATS({3:atsLines,8:marked},cfp),8);
 assert.throws(()=>api.findATS({3:[...atsLines,'COPY OF ATS FPL'],8:marked},cfp),/후보 페이지: 4, 9/);
});

for(const mismatch of [false,true])test('submitted ATS caption resolves duplicate pages and preserves '+(mismatch?'mismatch detection':'Checked'),async()=>{
 const doc=await lib.PDFDocument.load(await fixture({mismatch})),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 for(const [i,line] of atsLines.entries())doc.getPage(6).drawText(line,{x:30,y:760-i*16,size:10,font});
 doc.getPage(3).drawText('COPY OF ATS FPL, SUBMITTED AT 0100Z',{x:30,y:100,size:10,font});
 const ui=app();await ui.api.run(file(await doc.save({useObjectStreams:false})));
 assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  const outline=await ui.api.readOutline(read);assert.equal(outline['ATS FLIGHT PLAN'],3);
  const text=(await(await read.getPage(4)).getTextContent()).items.map(item=>item.str).join(' ');
  assert.equal(text.includes('(Checked)'),!mismatch);
 });
 if(mismatch)assert.match(ui.elements.status.textContent,/불일치/);
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

test('repeated mismatch tokens underline each occurrence once',()=>{
 const {api}=app(),lines=[],font={widthOfTextAtSize:s=>s.length*5};
 const page={getHeight:()=>842,getWidth:()=>595,drawText(){},drawLine:line=>lines.push(line)};
 api.drawRoute(page,'RKSI ABC ABC RJAA',{match:false,bad:['ABC','ABC','ABC']},font,lib);
 assert.equal(lines.length,2);assert.notEqual(lines[0].start.x,lines[1].start.x);
});

test('drawing metrics use unkerned PDF advances and preserve an existing route annotation',async()=>{
 const source=await lib.PDFDocument.create();source.addPage([595,842]);
 const bytes=await source.save({useObjectStreams:false}),doc=await lib.PDFDocument.load(bytes),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 const text='AVATAR VA WAVE '.repeat(4).trim(),width=safety.textWidth(font,text,10),edits=[];
 assert.ok(width>font.widthOfTextAtSize(text,10)+2);
 safety.recordPage(doc.getPage(0),0,edits,[0,0,595,842]).drawText(text,{x:25,y:825,size:10,font,color:lib.rgb(0,0,1)});
 await inspect(bytes,async before=>inspect(await doc.save({useObjectStreams:false}),async after=>{
  const items=(await(await after.getPage(1)).getTextContent()).items;assert.ok(Math.abs(items.find(t=>t.str===text).width-width)<.01);
  await safety.verify(before,after,{document:app().document,edits});
 }));
 const {api}=app(),route=cfpLines[5],annotations=[{subtype:'FreeText',contentsObj:{str:route},rect:[160,792,585,815]}];
 assert.equal(api.routeLayout(annotations,route,{match:true},font,595,842).size,9);
 assert.equal(api.routeLayout([],route,{match:true},font,595,842).size,10);
 assert.ok(api.routeLayout([{...annotations[0],rect:[160,792,585,840]}],route,{match:true},font,595,842).top>50);
 assert.throws(()=>api.routeLayout([{...annotations[0],rect:[0,772,595,842]}],route,{match:true},font,595,842),/여백이 부족/);
});

test('four-line route can use clear space below an existing route annotation',async()=>{
 const {api}=app(),doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 const route='RKSI '+Array(55).fill('ABCDE').join(' ')+' RJAA';
 const annotations=[{subtype:'FreeText',contentsObj:{str:route},rect:[25,832,570,842]}];
 const source=doc.addPage([595,842]);
 source.drawText('EXISTING ROUTE',{x:25,y:833,size:8,font});
 const original=await doc.save(),editable=await lib.PDFDocument.load(original),newFont=await editable.embedFont(lib.StandardFonts.Helvetica),edits=[];
 await inspect(original,async before=>{
  const clear=await safety.whitespace(await before.getPage(1),app().document);
  const layout=api.routeLayout(annotations,route,{match:true},newFont,595,842,clear);
  assert.ok(842-layout.top+layout.size+2<832);
  api.drawRoute(safety.recordPage(editable.getPage(0),0,edits,[0,0,595,842]),route,{match:true},newFont,lib,layout);
  await inspect(await editable.save(),async after=>{
   await safety.verify(before,after,{document:app().document,edits});
   const items=(await(await after.getPage(1)).getTextContent()).items;
   assert.equal(items.filter(t=>t.str.includes('ABCDE')).length,4);
   assert.ok(items.some(t=>t.str==='EXISTING ROUTE'));
  });
 });
});

for(const mismatch of [false,true])test('four-line route preserves black header and '+(mismatch?'red underlines':'Checked'),async()=>{
 const bytes=await fixture({longRoute:true,mismatch}),edits=[],ui=app(undefined,{...safety,recordPage:(page,index,marks,view)=>{
  const target=safety.recordPage(page,index,marks,view);
  return {...target,drawLine(opts){edits.push(opts);target.drawLine(opts)}};
 }});
 await ui.api.run(file(bytes));assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  const items=(await(await read.getPage(4)).getTextContent()).items;
  const route=items.filter(t=>t.str.includes('ABCDE')&&t.transform[5]>790);
  assert.equal(route.length,4);
  assert.equal(items.some(t=>t.str==='(Checked)'),!mismatch);
  if(mismatch)assert.ok(edits.some(e=>e.color.red===.85));
  assert.ok(items.some(t=>t.str==='ORIGINAL BLACK HEADER'&&t.transform[5]===775));
 });
});

test('route placement searches clear margin and rejects an occupied top margin',async()=>{
 const {api}=app(),doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 const layout=api.routeLayout([],cfpLines[5],{match:true},font,595,842,r=>r[1]>825);
 assert.ok(layout.top<17);
 assert.ok(api.routeLayout([],Array(200).fill('ABCDE').join(' '),{match:true},font,595,842).size<9);
 assert.throws(()=>api.routeLayout([],'X'.repeat(20000),{match:true},font,595,842),/4줄/);
 const ui=app();await ui.api.run(file(await fixture({longRoute:true,blockedMargin:true})));
 assert.equal(ui.blob,undefined);assert.match(ui.elements.status.textContent,/여백이 부족/);
});

for(const mismatch of [false,true])test('long route shrinks below 9pt and preserves all tokens, black text and '+(mismatch?'underlines':'Checked'),async()=>{
 const bytes=await fixture({longRoute:true,routeWords:95,mismatch}),ui=app();
 await ui.api.run(file(bytes));assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  const items=(await(await read.getPage(4)).getTextContent()).items;
  const route=items.filter(t=>t.str.includes('ABCDE')&&t.transform[5]>790);
  assert.ok(route.length<=4&&route.length>0);
  assert.equal(route.map(t=>t.str).join(' ').match(/ABCDE/g).length,95);
  assert.ok(route.every(t=>Math.abs(t.transform[0])<9));
  assert.equal(items.some(t=>t.str==='(Checked)'),!mismatch);
  assert.ok(items.some(t=>t.str==='ORIGINAL BLACK HEADER'&&t.transform[5]===775));
 });
});

test('real PDF libraries: stale index 58 on seven-page PDF, save/reopen, annotations/bookmarks/filename',async()=>{
 const bytes=await fixture(),original=Uint8Array.from(bytes),ui=app();
 await ui.api.run(file(bytes));assert.ok(ui.blob,ui.elements.status.textContent);
 assert.equal(ui.download,'1234 KAL123 RKSI-RJAA 15 Nov 2026.pdf');assert.deepEqual(bytes,original);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  assert.equal(read.numPages,7);
  const text=async i=>(await read.getPage(i+1)).getTextContent().then(c=>c.items.map(t=>t.str).join(' '));
  assert.match(await text(3),/RJAA\s*\(Checked\)/);assert.match(await text(5),/DISC 42/);
  const discItems=(await(await read.getPage(6)).getTextContent()).items;
  const label=discItems.find(t=>t.str==='- DISC FUEL DUE TO WEATHER'),disc=discItems.find(t=>t.str==='DISC 42');
  assert.equal(disc.transform[5],label.transform[5]);
  assert.ok(Math.abs(disc.transform[4]-(label.transform[4]+label.width+10))<.01);
  assert.match(await text(2),/ETD RKSI 0100Z ETA RJAA 0300Z/);
  const outline=await ui.api.readOutline(read);
  for(const [title,index] of Object.entries({FlightPlan:0,'ATS FLIGHT PLAN':3,Header:4,'Weather Briefing':2,WindTemp:1,'Cross Chart':4,'Notam 1':5,OceanicTracks:6}))assert.equal(outline[title],index,title);
  const roots=await read.getOutline(),weather=roots.find(item=>item.title==='Weather Briefing');
  assert.deepEqual(weather.items.map(item=>item.title),['WindTemp','Cross Chart']);
  assert.ok(!roots.some(item=>['Weather Charts','WindTemp','Cross Chart'].includes(item.title)));
 });
 assert.equal(ui.elements.choose.disabled,false);
});

test('weather chart heading detection ignores references in flight notes and NOTAM text',()=>{
 const {api}=app();
 for(const [title,expected] of [['w i n t e m 1','WindTemp'],['s i g w x 1','SIGWX'],['a s c','ASC(TURB)'],['ASC (TURB)','ASC(TURB)'],['c r o s s','Cross Chart']])assert.equal(api.weatherChart([title]),expected);
 assert.equal(api.weatherChart(['EXPECTED SIG WX (REFER TO SIG AND TURB CHART)','AVBL CROSS RWY18L','START OF WIND AND TEMPERATURE SUMMARY']),undefined);
});

test('FlightPlan section detection excludes fuel summary rows and sentence references',()=>{
 const {api}=app();
 assert.deepEqual(api.flightPlanSections(['3% CONTINGENCY ERA VALIDATION','--- EDTO EQUAL TIME POINT 1 ---','REFILE FLT PLAN KAL123']),['3% Contingency','EDTO','Refile']);
 assert.deepEqual(api.flightPlanSections(['3 PCT CONT 0020 00.12','REFILE RES 0000 00.00','REFER TO EDTO INFORMATION','EDTO FUEL 1234']),[]);
 assert.deepEqual(api.flightPlanSections(['EDTO','REFILE','EDTO INFORMATION','REFILE FLIGHT PLAN','3 PCT CONTINGENCY']),['3% Contingency']);
 assert.deepEqual(api.flightPlanSections(['edto   equal time point','Refile  FLT  Plan:']),['EDTO','Refile']);
});

test('FlightPlan has three ordered children at first primary-CFP headings alongside weather children',async()=>{
 const doc=await lib.PDFDocument.load(await fixture({pages:12,atsIndex:8})),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 for(const [page,title] of [[2,'3% CONTINGENCY ERA VALIDATION'],[3,'EDTO EQUAL TIME POINT 1'],[4,'REFILE FLT PLAN KAL123'],[6,'3% CONTINGENCY ERA VALIDATION'],[7,'EDTO EQUAL TIME POINT 2'],[9,'REFILE FLT PLAN KAL123']])doc.getPage(page).drawText(title,{x:30,y:720,size:10,font});
 const ui=app();await ui.api.run(file(await doc.save({useObjectStreams:false})));
 assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  const roots=await read.getOutline(),flight=roots.find(item=>item.title==='FlightPlan'),titles=['3% Contingency','EDTO','Refile'];
  assert.deepEqual(flight.items.map(item=>item.title),titles);
  const outline=await ui.api.readOutline(read);
  for(const [i,page] of [2,3,4].entries())assert.equal(outline[titles[i]],page);
  assert.deepEqual(roots.find(item=>item.title==='Weather Briefing').items.map(item=>item.title),['WindTemp','Cross Chart']);
  assert.ok(!roots.some(item=>titles.includes(item.title)));
  assert.equal(read.numPages,12);
 });
});

test('Weather Briefing owns four ordered child bookmarks pointing to first matching charts',async()=>{
 const doc=await lib.PDFDocument.load(await fixture({pages:12})),font=await doc.embedFont(lib.StandardFonts.Helvetica);
 for(const [page,title] of [[6,'s i g w x 1'],[7,'a s c'],[8,'w i n t e m 2'],[9,'s i g w x 2'],[10,'a s c'],[11,'c r o s s']])doc.getPage(page).drawText(title,{x:30,y:760,size:10,font});
 const ui=app();await ui.api.run(file(await doc.save({useObjectStreams:false})));
 assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  const roots=await read.getOutline(),weather=roots.find(item=>item.title==='Weather Briefing'),titles=['WindTemp','SIGWX','ASC(TURB)','Cross Chart'];
  assert.deepEqual(weather.items.map(item=>item.title),titles);
  assert.ok(!roots.some(item=>titles.includes(item.title)));
  const outline=await ui.api.readOutline(read);
  for(const [i,page] of [1,6,7,4].entries())assert.equal(outline[titles[i]],page);
  assert.equal(read.numPages,12);
 });
 const {api}=app(),invalid=await lib.PDFDocument.create();invalid.addPage();
 assert.throws(()=>api.addBookmarks(invalid,[{title:'Weather Briefing',page:0,children:[{title:'SIGWX',page:99}]}],lib),/북마크 페이지 범위/);
});

test('NOTAM bookmarks target the first heading, including repeats across extraction batches',async()=>{
 const doc=await lib.PDFDocument.load(await fixture({pages:14}));
 const font=await doc.embedFont(lib.StandardFonts.Helvetica);
 // NOTAM 1 starts on index 5 in fixture(); all three titles repeat later.
 for(const [index,number] of [[6,2],[7,3],[8,1],[9,2],[10,3],[11,1],[12,2],[13,3]]){
  doc.getPage(index).drawText('KOREAN AIR NOTAM PACKAGE '+number,{x:30,y:760,size:10,font});
 }
 const ui=app();await ui.api.run(file(await doc.save({useObjectStreams:false})));
 assert.ok(ui.blob,ui.elements.status.textContent);
 await inspect(new Uint8Array(await ui.blob.arrayBuffer()),async read=>{
  assert.equal(read.numPages,14);
  const outline=await ui.api.readOutline(read);
  for(const [number,index] of [[1,5],[2,6],[3,7]])assert.equal(outline['Notam '+number],index);
 });
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

test('verification keeps the gap between separate allowed edit regions protected',async()=>{
 const source=await lib.PDFDocument.create();source.addPage([595,842]);
 const bytes=await source.save(),doc=await lib.PDFDocument.load(bytes),font=await doc.embedFont(lib.StandardFonts.Helvetica),edits=[],document=app().document;
 const page=safety.recordPage(doc.getPage(0),0,edits,[0,0,595,842]);
 page.drawText('LEFT',{x:30,y:800,size:10,font});page.drawText('RIGHT',{x:300,y:800,size:10,font});
 const valid=await doc.save();
 await inspect(bytes,async before=>{
  await inspect(valid,async after=>{await safety.verify(before,after,{document,edits})});
  const changed=await lib.PDFDocument.load(valid);
  changed.getPage(0).drawRectangle({x:160,y:800,width:10,height:5,color:lib.rgb(1,0,0)});
  await inspect(await changed.save(),async after=>{await assert.rejects(safety.verify(before,after,{document,edits}),/표시 영역 밖/)});
 });
});

test('cached original fingerprints avoid re-rendering while changed output still blocks download',async()=>{
 const doc=await lib.PDFDocument.create();doc.addPage([100,100]);const bytes=await doc.save(),document=app().document;
 await inspect(bytes,async before=>inspect(bytes,async after=>{
  let sourceRenders=0,resultRenders=0;
  const tracked=(read,onRender)=>({numPages:read.numPages,getPage:async n=>new Proxy(await read.getPage(n),{get(target,name){
   const value=Reflect.get(target,name,target);
   if(name==='render')return options=>{onRender();return value.call(target,options)};
   return typeof value==='function'?value.bind(target):value;
  }})});
  const source=tracked(before,()=>sourceRenders++),result=tracked(after,()=>resultRenders++);
  await safety.verify(source,result,{document});await safety.verify(source,result,{document});
  assert.equal(sourceRenders,1);assert.equal(resultRenders,2);
  const changed=await lib.PDFDocument.load(bytes);changed.getPage(0).drawRectangle({x:10,y:10,width:10,height:10,color:lib.rgb(1,0,0)});
  await inspect(await changed.save(),async corrupt=>{await assert.rejects(safety.verify(source,corrupt,{document}),/표시 영역 밖/)});
 }));
});

test('verification without Web Crypto retains exact pixel checks',async()=>{
 const vm=require('node:vm'),context=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../pdf-safety.js'),'utf8'),context);
 const doc=await lib.PDFDocument.create();doc.addPage([100,100]);const bytes=await doc.save(),document=app().document;
 await inspect(bytes,async before=>inspect(bytes,async after=>{await context.OFPSafety.verify(before,after,{document})}));
 // Reopen before changing a saved stream so the new drawing is serialized.
 const changed=await lib.PDFDocument.load(bytes);changed.getPage(0).drawRectangle({x:10,y:10,width:10,height:10,color:lib.rgb(0,0,0)});
 await inspect(bytes,async before=>inspect(await changed.save(),async after=>{await assert.rejects(context.OFPSafety.verify(before,after,{document}),/표시 영역 밖/)}));
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
