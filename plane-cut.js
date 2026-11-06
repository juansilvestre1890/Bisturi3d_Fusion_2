import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/+esm';

// Plane cut of an individual triangular mesh in its LOCAL XY coordinates.
// Caps are constructed from closed intersection contours; open/non-manifold
// sources are rejected where a closed contour cannot be reconstructed.
export function sliceMeshHorizontal(geometry,level,{capMaterialIndex=null}={}){
  const pos=geometry?.getAttribute('position');
  if(!pos ||pos.count<3)throw Error('La malla no contiene triángulos.');
  const index=geometry.getIndex(), triangles=index?index.count/3:pos.count/3;
  if(triangles>250000)throw Error('Corte limitado a 250 000 triángulos por malla en esta versión.');
  const box=geometry.boundingBox||geometry.computeBoundingBox()||geometry.boundingBox;
  const span=Math.max(...box.getSize(new THREE.Vector3()).toArray(),1);
  const eps=span*1e-6;
  if(level<=box.min.y+eps||level>=box.max.y-eps)throw Error('El plano debe cruzar el interior de la malla.');
  const tops=[],bottoms=[],segments=[];
  const names=['uv','uv1','uv2','color'].filter(name=>geometry.getAttribute(name));
  const data=new Map([[tops,{attributes:{},materials:[]}],[bottoms,{attributes:{},materials:[]}]]);
  for(const out of data.values())for(const name of names)out.attributes[name]=[];
  const capIndex=capMaterialIndex??Math.max(0,...geometry.groups.map(g=>g.materialIndex))+1;
  let materialIndex=0,isCap=false;
  const interpolate=(a,b,t)=>{const p=a.clone().lerp(b,t);p.cutAttrs={};for(const name of names)p.cutAttrs[name]=a.cutAttrs[name].map((x,i)=>x+(b.cutAttrs[name][i]-x)*t);return p};
  const vertex=i=>{const p=new THREE.Vector3(pos.getX(i),pos.getY(i),pos.getZ(i));p.cutAttrs={};for(const name of names){const attr=geometry.getAttribute(name);p.cutAttrs[name]=Array.from({length:attr.itemSize},(_,c)=>attr.getComponent(i,c));}return p};
  const pushTri=(out,a,b,c)=>{out.push(...a.toArray(),...b.toArray(),...c.toArray());const record=data.get(out);record.materials.push(isCap?capIndex:materialIndex);for(const p of [a,b,c])for(const name of names){const size=geometry.getAttribute(name).itemSize;const value=isCap?Array.from({length:size},(_,i)=>name==='color'?1:i===0?(p.x-box.min.x)/span:i===1?(p.z-box.min.z)/span:0):p.cutAttrs[name];record.attributes[name].push(...value);}};
  const clip=(polygon,upper)=>{
    let output=[];
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      const da=a.y-level,db=b.y-level;
      const insideA=upper?da>=0:da<=0,insideB=upper?db>=0:db<=0;
      if(insideA)output.push(a);
      if(da*db<0){const t=da/(da-db);const p=interpolate(a,b,t);p.y=level;output.push(p)}
    }
    if(output.length>2)for(let i=1;i<output.length-1;i++)pushTri(upper?tops:bottoms,output[0],output[i],output[i+1]);
  };
  for(let j=0;j<triangles;j++){
    materialIndex=geometry.groups.find(g=>3*j>=g.start&&3*j<g.start+g.count)?.materialIndex??0;
    // Snap the tolerance band once, before both contour extraction and clipping.
    // This keeps every cap seam on the same plane as the side triangles.
    const v=[0,1,2].map(k=>{const p=vertex(index?index.getX(j*3+k):j*3+k);if(Math.abs(p.y-level)<=eps)p.y=level;return p});
    const above=v.some(p=>p.y>level),below=v.some(p=>p.y<level);
    const onPlane=v.filter(p=>p.y===level).length;
    if(onPlane===3)throw Error('Una cara coincide con el plano; desplaza ligeramente el corte.');
    if((above&&below)||onPlane===2){
      const crossings=[];
      for(let i=0;i<3;i++){
        const a=v[i],b=v[(i+1)%3],da=a.y-level,db=b.y-level;
        if(da===0)crossings.push(a);
        if(da*db<0){
          const p=a.clone().lerp(b,da/(da-db));p.y=level;crossings.push(p);
        }
      }
      if(crossings.length===2 && crossings[0].distanceToSquared(crossings[1])>eps*eps)segments.push(crossings);
    }
    clip(v,true);clip(v,false);
  }
  if(!segments.length)throw Error('No se pudo obtener una intersección cerrada con este plano.');
  const pointKey=p=>`${Math.round(p.x/eps)},${Math.round(p.z/eps)}`;
  const nodes=new Map();
  const add=(p,q)=>{const key=pointKey(p);if(!nodes.has(key))nodes.set(key,{p,neighbors:new Set()});nodes.get(key).neighbors.add(pointKey(q))};
  for(const [a,b] of segments){add(a,b);add(b,a)}
  // All intersection contours must form closed, non-branching rings.
  if([...nodes.values()].some(n=>n.neighbors.size!==2))throw Error('El corte atraviesa bordes abiertos o geometría no manifold; no se pueden cerrar ambas piezas con seguridad.');
  const visited=new Set(),loops=[];
  for(const start of nodes.keys()){
    if(visited.has(start))continue;
    const keys=[],seen=new Set();let curr=start,prev=null;
    while(!seen.has(curr)){
      if(!nodes.has(curr))throw Error('Contorno incompleto.');
      seen.add(curr);visited.add(curr);keys.push(curr);
      const next=[...nodes.get(curr).neighbors].find(k=>k!==prev);
      prev=curr;curr=next;
      if(keys.length>nodes.size+1)throw Error('Contorno inválido.');
    }
    if(curr!==start ||keys.length<3)throw Error('Contorno de corte abierto o ambiguo.');
    loops.push(keys.map(k=>nodes.get(k).p));
  }
  // Project to XZ; use Three.js ShapeUtils for polygon triangulation.
  // Multi-ring holes/nesting are deliberately rejected rather than incorrectly capped.
  const paths=loops.map(loop=>loop.map(p=>new THREE.Vector2(p.x,p.z)));
  for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
    // Nested contours imply holes, for which a separate robust tessellation path is required.
    if(THREE.ShapeUtils.isClockWise(paths[i])===THREE.ShapeUtils.isClockWise(paths[j]))continue;
    // Keep simple single contours supported. Complex nested ring validation is conservative.
  }
  if(loops.length>1)throw Error('Se detectaron varios contornos (posibles huecos). Este tipo de corte necesita el algoritmo avanzado de triangulación.');
  const polygon=loops[0],shape=paths[0],faces=THREE.ShapeUtils.triangulateShape(shape,[]);
  if(!faces.length)throw Error('No se pudo cerrar la sección cortada.');
  // Preferred connector centre: centroid of the largest cap triangle.
  // The inradius limits a cylindrical pin to the inside of this triangle.
  let connectorCentre=null,connectorRadius=0;
  for(const [i,j,k] of faces){
    const a=polygon[i],b=polygon[j],c=polygon[k];
    const area=b.clone().sub(a).cross(c.clone().sub(a)).length()*.5;
    const perimeter=a.distanceTo(b)+b.distanceTo(c)+c.distanceTo(a);
    const radius=perimeter>0?2*area/perimeter:0;
    if(radius>connectorRadius){connectorRadius=radius;connectorCentre=a.clone().add(b).add(c).multiplyScalar(1/3)}
  }
  isCap=true;
  for(const [i,j,k] of faces){
    const a=polygon[i],b=polygon[j],c=polygon[k];
    const ny=new THREE.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).y;
    // Upper half outward normal on cap is -Y, lower is +Y.
    if(ny>0){pushTri(bottoms,a,b,c);pushTri(tops,c,b,a)}
    else{pushTri(bottoms,c,b,a);pushTri(tops,a,b,c)}
  }
  const make=arr=>{if(arr.length<9)throw Error('Una de las mitades está vacía.');const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));const record=data.get(arr);for(const name of names)g.setAttribute(name,new THREE.Float32BufferAttribute(record.attributes[name],geometry.getAttribute(name).itemSize));for(let i=0;i<record.materials.length;){let end=i+1;while(end<record.materials.length&&record.materials[end]===record.materials[i])end++;g.addGroup(i*3,(end-i)*3,record.materials[i]);i=end;}g.userData.cutCapMaterialIndex=capIndex;g.computeVertexNormals();g.computeBoundingBox();return g};
  return {upper:make(tops),lower:make(bottoms),contours:loops.length,triangles:[tops.length/9,bottoms.length/9],connectorCentre,connectorRadius};
}


// Cut an arbitrarily oriented plane expressed in WORLD coordinates. Move a copy
// of the mesh geometry into world space, rotate the plane normal to +Y,
// reuse the conservative closed-contour cutter, then return LOCAL geometries.
// Fraction is measured between extremal vertex projections on the plane normal.
export function sliceMeshByWorldPlane(mesh, normal, fraction){
  if(!Number.isFinite(fraction)||fraction<=0||fraction>=1)throw Error('El porcentaje debe estar entre 1 y 99.');
  mesh.updateWorldMatrix(true,false);
  const n=normal.clone().normalize();
  if(n.lengthSq()<.9)throw Error('Normal de corte no válida.');
  const rotation=new THREE.Quaternion().setFromUnitVectors(n,new THREE.Vector3(0,1,0));
  const forward=new THREE.Matrix4().makeRotationFromQuaternion(rotation).multiply(mesh.matrixWorld);
  const reverse=forward.clone().invert();
  const rotated=mesh.geometry.clone();
  rotated.applyMatrix4(forward);
  rotated.computeBoundingBox();
  const bounds=rotated.boundingBox;
  const level=THREE.MathUtils.lerp(bounds.min.y,bounds.max.y,fraction);
  try{
    const result=sliceMeshHorizontal(rotated,level,{capMaterialIndex:Array.isArray(mesh.material)?mesh.material.length:1});
    result.upper.applyMatrix4(reverse);
    result.lower.applyMatrix4(reverse);
    result.upper.computeVertexNormals();
    result.lower.computeVertexNormals();
    result.connectorPoint=result.connectorCentre?.clone().applyQuaternion(rotation.clone().invert())||null;
    result.connectorNormal=n.clone();
    result.planeOffset=level;
    return result;
  } finally {rotated.dispose()}
}
