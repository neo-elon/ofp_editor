// Rebuild the browser icon assets from the editable SVG. Requires dev dependencies only.
const fs=require('node:fs');
const path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');

(async()=>{
 const directory=path.join(__dirname,'../icons');
 const source=await loadImage(fs.readFileSync(path.join(directory,'ofp-editor.svg')));
 for(const [name,size] of [['favicon-32',32],['apple-touch-icon-167',167],['apple-touch-icon-180',180],['icon-192',192],['icon-512',512]]){
  const canvas=createCanvas(size,size);
  canvas.getContext('2d').drawImage(source,0,0,size,size);
  fs.writeFileSync(path.join(directory,name+'.png'),canvas.toBuffer('image/png'));
 }
})().catch(error=>{console.error(error);process.exitCode=1});
