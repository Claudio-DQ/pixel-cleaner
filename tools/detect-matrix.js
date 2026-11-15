'use strict';
const engine = require('../engine.js');

function mulberry32(seed) { let a = seed >>> 0; return function () { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PALETTE = [[20,20,28],[238,238,242],[214,66,66],[68,178,92],[62,112,220],[230,200,60],[178,92,200],[42,190,190],[230,140,50],[120,80,50],[250,250,250],[15,15,15]];
function makeImage(w,h,data){return {width:w,height:h,data:data||new Uint8ClampedArray(w*h*4)};}
function makeRandomArt(w,h,seed){const rng=mulberry32(seed);const out=makeImage(w,h);for(let i=0,p=0;i<w*h;i++,p+=4){const c=PALETTE[Math.floor(rng()*PALETTE.length)];out.data[p]=c[0];out.data[p+1]=c[1];out.data[p+2]=c[2];out.data[p+3]=255;}return out;}
function upscaleNearest(src,s){const w=src.width*s,h=src.height*s,out=makeImage(w,h);for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){const si=(y*src.width+x)*4;for(let dy=0;dy<s;dy++){let di=((y*s+dy)*w+x*s)*4;for(let dx=0;dx<s;dx++,di+=4){out.data[di]=src.data[si];out.data[di+1]=src.data[si+1];out.data[di+2]=src.data[si+2];out.data[di+3]=src.data[si+3];}}}return out;}
function padImage(src,l,t,r,b,color){const w=src.width+l+r,h=src.height+t+b,out=makeImage(w,h);const c=color||[0,0,0,0];for(let i=0,p=0;i<w*h;i++,p+=4){out.data[p]=c[0];out.data[p+1]=c[1];out.data[p+2]=c[2];out.data[p+3]=c[3]==null?255:c[3];}for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){const si=(y*src.width+x)*4,di=((y+t)*w+x+l)*4;out.data[di]=src.data[si];out.data[di+1]=src.data[si+1];out.data[di+2]=src.data[si+2];out.data[di+3]=src.data[si+3];}return out;}
function boxBlur(src,r){const w=src.width,h=src.height,out=makeImage(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){let rr=0,gg=0,bb=0,aa=0,n=0;for(let dy=-r;dy<=r;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;for(let dx=-r;dx<=r;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;const p=(yy*w+xx)*4;rr+=src.data[p];gg+=src.data[p+1];bb+=src.data[p+2];aa+=src.data[p+3];n++;}}const p=(y*w+x)*4;out.data[p]=Math.round(rr/n);out.data[p+1]=Math.round(gg/n);out.data[p+2]=Math.round(bb/n);out.data[p+3]=Math.round(aa/n);}return out;}
function addNoise(src,amp,seed){const rng=mulberry32(seed);const out=makeImage(src.width,src.height,new Uint8ClampedArray(src.data));for(let i=0,p=0;i<src.width*src.height;i++,p+=4){const n=(rng()*2-1)*amp;out.data[p]=src.data[p]+n;out.data[p+1]=src.data[p+1]+n;out.data[p+2]=src.data[p+2]+n;out.data[p+3]=src.data[p+3];}return out;}
function jpegBias(src,block,amp){const out=makeImage(src.width,src.height,new Uint8ClampedArray(src.data));const w=src.width;for(let y=0;y<src.height;y++)for(let x=0;x<w;x++){const p=(y*w+x)*4;const bias=((Math.floor(x/block)+Math.floor(y/block))%2)?amp:-amp;out.data[p]=src.data[p]+bias;out.data[p+1]=src.data[p+1]+bias;out.data[p+2]=src.data[p+2]+bias;}return out;}

const variants = {
  clean: (img) => img,
  blur1: (img) => boxBlur(img, 1),
  blur2: (img) => boxBlur(img, 2),
  noise8: (img) => addNoise(img, 8, 111),
  blur1noise8: (img) => addNoise(boxBlur(img, 1), 8, 222),
  blur2noise12: (img) => addNoise(boxBlur(img, 2), 12, 333),
  jpeg8: (img) => jpegBias(img, 8, 6),
  jpeg8blur1: (img) => boxBlur(jpegBias(img, 8, 6), 1),
};

const scales = [2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 24];
let total = 0, pass = 0;
const failures = [];
const t0 = Date.now();

for (const scale of scales) {
  for (const [vname, fn] of Object.entries(variants)) {
    const art = makeRandomArt(18, 13, 7000 + scale * 17);
    let img = upscaleNearest(art, scale);
    img = fn(img);
    const det = engine.detectGrid(img);
    total++;
    if (det.scale === scale) pass++;
    else failures.push({ scale, vname, got: det.scale, conf: det.confidence.toFixed(3), prof: det.profileScore && det.profileScore.toFixed(2) });
  }
}

// padding tests
for (const scale of [4, 8, 12]) {
  const art = makeRandomArt(14, 10, 8888 + scale);
  let img = padImage(upscaleNearest(art, scale), 3, 2, 0, 0, [30, 40, 50, 255]);
  img = boxBlur(img, 1);
  const det = engine.detectGrid(img);
  total++;
  if (det.scale === scale && det.offsetX === 3 && det.offsetY === 2) pass++;
  else failures.push({ scale, vname: 'padding+blur', got: det.scale, off: `${det.offsetX},${det.offsetY}`, conf: det.confidence.toFixed(3) });
}

const elapsed = Date.now() - t0;
console.log(`pass ${pass}/${total} in ${elapsed} ms`);
for (const f of failures) console.log('FAIL', f);
