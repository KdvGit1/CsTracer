"use client";
import { useState } from 'react';
import { radarMapFor, worldToRadar } from '../map-data';
import type { DuelEncounter } from '../lib/types';
import DuelPovView from './DuelPovView';

const reason: Record<string,string> = {visible:'Görüş hattı açık',wall:'Arada duvar var',smoke:'Duman görüşü kapatıyor','outside-fov':'Rakip bakış alanı dışında',unknown:'Görüş doğrulanamadı'};
export default function DuelSceneView({duel,selectedShotIndex=0,showAllShots=false,mapName}:{duel:DuelEncounter;selectedShotIndex?:number;showAllShots?:boolean;mapName?:string}) {
 const [mode,setMode]=useState('map');
 const [wide,setWide]=useState(false);
 const scene=duel.scene, map=radarMapFor(mapName);
 const shots=showAllShots?duel.shots:duel.shots.slice(selectedShotIndex,selectedShotIndex+1);
 const own=scene?.camera.origin, enemy=scene?.targetPoints[0];
 const project=(p:number[])=>{const r=worldToRadar(p[0],p[1],map!);return {x:r.left*10.24,y:r.top*10.24};};
 const a=map&&own?project(own):null, b=map&&enemy?project(enemy):null;
 const span=wide?1024:Math.min(1024,Math.max(320,a&&b?Math.max(Math.abs(a.x-b.x)*1.9,Math.abs(a.y-b.y)*2.8):240));
 const cx=a?(a.x+(b?.x??a.x))/2:512,cy=a?(a.y+(b?.y??a.y))/2:512;
 const left=Math.max(0,Math.min(1024-span,cx-span/2)),top=Math.max(0,Math.min(1024-span*2/3,cy-span/3));
 const unit=span/600;
 const yaw=scene?Math.atan2(-scene.camera.forward[1],scene.camera.forward[0]):0;
 const half=scene?Math.atan(scene.camera.tanH):Math.PI/3;
 const cone=a?`${a.x},${a.y} ${a.x+Math.cos(yaw-half)*span*.55},${a.y+Math.sin(yaw-half)*span*.55} ${a.x+Math.cos(yaw+half)*span*.55},${a.y+Math.sin(yaw+half)*span*.55}`:'';
 const lower=Boolean(map?.lowerImage&&own&&own[2]-64<(map.lowerMaxZ??-Infinity));
 const otherFloor=Boolean(map?.lowerImage&&own&&enemy&&((own[2]-64<(map.lowerMaxZ??-Infinity))!==(enemy[2]-64<(map.lowerMaxZ??-Infinity))));
 const traces=shots.map(shot=>({
  start:map&&shot.origin?project(shot.origin):null,
  impacts:map?shot.impacts.map(i=>project(i.point)):[],
  aim:map&&shot.origin&&shot.direction?project(shot.origin.map((v,i)=>v+shot.direction![i]*Math.max(128,shot.target?Math.hypot(...shot.target.map((n,j)=>n-shot.origin![j])):700))):null,
  color:showAllShots?(shot.owner==='self'?'#b9ee64':'#ff8a83'):'#ffcb7a'
 }));
 return <div className="da-scene">
  <div className="da-scene-head"><div><span className="da-kicker">OLAY YERİ</span><h4>{duel.outcome==='loss'?'Öldüğün an':duel.outcome==='win'?'Rakibi düşürdüğün an':'Temasın son anı'}</h4></div><div className="da-segment" aria-label="Olay yeri görünümü"><button aria-pressed={mode==='map'} onClick={()=>setMode('map')}>Haritada</button><button aria-pressed={mode==='pov'} onClick={()=>setMode('pov')}>Bakış açısı</button></div></div>
  {mode==='pov'?<DuelPovView duel={duel} selectedShotIndex={selectedShotIndex} showAllShots={showAllShots}/>:<>
   {map&&a&&scene?<div className="da-radar-scene">
    <svg viewBox={`${left} ${top} ${span} ${span*2/3}`} role="img" aria-label={`${map.label}: senin ve rakibin temas sonundaki konumu, bakış alanın ve ${showAllShots?'tüm atışlar':'seçili atış'}`}>
     <defs><clipPath id={`radar-${duel.id}`}><rect x={left} y={top} width={span} height={span*2/3}/></clipPath></defs>
     <g clipPath={`url(#radar-${duel.id})`}>
      <image href={lower?map.lowerImage:map.image} x="0" y="0" width="1024" height="1024" opacity=".72"/>
      <polygon points={cone} fill="#a9da5826" stroke="#b9ee6455" strokeWidth={unit}/>
      {scene.smokes.map((s,i)=>{const p=project(s.center);return <circle key={i} cx={p.x} cy={p.y} r={s.radius/map.scale} fill="#ccd4d138" stroke="#ccd4d1" strokeWidth={unit} strokeDasharray={`${3*unit} ${5*unit}`}/>;})}
      {b&&<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={scene.visibility.visible?'#b9ee6480':'#e2a077aa'} strokeWidth={unit*1.5} strokeDasharray={`${4*unit} ${6*unit}`}/>}
      {traces.map(({start,impacts,aim,color},index)=><g key={index} data-shot-trace={index} opacity={showAllShots ? .75 : 1}>
       {start&&impacts.map((p,i)=><g key={i}><line x1={start.x} y1={start.y} x2={p.x} y2={p.y} stroke={color} strokeWidth={unit*2}/><path d={`M${p.x-4*unit},${p.y-4*unit} l${8*unit},${8*unit} m${-8*unit},0 l${8*unit},${-8*unit}`} stroke={color} strokeWidth={unit*2}/></g>)}
       {start&&aim&&!impacts.length&&<line x1={start.x} y1={start.y} x2={aim.x} y2={aim.y} stroke={color} strokeWidth={unit*2} strokeDasharray={`${8*unit} ${5*unit}`}/>}
      </g>)}
      {[[a,'S','#b9ee64'],...(b?[[b,'R','#ff8a83']]:[])].map(([p,l,c])=>{const point=p as {x:number;y:number};return <g key={String(l)}><circle cx={point.x} cy={point.y} r={12*unit} fill={String(c)} stroke="#101815" strokeWidth={3*unit}/><text x={point.x} y={point.y+4*unit} fontSize={12*unit} fontWeight="800" textAnchor="middle" fill="#101815">{String(l)}</text></g>;})}
     </g>
    </svg>
    <div className="da-map-caption"><span>{map.label} · {duel.zone}{lower?' · Alt kat':''}</span><button onClick={()=>setWide(!wide)}>{wide?'Yakın plan':'Haritayı genişlet'}</button></div>
   </div>:<div className="da-empty">Bu temasın harita konumu bulunamadı. Bakış açısı görünümünü deneyebilirsin.</div>}
   <div className="da-map-legend"><span><i className="da-dot da-self"/>S · Sen{showAllShots?' / atışların':''}</span><span><i className="da-dot da-enemy"/>R · Rakip{showAllShots?' / atışları':''}</span><span>Kesik çizgi · atış yönü</span><span>× · Kayıtlı çarpma</span></div>
   <div className="da-scene-caption"><strong>{reason[scene?.visibility.reason||'unknown']}</strong><span>{otherFloor?'Rakip farklı katta; harita senin katını gösteriyor. ':''}{showAllShots?'Konumlar temasın son anına ait; tüm atışlar kendi ateşlenme konumlarından birlikte çizilir.':'Konumlar temasın son anına, atış izi seçtiğin atışa ait.'}</span></div>
  </>}
 </div>;
}
