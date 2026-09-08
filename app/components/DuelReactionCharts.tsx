"use client";
import {useState} from 'react';
import type {DuelAnalystData} from '../lib/types';
const value=(n:number|null|undefined)=>n==null?'—':`${n} ms`;
const metrics={ms:{label:'Sen · ilk ateş',color:'#b9ee64'},opponentMs:{label:'Rakip · ilk ateş',color:'#ff8a83'},damageMs:{label:'Sen · ilk hasar',color:'#83c9e7'}};
export default function DuelReactionCharts({analysis,onOpen}:{analysis:DuelAnalystData;onOpen:(id:string)=>void}) {
 const [metric,setMetric]=useState<keyof typeof metrics>('ms');
 const [selected,setSelected]=useState(0);
 const samples=analysis.reaction.samples;
 const current=samples[Math.min(selected,Math.max(0,samples.length-1))];
 const numbers=samples.map(s=>s[metric]).filter((n):n is number=>n!==null);
 const ceiling=Math.max(400,Math.ceil(Math.max(...numbers,0)/200)*200);
 const x=(i:number)=>64+i*816/Math.max(1,samples.length-1),y=(n:number)=>268-n/ceiling*224;
 const sorted=[...numbers].sort((a,b)=>a-b),median=sorted.length?(sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2:null;
 const color=metrics[metric].color;
 // Missing values split the line; they never become zero or bridge a gap.
 const lines:number[][]=[];let run:number[]=[];
 samples.forEach((s,i)=>{if(s[metric]===null){if(run.length)lines.push(run);run=[];}else run.push(i);});if(run.length)lines.push(run);
 const maxCount=Math.max(1,...analysis.reaction.histogram.map(b=>b.count));
 return <div className="da-reaction-page">
  <div className="da-metric-grid">{[['Medyan tepki',value(analysis.reaction.medianMs),'Geçerli ilk ateş sürelerinin ortası'],['P90 tepki',value(analysis.reaction.p90Ms),'Ölçümlerin %90’ı bu sürenin altında'],['Ölçülen temas',String(samples.length),'Hedefi ve başlangıcı doğrulanmış'],['Hariç tutulan',String(analysis.reaction.excluded),'Prefire, belirsiz veya eksik kayıt']].map(([label,note,help])=><div className="da-metric" key={label}><span>{label}</span><strong>{note}</strong><small>{help}</small></div>)}</div>
  <div className="da-chart-card"><div className="da-card-heading"><div><span className="da-kicker">TEMAS SIRASINA GÖRE</span><h3>Tepkin maç boyunca nasıl değişti?</h3></div><label className="da-field">Gösterilen ölçüm<select value={metric} onChange={e=>setMetric(e.target.value as keyof typeof metrics)}>{Object.entries(metrics).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}</select></label></div>
   {numbers.length?<><div className="da-plot-scroll"><svg viewBox="0 0 920 324" role="img" aria-label={`${metrics[metric].label}; yatay eksen temas sırası, dikey eksen milisaniye`}>
    {[0,.25,.5,.75,1].map(r=><g key={r}><line x1="64" x2="880" y1={y(r*ceiling)} y2={y(r*ceiling)} stroke="#ffffff12"/><text x="48" y={y(r*ceiling)+4} textAnchor="end" fill="#98aaa2" fontSize="17">{Math.round(r*ceiling)}</text></g>)}
    <text x="18" y="21" fill="#98aaa2" fontSize="17">ms</text>
    {median!==null&&<g><line x1="64" x2="880" y1={y(median)} y2={y(median)} stroke={color} strokeOpacity=".4" strokeDasharray="5 6"/><text x="875" y={Math.max(18,y(median)-10)} textAnchor="end" fill={color} fontSize="17">Medyan {Math.round(median)} ms</text></g>}
    {lines.filter(l=>l.length>1).map((l,i)=><polyline key={i} points={l.map(index=>`${x(index)},${y(samples[index][metric]!)}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeOpacity=".6"/>)}
    {current&&<line x1={x(Math.min(selected,samples.length-1))} x2={x(Math.min(selected,samples.length-1))} y1="40" y2="278" stroke="#ffffff35" strokeDasharray="3 4"/>}
    {samples.map((s,i)=><g key={s.id}>{s[metric]!==null&&<circle cx={x(i)} cy={y(s[metric]!)} r={i===selected?6:4} fill={color} stroke="#101914" strokeWidth="2"><title>Temas {i+1} · Round {s.round}: {s[metric]} ms</title></circle>}{(i===0||i===samples.length-1||i%Math.ceil(samples.length/10)===0)&&<text x={x(i)} y="298" textAnchor="middle" fill="#98aaa2" fontSize="17">{i+1}</text>}</g>)}
    <text x="472" y="321" textAnchor="middle" fill="#98aaa2" fontSize="17">Temas sırası</text>
   </svg></div>
   <div className="da-chart-inspector"><label className="da-field">Teması incele<select value={Math.min(selected,samples.length-1)} onChange={e=>setSelected(Number(e.target.value))}>{samples.map((s,i)=><option key={s.id} value={i}>{i+1}. temas · Round {s.round}</option>)}</select></label><div><span>Sen · ilk ateş</span><strong>{value(current?.ms)}</strong></div><div><span>Rakip · ilk ateş</span><strong>{value(current?.opponentMs)}</strong></div><div><span>Sen · ilk hasar</span><strong>{value(current?.damageMs)}</strong></div><button onClick={()=>current&&onOpen(current.id)}>Düelloyu aç ↗</button></div></>:<div className="da-empty">Seçili ölçüm için geçerli kayıt bulunamadı. Eksik kayıtlar grafiğe sıfır olarak eklenmez.</div>}
  </div>
  <div className="da-chart-card"><div className="da-card-heading"><div><span className="da-kicker">İLK ATEŞ SÜRESİ</span><h3>En çok hangi aralıktasın?</h3></div><span className="da-muted">{samples.length} geçerli temas</span></div><div className="da-distribution">{analysis.reaction.histogram.map(b=><div key={b.label}><strong>{b.count}<small> temas</small></strong><div className="da-dist-track"><i style={{height:`${b.count/maxCount*100}%`}}/></div><span>{b.label}</span><small>{samples.length?(b.count/samples.length*100).toLocaleString('tr-TR',{maximumFractionDigits:1}):0}%</small></div>)}</div></div>
  <details className="da-details"><summary>Bu süreler nasıl hesaplanıyor?</summary><p>Görünürlük başlangıcından ilk ateşe kadar geçen demo süresidir; saf insan refleksi değildir. Prefire, hedefi tahmini, başlangıcı belirsiz ve 1500 ms üzerindeki temaslar tepki özetine girmez. İlk hasar ve rakip ölçümü ayrı serilerdir. Ping bu sürelerden çıkarılmaz. Tick çözünürlüğü {value(analysis.precisionMs)}.</p></details>
 </div>;
}
