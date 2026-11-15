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
 const exports='return {readOutline,readLines,mapPages,findCFP,findATS,routeLayout,discLayout,validPage,parseCFP,parseATS,compare,drawRoute,addBookmarks,run};';
 const api=new Function('document','window','URL','setTimeout',script.replace(/\}\)\(\);\s*$/,exports+'})();').replace('(function(){','return (function(){'))(document,{pdfjsLib,PDFLib:lib,OFPSafety:safetyLib},URL,()=>{});
 return {api,elements,document,get blob(){return blob},get download(){return download}};
}

async function inspect(bytes,fn){
 const task=browserPdfjs.getDocument({data:Uint8Array.from(bytes),isEvalSupported:false});
 try{return await fn(await task.promise)}finally{await task.destroy()}
}
async function normalize(bytes){
 const createQpdf=require('../vendor/qpdf/qpdf.js');
 const qpdf=await createQpdf({noInitialRun:true,locateFile:()=>path.join(__dirname,'../vendor/qpdf/qpdf.wasm')});
 return safety.normalizeWithModule(qpdf,bytes);
}
module.exports={app,browserPdfjs,inspect,normalize,lib,safety};
