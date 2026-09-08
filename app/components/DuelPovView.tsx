"use client";
import {useState} from 'react';
import {dot3,projectPoint,projectShotDirection} from '../../shared/duel_view.mjs';
import type {DuelEncounter} from '../lib/types';
export default function DuelPovView({duel,selectedShotIndex=0,showAllShots=false}:{duel:DuelEncounter;selectedShotIndex?:number;showAllShots?:boolean}) {
 const [zoom,setZoom]=useState(1);
 const scene=duel.scene,shot=duel.shots[selectedShotIndex];
 const shots=showAllShots?duel.shots:duel.shots.slice(selectedShotIndex,selectedShotIndex+1);
 if(!scene)return <div className="da-empty">Oyuncu bakışı için demoyu yeniden analiz et.</div>;
 const projected=scene.targetPoints.map(p=>projectPoint(scene.camera,p));
 const head=projected[0],body=projected[1],hips=projected[2];
 const toSvg=(p:NonNullable<ReturnType<typeof projectPoint>>)=>({x:480+(p.x-.5)*960*zoom,y:270+(p.y-.5)*540*zoom});
 const pos=head?toSvg(head):null;
 const inView=Boolean(pos&&pos.x>=0&&pos.x<=960&&pos.y>=0&&pos.y<=540);
 const target=scene.targetPoints[0],relative=target?.map((n,i)=>n-scene.camera.origin[i]);
 const bearing=relative?Math.round(Math.atan2(dot3(relative,scene.camera.right),dot3(relative,scene.camera.forward))*180/Math.PI):null;
 const behind=relative?dot3(relative,scene.camera.forward)<=0:false;
 const hidden=scene.visibility.visible!==true;
 const color=hidden?'#a7b5b2':'#ff9589';
 const traces=shots.map(s=>({
  guide:!s.impacts.length?projectShotDirection(scene.camera,s):null,
  impactPoints:s.impacts.map(i=>projectPoint(scene.camera,i.point)).filter((p):p is NonNullable<typeof p>=>p!==null),
  color:showAllShots?(s.owner==='self'?'#b9ee64':'#ff8a83'):'#ffce84'
 }));
 const bounds=projected.filter((p):p is NonNullable<typeof p>=>p!==null).map(toSvg);
 const top=bounds.length?Math.min(...bounds.map(p=>p.y)):0,bottom=bounds.length?Math.max(...bounds.map(p=>p.y)):0;
 const headRadius=head?Math.max(3,Math.min(35,5/(head.depth*scene.camera.tanH*2)*960*zoom)):0;
 return <div className="da-pov">
  <div className="da-pov-toolbar"><span>Nişangaha göre rakibin konumu</span><label>Yakınlaştır<select aria-label="Bakış yakınlaştırması" value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label></div>
  <svg className="da-pov-diagram" viewBox="0 0 960 540" role="img" aria-label={`Oyuncu bakışı şeması. ${behind?'Rakip arkanda.':inView?'Rakip bakış alanında.':'Rakip bu görünümün dışında.'}`}>
   <defs><pattern id={`pov-grid-${duel.id}`} width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#ffffff08" strokeWidth="1"/></pattern></defs>
   <rect width="960" height="540" fill="#0c1410"/><rect width="960" height="540" fill={`url(#pov-grid-${duel.id})`}/>
   <path d="M0 270H960 M480 0V540" stroke="#ffffff14" strokeDasharray="4 8"/>
   <rect x="28" y="28" width="904" height="484" rx="10" fill="none" stroke="#354d3c"/>
   {inView&&pos&&body&&hips&&<g stroke={color} fill={color} strokeWidth={Math.max(3,headRadius*.75)} strokeLinecap="round" strokeLinejoin="round" opacity={hidden ? .55 : .95}>
    <circle cx={pos.x} cy={pos.y} r={headRadius}/>
    {[[0,1],[1,2],[3,4],[1,3],[1,4],[2,5],[2,6]].map(([i,j])=>{const a=projected[i]&&toSvg(projected[i]!),b=projected[j]&&toSvg(projected[j]!);return a&&b?<line key={`${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeDasharray={scene.pointVisibility?.[i]&&scene.pointVisibility?.[j]?undefined:'5 5'}/>:null;})}
   </g>}
   {inView&&pos&&<g fill="none" stroke={color} strokeWidth="1.5"><rect x={pos.x-headRadius*2-10} y={top-headRadius-10} width={headRadius*4+20} height={Math.max(40,bottom-top+headRadius+20)} rx="5" strokeOpacity=".35" strokeDasharray={hidden?'4 5':undefined}/><path d={`M${pos.x} ${top-headRadius-12} L${Math.max(110,Math.min(810,pos.x+110))} ${Math.max(72,top-65)}`}/><text x={Math.max(110,Math.min(810,pos.x+110))} y={Math.max(62,top-75)} fill={color} stroke="none" fontSize="18" textAnchor="middle">Rakip{hidden?' · gizli konum':''}</text></g>}
   {traces.map(({guide,impactPoints,color:traceColor},index)=><g key={index} data-shot-trace={index} opacity={showAllShots ? .75 : 1}>
    {guide&&<g stroke={traceColor} fill="none"><line x1={toSvg(guide.start).x} y1={toSvg(guide.start).y} x2={toSvg(guide.end).x} y2={toSvg(guide.end).y} strokeWidth="2" strokeDasharray="8 8"/>{!guide.clipped&&<circle cx={toSvg(guide.end).x} cy={toSvg(guide.end).y} r="7" strokeWidth="2"/>}</g>}
    {impactPoints.map((p,i)=>{const a=toSvg(p);return <path key={i} d={`M${a.x-6} ${a.y-6} l12 12 m-12 0 l12 -12`} stroke={traceColor} strokeWidth="3"/>;})}
   </g>)}
   <circle cx="480" cy="270" r="15" fill="#0c1410" fillOpacity=".8" stroke="#daeed0" strokeWidth="1.5"/><path d="M454 270H473 M487 270H506 M480 244V263 M480 277V296" stroke="#daeed0" strokeWidth="2"/>
   <text x="480" y="324" fill="#acc4b1" fontSize="14" textAnchor="middle">Nişangahın</text>
   {!inView&&<g><path d={bearing!==null&&bearing<0?'M80 258l-16 12 16 12':'M880 258l16 12-16 12'} fill="none" stroke="#ff9589" strokeWidth="4"/><text x="480" y="415" textAnchor="middle" fill="#d6b7ae" fontSize="20">{!target?'Rakip konumu yok':behind?'Rakip arkanda':zoom>1?'Rakip yakınlaştırılan alanın dışında':'Rakip ekranın dışında'}</text></g>}
  </svg>
  <div className="da-pov-facts"><div><span>Rakibin yönü</span><strong>{bearing==null?'—':`${Math.abs(bearing)}° ${bearing<0?'solunda':'sağında'}`}</strong></div><div><span>Görüş hattı</span><strong>{scene.visibility.visible?'Açık':scene.visibility.reason==='wall'?'Duvarla kapalı':scene.visibility.reason==='smoke'?'Dumanla kapalı':'Kapalı / belirsiz'}</strong></div><div><span>{showAllShots?'Gösterilen atışlar':'Seçili atış'}</span><strong>{showAllShots?`Tümü · ${shots.length}`:shot?`${selectedShotIndex+1} · ${shot.owner==='self'?'Sen':'Rakip'}`:'Yok'}</strong></div></div>
  {showAllShots&&<div className="da-map-legend"><span><i className="da-dot da-self"/>Senin atışların</span><span><i className="da-dot da-enemy"/>Rakibin atışları</span></div>}
  <p className="da-pov-note">Temsili nişangah şeması · {showAllShots?'Tüm atışlar son bakışına göre aynı şemada gösterilir; bu bakışın dışında kalan izler görünmeyebilir.':'Son bakışın, rakip konumu ve seçili atış.'} Boş halka yaklaşık atış yönü, çarpı kayıtlı çarpma noktasıdır. Gizli oyuncu konumu analiz için gösterilir.</p>
 </div>;
}
