const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..'),base=new URL('https://example.test/ofp_editor/');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const links=[...html.matchAll(/<link\b([^>]+)>/g)].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])));
function asset(href,relativeTo=base){
 const url=new URL(href,relativeTo);
 assert.equal(url.origin,base.origin);assert.ok(url.pathname.startsWith(base.pathname));
 return fs.readFileSync(path.join(root,url.pathname.slice(base.pathname.length)));
}
function pngSize(bytes){
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 return bytes.readUInt32BE(16)+'x'+bytes.readUInt32BE(20);
}

test('home-screen manifest and icons resolve within the GitHub Pages project path',()=>{
 const link=links.find(link=>link.rel==='manifest');assert.ok(link);
 const manifestURL=new URL(link.href,base),manifest=JSON.parse(asset(link.href));
 assert.equal(manifest.name,'OFP Editor');assert.equal(manifest.short_name,'OFP Editor');
 assert.equal(manifest.display,'standalone');
 for(const key of ['start_url','scope','id'])assert.equal(new URL(manifest[key],manifestURL).href,base.href);
 assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'));
 assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose.split(' ').includes('maskable')));
 for(const icon of manifest.icons){assert.equal(icon.type,'image/png');assert.equal(pngSize(asset(icon.src,manifestURL)),icon.sizes)}
});

test('iPad touch icons have the declared sizes and standalone app metadata',async()=>{
 const touch=links.filter(link=>link.rel==='apple-touch-icon');assert.equal(touch.length,2);
 for(const icon of touch)assert.equal(pngSize(asset(icon.href)),icon.sizes);
 assert.match(html,/<meta name="apple-mobile-web-app-capable" content="yes">/);
 assert.match(html,/<meta name="apple-mobile-web-app-title" content="OFP Editor">/);
 for(const icon of links.filter(link=>link.rel==='icon'))assert.ok(asset(icon.href).length);
 const {loadImage,createCanvas}=require('@napi-rs/canvas'),image=await loadImage(asset('icons/icon-512.png'));
 const canvas=createCanvas(512,512),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
 const pixels=ctx.getImageData(0,0,512,512).data;
 for(let i=3;i<pixels.length;i+=4)assert.equal(pixels[i],255,'Home-screen icon must have an opaque background');
});
