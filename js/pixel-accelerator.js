/* Optional pure-pixel backend. No capture, recognition rules or UI state. */
(function(root){
 'use strict';
 function create(instance){
  const e=instance.exports;if(e.kernel_contract?.()!==1)throw Error('Unsupported pixel kernel contract');
  const allocations=[];let buffers=new WeakMap(),textScratch=null;
  function alloc(bytes){const p=e.alloc(bytes);if(!p&&bytes)throw Error('Pixel allocation failed');allocations.push([p,bytes]);return p;}
  function reset(){for(const [p,n]of allocations)e.dealloc(p,n);allocations.length=0;buffers=new WeakMap();textScratch=null;}
  function temp(bytes){const p=e.alloc(bytes);if(!p&&bytes)throw Error('Pixel scratch allocation failed');return p;}
  function put(array,Type=array.constructor){let p=buffers.get(array);if(p===undefined){p=alloc(array.byteLength);new Type(e.memory.buffer,p,array.length).set(array);buffers.set(array,p);}return p;}
  function output(ptr,length){return new Float32Array(e.memory.buffer,ptr,length).slice();}
  const pixels=(img)=>{const n=img.width*img.height;if(!Number.isInteger(n)||n<=0||n>32_000_000||img.data.length!==n*4)throw Error('Invalid pixel shape');return n;};
  return {
   name:'wasm',reset,
   gray(img){const n=pixels(img),src=put(img.data,Uint8Array),dst=temp(n*4);try{e.gray(src,dst,n);return output(dst,n);}finally{e.dealloc(dst,n*4);}},
   blur(g,w,h,r){if(r<1)return g;if(g.length!==w*h||w<2||h<2||r<0||!Number.isInteger(r)||r>4096)throw Error('Invalid blur shape');const src=put(g),tmp=temp(g.byteLength),dst=temp(g.byteLength);try{e.blur(src,tmp,dst,w,h,r);return output(dst,g.length);}finally{e.dealloc(dst,g.byteLength);e.dealloc(tmp,g.byteLength);}},
   half(g,w,h){const W=w>>1,H=h>>1;if(g.length!==w*h||W<1||H<1)throw Error('Invalid pyramid shape');const src=put(g),dst=temp(W*H*4);try{e.half(src,dst,w,h);return {g:output(dst,W*H),w:W,h:H};}finally{e.dealloc(dst,W*H*4);}},
   textMask(img,x0,y0,w,h,r,s,minL,minContrast,relativeContrast){pixels(img);if(x0<0||y0<0||x0+w>img.width||y0+h>img.height||w<1||h<1||!Number.isInteger(r)||r<1||r>4096)throw Error('Invalid text mask shape');const src=put(img.data,Uint8Array),n=w*h;if(!textScratch||textScratch.capacity<n){const capacity=2**Math.ceil(Math.log2(n));textScratch={capacity,lum:alloc(capacity*4),tmp:alloc(capacity*4),around:alloc(capacity*4),mask:alloc(capacity)};}const t=textScratch;e.text_mask(src,img.width,x0,y0,w,h,r,s,minL,minContrast,relativeContrast,t.lum,t.tmp,t.around,t.mask);return new Uint8Array(e.memory.buffer,t.mask,n).slice();},
   geometry(pts,tv){const xy=Float64Array.from(pts.flatMap(p=>[p[0],p[1]])),xyPtr=put(xy),tvPtr=put(tv);return (lv,s,ox,oy,nearest)=>e.score(put(lv.g),lv.w,lv.h,xyPtr,tvPtr,pts.length,s/lv.f,ox,oy,nearest?1:0);},
   coarse(lv,xs,ys,tv,ox0,ox1,oy0,oy1){const gp=put(lv.g),xp=alloc(xs.byteLength),yp=alloc(ys.byteLength),tp=put(tv),rp=alloc(24);new Float64Array(e.memory.buffer,xp,xs.length).set(xs);new Float64Array(e.memory.buffer,yp,ys.length).set(ys);e.coarse_search(gp,lv.w,lv.h,xp,yp,tp,tv.length,ox0,ox1,oy0,oy1,rp);const v=new Float64Array(e.memory.buffer,rp,3);return {ox:v[0],oy:v[1],score:v[2]};},
   memoryBytes:()=>e.memory.buffer.byteLength
  };
 }
 const api={create};if(typeof module==='object'&&module.exports)module.exports=api;root.TartarusPixelAccelerator=api;
})(typeof self!=='undefined'?self:globalThis);
