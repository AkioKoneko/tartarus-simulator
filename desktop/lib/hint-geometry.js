'use strict';
// A pure transform; main.js continues to own the windows and their lifecycle.
function transform(packet, bounds, toDip) {
  if (!packet || !packet.valid || !bounds || !(packet.width>100 && packet.height>100 && bounds.width>100 && bounds.height>100)) return null;
  const ratio = packet.width/packet.height;
  if (Math.abs(bounds.width/bounds.height/ratio-1)>.025) return null;
  const area = toDip(bounds);
  if (!area || !(area.width>0 && area.height>0)) return null;
  const sx=area.width/packet.width, sy=area.height/packet.height;
  const input=packet.targets || [];
  if(!Array.isArray(input))return null;
  const chain=input.filter(t=>t && (t.chainStep!==undefined || t.chainState!==undefined)).sort((a,b)=>a.chainStep-b.chainStep);
  // Never reconnect a broken route after dropping one bad node. The button
  // plus at most six meals fit in the same small display packet.
  if(chain.length && (input.length>8 || chain.length>6 || chain.some((t,i)=>t.chainStep!==i+1 || t.kind!=='cell' || t.shape==='underline' ||
    !['current','planned'].includes(t.chainState) || i>0 && t.chainState!=='planned' ||
    ![t.x,t.y,t.radius].every(Number.isFinite) || t.radius<=0 || t.radius>Math.max(packet.width,packet.height) || t.x<0 || t.y<0 || t.x>packet.width || t.y>packet.height)))return null;
  const targets=input.slice(0,8).filter(t=>t && Number.isFinite(t.x)&&Number.isFinite(t.y)&&t.x>=0&&t.y>=0&&t.x<=packet.width&&t.y<=packet.height &&
    (t.shape!=='underline' || [t.width,t.height].every(n=>Number.isFinite(n)&&n>0))).map(t=>Object.assign({x:t.x*sx,y:t.y*sy,radius:Math.max(12,Math.min(90,(Number(t.radius)||36)*Math.min(sx,sy))),label:String(t.label || '').slice(0,120),kind:t.kind || 'cell'},t.shape==='underline'?{shape:t.shape,width:t.width*sx,height:t.height*sy}:{},t.priority?{priority:t.priority}:{},t.chainStep!==undefined?{chainStep:t.chainStep,chainState:t.chainState}:{}));
  return {bounds:{x:Math.round(area.x),y:Math.round(area.y),width:Math.round(area.width),height:Math.round(area.height)},payload:{visible:targets.length>0,width:area.width,height:area.height,targets}};
}
module.exports={transform};
