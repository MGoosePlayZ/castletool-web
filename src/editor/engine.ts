// @ts-nocheck
/* Art editor engine. Straight port of the editor prototype (castletool-art-editor.html): same layout, same behaviour,
 * same arc/bucket/paint code. The prototype's media screen and debug menu are gone; what the page used to do itself
 * (leave, image import, colour picker) goes through `host`. Dense on purpose: keep it close to the prototype so the two
 * stay easy to compare. */
import { PALETTES } from './palettes';

export interface EditorHost {
  arrow1: string; arrow2: string;                 // link display (line + tip) in frame cells
  exit(): void;                                   // close button
  importImage(): void;                            // "Image" in the new-layer menu
  changed(): void;                                // an edit finished (the screen saves it as one undo step)
  undo(): void; redo(): void;
  pickHost(el: HTMLElement | null): void;         // element inside the colour dropdown that the colour picker renders into (null = gone)
}
export interface EditorApi {
  loadDraw(drawData: any, keepUi?: boolean): string; setHistory(canUndo: boolean, canRedo: boolean): void; toDraw(drawData: any): void;
  dirty(): boolean; clean(): void; ready(): Promise<void>; setColor(hex: string): void; getColor(): string; dispose(): void;
}

export function createEditor(root: HTMLElement, host: EditorHost): EditorApi {
root.innerHTML = '<canvas id="cv"></canvas><button id="close" class="b" data-a="go"></button><div id="ur"></div><div id="tools"></div><div id="rt"><div id="top"></div><div id="sub"></div></div><div class="dd" id="dd"></div><div id="dr"></div><div id="pop" class="pop" hidden></div><div id="mod" hidden></div>';

let W=256,H=256;const $=s=>root.querySelector(s),LW=7,HIT=6;
// ---- icons: ci-* = real CastleIcon.ttf glyphs; md-* = svg stand-ins
const CI={close:0xE911,pencil:0xE917,bucket:0xE925,grab:0xE935,eraser:0xE922,squiggle:0xE919,line:0xE91A,square:0xE91B,circle:0xE918,triangle:0xE91C,pipette:0xE924,'left-arrow':0xE905,'horizontal-line':0xE942,settings:0xE95B,undo:0xE962,redo:0xE953,add:0xE950,delete:0xE960};
const MDI={brush:0xf00e3,spray:0xf0665,cut:0xf0190,vector_radius:0xf074a,cursor_move:0xf01be,'rotate-right':0xf0467,flip_h:0xf10e7,flip_v:0xf10e8,shapes:0xf0832,dots:0xf01d8,copy:0xf018f,paste:0xf0192,picture:0xf0eb0,swap:0xf04e1,eye:0xf0208,eyeoff:0xf0209,link:0xf0337};
const FA={chain:0xf0c1,chain_broken:0xf127},MX={merge_down:0xf0792,gesture:0xf07cb};
const P={modsq:'<path d="M9 9h6v6H9z"/>',e1:'<circle cx="12" cy="12" r="2" fill="currentColor"/>',e2:'<circle cx="12" cy="12" r="4.5" fill="currentColor"/>',e3:'<circle cx="12" cy="12" r="8" fill="currentColor"/>'};
const ic=(n,s=22,r=0)=>{const t=r?`transform:rotate(${r}deg)`:'',g=CI[n]?['ci',CI[n]]:MDI[n]?['mdi',MDI[n]]:FA[n]?['fa',FA[n]]:MX[n]?['mdx',MX[n]]:null;return g?`<span class="${g[0]}" style="font-size:${s}px;${t}">${String.fromCodePoint(g[1])}</span>`:`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="${t}">${P[n]}</svg>`};
const D=h=>`<div class="dock">${h}</div>`;
const B=(i,a,d='',on=0,c='',r=0)=>`<button class="b ${on?'on ':''}${c}" data-a="${a}" data-d="${d}">${ic(i,c.includes('s')?18:22,r)}</button>`;
const PI=(a,d,txt,icn,c='')=>`<button class="pi ${c}" data-a="${a}" data-d="${d}"><span class="ib">${icn}</span>${txt}</button>`;
// ---- color
const _c=document.createElement('canvas').getContext('2d');
const hex=c=>{_c.fillStyle='#000';_c.fillStyle=c;return _c.fillStyle};
const rgb=h=>[1,3,5].map(i=>parseInt(h.substr(i,2),16));
const PAL=PALETTES.map(([n,c])=>({n:n+' ('+c.length+')',c}));
// ---- state. frame links = shared data object between neighbouring frames of a layer (per layer)
const S={hu:0,hr:0,er:null,arc:false,dirty:0,pend:0,L:[],sel:0,cf:0,F:1,tool:'pencil',sub:{p:'squiggle',g:'modify',e:'cut',b:'fill'},size:8,color:'#000000',pip:0,dd:0,tab:'pal',szE:0,pal:0,open:1,pop:null,mod:0,tmp:null,view:{x:0,y:0,z:1}};
const TL={shapes:['pencil','bucket','grab','eraser'],paint:['brush','spray','bucket','grab','eraser']};
const nd=t=>t=='shapes'?{lines:[],fills:[],dirty:1}:(()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return{cv:c}})();
const cl=(d,t)=>{if(t=='shapes'){const n={lines:JSON.parse(JSON.stringify(d.lines)),fills:d.fills.map(s=>({...s})),dirty:1};return n}const n=nd(t);n.cv.getContext('2d').drawImage(d.cv,0,0);return n};
const addLayer=t=>{const n=Math.max(0,...S.L.map(l=>+(l.name.match(/(\d+)$/)||[0,0])[1]))+1;S.L.push({name:(t=='shapes'?'Shapes ':'Paint ')+n,type:t,vis:true,fr:Array.from({length:S.F},()=>nd(t))});S.sel=S.L.length-1};
const cur=()=>{const l=S.L[S.sel];return l&&{l,d:l.fr[S.cf]}};
const tools=()=>{const l=S.L[S.sel];return l?TL[l.type]:[]};
const rc=t=>{const r=t.getBoundingClientRect();return{left:r.left,top:r.top}};
const linked=(l,i)=>i>0&&l.fr[i]===l.fr[i-1];
// ---- geometry: line = {a,b,m(arc midpoint|null),c}
function sagK(p1,bp,p2){const dx=p2[0]-p1[0],dy=p2[1]-p1[1],L=Math.hypot(dx,dy);if(L<1e-9)return null;const n=[-dy/L,dx/L],m=[(p1[0]+p2[0])/2,(p1[1]+p2[1])/2];let h=(bp[0]-m[0])*n[0]+(bp[1]-m[1])*n[1];h=Math.sign(h)*Math.min(Math.abs(h),L/2);const a=Math.abs(h);if(a<1e-6)return null;
const R=(L*L/4+a*a)/(2*a),sg=Math.sign(h),c=[m[0]+n[0]*sg*(a-R),m[1]+n[1]*sg*(a-R)],ap=[m[0]+n[0]*h,m[1]+n[1]*h];return{c,r:R,ccw:(p1[0]-c[0])*(ap[1]-c[1])-(p1[1]-c[1])*(ap[0]-c[0])>0}}
function normM(a,m,b){const dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy);if(L<1e-6)return null;const n=[-dy/L,dx/L],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;let h=(m[0]-mx)*n[0]+(m[1]-my)*n[1];h=Math.sign(h)*Math.min(Math.abs(h),L/2);return Math.abs(h)<1?null:[mx+n[0]*h,my+n[1]*h]}
function quarter(a,b,k){const C1=[a[0],b[1]],C2=[b[0],a[1]],cen=k==2?(C1[1]>=C2[1]?C1:C2):(C1[1]<=C2[1]?C1:C2),ux=a[0]-cen[0],uy=a[1]-cen[1],vx=b[0]-cen[0],vy=b[1]-cen[1],o=[];for(let i=0;i<=24;i++){const f=Math.PI/2*i/24,c=Math.cos(f),s=Math.sin(f);o.push([cen[0]+ux*c+vx*s,cen[1]+uy*c+vy*s])}return o}
function pts(l,n){if(l.q)return quarter(l.a,l.b,l.q);const A=l.m&&sagK(l.a,l.m,l.b);if(!A)return[l.a,l.b];const T=Math.PI*2,md=v=>((v%T)+T)%T,a1=Math.atan2(l.a[1]-A.c[1],l.a[0]-A.c[0]),a2=Math.atan2(l.b[1]-A.c[1],l.b[0]-A.c[0]),sw=A.ccw?md(a2-a1):-md(a1-a2);n=n||Math.max(8,Math.min(96,Math.ceil(Math.abs(sw)*A.r/3)));const o=[];for(let i=0;i<=n;i++){const t=a1+sw*i/n;o.push([A.c[0]+A.r*Math.cos(t),A.c[1]+A.r*Math.sin(t)])}o[0]=l.a;o[n]=l.b;return o}
function stroke(c,l,w=LW){c.strokeStyle=l.c;c.lineWidth=w;c.lineCap='round';c.lineJoin='round';const p=pts(l);c.beginPath();c.moveTo(p[0][0],p[0][1]);for(let i=1;i<p.length;i++)c.lineTo(p[i][0],p[i][1]);c.stroke()}
const samp=l=>pts(l,24);
const segd=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy;let t=L?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L:0;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)};
const dist=(p,l)=>{const s=samp(l);let m=1e9;for(let i=0;i<s.length-1;i++)m=Math.min(m,segd(p,s[i],s[i+1]));return m};
const mp=l=>{if(l.q)return pts(l)[12];const m=l.m&&normM(l.a,l.m,l.b);return m||[(l.a[0]+l.b[0])/2,(l.a[1]+l.b[1])/2]};
// ---- pngFill. Walls = thin centre line (width ignored; the 3px stroke drawn on top hides the seam).
// Each fill remembers its pixels (px). On recompute it re-floods from them: a new line splits it into one fill per half; a gap (leak) makes it dormant.
function fills(d){if(!d.dirty)return;d.dirty=0;const o=document.createElement('canvas');o.width=W;o.height=H;const x=o.getContext('2d');d.lines.forEach(l=>stroke(x,{...l,c:'#000'},LW*0.5));const px=x.getImageData(0,0,W,H).data,wall=i=>px[i*4+3]>20;
const fc=document.createElement('canvas');fc.width=W;fc.height=H;const fx=fc.getContext('2d'),im=fx.createImageData(W,H),q=im.data,out=[];
d.fills.forEach(s=>{const src=s.px||(()=>{if(s.x<0||s.y<0||s.x>=W||s.y>=H)return[];if(!wall(s.y*W+s.x))return[s.y*W+s.x];for(let r=1;r<=4;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const u=s.x+dx,v=s.y+dy;if(u>=0&&v>=0&&u<W&&v<H&&!wall(v*W+u))return[v*W+u]}return[]})(),vis=new Uint8Array(W*H),comps=[];let leak=0;
for(const i0 of src){if(vis[i0]||wall(i0))continue;const st=[i0],reg=[];vis[i0]=1;
while(st.length){const i=st.pop();reg.push(i);const a=i%W,b=(i/W)|0;if(!a||!b||a==W-1||b==H-1){leak=1;break}for(const j of[i-1,i+1,i-W,i+W])if(!vis[j]&&!wall(j)){vis[j]=1;st.push(j)}}
if(leak)break;comps.push(reg)}
if(leak||!comps.length){out.push({...s,ok:0});return}
const col=rgb(hex(s.c));comps.forEach(reg=>{const ex=[];let fr=reg;for(let k=0;k<1;k++){const nx=[];for(const i of fr){const a=i%W,b=(i/W)|0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const u=a+dx,v=b+dy;if(u<0||v<0||u>=W||v>=H)continue;const k2=v*W+u;if(!vis[k2]&&wall(k2)){vis[k2]=1;nx.push(k2)}}}ex.push(...nx);fr=nx}
[reg,ex].forEach(L=>L.forEach(i=>{q[i*4]=col[0];q[i*4+1]=col[1];q[i*4+2]=col[2];q[i*4+3]=255}));out.push({x:reg[0]%W,y:(reg[0]/W)|0,c:s.c,px:reg,ex,ok:1})})});
d.fills=out;fx.putImageData(im,0,0);d.fc=fc;d.fx=fx;d.fim=im}
function sfill(d,p){const h=d.lines.find(l=>dist(p,l)<HIT);if(h){h.c=S.color;return}const x=Math.round(p[0]),y=Math.round(p[1]);if(x<0||y<0||x>=W||y>=H)return;
d.fills.push({x,y,c:S.color,px:null});d.dirty=1;fills(d);const last=d.fills[d.fills.length-1];
if(!last.ok)d.fills.pop();else d.fills=d.fills.filter(f=>f===last||!(f.px&&f.px.includes(y*W+x)));d.dirty=1}
const fillAt=(d,p)=>{const i=Math.round(p[1])*W+Math.round(p[0]);return d.fills.find(f=>f.ok&&f.px&&(f.set||(f.set=new Set(f.px))).has(i))};
const pxAt=(cv,p)=>{const x=Math.floor(p[0]),y=Math.floor(p[1]);if(x<0||y<0||x>=cv.width||y>=cv.height)return null;const q=cv.getContext('2d').getImageData(x,y,1,1).data;return q[3]?hex(`rgb(${q[0]},${q[1]},${q[2]})`):null};
function colorAt(l,d,p){if(l.type=='shapes'){const h=d.lines.find(n=>dist(p,n)<HIT);if(h)return h.c;fills(d);const f=fillAt(d,p);return f?f.c:null}return pxAt(d.cv,p)}
function swTarget(c,p){const d=c.d;if(c.l.type=='shapes'){const h=d.lines.find(l=>dist(p,l)<HIT);if(h)return h.c;fills(d);const f=fillAt(d,p);if(f)return f.c;return null}return pxAt(d.cv,p)}
function repl(cv,t){const x=cv.getContext('2d'),im=x.getImageData(0,0,cv.width,cv.height),q=im.data,tc=rgb(t),nc=rgb(S.color);for(let i=0;i<q.length;i+=4)if(q[i+3]&&Math.abs(q[i]-tc[0])+Math.abs(q[i+1]-tc[1])+Math.abs(q[i+2]-tc[2])<8){q[i]=nc[0];q[i+1]=nc[1];q[i+2]=nc[2]}x.putImageData(im,0,0)}
function swapAll(c,p){const d=c.d,t=swTarget(c,p);if(!t||t==S.color)return;
if(c.l.type=='shapes'){d.lines.forEach(l=>{if(l.c==t)l.c=S.color});d.fills.forEach(f=>{if(f.c==t)f.c=S.color});d.dirty=1}else repl(d.cv,t)}
// paint: mode 0 flood fill; 1 swap all matching pixels; color null = erase (cut)
function pfill(d,p,c,all){const x=d.cv.getContext('2d'),im=x.getImageData(0,0,W,H),q=im.data,sx=Math.floor(p[0]),sy=Math.floor(p[1]);if(sx<0||sy<0||sx>=W||sy>=H)return;const i0=(sy*W+sx)*4,t=[q[i0],q[i0+1],q[i0+2],q[i0+3]],col=c?rgb(hex(c)):[0,0,0],al=c?255:0;
const m=i=>Math.abs(q[i]-t[0])+Math.abs(q[i+1])-t[1]+0==0?0:0;
const eq=i=>Math.abs(q[i]-t[0])+Math.abs(q[i+1]-t[1])+Math.abs(q[i+2]-t[2])+Math.abs(q[i+3]-t[3])<8;
if(c&&eq(i0)&&q[i0+3]==255&&q[i0]==col[0]&&q[i0+1]==col[1]&&q[i0+2]==col[2])return;if(!c&&!t[3])return;
const set=o=>{q[o]=col[0];q[o+1]=col[1];q[o+2]=col[2];q[o+3]=al};
if(all){if(!t[3])return;for(let i=0;i<q.length;i+=4)if(eq(i))set(i)}
else{const seen=new Uint8Array(W*H),st=[sy*W+sx];seen[st[0]]=1;while(st.length){const i=st.pop(),a=i%W,b=(i/W)|0;set(i*4);[[a-1,b],[a+1,b],[a,b-1],[a,b+1]].forEach(([u,v])=>{if(u<0||v<0||u>=W||v>=H)return;const j=v*W+u;if(!seen[j]&&eq(j*4)){seen[j]=1;st.push(j)}})}}
x.putImageData(im,0,0)}
// bucket drag: fill what is under the pointer only if it is the same colour (or empty) as what the first tap filled
function bfill(c,p,tg){if((tg||null)===S.color)return;if((swTarget(c,p)||null)!==(tg||null))return;if(c.l.type=='shapes')sfill(c.d,p);else pfill(c.d,p,S.color)}
// ---- shape builders
function sq(raw){const idx=[0];let acc=0;for(let i=1;i<raw.length;i++){acc+=Math.hypot(raw[i][0]-raw[i-1][0],raw[i][1]-raw[i-1][1]);if(acc>=14){idx.push(i);acc=0}}if(idx[idx.length-1]!=raw.length-1)idx.push(raw.length-1);
const out=[];for(let k=1;k<idx.length;k++){const i=idx[k-1],j=idx[k],a=raw[i],b=raw[j];if(Math.hypot(b[0]-a[0],b[1]-a[1])<.5)continue;let m=null;
if(S.arc&&j-i>1)m=normM(a,raw[(i+j)>>1],b);out.push({a,b,m,c:S.color})}return out}
function mk(s){const a=s.p0,raw=s.raw,b=raw[raw.length-1],L=(x,y)=>({a:x,b:y,m:null,c:S.color}),k=S.sub.p;
if(k=='squiggle')return sq(raw);if(k=='line')return[L(a,b)];
if(k=='square'){const q=[a,[b[0],a[1]],b,[a[0],b[1]]];return q.map((v,i)=>L(v,q[(i+1)%4]))}
if(k=='triangle'){const q=[a,[a[0],b[1]],b];return q.map((v,i)=>L(v,q[(i+1)%3]))}
const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<2)return[];const r=len/2,cx_=(a[0]+b[0])/2,cy_=(a[1]+b[1])/2,ux=(b[0]-a[0])/len,uy=(b[1]-a[1])/len,nx=-uy,ny=ux,
pt=t=>[cx_+r*(Math.cos(t)*ux+Math.sin(t)*nx),cy_+r*(Math.cos(t)*uy+Math.sin(t)*ny)];
return[0,1,2,3].map(i=>({a:pt(Math.PI+i*Math.PI/2),b:pt(Math.PI+(i+1)*Math.PI/2),m:pt(Math.PI+i*Math.PI/2+Math.PI/4),c:S.color}))}
function erase(d,p,r,cut){let ch=0;const out=[];d.lines.forEach(l=>{if(cut){if(dist(p,l)<r)ch=1;else out.push(l);return}
if(l.q||(l.m&&sagK(l.a,l.m,l.b))){if(samp(l).some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<r))ch=1;else out.push(l);return}
const n=Math.max(1,Math.ceil(Math.hypot(l.b[0]-l.a[0],l.b[1]-l.a[1])));let run=null,hit=0;const fl=()=>{if(run&&Math.hypot(run[2]-run[0],run[3]-run[1])>=1)out.push({a:[run[0],run[1]],b:[run[2],run[3]],m:null,c:l.c});run=null};
for(let i=0;i<=n;i++){const t=i/n,x=l.a[0]+(l.b[0]-l.a[0])*t,y=l.a[1]+(l.b[1]-l.a[1])*t;if(Math.hypot(x-p[0],y-p[1])<r){hit=1;fl()}else if(!run)run=[x,y,x,y];else{run[2]=x;run[3]=y}}
if(!hit)out.push(l);else{ch=1;fl()}});if(ch){d.lines=out;d.dirty=1}}
// paint: hard-edged (no antialiasing): circles are stamped as integer pixel rows
function dot(x,px,py,r,er){const R=Math.floor(r);for(let dy=-R;dy<=R;dy++){const w=Math.floor(Math.sqrt(r*r-dy*dy+.25));if(er)x.clearRect(px-w,py+dy,2*w+1,1);else x.fillRect(px-w,py+dy,2*w+1,1)}}
function paintAt(d,a,b,er,r){const x=d.cv.getContext('2d');x.fillStyle=S.color;const ax=Math.round(a[0]),ay=Math.round(a[1]),bx=Math.round(b[0]),by=Math.round(b[1]);
if(S.tool=='spray'){const s=S.size,gap=Math.max(2,s/2),n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/gap));for(let k=1;k<=n;k++){const cx=a[0]+(b[0]-a[0])*k/n,cy=a[1]+(b[1]-a[1])*k/n;for(let i=0;i<s+6;i++){const q=Math.sqrt(Math.random())*s,t=Math.random()*6.283;x.fillRect(Math.round(cx+Math.cos(t)*q),Math.round(cy+Math.sin(t)*q),1,1)}}return}
const n=Math.max(Math.abs(bx-ax),Math.abs(by-ay),1);for(let i=0;i<=n;i++)dot(x,Math.round(ax+(bx-ax)*i/n),Math.round(ay+(by-ay)*i/n),r,er)}
function xf(k){const c=cur();if(!c)return;const f=k=='rot'?(x,y)=>[W/2-(y-H/2),H/2+(x-W/2)]:k=='fh'?(x,y)=>[W-x,y]:(x,y)=>[x,H-y],d=c.d;
if(c.l.type=='shapes'){const m=p=>p&&f(p[0],p[1]);d.lines.forEach(l=>{if(l.q){l.m=pts(l)[12];l.q=0}});d.lines.forEach(l=>{l.a=m(l.a);l.b=m(l.b);l.m=m(l.m)});const pf=(x,y)=>f(x+.5,y+.5).map(Math.floor),mi=L=>L&&L.map(i=>{const[a,b]=pf(i%W,(i/W)|0);return a>=0&&b>=0&&a<W&&b<H?b*W+a:-1}).filter(i=>i>=0);d.fills.forEach(s=>{[s.x,s.y]=pf(s.x,s.y);s.px=mi(s.px);s.ex=mi(s.ex);s.set=null});d.dirty=1}
else{const t=document.createElement('canvas');t.width=W;t.height=H;t.getContext('2d').drawImage(d.cv,0,0);th();const x=d.cv.getContext('2d');x.clearRect(0,0,W,H);x.save();
if(k=='rot'){x.translate(W/2,H/2);x.rotate(Math.PI/2);x.translate(-W/2,-H/2)}else if(k=='fh'){x.translate(W,0);x.scale(-1,1)}else{x.translate(0,H);x.scale(1,-1)}x.imageSmoothingEnabled=false;x.drawImage(t,0,0);x.restore()}}
// ---- frame thumbnails: zoomed to the drawn content, black background (white when selected)
let thT=0;const th=()=>{clearTimeout(thT);thT=setTimeout(thumbs,30)};
function bbox(l,d){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const add=(x,y)=>{if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y};
if(l.type=='shapes'){d.lines.forEach(n=>samp(n).forEach(q=>add(q[0],q[1])));d.fills.forEach(f=>f.ok&&add(f.x,f.y));}
else{const q=d.cv.getContext('2d').getImageData(0,0,W,H).data;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(q[(y*W+x)*4+3])add(x,y)}return x0>x1?null:[x0,y0,x1,y1]}
function thumbs(){root.querySelectorAll('canvas.th').forEach(c=>{const[i,f]=c.dataset.t.split(',').map(Number),l=S.L[i];if(!l)return;const d=l.fr[f],x=c.getContext('2d'),N=76,sel=i==S.sel&&f==S.cf;x.clearRect(0,0,N,N);x.fillStyle=sel?'#fff':'#000';x.fillRect(0,0,N,N);const bb=bbox(l,d);if(!bb)return;
const w=Math.max(bb[2]-bb[0],4),h=Math.max(bb[3]-bb[1],4),s=Math.min((N-12)/Math.max(w,h),8);x.save();x.translate(N/2-(bb[0]+bb[2])/2*s,N/2-(bb[1]+bb[3])/2*s);x.scale(s,s);x.imageSmoothingEnabled=false;
if(l.type=='paint')x.drawImage(d.cv,0,0);else{fills(d);if(d.fc)x.drawImage(d.fc,0,0);d.lines.forEach(n=>stroke(x,n))}x.restore()})}
// ---- render
const cv=$('#cv'),cx=cv.getContext('2d');let dpr=1,raf=0,PAT=null;const rq=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;render()})};
function render(){const v=S.view;cx.setTransform(1,0,0,1,0,0);cx.clearRect(0,0,cv.width,cv.height);cx.setTransform(dpr*v.z,0,0,dpr*v.z,dpr*v.x,dpr*v.y);
cx.fillStyle=PAT||(PAT=(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.fillStyle='#7a7a7a';x.fillRect(0,0,32,32);x.fillStyle='#575757';x.fillRect(0,0,16,16);x.fillRect(16,16,16,16);return cx.createPattern(c,'repeat')})());cx.fillRect(0,0,W,H);cx.save();cx.beginPath();cx.rect(0,0,W,H);cx.clip();cx.imageSmoothingEnabled=false;
S.L.forEach((l,i)=>{if(!l.vis)return;const d=l.fr[S.cf];if(l.type=='paint')cx.drawImage(d.cv,0,0);else{if(!d.fc||!st)fills(d);if(d.fc)cx.drawImage(d.fc,d.off?d.off[0]:0,d.off?d.off[1]:0);d.lines.forEach(n=>stroke(cx,n));if(i==S.sel&&S.tmp)S.tmp.forEach(n=>stroke(cx,n))}});cx.restore();
if(S.er){cx.fillStyle='rgba(255,255,255,.3)';cx.beginPath();cx.arc(S.er.p[0],S.er.p[1],S.er.r,0,7);cx.fill()}
cx.strokeStyle='#444';cx.lineWidth=1/v.z;cx.strokeRect(0,0,W,H);
const c=cur();if(c&&c.l.type=='shapes'&&S.tool=='grab'&&['modify','arc'].includes(S.sub.g)){const h=5/v.z;cx.lineWidth=1.5/v.z;cx.strokeStyle='#000';cx.fillStyle='#fff';
c.d.lines.forEach(l=>{(S.sub.g=='modify'?[l.a,l.b]:[mp(l)]).forEach(q=>{cx.beginPath();if(S.sub.g=='arc')cx.arc(q[0],q[1],h,0,7);else cx.rect(q[0]-h,q[1]-h,2*h,2*h);cx.fill();cx.stroke()})})}}
function fit(){dpr=devicePixelRatio||1;cv.width=innerWidth*dpr;cv.height=innerHeight*dpr;render()}
function home(){const z=Math.min((innerWidth-24)/W,2.2);S.view={z,x:(innerWidth-W*z)/2,y:Math.max(64,innerHeight*.4-H*z/2)}}
// ---- input
let ptrs=new Map(),st=null,pz=null,pend=null;
const snap=c=>c.l.type=='paint'?(()=>{const n=document.createElement('canvas');n.width=W;n.height=H;n.getContext('2d').drawImage(c.d.cv,0,0);return n})():{lines:JSON.stringify(c.d.lines),fills:c.d.fills.map(s=>({...s}))};
function undoPend(){if(!pend||performance.now()-pend.t>350)return;const{c,s}=pend;if(c.l.type=='paint'){const x=c.d.cv.getContext('2d');x.clearRect(0,0,W,H);x.drawImage(s,0,0)}else{c.d.lines=JSON.parse(s.lines);c.d.fills=s.fills;c.d.dirty=1;c.d.off=null}S.tmp=null}const mark=()=>{S.dirty=1};const wk=[];const done=()=>{if(!--S.pend)wk.splice(0).forEach(r=>r())};
const toArt=e=>[(e.clientX-S.view.x)/S.view.z,(e.clientY-S.view.y)/S.view.z];
// only the shapes tools are kept inside the canvas (paint culls by itself, erasers may reach past the edge)
const lockP=(p,c)=>c&&c.l.type=='shapes'&&S.tool!='eraser'?[Math.max(0,Math.min(W,p[0])),Math.max(0,Math.min(H,p[1]))]:p;
cv.onpointerdown=e=>{try{cv.setPointerCapture(e.pointerId)}catch(_){}ptrs.set(e.pointerId,[e.clientX,e.clientY]);
if(ptrs.size==2){undoPend();pend=null;st=null;S.tmp=null;S.er=null;const[a,b]=[...ptrs.values()];pz={d:Math.hypot(a[0]-b[0],a[1]-b[1]),m:[(a[0]+b[0])/2,(a[1]+b[1])/2],v:{...S.view}};render();return}
if(ptrs.size==1)down(e)};
cv.onpointermove=e=>{if(!ptrs.has(e.pointerId))return;ptrs.set(e.pointerId,[e.clientX,e.clientY]);
if(ptrs.size==2&&pz){const[a,b]=[...ptrs.values()],z=Math.max(.3,Math.min(12,pz.v.z*Math.hypot(a[0]-b[0],a[1]-b[1])/pz.d)),m=[(a[0]+b[0])/2,(a[1]+b[1])/2];S.view={z,x:m[0]-(pz.m[0]-pz.v.x)/pz.v.z*z,y:m[1]-(pz.m[1]-pz.v.y)/pz.v.z*z};rq();return}
if(st)move(e)};
cv.onpointerup=cv.onpointercancel=e=>{const s=st,n=ptrs.size;ptrs.delete(e.pointerId);if(ptrs.size<2)pz=null;if(!ptrs.size)pend=null;st=null;if(s&&n==1)up(s)};
cv.addEventListener('wheel',e=>{e.preventDefault();const v=S.view,z=Math.max(.3,Math.min(12,v.z*Math.exp(-e.deltaY*.0015))),k=z/v.z;v.x=e.clientX-(e.clientX-v.x)*k;v.y=e.clientY-(e.clientY-v.y)*k;v.z=z;rq()},{passive:false});
const er=()=>Math.max(.5,S.size/2);
function down(e){let p=toArt(e);
if(S.pip){for(let i=S.L.length-1;i>=0;i--){const l=S.L[i];if(!l.vis)continue;const c=colorAt(l,l.fr[S.cf],p);if(c){S.color=c;break}}S.pip=0;ui();return}
let c=cur();if(!c||!c.l.vis)return;p=lockP(p,c);if(linked(c.l,S.cf)){const l=c.l,old=l.fr[S.cf],n=cl(old,l.type);for(let i=S.cf;i<S.F&&l.fr[i]===old;i++)l.fr[i]=n;c=cur();ui()}
const t=S.tool,d=c.d,sh=c.l.type=='shapes';pend={c,s:snap(c),t:performance.now()};mark();
if(t=='bucket'){if(S.sub.b=='swap'){swapAll(c,p);render();th();host.changed();return}const tg=swTarget(c,p);st={k:'bk',tg,l:p};bfill(c,p,tg);render();return}
if(sh){
if(t=='pencil')st={k:'draw',p0:p,raw:[p]};
else if(t=='grab'){const g=S.sub.g;if(g=='move'){d.off=[0,0];st={k:'mv',l:p}}else{let best=null,bd=20/S.view.z;d.lines.forEach(l=>(g=='modify'?[l.a,l.b]:[mp(l)]).forEach(q=>{const h=Math.hypot(q[0]-p[0],q[1]-p[1]);if(h<bd){bd=h;best=g=='modify'?q:l}}));
if(best)st=g=='modify'?{k:'mod',c:[best[0],best[1]]}:{k:'arc',l:best}}}
else if(t=='eraser'){st={k:'er'};const r=S.sub.e=='cut'?6:er();S.er={p,r};erase(d,p,r,S.sub.e=='cut');render()}}
else if(t=='grab'){const b=document.createElement('canvas');b.width=W;b.height=H;b.getContext('2d').drawImage(d.cv,0,0);st={k:'pmv',l:p,b}}
else if(t=='eraser'&&S.sub.e=='cut'){pfill(d,p,null);render();th();host.changed()}
else{st={k:'pt',l:p};if(t=='eraser')S.er={p,r:er()};paintAt(d,p,p,t=='eraser',t=='eraser'?er():S.size/2);render()}}
function move(e){const c=cur();if(!c)return;const p=lockP(toArt(e),c);const d=c.d;
if(S.er)S.er.p=p;
if(st.k=='bk'){const a=st.l,n=Math.max(1,Math.ceil(Math.hypot(p[0]-a[0],p[1]-a[1])/3));for(let i=1;i<=n;i++)bfill(c,[a[0]+(p[0]-a[0])*i/n,a[1]+(p[1]-a[1])*i/n],st.tg);st.l=p;rq();return}
if(st.k=='draw'){if(S.sub.p=='squiggle'){const l=st.raw[st.raw.length-1];if(Math.hypot(p[0]-l[0],p[1]-l[1])>1.5)st.raw.push(p)}else st.raw=[st.p0,p];S.tmp=mk(st)}
else if(st.k=='mod'){const dx=p[0]-st.c[0],dy=p[1]-st.c[1];d.lines.forEach(l=>['a','b'].forEach(k=>{if(Math.hypot(l[k][0]-st.c[0],l[k][1]-st.c[1])<.5){l[k]=[p[0],p[1]];if(l.m)l.m=normM(l.a,[l.m[0]+dx/2,l.m[1]+dy/2],l.b)}}));st.c=p}
else if(st.k=='arc'){const l=st.l;l.q=0;l.m=normM(l.a,p,l.b)}
else if(st.k=='mv'){const dx=Math.round(p[0]-st.l[0]),dy=Math.round(p[1]-st.l[1]);if(!dx&&!dy)return;d.lines.forEach(l=>{['a','b','m'].forEach(k=>{if(l[k])l[k]=[l[k][0]+dx,l[k][1]+dy]})});d.fills.forEach(s=>{s.x+=dx;s.y+=dy});d.off[0]+=dx;d.off[1]+=dy;st.l=[st.l[0]+dx,st.l[1]+dy]}
else if(st.k=='er')erase(d,p,S.sub.e=='cut'?6:er(),S.sub.e=='cut');
else if(st.k=='pt'){paintAt(d,st.l,p,S.tool=='eraser',S.tool=='eraser'?er():S.size/2);st.l=p}
else if(st.k=='pmv'){const x=d.cv.getContext('2d');x.clearRect(0,0,W,H);x.imageSmoothingEnabled=false;x.drawImage(st.b,Math.round(p[0]-st.l[0]),Math.round(p[1]-st.l[1]))}
rq()}
function up(s){const c=cur();if(s.k=='draw'&&S.tmp&&c)S.tmp.filter(l=>Math.hypot(l.b[0]-l.a[0],l.b[1]-l.a[1])>.5).forEach(l=>c.d.lines.push({a:[...l.a],b:[...l.b],m:l.m&&[...l.m],c:l.c}));
if(c&&c.l.type=='shapes'){const d=c.d;if(s.k=='mv'&&d.off&&(d.off[0]||d.off[1])){const[ox,oy]=d.off,sh=L=>L&&L.map(i=>{const a=i%W+ox,b=((i/W)|0)+oy;return a>=0&&b>=0&&a<W&&b<H?b*W+a:-1}).filter(i=>i>=0);d.fills.forEach(f=>{f.px=sh(f.px);f.ex=sh(f.ex);f.set=null})}d.dirty=1;d.off=null}S.tmp=null;S.er=null;render();th();host.changed()}
// ---- ui
const TR=()=>D(B('rotate-right','xf','rot'))+D(B('flip_h','xf','fh'))+D(B('flip_v','xf','fv'));
const SZ=()=>D(B('gesture','sub','e:1',S.sub.e!='cut')+B('cut','sub','e:cut',S.sub.e=='cut'));
const SZS=[1,2,3,4,6,8,12,16,24,32,48,64,96,128,256];
// handle position 0..1 along the track; sizes between steps sit proportionally between them, above 256 sits at the top
const slP=()=>{const v=S.size;if(v>=256)return 1;if(v<=1)return 0;let i=0;while(SZS[i+1]<=v)i++;return(i+(v-SZS[i])/(SZS[i+1]-SZS[i]))/(SZS.length-1)};
const slG=()=>{const q=slP();return[24+(1-q)*126,2+q*26]};   // handle top, dot diameter (linear in position, not in size)
function slView(){const h=$('#slr .h'),u=$('#slr u');if(!h)return;const[t,d]=slG();h.style.top=t+'px';u.style.width=u.style.height=d+'px';h.classList.toggle('pl',S.size>256);const l=$('#szl');if(l)l.textContent=S.size}
let slOn=0;const slSet=e=>{const r=$('#slr').getBoundingClientRect(),t=Math.max(0,Math.min(1,(e.clientY-r.top-43)/126));S.size=SZS[Math.round((1-t)*(SZS.length-1))];slView()};
root.addEventListener('pointerdown',e=>{if(e.target.closest('#szl,#szi'))return;const s=e.target.closest('#slr');if(s){slOn=1;s.setPointerCapture(e.pointerId);slSet(e)}});
root.addEventListener('pointermove',e=>{if(slOn)slSet(e)});root.addEventListener('pointerup',()=>slOn=0);root.addEventListener('pointercancel',()=>slOn=0);
const szApply=()=>{const i=$('#szi');if(i){const n=Math.round(+i.value);if(n>=1)S.size=Math.min(4096,n)}S.szE=0;ui()};
root.addEventListener('focusout',e=>{if(e.target.id=='szi'&&S.szE)szApply()});
root.addEventListener('keydown',e=>{if(e.target.id=='szi'&&e.key=='Enter'){e.preventDefault();szApply()}});
const SL=()=>{const[t,d]=slG();return`<div class="sl" id="slr">${S.szE?`<input class="sn" id="szi" type="number" inputmode="numeric" min="1" value="${S.size}">`:`<span class="sn" id="szl" data-a="szedit">${S.size}</span>`}<i></i><div class="h${S.size>256?' pl':''}" style="top:${t}px"><u style="width:${d}px;height:${d}px"></u></div></div>`};
function subHtml(ty){const T=S.tool;if(!ty)return'';
if(T=='bucket')return D(B('bucket','sub','b:fill',S.sub.b=='fill')+B('swap','sub','b:swap',S.sub.b=='swap'));
if(ty=='shapes'){if(T=='pencil')return D(['squiggle','line','square','circle','triangle'].map(k=>B(k,'sub','p:'+k,S.sub.p==k)).join(''));
if(T=='grab')return D([['modsq','modify'],['vector_radius','arc'],['cursor_move','move']].map(([i,k])=>B(i,'sub','g:'+k,S.sub.g==k)).join(''))+TR();
if(T=='eraser')return SZ()+(S.sub.e=='cut'?'':SL())}
if(T=='grab')return TR();if(T=='eraser')return SZ()+(S.sub.e=='cut'?'':SL());return SL()}
function ddTabs(){return[['pal','Palette'],['pick','Color']].map(([k,n])=>`<button data-a="tab" data-d="${k}" class="${S.tab==k?'on':''}">${n}</button>`).join('')}
function ddPal(){const p=PAL[S.pal];return`<div class="ph"><span>${p.n}</span><span>${B('left-arrow','palp',-1,0,'s rd')}${B('left-arrow','palp',1,0,'s rd',180)}</span></div><div class="pg">${p.c.map(c=>`<i data-a="col" data-d="${c}" class="${c==S.color?'sel':''}" style="background:${c}"></i>`).join('')}</div>`}
// the colour picker lives inside the dropdown: its host element is created once and kept while the Color tab is open
function ddUpdate(on){const dd=$('#dd');if(!on){if(dd.firstChild){dd.innerHTML='';host.pickHost(null)}return}
if(!dd.firstChild)dd.innerHTML='<div class="tabs" id="ddt"></div><div id="ddb"></div>';
$('#ddt').innerHTML=ddTabs();const b=$('#ddb');
if(S.tab=='pal'){if($('#pkh'))host.pickHost(null);b.innerHTML=ddPal()}
else if(!$('#pkh')){b.innerHTML='<div id="pkh" class="pkh"></div>';host.pickHost($('#pkh'))}}
const lnHtml=(first,end)=>`<div class="ai">${first&&end?'':`<img class="a1" src="${host.arrow1}" alt="">`}${end?`<img class="a2" src="${host.arrow2}" alt="">`:''}</div>`;
function drHtml(){const F=S.F;let h=`<div class="dh">${B('add','nl')}${B('left-arrow','tog','',0,'n',S.open?-90:90)}</div><div class="gw"><div class="g" style="grid-template-columns:112px repeat(${F},38px) 38px">`;
for(let i=S.L.length-1;i>=0;i--){const l=S.L[i];h+=`<div class="k ${i==S.sel?'on':''}"><button class="b s n" data-a="eye" data-d="${i}">${ic(l.vis?'eye':'eyeoff',18)}</button><span data-a="lay" data-d="${i}">${l.name}</span></div>`;
for(let f=0;f<F;f++){const sel=i==S.sel&&f==S.cf,m=linked(l,f)?lnHtml(!linked(l,f-1),!linked(l,f+1)):`<canvas class="th" width="76" height="76" data-t="${i},${f}"></canvas>`;h+=`<div class="c ${i==S.sel?'r ':''}${sel?'on':''}" data-a="cell" data-d="${i},${f}">${m}${sel?`<span class="dots">${ic('dots',13)}</span>`:''}</div>`}h+='<div></div>'}
h+='<div class="k"></div>';for(let f=0;f<F;f++)h+=`<div class="n ${f==S.cf?'on':''}" data-a="fr" data-d="${f}">${f+1}</div>`;
return h+`<button class="b s n" data-a="addf" style="margin:3px 0 0 6px">${ic('add',18)}</button></div></div>`}
function popHtml(){const p=S.pop;if(!p)return'';const c=cur();
if(p.k=='nl')return[['shapes','shapes','Shapes'],['paint','brush','Paint'],['image','picture','Image']].map(([t,i,n])=>PI('addl',t,n,ic(i,20))).join('');
if(p.k=='lay'&&c)return PI('ulay','','Move up',ic('left-arrow',18,90))+PI('dlay','','Move down',ic('left-arrow',18,-90))+(c.l.type=='shapes'?PI('conv','','Convert to paint',ic('brush',18)):'')+(S.sel>0?PI('merge','','Merge down',ic('merge_down',18)):'')+PI('xlay','','Delete layer',ic('delete',18),'dn');
if(p.k=='cell'&&c)return(S.cf?PI('lnk','',linked(c.l,S.cf)?'Unlink from previous':'Link to previous',ic(linked(c.l,S.cf)?'chain_broken':'chain',18)):'')+PI('copy','','Copy',ic('copy',18))+(S.clip&&S.clip.type==c.l.type?PI('paste','','Paste',ic('paste',18)):'');
if(p.k=='fr')return PI('fm',-1,'Move left',ic('left-arrow',18))+PI('fm',1,'Move right',ic('left-arrow',18,180))+PI('delf','','Delete frame',ic('delete',18),'dn')}
function doMerge(i,clear){const u=S.L[i],lo=S.L[i-1],pm=new Map(),fr=[];if(u.type!=lo.type)conv(u.type=='shapes'?u:lo);const type=u.type;
for(let f=0;f<S.F;f++){const a=lo.fr[f],b=u.fr[f];let m=pm.get(a);if(!m)pm.set(a,m=new Map());let n=m.get(b);if(!n){
if(type=='shapes')n={lines:JSON.parse(JSON.stringify([...a.lines,...b.lines])),fills:clear?[]:[...a.fills,...b.fills].map(x=>({...x,set:null})),dirty:1};
else{n=nd('paint');const x=n.cv.getContext('2d');x.drawImage(a.cv,0,0);x.drawImage(b.cv,0,0)}m.set(b,n)}fr.push(n)}
lo.fr=fr;lo.type=type;S.L.splice(i,1);S.sel=i-1}
function conv(l){if(l.type!='shapes')return;const m=new Map();l.fr=l.fr.map(d=>{if(m.has(d))return m.get(d);const n=nd('paint'),x=n.cv.getContext('2d');fills(d);if(d.fc)x.drawImage(d.fc,0,0);
d.lines.forEach(ln=>{x.fillStyle=ln.c;const p=pts(ln,64);for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1],k=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*2));for(let q=0;q<=k;q++)dot(x,Math.round(a[0]+(b[0]-a[0])*q/k),Math.round(a[1]+(b[1]-a[1])*q/k),LW/2,false)}});m.set(d,n);return n});l.type='paint'}
function modHtml(){const m=S.mod;if(!m)return'';if(m=='mconf')return`<div class="md"><div class="box"><h3>Merge down</h3><div>${S.mc} frame(s) have buckets in both layers. Merging removes all bucketing in the merged layer. Continue?</div><button class="pill o" style="color:#F87171" data-a="mgok">Remove buckets and merge</button><button class="pill o" data-a="mod" data-d="0">Cancel</button></div></div>`;return''}
function ui(){fixTool();const l=S.L[S.sel],ty=l&&l.type,add=['pencil','bucket','brush','spray'].includes(S.tool)&&ty;
$('#ur').innerHTML=D(`<button class="b" data-a="undo" ${S.hu?'':'disabled'}>${ic('undo')}</button><button class="b" data-a="redo" ${S.hr?'':'disabled'}>${ic('redo')}</button>`);
$('#tools').innerHTML=tools().length?D(tools().map(t=>B(t,'tool',t,S.tool==t)).join('')):'';$('#sub').innerHTML=subHtml(ty);
$('#top').innerHTML=add?`<button class="sw" data-a="sw" style="background:${S.color}"></button>`+D(B('pipette','pip','',S.pip)):'';
ddUpdate(!!(add&&S.dd));
const g=$('#dr .gw'),sl=g&&[g.scrollLeft,g.scrollTop];$('#dr').className=S.open?'':'cl';$('#dr').innerHTML=drHtml();const g2=$('#dr .gw');if(sl){g2.scrollLeft=sl[0];g2.scrollTop=sl[1]}
const po=$('#pop'),ph=popHtml();po.hidden=!ph;po.innerHTML=ph;if(S.pop){po.style.left=Math.max(6,Math.min(S.pop.r.left,innerWidth-200))+'px';po.style.bottom=(innerHeight-S.pop.r.top+6)+'px'}
const dm=$('#mod');dm.hidden=!S.mod;dm.innerHTML=modHtml();render();thumbs()}
function fixTool(){const t=tools();if(t.length&&!t.includes(S.tool))S.tool=t[0]}
let PREV=null;const tg=(k,d,t)=>PREV&&PREV.key==k+d?null:{k,r:rc(t),key:k+d};
const MUT=new Set(['xf','eye','ulay','dlay','xlay','paste','merge','mgok','conv','addf','fm','delf','lnk']);
function act(a,d,t){const f=S.cf;if(MUT.has(a))mark();switch(a){
case'go':host.exit();break;case'undo':host.undo();break;case'redo':host.redo();break;case'tool':S.tool=d;S.pip=0;break;case'sub':{const[k,v]=d.split(':');S.sub[k]=v;break}case'szedit':S.szE=1;queueMicrotask(()=>{const i=$('#szi');if(i){i.focus();i.select()}});break
case'xf':xf(d);break;case'sw':S.dd=!S.dd;break;case'tab':S.tab=d;break;case'col':S.color=d;break;case'palp':S.pal=(S.pal+ +d+PAL.length)%PAL.length;break;case'pip':S.pip=!S.pip;break;case'tog':S.open=!S.open;break;
case'nl':S.pop=tg('nl','',t);break;case'addl':S.pop=null;if(d=='image')host.importImage();else{addLayer(d);mark()}break;case'eye':S.L[d].vis=!S.L[d].vis;break;
case'lay':if(S.sel==+d)S.pop=tg('lay',d,t);else{S.sel=+d;S.pop=null}break;
case'ulay':case'dlay':{const i=S.sel,j=a=='ulay'?i+1:i-1;if(S.L[j]){[S.L[i],S.L[j]]=[S.L[j],S.L[i]];S.sel=j}S.pop=null;break}
case'xlay':S.L.splice(S.sel,1);S.sel=Math.max(0,Math.min(S.sel,S.L.length-1));S.pop=null;break;
case'cell':{const[i,g]=d.split(',').map(Number);if(i==S.sel&&g==S.cf)S.pop=tg('cell',d,t);else{S.sel=i;S.cf=g;S.pop=null}break}
case'fr':if(S.cf==+d)S.pop=tg('fr',d,t);else{S.cf=+d;S.pop=null}break;
case'copy':{const c=cur();if(c)S.clip={type:c.l.type,d:cl(c.d,c.l.type)};S.pop=null;break}
case'paste':{const c=cur();if(c&&S.clip&&S.clip.type==c.l.type){const old=c.l.fr[f],n=cl(S.clip.d,c.l.type);for(let i=f;i<S.F&&c.l.fr[i]===old;i++)c.l.fr[i]=n}S.pop=null;break}
case'merge':{const i=S.sel;S.pop=null;if(i>0){const u=S.L[i],lo=S.L[i-1];let n=0;if(u.type=='shapes'&&lo.type=='shapes')for(let f=0;f<S.F;f++)if(lo.fr[f].fills.length&&u.fr[f].fills.length)n++;if(n){S.mod='mconf';S.mc=n}else doMerge(i,false)}break}
case'mgok':doMerge(S.sel,true);S.mod=0;break;
case'conv':{const c=cur();if(c)conv(c.l);S.pop=null;break}
case'addf':S.F++;S.L.forEach(l=>l.fr.push(l.fr[l.fr.length-1]));S.cf=S.F-1;break;
case'fm':{const j=f+ +d;if(j>=0&&j<S.F){S.L.forEach(l=>[l.fr[f],l.fr[j]]=[l.fr[j],l.fr[f]]);S.cf=j}S.pop=null;break}
case'lnk':{const l=S.L[S.sel];if(l&&f>0){const old=l.fr[f];if(linked(l,f)){const n=cl(old,l.type);for(let i=f;i<S.F&&l.fr[i]===old;i++)l.fr[i]=n}else{const n=l.fr[f-1];for(let i=f;i<S.F&&l.fr[i]===old;i++)l.fr[i]=n}}S.pop=null;break}
case'delf':if(S.F>1){S.L.forEach(l=>l.fr.splice(f,1));S.F--;S.cf=Math.min(f,S.F-1)}S.pop=null;break;
case'mod':S.mod=d=='0'?0:d;break}ui();if(MUT.has(a)||a=='addl'&&d!='image'||a=='mgok')host.changed()}
root.addEventListener('click',e=>{if(e.target.id=='szi')return;const t=e.target.closest('[data-a]'),inn=e.target.closest('.pop,.dd,.box');PREV=S.pop;if(!inn&&!(t&&t.dataset.a=='sw')){S.pop=null;S.dd=0}
if(t)act(t.dataset.a,t.dataset.d,t);else if(!inn)ui()});
// ---- json io. Castle blueprint (Drawing2.drawData) is imported and edits are written back into drawData; rest of the blueprint untouched
const c2h=c=>'#'+c.slice(0,3).map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
// Castle fillPng -> bucket fills: one fill per same-colour connected region, seeded from its interior (never the sliver under the line),
// so they react to edits like buckets made here (split by a new line, cleared when the outline opens)
function extractFills(d,cvs){const q=cvs.getContext('2d').getImageData(0,0,W,H).data,lab=new Int32Array(W*H).fill(-1),ds=new Int16Array(W*H),key=i=>q[i*4]<<16|q[i*4+1]<<8|q[i*4+2],nb=i=>{const a=i%W,b=(i/W)|0;return[[a-1,b],[a+1,b],[a,b-1],[a,b+1]]};let id=0;
for(let s=0;s<W*H;s++){if(lab[s]>=0||!q[s*4+3])continue;const k=key(s),st=[s],reg=[];lab[s]=id;
while(st.length){const i=st.pop();reg.push(i);for(const[u,v]of nb(i)){if(u<0||v<0||u>=W||v>=H)continue;const j=v*W+u;if(lab[j]<0&&q[j*4+3]&&key(j)==k){lab[j]=id;st.push(j)}}}
let fr=[];for(const i of reg){let e=0;for(const[u,v]of nb(i))if(u<0||v<0||u>=W||v>=H||lab[v*W+u]!=id)e=1;if(e){ds[i]=1;fr.push(i)}}
for(let n=1;fr.length;n++){const nx=[];for(const i of fr)for(const[u,v]of nb(i)){if(u<0||v<0||u>=W||v>=H)continue;const j=v*W+u;if(lab[j]==id&&!ds[j]){ds[j]=n+1;nx.push(j)}}fr=nx}
let seeds=reg.filter(i=>ds[i]>=6);if(!seeds.length){let bi=reg[0];for(const i of reg)if(ds[i]>ds[bi])bi=i;seeds=[bi]}
d.fills.push({x:seeds[0]%W,y:(seeds[0]/W)|0,c:'#'+k.toString(16).padStart(6,'0'),px:seeds,ok:1});id++}d.dirty=1}
function loadCastle(dd){const ppu=dd.fillPixelsPerUnit||25.6;let half=Math.max(5,(dd.scale||10)/2);const ext=(a,b,c,e)=>{half=Math.max(half,Math.abs(a),Math.abs(b),Math.abs(c),Math.abs(e))};
(dd.framesBounds||[]).forEach(b=>ext(b.minX,b.maxX,b.minY,b.maxY));dd.layers.forEach(L=>L.frames.forEach(f=>{const b=f.fillImageBounds;if(f.fillPng&&b)ext(b.minX/ppu,b.maxX/ppu,b.minY/ppu,b.maxY/ppu)}));
W=H=Math.min(2048,Math.round(half*2*ppu));W=H=W+(W&1);/* even size: canvas centre = whole pixel, so export is exact */const X=v=>W/2+v*ppu,Y=v=>H/2+v*ppu,F=Math.max(1,...dd.layers.map(l=>l.frames.length));S.F=F;S.cf=0;S.clip=null;
S.L=dd.layers.map(L=>{const type=L.isBitmap?'paint':'shapes',fr=[];L.frames.forEach((f,i)=>{if(i&&f.isLinked){fr.push(fr[i-1]);return}const d=nd(type);
if(type=='shapes')d.lines=(f.pathDataList||[]).map(p=>({a:[X(p.p[0]),Y(p.p[1])],b:[X(p.p[2]),Y(p.p[3])],m:p.bp?[X(p.bp.x),Y(p.bp.y)]:null,q:!p.bp&&(p.s==2||p.s==3)?p.s:0,c:c2h(p.c||[1,1,1,1])}));
if(f.fillPng&&f.fillImageBounds){const b=f.fillImageBounds,im=new Image();S.pend++;im.onerror=()=>done();im.onload=()=>{const tg=type=='shapes'?nd('paint').cv:d.cv,x=tg.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(im,Math.round(W/2+b.minX),Math.round(H/2+b.minY));if(type=='shapes')extractFills(d,tg);render();th();done()};im.src='data:image/png;base64,'+f.fillPng}
fr.push(d)});while(fr.length<F)fr.push(nd(type));return{name:L.title||'Layer',type,vis:L.isVisible!==false,fr}});S.sel=S.L.length-1;home();return`castle drawing: ${S.L.length} layer(s), ${F} frame(s), ${W}x${H}px`}
// ---- export: rebuild Castle Drawing2.drawData from the editor layers (Castle only reads drawData; it drops unknown keys such as artEditor)
// units = (canvas px - W/2) / fillPixelsPerUnit. Vector layers -> pathDataList (+ fillPng for buckets); paint layers -> isBitmap + fillPng.
// fillImageBounds = integer px box of the cropped PNG (1 png px = 1 bounds px); frames with no pixels get zero bounds and NO fillPng.
function toDraw(dd){
const ppu=dd.fillPixelsPerUnit||25.6,r5=v=>Math.round(v*1e5)/1e5,cx=W/2,cy=H/2,X=v=>r5((v-cx)/ppu),Y=v=>r5((v-cy)/ppu),
col=h=>[1,3,5].map(i=>r5(parseInt(h.substr(i,2),16)/255)).concat(1),FB=[],
hu=W/2/ppu,ext=(f,a,b,c,e)=>{const k=v=>Math.max(-hu,Math.min(hu,v));a=k(a);b=k(b);c=k(c);e=k(e);const o=FB[f]||(FB[f]={minX:1e9,maxX:-1e9,minY:1e9,maxY:-1e9});o.minX=Math.min(o.minX,a);o.maxX=Math.max(o.maxX,b);o.minY=Math.min(o.minY,c);o.maxY=Math.max(o.maxY,e)},
crop=cv=>{const q=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;
for(let y=0;y<cv.height;y++)for(let i=0;i<cv.width;i++)if(q[(y*cv.width+i)*4+3]){if(i<x0)x0=i;if(i>x1)x1=i;if(y<y0)y0=y;if(y>y1)y1=y}
if(x1<0)return null;const w=x1-x0+1,h=y1-y0+1,o=document.createElement('canvas');o.width=w;o.height=h;o.getContext('2d').drawImage(cv,-x0,-y0);
const mx=Math.round(x0-cx),my=Math.round(y0-cy);return{png:o.toDataURL('image/png').split(',')[1],b:{minX:mx,maxX:mx+w,minY:my,maxY:my+h}}},
memo=new Map(),
fd=(l,d)=>{if(memo.has(d))return memo.get(d);const r={paths:[],png:null,b:null,box:null};let c=null;
if(l.type=='shapes'){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
d.lines.forEach(n=>{const p={p:[X(n.a[0]),Y(n.a[1]),X(n.b[0]),Y(n.b[1])],s:1,f:false,c:col(n.c)};
if(n.q)p.s=n.q;else if(n.m){const m=normM(n.a,n.m,n.b);if(m)p.bp={x:X(m[0]),y:Y(m[1])}}
r.paths.push(p);pts(n).forEach(([u,v])=>{x0=Math.min(x0,X(u));x1=Math.max(x1,X(u));y0=Math.min(y0,Y(v));y1=Math.max(y1,Y(v))})});
if(r.paths.length)r.box=[x0,x1,y0,y1];
fills(d);if(d.fc&&d.fills.some(s=>s.ok))c=crop(d.fc)}
else c=crop(d.cv);
if(c){r.png=c.png;r.b=c.b;const bx=[c.b.minX/ppu,c.b.maxX/ppu,c.b.minY/ppu,c.b.maxY/ppu];r.box=r.box?[Math.min(r.box[0],bx[0]),Math.max(r.box[1],bx[1]),Math.min(r.box[2],bx[2]),Math.max(r.box[3],bx[3])]:bx}
memo.set(d,r);return r};
dd.layers=S.L.map((l,li)=>({title:l.name,id:'layer'+(li+1),isVisible:l.vis!==false,isBitmap:l.type=='paint',isAvatar:false,
frames:l.fr.map((d,fi)=>{const r=fd(l,d),lk=linked(l,fi),f={isLinked:lk,pathDataList:lk?[]:r.paths,fillImageBounds:lk||!r.b?{minX:0,maxX:0,minY:0,maxY:0}:r.b,avatarX:0,avatarY:0,avatarRadius:5};
if(!lk&&r.png)f.fillPng=r.png;if(r.box)ext(fi,...r.box);return f})}));
dd.numTotalLayers=S.L.length;
dd.framesBounds=Array.from({length:S.F},(_,i)=>{const o=FB[i];return o?{minX:r5(o.minX),maxX:r5(o.maxX),minY:r5(o.minY),maxY:r5(o.maxY)}:{minX:-5,maxX:5,minY:-5,maxY:5}})}
// ---- init
$('#close').innerHTML=ic('close');
addLayer('shapes');const onResize=()=>fit();addEventListener('resize',onResize);fit();home();ui();

return {
  loadDraw(dd,keep){const v=S.view,sel=S.sel,cf=S.cf,m=loadCastle(dd);if(!S.L.length){addLayer('shapes');S.sel=0}if(keep){S.view=v;S.sel=Math.max(0,Math.min(sel,S.L.length-1));S.cf=Math.min(cf,S.F-1);S.pop=null}S.dirty=0;ui();return m},
  setHistory(u,r){S.hu=u?1:0;S.hr=r?1:0;ui()},
  toDraw,
  dirty:()=>!!S.dirty,
  clean(){S.dirty=0},
  ready:()=>S.pend?new Promise(r=>wk.push(r)):Promise.resolve(),
  setColor(h){S.color=h;const sw=$('.sw');if(sw)sw.style.background=h},
  getColor:()=>S.color,
  dispose(){removeEventListener('resize',onResize);cancelAnimationFrame(raf);clearTimeout(thT);root.innerHTML=''}
};
}
