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
// pdf-lib drawText emits unkerned Tj text; whole-string metrics include kerning.
const fontWidths=new WeakMap();
function textWidth(font,text,size){
 let sizes=fontWidths.get(font);if(!sizes){sizes=new Map();fontWidths.set(font,sizes)}
 let chars=sizes.get(size);if(!chars){chars=new Map();sizes.set(size,chars)}
 let width=0;for(const char of text){if(!chars.has(char))chars.set(char,font.widthOfTextAtSize(char,size));width+=chars.get(char)}return width;
}
async function raster(page,document){
 const viewport=page.getViewport({scale:1});
 if(!Number.isFinite(viewport.width)||!Number.isFinite(viewport.height)||viewport.width*viewport.height>3000000)fail('검증 가능한 페이지 크기를 초과했습니다. 다운로드하지 않습니다.');
 const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)fail('페이지 렌더링 검증을 실행할 수 없습니다.');
 await page.render({canvasContext:ctx,viewport,annotationMode:1}).promise;
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
 canvas.width=0;canvas.height=0;return {pixels,viewport};
}
async function whitespace(page,document){
 const {pixels,viewport}=await raster(page,document);
 return rect=>{
  const r=viewport.convertToViewportRectangle(rect),left=Math.floor(Math.min(r[0],r[2])),right=Math.ceil(Math.max(r[0],r[2])),top=Math.floor(Math.min(r[1],r[3])),bottom=Math.ceil(Math.max(r[1],r[3]));
  if(left<0||top<0||right>=pixels.width||bottom>=pixels.height)return false;
  for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
   const offset=(y*pixels.width+x)*4;
   if(pixels.data[offset]!==255||pixels.data[offset+1]!==255||pixels.data[offset+2]!==255)return false;
  }
  return true;
 };
}
// PDF.js source documents are immutable. Retain compact fingerprints, never all page images.
const sourceSnapshots=new WeakMap();
async function pixelDigest(pixels){
 if(!root.crypto?.subtle)return null;
 return new Uint8Array(await root.crypto.subtle.digest('SHA-256',pixels.data));
}
function sameDigest(a,b){return a.length===b.length&&a.every((value,index)=>value===b[index])}
async function verify(before,after,{document,edits=[],progress=()=>{}}){
 if(before.numPages!==after.numPages)fail('검증 실패: 원본 '+before.numPages+' / 결과 '+after.numPages+'페이지. 다운로드하지 않습니다.');
 let snapshots=sourceSnapshots.get(before);if(!snapshots){snapshots=new Map();sourceSnapshots.set(before,snapshots)}
 const editsByPage=new Map();for(const edit of edits){if(!editsByPage.has(edit.page))editsByPage.set(edit.page,[]);editsByPage.get(edit.page).push(edit)}
 for(let index=0;index<before.numPages;index++){
  const a=await before.getPage(index+1),b=await after.getPage(index+1),marks=editsByPage.get(index)||[];
  if(geometry(a)!==geometry(b))fail('검증 실패: '+(index+1)+'페이지 크기/회전/순서가 다릅니다.');
  const cached=snapshots.get(index),oldText=cached?.text||(await a.getTextContent()).items.filter(t=>typeof t.str==='string').map(textKey);
  const newItems=(await b.getTextContent()).items.filter(t=>typeof t.str==='string');
  const newText=newItems.map(textKey);let cursor=0;
  for(const item of newText)if(item===oldText[cursor])cursor++;
  if(cursor!==oldText.length||(!marks.length&&oldText.length!==newText.length))fail('검증 실패: '+(index+1)+'페이지 기존 텍스트 또는 위치가 변경되었습니다.');
  for(const mark of marks.filter(m=>m.text)){
   if(!newItems.some(t=>t.str===mark.text&&Math.abs(t.transform[4]-mark.x)<.1&&Math.abs(t.transform[5]-mark.y)<.1))fail('검증 실패: '+(index+1)+'페이지 표시 위치가 다릅니다: '+mark.text);
  }
  let first=marks.length||!cached?await raster(a,document):null;
  const second=await raster(b,document),y=second.pixels;
  const width=first?first.pixels.width:cached.width,height=first?first.pixels.height:cached.height;
  if(width!==y.width||height!==y.height)fail('검증 실패: 페이지 렌더링 크기가 다릅니다.');
  let digest=cached?.digest;
  if(!marks.length&&digest&&root.crypto?.subtle){
   if(sameDigest(digest,await pixelDigest(y))){
    snapshots.set(index,{text:oldText,width,height,digest});
    a.cleanup();b.cleanup();progress(index+1,before.numPages);continue;
   }
  }
  // Changed pages, hash mismatches and browsers without Web Crypto use exact pixel checks.
  if(!first)first=await raster(a,document);
  const x=first.pixels;
  const masks=marks.map(m=>{const r=first.viewport.convertToViewportRectangle(m.rect);return [Math.floor(Math.min(r[0],r[2])),Math.floor(Math.min(r[1],r[3])),Math.ceil(Math.max(r[0],r[2])),Math.ceil(Math.max(r[1],r[3]))]});
  // Union rectangles once instead of searching every rectangle at every pixel.
  const mask=masks.length?new Uint8Array(x.width*x.height):null;
  for(const [left,top,right,bottom] of masks)for(let row=Math.max(0,top);row<=Math.min(x.height-1,bottom);row++){
   const start=Math.max(0,left),end=Math.min(x.width-1,right);
   if(start<=end)mask.fill(1,row*x.width+start,row*x.width+end+1);
  }
  const oldPixels=new Uint32Array(x.data.buffer,x.data.byteOffset,x.data.byteLength/4),newPixels=new Uint32Array(y.data.buffer,y.data.byteOffset,y.data.byteLength/4);
  for(let pixel=0;pixel<oldPixels.length;pixel++){
   const offset=pixel*4,masked=mask&&mask[pixel];
   if(masked&&(x.data[offset]!==255||x.data[offset+1]!==255||x.data[offset+2]!==255))fail('검증 실패: '+(index+1)+'페이지 표시 위치에 기존 내용이 있습니다. 겹쳐 쓰지 않고 다운로드를 중단합니다.');
   if(oldPixels[pixel]===newPixels[pixel])continue;
   if(!masked)fail('검증 실패: '+(index+1)+'페이지의 허용된 표시 영역 밖 내용이 변경되었습니다 (픽셀 '+pixel%x.width+', '+Math.floor(pixel/x.width)+'). 다운로드하지 않습니다.');
  }
  if(!cached){digest=digest||await pixelDigest(x);if(digest)snapshots.set(index,{text:oldText,width,height,digest})}
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
const api={diagnose,normalizeWithModule,normalize,verify,recordPage,textWidth,whitespace};
if(typeof module==='object'&&module.exports)module.exports=api;else root.OFPSafety=api;
})(globalThis);
