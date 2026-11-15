'use strict';
importScripts('vendor/qpdf/qpdf.js','pdf-safety.js');
self.onmessage=async event=>{
 const messages=[],logError=console.error;
 console.error=(...args)=>{messages.push(args.join(' '));logError.apply(console,args)};
 try{
  const qpdf=await Module({noInitialRun:true,locateFile:()=>new URL('vendor/qpdf/qpdf.wasm',self.location.href).href});
  const bytes=OFPSafety.normalizeWithModule(qpdf,event.data.bytes);
  self.postMessage({bytes},[bytes.buffer]);
 }catch(error){self.postMessage({error:'QPDF 정상화 실패: '+(error.message||String(error))+'\n'+messages.join('\n').slice(-3000)})}finally{console.error=logError}
};
