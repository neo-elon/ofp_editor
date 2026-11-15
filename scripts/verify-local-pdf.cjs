// Local-only investigation. Never upload or commit the input or generated reports.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {app,inspect,normalize,lib,safety,browserPdfjs}=require('../tests/app-harness.cjs');

(async()=>{
 const input=process.argv[2];if(!input)throw Error('Usage: node scripts/verify-local-pdf.cjs INPUT.pdf [--process]');
 const bytes=fs.readFileSync(input),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const directory=path.join(__dirname,'../tmp/pdfs');fs.mkdirSync(directory,{recursive:true});
 const report={sha256:hash,sourceUnchanged:false,stages:[]};
 const parsed=await lib.PDFDocument.load(bytes,{updateMetadata:false});
 await inspect(bytes,async read=>{
  report.source=await safety.diagnose(read,parsed,bytes,lib);
  const ui=app(),texts={};
  for(let i=0;i<read.numPages;i++)texts[i]=await ui.api.readLines(read,i);
  fs.writeFileSync(path.join(directory,'source-lines.json'),JSON.stringify(texts,null,2));
  report.originalOutline=await ui.api.readOutline(read);
  const {page,cfp}=ui.api.findCFP(texts,report.originalOutline.FlightPlan);
  const atsPage=ui.api.findATS(texts,cfp,report.originalOutline.FlightInfo);
  report.cfp={...cfp,page:page+1};report.atsPage=atsPage+1;
  report.comparison=ui.api.compare(cfp.route,ui.api.parseATS(texts[atsPage],cfp.dest),cfp.origin,cfp.dest);
 });
 console.log('Source counts:',report.source.pdfjsPages,report.source.pdfLibPages,'CFP page:',report.cfp.page,'ATS page:',report.atsPage);
 if(process.argv.includes('--process')){
  let latestBytes;
  const reader={GlobalWorkerOptions:{},getDocument:options=>{latestBytes=Uint8Array.from(options.data);return browserPdfjs.getDocument(options)}};
  const ui=app(reader,{...safety,normalize:async value=>{report.normalizationRequested=true;return normalize(value)},
   recordPage:(page,index,edits,view)=>{report.edits=edits;return safety.recordPage(page,index,edits,view)},
   verify:async(before,after,options)=>{
    const stage={before:before.numPages,after:after.numPages,edits:options.edits?.length||0};report.stages.push(stage);
    if(stage.edits&&process.argv.includes('--debug'))fs.writeFileSync(path.join(directory,'rejected-candidate.pdf'),latestBytes);
    const progress=options.progress;
    return safety.verify(before,after,{...options,progress:(n,total)=>{if(n%5===0||n===total)console.log('Verified:',n,'/',total,'edits:',stage.edits);if(progress)progress(n,total)}}).then(result=>{stage.passed=true;return result});
   }});
  await ui.api.run({name:path.basename(input),type:'application/pdf',arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
  report.status=ui.elements.status.textContent;
  if(ui.blob){
   const output=path.join(__dirname,'../output/pdf');fs.mkdirSync(output,{recursive:true});
   const name=path.basename(ui.download),target=path.join(output,name);
   if(fs.existsSync(target))throw Error('Output exists; refusing to overwrite '+target);
   fs.writeFileSync(target,new Uint8Array(await ui.blob.arrayBuffer()));report.output=target;
   await inspect(fs.readFileSync(target),async read=>{report.outputPages=read.numPages;report.finalOutline=await ui.api.readOutline(read)});
  }
 }
 report.sourceUnchanged=hash===crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
 fs.writeFileSync(path.join(directory,'local-verification.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,stages:report.stages,sourceUnchanged:report.sourceUnchanged,outputPages:report.outputPages,output:report.output},null,2));
 if(process.argv.includes('--process')&&!report.output)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
