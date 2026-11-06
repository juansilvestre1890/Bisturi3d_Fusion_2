/** Diagnóstico topológico preliminar. No reemplaza un validador de impresión 3D. */
export function analyzeMeshGeometry(geometry,{tolerance=1e-5,maxTriangles=2000000}={}){
  const pos=geometry?.getAttribute?.('position');
  if(!pos||pos.itemSize<3)return {ok:false,level:'error',reason:'Sin posiciones de vértices',triangles:0};
  const index=geometry.index;
  const corners=index?index.count:pos.count;
  if(corners%3!==0)return {ok:false,level:'error',reason:'Número de vértices no divisible entre tres',triangles:0};
  const triangles=corners/3;
  if(triangles>maxTriangles)return {ok:false,level:'unknown',reason:'Malla demasiado grande para este análisis',triangles};
  const vertices=new Map(), edges=new Map();
  const scale=1/tolerance;
  let degenerate=0,invalid=0, area=0;
  const point=i=>[pos.getX(i),pos.getY(i),pos.getZ(i)];
  const vertexKey=(p)=>p.map(n=>Math.round(n*scale)).join(',');
  for(let f=0;f<triangles;f++){
    const ids=[0,1,2].map(c=>index?index.getX(3*f+c):3*f+c);
    if(ids.some(i=>!Number.isInteger(i)||i<0||i>=pos.count)){invalid++;continue}
    const pts=ids.map(point);
    if(pts.some(p=>p.some(n=>!Number.isFinite(n)))){invalid++;continue}
    const keys=pts.map(vertexKey);
    const a=pts[0],b=pts[1],c=pts[2];
    const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    const cr=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const thisArea=Math.hypot(...cr)/2;
    if(new Set(keys).size!==3||thisArea<=tolerance*tolerance){degenerate++;continue}
    area+=thisArea;
    for(const k of keys)vertices.set(k,true);
    for(let j=0;j<3;j++){
      const from=keys[j],to=keys[(j+1)%3], k=from<to?from+'|'+to:to+'|'+from;
      const e=edges.get(k)||{count:0,direction:0};e.count++;e.direction+=from<to?1:-1;edges.set(k,e);
    }
  }
  let boundary=0,nonManifold=0,winding=0;
  for(const e of edges.values()){
    if(e.count===1)boundary++;
    else if(e.count>2)nonManifold++;
    else if(e.count===2&&e.direction!==0)winding++;
  }
  const ok=triangles>0&&invalid===0&&degenerate===0&&boundary===0&&nonManifold===0&&winding===0;
  return {ok,level:ok?'ok':'warning',triangles,vertices:vertices.size,edges:edges.size,boundary,nonManifold,winding,degenerate,invalid,surfaceArea:area,reason:ok?'Sin problemas topológicos detectados (no garantiza imprimibilidad)':'Se encontraron posibles problemas de malla'};
}
