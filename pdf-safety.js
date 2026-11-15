(function(root){
'use strict';
const fail=message=>{throw new Error(message)};
function key(ref){return ref&&Number.isInteger(ref.num)&&Number.isInteger(ref.gen)?ref.num+':'+ref.gen:null}
async function diagnose(read,doc,bytes,lib){
 const sourceRefs=[];
 for(let i=1;i<=read.numPages;i++)sourceRefs.push(key((await read.getPage(i)).ref));
 const editableRefs=doc.getPages().map(p=>p.ref.objectNumber+':'+p.ref.generationNumber);
 const objects=doc.context.enumerateIndirectObjects(),N=lib.PDFName;
 const trees=objects.filter(([,obj])=>obj instanceof lib.PDFDict&&obj.get(N.of('Type'))===N.of('Pages')).map(([ref,obj])=>({ref:String(ref),count:String(obj.get(N.of('Count'))),kids:String(obj.get(N.of('Kids')))}));
 const leaves=objects.filter(([,obj])=>obj instanceof lib.PDFDict&&obj.get(N.of('Type'))===N.of('Page')).length;
 // Syntax hints only: matching bytes inside streams is not proof of an update chain.
 const text=new TextDecoder('latin1').decode(bytes);
 return {pdfjsPages:read.numPages,pdfLibPages:editableRefs.length,sourceRefs,editableRefs,missingRefs:sourceRefs.filter(ref=>!editableRefs.includes(ref)),pageLeafObjects:leaves,pageTrees:trees,
  syntaxHints:{startxref:(text.match(/startxref\s+\d+/g)||[]).length,prev:(text.match(/\/Prev\s+\d+/g)||[]).length,objectStreams:(text.match(/\/Type\s*\/ObjStm\b/g)||[]).length,xrefStreams:(text.match(/\/Type\s*\/XRef\b/g)||[]).length},
  note:'구문 개수는 단서이며 실제 xref 체인을 증명하지 않습니다. 실제 파일 분석 전에는 원인을 확정할 수 없습니다.'};
}
function normalizeWithModule(qpdf,input){
 qpdf.FS.writeFile('/input.pdf',new Uint8Array(input));
 const code=qpdf.callMain(['--object-streams=disable','--stream-data=preserve','/input.pdf','/normalized.pdf']);
 // QPDF exit 3 means warnings/repair: require investigation rather than assume safe repair.
 if(code!==0)fail('QPDF 정상화가 경고 또는 오류로 종료되었습니다 ('+code+'). 다운로드하지 않습니다.');
 return qpdf.FS.readFile('/normalized.pdf').slice();
}
function normalize(input){
 return new Promise((resolve,reject)=>{
  let worker,timer;
  const done=(error,bytes)=>{clearTimeout(timer);if(worker)worker.terminate();error?reject(error):resolve(bytes)};
  try{
   worker=new Worker('qpdf-worker.js');
   timer=setTimeout(()=>done(new Error('QPDF 처리 시간 초과. 다운로드하지 않습니다.')),120000);
   worker.onerror=()=>done(new Error('QPDF WASM worker를 실행하지 못했습니다. HTTPS 환경 및 브라우저 메모리를 확인하세요.'));
   worker.onmessage=event=>{const result=event.data;result.error?done(new Error(result.error)):done(null,new Uint8Array(result.bytes))};
   const copy=new Uint8Array(input).slice();worker.postMessage({bytes:copy},[copy.buffer]);
  }catch(error){done(error)}
 });
}
function geometry(page){return JSON.stringify([page.view,page.rotate,page.userUnit])}
function textKey(item){return JSON.stringify([item.str,item.dir,item.transform.map(n=>Math.round(n*10000)/10000),Math.round(item.width*10000)/10000,Math.round(item.height*10000)/10000])}
function inside(x,y,rects){return rects.some(r=>x>=r[0]&&x<=r[2]&&y>=r[1]&&y<=r[3])}
// pdf-lib drawText emits unkerned Tj text; whole-string metrics include kerning.
function textWidth(font,text,size){return Array.from(text).reduce((width,char)=>width+font.widthOfTextAtSize(char,size),0)}
async function raster(page,document){
 const viewport=page.getViewport({scale:1});
 if(!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width*viewport.height>3000000)fail('검증 가능한 페이지 크기를 초과했습니다. 다운로드하지 않습니다.');
 const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)fail('페이지 렌더링 검증을 실행할 수 없습니다.');
 await page.render({canvasContext:ctx,viewport,annotationMode:1}).promise;
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
 canvas.width=0;canvas.height=0;return {pixels,viewport};
}
async function verify(before,after,{document,edits=[],progress=()=>{}}){
 if(before.numPages!==after.numPages)fail('검증 실패: 원본 '+before.numPages+' / 결과 '+after.numPages+'페이지. 다운로드하지 않습니다.');
 for(let index=0;index<before.numPages;index++){
  const a=await before.getPage(index+1),b=await after.getPage(index+1),marks=edits.filter(e=>e.page===index);
  if(geometry(a)!==geometry(b))fail('검증 실패: '+(index+1)+'페이지 크기/회전/순서가 다릅니다.');
  const oldText=(await a.getTextContent()).items.filter(t=>typeof t.str==='string').map(textKey);
  const newItems=(await b.getTextContent()).items.filter(t=>typeof t.str==='string');
  const newText=newItems.map(textKey);let cursor=0;
  for(const item of newText)if(item===oldText[cursor])cursor++;
  if(cursor!==oldText.length||(!marks.length&&oldText.length!==newText.length))fail('검증 실패: '+(index+1)+'페이지 기존 텍스트 또는 위치가 변경되었습니다.');
  for(const mark of marks.filter(m=>m.text)){
   if(!newItems.some(t=>t.str===mark.text&&Math.abs(t.transform[4]-mark.x)<.1&&Math.abs(t.transform[5]-mark.y)<.1))fail('검증 실패: '+(index+1)+'페이지 표시 위치가 다릅니다: '+mark.text);
  }
  const first=await raster(a,document),second=await raster(b,document);
  const x=first.pixels,y=second.pixels;
  if(x.width!==y.width||x.height!==y.height)fail('검증 실패: 페이지 렌더링 크기가 다릅니다.');
  const masks=marks.map(m=>{const r=first.viewport.convertToViewportRectangle(m.rect);return [Math.floor(Math.min(r[0],r[2])),Math.floor(Math.min(r[1],r[3])),Math.ceil(Math.max(r[0],r[2])),Math.ceil(Math.max(r[1],r[3]))]});
  for(let offset=0;offset<x.data.length;offset+=4){
   const pixel=offset/4,masked=inside(pixel%x.width,Math.floor(pixel/x.width),masks);
   if(masked&&(x.data[offset]!==255||x.data[offset+1]!==255||x.data[offset+2]!==255))fail('검증 실패: '+(index+1)+'페이지 표시 위치에 기존 내용이 있습니다. 겹쳐 쓰지 않고 다운로드를 중단합니다.');
   if(x.data[offset]===y.data[offset]&&x.data[offset+1]===y.data[offset+1]&&x.data[offset+2]===y.data[offset+2]&&x.data[offset+3]===y.data[offset+3])continue;
   if(!masked)fail('검증 실패: '+(index+1)+'페이지의 허용된 표시 영역 밖 내용이 변경되었습니다 (픽셀 '+pixel%x.width+', '+Math.floor(pixel/x.width)+'). 다운로드하지 않습니다.');
  }
  a.cleanup();b.cleanup();progress(index+1,before.numPages);
 }
 return {pages:before.numPages,checkedEdits:edits.length};
}
function recordPage(page,index,edits,view){
 if(page.getRotation().angle!==0||view[0]!==0||view[1]!==0||view[2]!==page.getWidth()||view[3]!==page.getHeight())fail('표시 대상 페이지의 회전/CropBox를 지원하지 않습니다. 다운로드하지 않습니다.');
 const add=mark=>{
  if(mark.rect.some(n=>!Number.isFinite(n))||mark.rect[0]<0||mark.rect[1]<0||mark.rect[2]>view[2]||mark.rect[3]>view[3])fail('표시가 페이지 영역을 벗어납니다. 다운로드하지 않습니다.');
  edits.push({page:index,...mark});
 };
 return {getHeight:()=>page.getHeight(),getWidth:()=>page.getWidth(),drawText(text,opts){
  const width=textWidth(opts.font,text,opts.size);add({text,x:opts.x,y:opts.y,rect:[opts.x-2,opts.y-opts.size*.3-2,opts.x+width+2,opts.y+opts.size+2]});page.drawText(text,opts);
 },drawLine(opts){const {start:a,end:b}=opts;add({rect:[Math.min(a.x,b.x)-2,Math.min(a.y,b.y)-2,Math.max(a.x,b.x)+2,Math.max(a.y,b.y)+2]});page.drawLine(opts)}};
}
const api={diagnose,normalizeWithModule,normalize,verify,recordPage,textWidth};
if(typeof module==='object'&&module.exports)module.exports=api;else root.OFPSafety=api;
})(globalThis);
