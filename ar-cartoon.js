import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const container = document.querySelector('#mindarContainer');
const loadingEl = document.querySelector('#arLoading');
const statusText = document.querySelector('#arStatusText');
const statusWrap = document.querySelector('#arStatus');
const interactionHost = document.querySelector('#arStage');
const dragGhost = document.querySelector('#dragGhost');
const placementFeedback = document.querySelector('#placementFeedback');

const PLATFORM_ANDROID=/Android/i.test(navigator.userAgent);
const qualityParam=new URLSearchParams(location.search).get('quality');
const DEVICE_MEMORY_GB=Math.max(2,Number(navigator.deviceMemory)||4);
const QUALITY=
  qualityParam==='fun' ? 'fun' :
  qualityParam==='lite' ? 'lite' :
  'fun';

// The visible model remains full quality on every platform. Android performance
// work happens below the model layer (instancing, static matrices, frame pacing).
const ANDROID_LIGHT_MODE=PLATFORM_ANDROID&&QUALITY==='lite';
const ANDROID_OPTIMIZED_MODE=PLATFORM_ANDROID;
const ENABLE_DYNAMIC_SHADOWS=!ANDROID_LIGHT_MODE;
const ANDROID_RENDER_INTERVAL_MS=1000/30;
const ANDROID_LOCKED_DETECTION_INTERVAL_MS=1000/15;
const ANDROID_SHADOW_INTERVAL_MS=125;

// Geometry fidelity and render resolution stay at the full profile by default.
// The lite branch remains available only through the explicit query parameter.
const AR_MAX_PIXEL_RATIO=QUALITY==='lite'
  ? (PLATFORM_ANDROID?1:1.15)
  : (PLATFORM_ANDROID
      ? (DEVICE_MEMORY_GB>=6?1.65:1.50)
      : 1.65);

let renderer,scene,arCamera;
let cameraVideo=null,cameraStream=null;
let androidCameraTexture=null;

// Android raw-video + Canvas2D AR overlay.
// Camera stays as the proven-stable HTML <video>; only AR is copied to Canvas2D.
let androidOverlayCanvas=null;
let androidOverlayCtx=null;
let androidCameraCanvas=null;
let androidCameraCtx=null;
let androidARCanvas=null;
let androidARCtx=null;
let androidARTarget=null;
let androidARPixels=null;
let androidARImageData=null;
let androidCompositeActive=false;
let androidCompositeW=0;
let androidCompositeH=0;
let androidLastCompositeAt=0;
const ANDROID_COMPOSITE_INTERVAL_MS=50; // ~20 FPS AR overlay
let androidLastVisibleARPixels=0;
let androidLastARStatusAt=0;
let cameraStartPromise=null;

let apriltagWorker=null,detectorReadyPromise=null,detectorBusy=false,detectorReady=false,detectorInitError=null;
let detectorCanvas=null,detectorCtx=null,detectorGray=null;
let detectorWidth=0,detectorHeight=0,detectorSeq=0,lastDetectorSubmit=0;
let cameraIntrinsics=null;
let running=false, preview=false, previewRenderer=null, previewScene=null, previewCamera=null;
let lastLiveRenderAt=0,lastPreviewRenderAt=0;
let lastAndroidShadowRefreshAt=0;
let world=new THREE.Group(), terrainMesh=null, stageBackdrop=null, currentStage=0, clock=new THREE.Clock();
let stickyRoot=new THREE.Group(), trackingFound=false, hasEverTracked=false;
const APRILTAG_CDN_BASE='https://cdn.jsdelivr.net/gh/arenaxr/apriltag-js-standalone@e3a48bdd25d9da0643454c79efff09a0a5ec8e46/html/';
const TRACK_TAG_SIZE_M=.060;
const TERRAIN_FOOTPRINT_DEPTH=1.12;
const INITIAL_USER_SCALE=1;
const MARKER_COVERAGE_MARGIN=1.08;

// Board coordinates: x right, y down, z into board.
// Must match climate-tracking-board-v13.png printed at 180 x 120 mm.
const TRACK_TAG_LAYOUT={
  // V14 SINGLE ANCHOR:
  // One large AprilTag at the exact center of the physical marker.
  // This removes multi-tag board-center fusion drift.
  0:{x:0,y:0,z:0}
};

// Fit the 1.12-unit terrain depth to the physical 60 mm AprilTag, plus a small
// safety margin so the solid diorama base fully hides the black/white QR area
// on the very first lock. Width remains proportional (~100 mm).
const TRACKING_WORLD_SCALE=
  (TRACK_TAG_SIZE_M*MARKER_COVERAGE_MARGIN)/
  (TERRAIN_FOOTPRINT_DEPTH*INITIAL_USER_SCALE);
const BOARD_SURFACE_OFFSET_M=.003; // lift ~4 mm above board plane: visually attached, not buried
const USER_ZOOM_MIN=.55;
const USER_ZOOM_MAX=2.20;
const TRACK_HFOV_DEG=clamp(Number(new URLSearchParams(location.search).get('hfov'))||62,45,85);

const trackingTargetPosition=new THREE.Vector3();
const trackingTargetQuaternion=new THREE.Quaternion();
const trackingRenderPosition=new THREE.Vector3();
const trackingRenderQuaternion=new THREE.Quaternion();
const trackingCandidatePosition=new THREE.Vector3();
const trackingCandidateQuaternion=new THREE.Quaternion();
const trackingBoardNormal=new THREE.Vector3();
const trackingLockedPosition=new THREE.Vector3();
let trackingPoseReady=false;
let renderPoseReady=false;
/* trackingFound dan hasEverTracked sudah dideklarasikan bersama stickyRoot di atas. */
let lastSeenAt=0;
let lastPoseAcceptedAt=0;
let trackingEventFound=false;
let pendingJumpFrames=0;
const pendingJumpPosition=new THREE.Vector3();
const pendingJumpQuaternion=new THREE.Quaternion();
let trackingLastRenderTime=performance.now();
let lastRawTagCount=0;
let lastValidPoseCount=0;
let lastDetectorDebugAt=0;
let lastTrackingStatusAt=0;

const TRACKING_LIMITS={
  detectionIntervalMs:ANDROID_LIGHT_MODE?50:PLATFORM_ANDROID?34:42,
  foundTimeoutMs:820,
  holdVisibleMs:1150,
  edgeFacingMin:.020,
  jumpAngle:THREE.MathUtils.degToRad(68),
  jumpDistance:.24,
  confirmFrames:3,
  confirmAngle:THREE.MathUtils.degToRad(17),
  confirmDistance:.085
};

let userYaw=0, userPitch=0, userScale=INITIAL_USER_SCALE, manualOrbit=false, revealed=false;
let placedGroup=new THREE.Group(), recoveryReadyFired=false;
let recoveryState={plan:0,trees:0,efficiency:0,solar:0,waste:0,building:0,ev:0,community:0,indicatorCount:0,recovery:0,emission:86,ready:false};
let dragPlacement=null;
let dragPreviewObject=null;
let pendingToolGesture=null;
const activePointers=new Map();
let gestureMode=null, gestureStart=null;
const raycaster=new THREE.Raycaster(), pointerNDC=new THREE.Vector2();
const animated=[], smokePuffs=[], movingCars=[], turbines=[], waterGlints=[], swayObjects=[], ambientActors=[], birdFlocks=[], waterfallStreams=[], cyclists=[];
const foliageSwayObjects=[], riverSurfaces=[], livingProps=[];
const toolImages={};
let realisticGrassBatch=null,realisticGrassCount=0;
const realisticRockBatches=new Map();
const realisticVegetationBatches=new Map();
const instanceTransform=new THREE.Object3D();
const instanceParentMatrix=new THREE.Matrix4();
const instanceWorldMatrix=new THREE.Matrix4();

function thawWorldMatrices(){
  if(!PLATFORM_ANDROID)return;
  world.traverse(object=>{object.matrixAutoUpdate=true});
}

function freezeStaticWorldMatrices(){
  if(!PLATFORM_ANDROID)return;

  const dynamicNodes=new Set();
  const dynamicRoots=[
    ...animated,...smokePuffs,...movingCars,...turbines,...waterGlints,
    ...swayObjects,...ambientActors,...birdFlocks,...waterfallStreams,
    ...cyclists,...foliageSwayObjects,...riverSurfaces
  ];
  for(const root of dynamicRoots){
    root?.traverse?.(object=>dynamicNodes.add(object));
  }

  world.traverse(object=>{
    if(object===world||dynamicNodes.has(object)){
      object.matrixAutoUpdate=true;
      return;
    }
    object.updateMatrix();
    object.matrixAutoUpdate=false;
  });
}

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rand(a,b){return a+Math.random()*(b-a)}
function seeded(seed){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296)}

// ===== V8.1 ROAD / HOUSE LAYOUT FIX =====
// ===== V8.2 ROAD VISIBILITY FIX =====
// Jalan dipindah sedikit masuk dari bibir diorama supaya seluruh permukaannya terlihat.
const ROAD_Z=-.390;
const ROAD_HALF_DEPTH=.085;
const ROAD_X_MIN=-.68;
const ROAD_X_MAX=.68;
// Extend only the visible road assembly to both edges of the 1.72-wide terrain.
// Vehicle routes and placement rules intentionally keep their existing bounds.
const ROAD_VISUAL_LENGTH=1.74;
const ROAD_EDGE_LENGTH=1.68;
const ROAD_DASH_COUNT=12;
const ROAD_DASH_SPACING=.135;
const ROAD_DASH_START=-((ROAD_DASH_COUNT-1)*ROAD_DASH_SPACING)/2;

// Rumah dipindah ke belakang koridor jalan agar tidak bersinggungan dengan asphalt.
const HOUSE_LAYOUT=[
  {x:-.50,z:-.125,s:.106,roofY:.202},
  {x:-.30,z:.080,s:.094,roofY:.179},
  {x:.300,z:-.115,s:.098,roofY:.186}
];

const toonGradient=(()=>{
  const data=new Uint8Array([55,110,175,255]);
  const t=new THREE.DataTexture(data,4,1,THREE.RedFormat);
  t.needsUpdate=true;t.minFilter=THREE.NearestFilter;t.magFilter=THREE.NearestFilter;
  return t;
})();
function toon(color,opts={}){
  // Stylized-realistic: warna tetap fun, tetapi menerima pencahayaan PBR dan bayangan lebih natural.
  return new THREE.MeshStandardMaterial({
    color, roughness:.78, metalness:.025, flatShading:false, ...opts
  });
}
function std(color,opts={}){return new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.03,...opts})}
function phys(color,opts={}){return new THREE.MeshPhysicalMaterial({color,roughness:.2,metalness:.03,clearcoat:.5,clearcoatRoughness:.15,...opts})}

// ---------------------------------------------------------------------------
// V14.3.7 ANDROID RAW VIDEO AR OVERLAY MATERIAL SYSTEM
// Runtime-generated textures keep the project self-contained: no new CDN,
// image file or GLB dependency is required for the first realistic prototype.
// ---------------------------------------------------------------------------
const REAL_TEX_CACHE=new Map();

function _texRand(seed){
  let s=seed>>>0;
  return ()=>{
    s=(s*1664525+1013904223)>>>0;
    return s/4294967296;
  };
}

function realisticTexture(kind){
  if(REAL_TEX_CACHE.has(kind))return REAL_TEX_CACHE.get(kind);

  const size=256;
  const c=document.createElement('canvas');
  c.width=c.height=size;
  const x=c.getContext('2d',{willReadFrequently:false});
  const rng=_texRand(
    kind==='grass'?101:
    kind==='soil'?203:
    kind==='asphalt'?307:
    kind==='stone'?409:
    kind==='bark'?503:
    kind==='roof'?607:
    kind==='plaster'?709:
    kind==='leaf'?811:919
  );

  if(kind==='grass'){
    x.fillStyle='#537d47';x.fillRect(0,0,size,size);
    for(let i=0;i<7200;i++){
      const px=rng()*size, py=rng()*size;
      const l=1+rng()*3;
      const shades=['#315d38','#477342','#658e4e','#789c58','#3b6740'];
      x.strokeStyle=shades[(rng()*shades.length)|0];
      x.globalAlpha=.18+rng()*.34;
      x.lineWidth=.45+rng()*.65;
      x.beginPath();x.moveTo(px,py);x.lineTo(px+(rng()-.5)*2,py-l);x.stroke();
    }
  }else if(kind==='soil'){
    x.fillStyle='#684d35';x.fillRect(0,0,size,size);
    for(let i=0;i<8500;i++){
      const v=(55+rng()*65)|0;
      x.fillStyle=`rgba(${v+28},${v+4},${Math.max(25,v-20)},${.08+rng()*.25})`;
      const s=.5+rng()*2.4;
      x.fillRect(rng()*size,rng()*size,s,s);
    }
  }else if(kind==='asphalt'){
    x.fillStyle='#303331';x.fillRect(0,0,size,size);
    for(let i=0;i<7000;i++){
      const v=(82+rng()*65)|0;
      x.fillStyle=`rgba(${v},${v},${v},${.07+rng()*.20})`;
      const s=.4+rng()*1.5;
      x.fillRect(rng()*size,rng()*size,s,s);
    }
  }else if(kind==='stone'){
    x.fillStyle='#777970';x.fillRect(0,0,size,size);
    for(let i=0;i<5000;i++){
      const v=(95+rng()*80)|0;
      x.fillStyle=`rgba(${v},${v+2},${Math.max(0,v-6)},${.08+rng()*.18})`;
      x.fillRect(rng()*size,rng()*size,1+rng()*3,1+rng()*2);
    }
  }else if(kind==='bark'){
    x.fillStyle='#5e402d';x.fillRect(0,0,size,size);
    for(let i=0;i<520;i++){
      const px=rng()*size;
      const width=.5+rng()*2.7;
      x.strokeStyle=rng()>.5?'rgba(39,25,17,.35)':'rgba(150,105,70,.23)';
      x.lineWidth=width;
      x.beginPath();
      x.moveTo(px,0);
      x.bezierCurveTo(px+(rng()-.5)*9,size*.32,px+(rng()-.5)*7,size*.72,px+(rng()-.5)*5,size);
      x.stroke();
    }
  }else if(kind==='roof'){
    x.fillStyle='#804c3d';x.fillRect(0,0,size,size);
    x.strokeStyle='rgba(45,27,22,.35)';x.lineWidth=2;
    for(let yy=0;yy<size;yy+=19){
      x.beginPath();x.moveTo(0,yy);x.lineTo(size,yy);x.stroke();
      for(let xx=(yy/19%2)*12;xx<size;xx+=24){
        x.beginPath();x.moveTo(xx,yy);x.lineTo(xx,yy+19);x.stroke();
      }
    }
    for(let i=0;i<1600;i++){
      x.fillStyle=`rgba(230,160,120,${rng()*.08})`;
      x.fillRect(rng()*size,rng()*size,1+rng()*3,1+rng()*2);
    }
  }else if(kind==='plaster'){
    x.fillStyle='#d9d2c4';x.fillRect(0,0,size,size);
    for(let i=0;i<4200;i++){
      const v=(150+rng()*70)|0;
      x.fillStyle=`rgba(${v},${v-4},${Math.max(0,v-12)},${.025+rng()*.065})`;
      x.fillRect(rng()*size,rng()*size,1+rng()*3,1+rng()*3);
    }
  }else if(kind==='leaf'){
    x.fillStyle='#386b3c';x.fillRect(0,0,size,size);
    for(let i=0;i<7200;i++){
      const shades=['#254f31','#32643a','#497b45','#598a4d','#6c9958'];
      x.fillStyle=shades[(rng()*shades.length)|0];
      x.globalAlpha=.10+rng()*.30;
      const s=.5+rng()*2.1;
      x.fillRect(rng()*size,rng()*size,s,s);
    }
  }else{
    x.fillStyle='#808080';x.fillRect(0,0,size,size);
  }

  x.globalAlpha=1;
  const tex=new THREE.CanvasTexture(c);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.repeat.set(
    kind==='grass'?7:
    kind==='asphalt'?9:
    kind==='bark'?2:
    kind==='roof'?3:
    kind==='plaster'?2:4,
    kind==='grass'?5:
    kind==='asphalt'?2:
    kind==='bark'?5:
    kind==='roof'?2:
    kind==='plaster'?2:4
  );
  tex.minFilter=ANDROID_LIGHT_MODE?THREE.LinearFilter:THREE.LinearMipmapLinearFilter;
  tex.magFilter=THREE.LinearFilter;
  tex.generateMipmaps=!ANDROID_LIGHT_MODE;
  REAL_TEX_CACHE.set(kind,tex);
  return tex;
}

function realisticMat(color,kind,opts={}){
  const tex=kind?realisticTexture(kind):null;
  return new THREE.MeshStandardMaterial({
    color,
    map:tex,
    bumpMap:tex,
    bumpScale:
      kind==='grass'?.010:
      kind==='asphalt'?.003:
      kind==='bark'?.014:
      kind==='roof'?.006:
      kind==='stone'?.008:
      kind==='plaster'?.0025:.004,
    roughness:
      kind==='glass'?.12:
      kind==='asphalt'?.94:
      kind==='grass'?.90:
      kind==='bark'?.96:
      kind==='stone'?.92:
      kind==='roof'?.84:.78,
    metalness:0,
    ...opts
  });
}

function realisticGlass(tint=0x9bc8d2,opacity=.58){
  if(ANDROID_LIGHT_MODE){
    return new THREE.MeshStandardMaterial({
      color:tint,transparent:true,opacity,roughness:.30,metalness:.02,depthWrite:true
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color:tint,
    transparent:true,
    opacity,
    roughness:.10,
    metalness:0,
    transmission:.14,
    ior:1.48,
    thickness:.010,
    clearcoat:.92,
    clearcoatRoughness:.10,
    depthWrite:true
  });
}

function realisticWaterMaterial(){
  const tex=realisticTexture('stone');
  if(ANDROID_LIGHT_MODE){
    return new THREE.MeshStandardMaterial({
      color:0x3d9eb1,map:tex,transparent:true,opacity:.78,
      roughness:.32,metalness:0,bumpMap:tex,bumpScale:.002,depthWrite:true
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color:0x3d9eb1,
    transparent:true,
    opacity:.72,
    roughness:.08,
    metalness:0,
    transmission:.20,
    ior:1.333,
    thickness:.018,
    clearcoat:1,
    clearcoatRoughness:.045,
    bumpMap:tex,
    bumpScale:.003
  });
}
function mesh(g,m,p=[0,0,0],r=[0,0,0],s=[1,1,1]){
  const o=new THREE.Mesh(g,m);o.position.set(...p);o.rotation.set(...r);o.scale.set(...s);o.castShadow=ENABLE_DYNAMIC_SHADOWS;o.receiveShadow=ENABLE_DYNAMIC_SHADOWS;return o;
}
function rb(w,h,d,radius=.025,segments=4){return new RoundedBoxGeometry(w,h,d,segments,radius)}
function outline(target,amount=1.035,color=0x183129){
  // Outline geometri lama menambah lapisan mesh kedua dan menimbulkan z-fighting.
  // Material PBR + bayangan sekarang menjadi pemisah bentuk yang lebih natural.
  return target;
}
function addBox(parent,size,color,pos,rot=[0,0,0],rounded=.018,doOutline=false){
  const o=mesh(rb(size[0],size[1],size[2],Math.min(rounded,Math.min(...size)/3),4),toon(color),pos,rot);
  parent.add(o);if(doOutline)outline(o,1.025);return o;
}
function addCyl(parent,rt,rbm,h,color,pos,seg=16,rot=[0,0,0],doOutline=false){
  const o=mesh(new THREE.CylinderGeometry(rt,rbm,h,seg),toon(color),pos,rot);parent.add(o);if(doOutline)outline(o,1.025);return o;
}
function shadowBlob(parent,x,z,w=.1,h=.06,opacity=.105){
  const m=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity,depthWrite:false});
  const o=mesh(new THREE.CircleGeometry(1,28),m,[x,.006,z],[-Math.PI/2,0,0],[w,h,1]);o.castShadow=false;o.receiveShadow=false;parent.add(o);return o;
}
function clearWorld(preservePlaced=false){
  if(stageBackdrop){
    stageBackdrop.removeFromParent();
    stageBackdrop.geometry?.dispose?.();
    stageBackdrop.material?.map?.dispose?.();
    stageBackdrop.material?.dispose?.();
    stageBackdrop=null;
  }

  // Jangan ikut dispose hasil drag & drop ketika pindah dari
  // Tahap Pemulihan -> Dunia Pulih.
  if(preservePlaced && placedGroup?.parent===world){
    world.remove(placedGroup);
  }

  while(world.children.length){
    const o=world.children.pop();
    o.traverse?.(n=>{
      if(n.geometry)n.geometry.dispose?.();
      if(n.material){
        const mats=Array.isArray(n.material)?n.material:[n.material];
        mats.forEach(m=>m.dispose?.());
      }
    });
  }

  animated.length=0;
  smokePuffs.length=0;
  movingCars.length=0;
  turbines.length=0;
  waterGlints.length=0;
  swayObjects.length=0;
  ambientActors.length=0;
  birdFlocks.length=0;
  waterfallStreams.length=0;
  cyclists.length=0;
  foliageSwayObjects.length=0;
  riverSurfaces.length=0;
  livingProps.length=0;
  realisticGrassBatch=null;
  realisticGrassCount=0;
  realisticRockBatches.clear();
  realisticVegetationBatches.clear();

  if(!preservePlaced){
    placedGroup=new THREE.Group();
    placedGroup.name='placedGroup';
  }
}

function makeTerrain(stage){
  const segX=QUALITY==='lite'?54:96,segY=QUALITY==='lite'?38:70;
  const g=new THREE.PlaneGeometry(1.72,1.12,segX,segY);
  const p=g.attributes.position;
  const colors=new Float32Array(p.count*3);
  const rng=seeded(810+stage*23);

  const polluted=isPollutedStage(stage);
  const healthy=new THREE.Color(
    polluted ? 0x765c45 :
    stage===1 ? 0x78905d :
    stage===4 ? 0x67b166 :
    stage===0 ? 0x789a63 : 0x6aa95f
  );
  const dry=new THREE.Color(0xae8050);
  const rock=new THREE.Color(0x6f806e);
  const lightGrass=new THREE.Color(stage===4?0x91cf78:0x82c770);

  const peak=(x,c,w,h)=>Math.exp(-Math.pow((x-c)/w,2))*h;

  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i);

    // Background hills + subtle left/right terraces.
    const back=THREE.MathUtils.smoothstep(y,.06,.54);
    const ridge=
      peak(x,-.50,.18,.040)+
      peak(x,-.16,.20,.030)+
      peak(x,.18,.20,.038)+
      peak(x,.50,.18,.030);

    const terraceL=Math.exp(-Math.pow((x+.48)/.23,2))*THREE.MathUtils.smoothstep(y,-.12,.32)*.020;
    const terraceR=Math.exp(-Math.pow((x-.46)/.24,2))*THREE.MathUtils.smoothstep(y,-.08,.30)*.017;

    const riverCenter=-.01+Math.sin(y*6.3)*.040;
    const river=Math.exp(-Math.pow((x-riverCenter)/.082,2))*.036;

    const micro=(Math.sin(x*13)+Math.sin(y*17))*0.0023+(rng()-.5)*.0035;
    let h=micro+back*ridge+terraceL+terraceR-river*(1-back*.35);

    if(polluted)h*=.93;

    // Keep the foreground road readable.
    const worldZ=-y;
    const roadDistance=Math.abs(worldZ-ROAD_Z);
    const roadBlend=1-THREE.MathUtils.smoothstep(
      roadDistance,
      ROAD_HALF_DEPTH+.020,
      ROAD_HALF_DEPTH+.105
    );
    if(roadBlend>0)h=THREE.MathUtils.lerp(h,-.012,roadBlend);

    p.setZ(i,h);

    let c=(polluted?dry:healthy).clone();
    const alt=clamp((h+.008)/.09,0,1);
    if(!polluted)c.lerp(lightGrass,alt*.36);
    if(alt>.68)c.lerp(rock,THREE.MathUtils.smoothstep(alt,.68,1)*.35);
    c.offsetHSL((rng()-.5)*.012,(rng()-.5)*.045,(rng()-.5)*.045);

    colors[i*3]=c.r;
    colors[i*3+1]=c.g;
    colors[i*3+2]=c.b;
  }

  g.setAttribute('color',new THREE.BufferAttribute(colors,3));
  g.computeVertexNormals();

  const terrainTex=isPollutedStage(stage)
    ? realisticTexture('soil')
    : realisticTexture('grass');

  const mat=new THREE.MeshStandardMaterial({
    color:0xffffff,
    vertexColors:true,
    map:terrainTex,
    bumpMap:terrainTex,
    bumpScale:isPollutedStage(stage)?.006:.008,
    roughness:isPollutedStage(stage)?.96:.91,
    metalness:0
  });

  terrainMesh=mesh(g,mat,[0,.010,0],[-Math.PI/2,0,0]);
  terrainMesh.userData.isTerrain=true;
  terrainMesh.name='terrainSurface';
  world.add(terrainMesh);

  // Layered "storybook / miniature" base with visible soil edge.
  const soil=mesh(
    rb(1.77,.115,1.17,.060,6),
    realisticMat(
      polluted?0x654a36:stage===4?0x765a40:0x806047,
      'soil',
      {roughness:.98}
    ),
    [0,-.086,0]
  );
  soil.name='terrainSoil';
  world.add(soil);

  const grassRim=mesh(
    rb(1.80,.040,1.20,.068,6),
    realisticMat(
      polluted?0x554b3d:stage===4?0x4f7948:0x486a42,
      polluted?'soil':'grass',
      {roughness:.96}
    ),
    [0,-.025,0]
  );
  grassRim.name='terrainRim';
  world.add(grassRim);

  // A thinner dark bottom layer gives a stronger pop-up silhouette.
  const shadowBase=mesh(
    rb(1.84,.030,1.24,.072,6),
    realisticMat(0x2d3933,'stone',{roughness:1,bumpScale:.004}),
    [0,-.115,0]
  );
  shadowBase.name='terrainBase';
  world.add(shadowBase);
}
function isPollutedStage(stage){return stage===2||stage===3}
function makeBackdropTexture(stage){
  const c=document.createElement('canvas');c.width=768;c.height=360;
  const x=c.getContext('2d'),polluted=isPollutedStage(stage),recovered=stage===4;
  const sky=x.createLinearGradient(0,0,0,c.height);
  if(polluted){sky.addColorStop(0,'#302e2c');sky.addColorStop(.52,'#655d53');sky.addColorStop(1,'#9a7353')}
  else if(recovered){sky.addColorStop(0,'#65bfe8');sky.addColorStop(.58,'#bcecff');sky.addColorStop(1,'#eefbdc')}
  else{sky.addColorStop(0,'#84cdea');sky.addColorStop(.62,'#d5f1f6');sky.addColorStop(1,'#f4f1cf')}
  x.fillStyle=sky;x.fillRect(0,0,c.width,c.height);
  if(polluted){
    x.fillStyle='rgba(28,27,26,.58)';
    for(let i=0;i<15;i++){const px=i*58-20,h=35+(i%5)*18;x.fillRect(px,c.height-h,46,h)}
    x.fillStyle='rgba(40,38,35,.34)';
    for(let i=0;i<9;i++){x.beginPath();x.ellipse(55+i*91,85+(i%3)*30,80,32,0,0,Math.PI*2);x.fill()}
  }else{
    x.fillStyle=recovered?'#fff3a8':'#ffe39a';x.beginPath();x.arc(620,76,recovered?31:24,0,Math.PI*2);x.fill();
    x.fillStyle='rgba(255,255,255,.62)';
    for(const [cx,cy,s] of [[105,82,1],[330,57,.75],[545,125,.62]]){
      x.beginPath();x.ellipse(cx,cy,54*s,18*s,0,0,Math.PI*2);x.ellipse(cx+38*s,cy-8*s,40*s,21*s,0,0,Math.PI*2);x.fill();
    }
  }
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}
function addStageBackdrop(stage){
  // Background AR harus berasal dari kamera asli. Plane backdrop 3D lama
  // dapat menutup jalan/object ketika kamera berubah sudut, jadi dinonaktifkan.
  stageBackdrop=null;
}

function terrainSpotIsClear(x,z,stage,padding=.04){
  if(Math.abs(x)<.14+padding&&z<.31)return false;
  if(z>.34-padding)return false;

  // Reserve road corridor in ALL stages, including the initial green stage.
  // This prevents grass/trees from growing over the asphalt.
  if(x>ROAD_X_MIN-padding&&x<ROAD_X_MAX+padding&&Math.abs(z-ROAD_Z)<ROAD_HALF_DEPTH+.050+padding)return false;

  const houses=HOUSE_LAYOUT.map(h=>[h.x,h.z,h.s>.10?.17:.15]);
  if(houses.some(([hx,hz,r])=>Math.hypot(x-hx,z-hz)<r+padding))return false;

  if(stage>=1&&stage<4){
    // Industrial zone is rear-right and stays off the road.
    if(Math.hypot(x-.52,z-.20)<.30+padding)return false;
  }
  return Math.abs(x)<.76&&Math.abs(z)<.45;
}


function createStylizedMountainGeometry(radius,height,seed=1,segments=18,rings=7){
  const rng=seeded(seed);
  const positions=[];
  const indices=[];

  // Bottom-to-top rings. The center shifts slightly to create ridges.
  for(let r=0;r<rings;r++){
    const t=r/(rings-1);
    const y=t*height;
    const baseRadius=radius*Math.pow(1-t,.74);
    const shiftX=Math.sin(t*4.6+seed*.31)*radius*.09*t;
    const shiftZ=Math.cos(t*3.8+seed*.27)*radius*.07*t;

    for(let s=0;s<segments;s++){
      const a=s/segments*Math.PI*2;
      const jag=1+
        Math.sin(a*3+seed)*.055*(1-t)+
        Math.sin(a*7+seed*.7)*.028+
        (rng()-.5)*.035;
      const rr=baseRadius*jag;
      positions.push(
        shiftX+Math.cos(a)*rr,
        y,
        shiftZ+Math.sin(a)*rr
      );
    }
  }

  for(let r=0;r<rings-1;r++){
    for(let s=0;s<segments;s++){
      const n=(s+1)%segments;
      const a=r*segments+s;
      const b=r*segments+n;
      const c=(r+1)*segments+s;
      const d=(r+1)*segments+n;
      indices.push(a,c,b,b,c,d);
    }
  }

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function addMountainBackdrop(stage){
  const group=new THREE.Group();
  group.name='mountainBackdrop';
  world.add(group);

  const polluted=isPollutedStage(stage);
  const recovered=stage===4;

  const mountainColors=polluted
    ? [0x685a4d,0x756352,0x5d5148,0x725f4e,0x665548]
    : recovered
      ? [0x3c7659,0x4c855f,0x356b51,0x568c66,0x44785a]
      : [0x456f57,0x56815f,0x3d6852,0x5b8664,0x47745a];

  const specs=[
    [-.64,.49,.145,.40,11],
    [-.34,.515,.170,.53,22],
    [-.02,.535,.188,.59,33],
    [ .33,.510,.170,.51,44],
    [ .63,.485,.145,.39,55]
  ];

  for(let i=0;i<specs.length;i++){
    let [x,z,r,h,seed]=specs[i];

    if(polluted){
      z+=.035;
      r*=.91;
      h*=.76;
    }

    const geo=createStylizedMountainGeometry(r,h,seed,QUALITY==='lite'?14:20,QUALITY==='lite'?6:8);
    const mountain=mesh(
      geo,
      realisticMat(
        mountainColors[i],
        'stone',
        {roughness:.98,bumpScale:polluted?.012:.009}
      ),
      [x,.000,z],
      [0,rand(-.06,.06),0]
    );
    group.add(mountain);

    if(!polluted && h>.46){
      // Organic snow cap: smaller mountain geometry instead of a perfect cone.
      const snowGeo=createStylizedMountainGeometry(r*.31,h*.17,seed+100,14,5);
      const snow=mesh(
        snowGeo,
        realisticMat(0xe6e9e5,'stone',{roughness:.88,bumpScale:.003}),
        [x,h*.83,z],
        [0,mountain.rotation.y,0]
      );
      group.add(snow);
    }
  }

  // Layered foothills create depth between village and mountains.
  for(const [x,z,sx,sy,c] of [
    [-.53,.405,.21,.085,0x5d9269],
    [-.18,.420,.18,.070,0x6aa075],
    [ .18,.414,.20,.078,0x5f946b],
    [ .52,.402,.19,.072,0x679a70]
  ]){
    const hill=mesh(
      new THREE.SphereGeometry(1,24,14,0,Math.PI*2,0,Math.PI/2),
      toon(polluted?0x78644e:c,{roughness:.95}),
      [x,.006,z],
      [0,0,0],
      [sx,sy,sx*.72]
    );
    group.add(hill);
  }
}

function addWaterfall(stage){
  const polluted=isPollutedStage(stage);
  const g=new THREE.Group();
  g.name='waterfall';
  g.position.set(-.075,0,.325);
  world.add(g);

  // Rock ledge.
  for(const [x,y,z,s,c] of [
    [-.045,.050,.005,.055,0x70806f],
    [ .020,.055,.000,.060,0x697868],
    [-.082,.025,.018,.045,0x7c897a],
    [ .060,.026,.015,.043,0x738170]
  ]){
    const rock=mesh(
      new THREE.DodecahedronGeometry(s,1),
      toon(polluted?0x67584b:c,{roughness:.98}),
      [x,y,z],
      [rand(-.25,.25),rand(0,3),rand(-.18,.18)],
      [1.25,.85,1]
    );
    g.add(rock);
  }

  const waterColor=polluted?0x60665d:0x71d7ee;
  const falls=mesh(
    rb(.090,.150,.012,.008,3),
    phys(waterColor,{
      transparent:true,
      opacity:polluted?.50:.78,
      roughness:.08,
      clearcoat:.75,
      clearcoatRoughness:.15
    }),
    [-.008,.095,.030],
    [0,0,0]
  );
  g.add(falls);

  // Animated foam/glints.
  for(let i=0;i<5;i++){
    const stripe=mesh(
      rb(.010,.060,.004,.002,2),
      new THREE.MeshBasicMaterial({
        color:0xeafcff,
        transparent:true,
        opacity:polluted?.18:.65,
        depthWrite:false
      }),
      [-.032+i*.016,.110+(i%2)*.010,.037]
    );
    stripe.castShadow=false;
    stripe.userData={baseY:stripe.position.y,phase:i*.9,speed:.08+i*.007};
    g.add(stripe);
    waterfallStreams.push(stripe);
  }

  // Foam pool.
  const foam=mesh(
    new THREE.CircleGeometry(.074,28),
    new THREE.MeshBasicMaterial({
      color:polluted?0xb2aca1:0xe8fbff,
      transparent:true,
      opacity:polluted?.24:.63,
      depthWrite:false
    }),
    [-.008,.021,.018],
    [-Math.PI/2,0,0],
    [1.4,.72,1]
  );
  foam.castShadow=false;
  g.add(foam);
}

function addRiver(stage){
  const polluted=isPollutedStage(stage);

  const shape=new THREE.Shape();
  shape.moveTo(-.11,-.53);
  shape.bezierCurveTo(-.22,-.27,-.015,.01,-.095,.53);
  shape.lineTo(.065,.53);
  shape.bezierCurveTo(.175,.24,.025,-.06,.10,-.53);
  shape.closePath();

  // Slightly recessed river bed makes the water feel embedded in terrain.
  const bed=mesh(
    new THREE.ShapeGeometry(shape,40),
    realisticMat(
      polluted?0x55483b:stage===4?0x627b70:0x5d756d,
      polluted?'soil':'stone',
      {roughness:.98,bumpScale:.006}
    ),
    [0,.010,0],
    [-Math.PI/2,0,0]
  );
  bed.scale.x=.66;
  bed.name='riverBed';
  world.add(bed);

  const mat=polluted
    ? new THREE.MeshPhysicalMaterial({
        color:stage===3?0x6f725f:0x5c6257,
        transparent:true,
        opacity:.72,
        roughness:.38,
        metalness:0,
        transmission:.03,
        ior:1.333,
        thickness:.014,
        clearcoat:.18,
        clearcoatRoughness:.28,
        bumpMap:realisticTexture('stone'),
        bumpScale:.0025
      })
    : realisticWaterMaterial();

  if(stage===4){
    mat.color.setHex(0x45aabd);
    mat.opacity=.77;
  }

  const river=mesh(
    new THREE.ShapeGeometry(shape,40),
    mat,
    [0,.018,0],
    [-Math.PI/2,0,0]
  );
  river.scale.x=.60;
  river.castShadow=false;
  river.name='riverSurface';
  river.userData.baseOpacity=mat.opacity;
  river.userData.phase=rand(0,Math.PI*2);
  riverSurfaces.push(river);
  world.add(river);

  // River banks.
  const rng=seeded(71+stage);
  for(let i=0;i<20;i++){
    const z=-.48+i*.052+rng()*.015;
    const curve=Math.sin((z+.35)*6.2)*.040;
    addRock(-.095+curve+(rng()-.5)*.016,z,.008+rng()*.010,polluted);
    addRock(.070+curve+(rng()-.5)*.016,z,.008+rng()*.010,polluted);
  }

  if(!polluted){
    for(let i=0;i<9;i++){
      const g=mesh(
        rb(.050,.002,.007,.003,2),
        new THREE.MeshBasicMaterial({
          color:0xe6fbff,
          transparent:true,
          opacity:.50,
          depthWrite:false
        }),
        [-.025,.023,-.42+i*.105],
        [0,Math.sin(i)*.32,0]
      );
      g.castShadow=false;
      g.userData.phase=i*.65;
      waterGlints.push(g);
      world.add(g);
    }
  }

  addWaterfall(stage);
}
function addRock(x,z,s=.014,dry=false){
  const key=dry?'dry':'healthy';
  let batch=realisticRockBatches.get(key);
  if(!batch){
    batch=new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1,1),
      realisticMat(dry?0x78604d:0x78877b,'stone',{roughness:.99,bumpScale:.006}),
      128
    );
    batch.name=`rockBatch-${key}`;
    batch.count=0;
    batch.castShadow=ENABLE_DYNAMIC_SHADOWS;
    batch.receiveShadow=ENABLE_DYNAMIC_SHADOWS;
    batch.frustumCulled=false;
    batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    realisticRockBatches.set(key,batch);
    world.add(batch);
  }

  instanceTransform.position.set(x,s*.62,z);
  instanceTransform.rotation.set(rand(-.3,.3),rand(0,3),rand(-.25,.25));
  instanceTransform.scale.set(s*1.45,s*.75,s);
  instanceTransform.updateMatrix();
  batch.setMatrixAt(batch.count++,instanceTransform.matrix);
  batch.instanceMatrix.needsUpdate=true;
}
function addGrass(x,z,s=1,dry=false){
  const g=new THREE.Group();g.name='grass';g.position.set(x,0,z);world.add(g);
  const c=dry?0xc19a58:0x52934d;
  for(let i=0;i<5;i++){
    const blade=mesh(new THREE.ConeGeometry(.005*s,.055*s,4),toon(c),[(i-2)*.009*s,.027*s,Math.sin(i)*.007*s],[0,rand(0,3),rand(-.25,.25)]);
    g.add(blade);
  }
  g.userData.phase=rand(0,6);swayObjects.push(g);
}

function buildTree(scale=.1,healthy=true,flower=false){
  const g=new THREE.Group();
  const s=scale/.1;

  addCyl(g,.014*s,.022*s,.30*s,healthy?0x765039:0x5d5149,[0,.15*s,0],9);

  if(healthy){
    const variant=Math.floor(rand(0,4));

    if(variant===0){
      // Rounded deciduous tree.
      const colors=flower?[0x4f9b56,0x69af61,0xf0a8bd]:[0x397d48,0x4e9854,0x6caf61];
      for(const [x,y,z,r,c] of [
        [-.040,.31,0,.072,colors[0]],[.038,.32,.012,.079,colors[1]],[0,.39,0,.087,colors[1]],
        [-.052,.385,-.015,.056,colors[0]],[.052,.39,.006,.058,colors[1]],[0,.455,0,.050,colors[2]]
      ]){
        g.add(mesh(new THREE.IcosahedronGeometry(r*s,2),toon(c,{roughness:.9}),[x*s,y*s,z*s]));
      }
    }else if(variant===1){
      // Layered conifer.
      const green=flower?0x4f965c:0x356f4a;
      for(const [y,r,h] of [[.23,.085,.17],[.32,.074,.18],[.41,.058,.16]]){
        const cone=mesh(
          new THREE.ConeGeometry(r*s,h*s,10,2),
          toon(green,{roughness:.94}),
          [0,y*s,0]
        );
        g.add(cone);
      }
    }else if(variant===2){
      // Wide umbrella canopy.
      const canopy=mesh(
        new THREE.SphereGeometry(.11*s,18,10),
        toon(flower?0x63a65e:0x4a9252,{roughness:.9}),
        [0,.375*s,0],
        [0,0,0],
        [1.28,.62,1.02]
      );
      g.add(canopy);
      for(const dx of [-.07,.07]){
        g.add(mesh(
          new THREE.IcosahedronGeometry(.055*s,1),
          toon(flower?0xf1adc0:0x5aa35b,{roughness:.92}),
          [dx*s,.39*s,.008*s]
        ));
      }
    }else{
      // Compact orchard tree.
      for(const [x,y,z,r,c] of [
        [-.050,.34,0,.064,0x4b9251],
        [ .050,.35,0,.067,0x62a65d],
        [0,.415,0,.072,flower?0xeea6b9:0x559d56],
        [0,.335,.045,.057,0x3f844a]
      ]){
        g.add(mesh(new THREE.DodecahedronGeometry(r*s,1),toon(c,{roughness:.94}),[x*s,y*s,z*s]));
      }
    }
  }else{
    for(let k=0;k<5;k++){
      const branch=addCyl(g,.006*s,.009*s,.16*s,0x62544b,[0,.27*s,0],7);
      branch.rotation.z=(k%2?1:-1)*(0.65+k*.07);
      branch.rotation.y=k*1.1;
    }
  }

  g.userData.phase=rand(0,6);
  swayObjects.push(g);
  return g;
}
function addTree(x,z,s=.1,healthy=true,flower=false){
  const g=buildTree(s,healthy,flower);
  g.name='tree';
  g.position.set(x,0,z);
  world.add(g);

  // Canopy gets its own tiny movement on top of the whole-tree sway.
  // This gives volume/life without changing the tracking anchor.
  if(healthy){
    for(const child of g.children){
      if(child.isMesh && child.position.y>.20*(s/.1)){
        child.userData.foliageBaseX=child.rotation.x;
        child.userData.foliageBaseZ=child.rotation.z;
        child.userData.foliagePhase=rand(0,Math.PI*2);
        foliageSwayObjects.push(child);
      }
    }
  }

  shadowBlob(world,x,z,s*.43,s*.26,.12);
  return g;
}
function addBush(x,z,s=.04,dry=false){
  const g=new THREE.Group();g.name='bush';g.position.set(x,0,z);world.add(g);
  const colors=dry?[0x8f7652,0xa68c5c]:[0x3d8049,0x5aa356];
  for(const [dx,dz,ss] of [[0,0,1],[.03,.005,.75],[-.027,.008,.7],[.008,-.018,.65]]){
    g.add(mesh(new THREE.IcosahedronGeometry(s*ss,1),toon(colors[Math.random()>.5?0:1]),[dx,.028*ss,dz]));
  }
}


// ---------------------------------------------------------------------------
// V14.2 — REALISTIC GEOMETRY USED ONLY BY STAGE 1 (internal stage === 0)
// ---------------------------------------------------------------------------
function getRealisticVegetationBatch(key,geometryFactory,materialFactory,capacity){
  let batch=realisticVegetationBatches.get(key);
  if(batch)return batch;

  batch=new THREE.InstancedMesh(geometryFactory(),materialFactory(),capacity);
  batch.name=`realisticVegetation-${key}`;
  batch.count=0;
  batch.castShadow=ENABLE_DYNAMIC_SHADOWS;
  batch.receiveShadow=ENABLE_DYNAMIC_SHADOWS;
  batch.frustumCulled=false;
  batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  realisticVegetationBatches.set(key,batch);
  world.add(batch);
  return batch;
}

function addRealisticVegetationInstance(batch,parentX,parentZ,parentYaw,pos,rot,scale){
  instanceParentMatrix.makeRotationY(parentYaw);
  instanceParentMatrix.setPosition(parentX,0,parentZ);
  instanceTransform.position.set(pos[0],pos[1],pos[2]);
  instanceTransform.rotation.set(rot[0],rot[1],rot[2]);
  instanceTransform.scale.set(scale[0],scale[1],scale[2]);
  instanceTransform.updateMatrix();
  instanceWorldMatrix.multiplyMatrices(instanceParentMatrix,instanceTransform.matrix);
  batch.setMatrixAt(batch.count++,instanceWorldMatrix);
  batch.instanceMatrix.needsUpdate=true;
}

function addBatchedRealisticTree(x,z,s=.1){
  const k=s/.1;
  const yaw=rand(0,Math.PI*2);
  const bark=()=>realisticMat(0x6e4c35,'bark',{roughness:.98});
  const trunkBatch=getRealisticVegetationBatch(
    'tree-trunk',()=>new THREE.CylinderGeometry(.022,.033,.285,14,3),bark,128
  );
  addRealisticVegetationInstance(trunkBatch,x,z,yaw,[0,.145*k,0],[0,rand(-.025,.025),0],[k,k,k]);

  const branchBatch=getRealisticVegetationBatch(
    'tree-branch',()=>new THREE.CylinderGeometry(.007,.011,1,10),bark,512
  );
  const branchSpecs=[
    [-.020,.245,.000,.105,-.52,.18],
    [ .018,.270,.006,.115,.48,-.12],
    [-.006,.300,-.010,.090,-.20,.52],
    [ .010,.322,.004,.070,.38,.36]
  ];
  for(const [bx,by,bz,len,rz,rx] of branchSpecs){
    addRealisticVegetationInstance(
      branchBatch,x,z,yaw,[bx*k,by*k,bz*k],[rx,0,rz],[k,len*k,k]
    );
  }

  const crownSpecs=[
    ['dark',-.070,.355,.005,.082,1.00,.82,1.00,0x3f7146,.93],
    ['mid', .060,.370,.015,.090,1.05,.82,.95,0x568e4e,.91],
    ['light',-.012,.425,-.025,.095,1.00,.90,1.02,0x70a85d,.90],
    ['mid',-.090,.420,-.030,.067,.95,.82,1.02,0x568e4e,.91],
    ['dark', .083,.438,-.018,.070,.92,.86,1.05,0x3f7146,.93],
    ['mid', .008,.490,.010,.072,.92,.82,.92,0x568e4e,.91]
  ];
  for(const [tone,cx,cy,cz,r,sx,sy,sz,color,roughness] of crownSpecs){
    const batch=getRealisticVegetationBatch(
      `tree-crown-${tone}`,
      ()=>new THREE.IcosahedronGeometry(1,2),
      ()=>realisticMat(color,'leaf',{roughness}),
      384
    );
    addRealisticVegetationInstance(
      batch,x,z,yaw,[cx*k,cy*k,cz*k],
      [rand(-.15,.15),rand(0,3.14),rand(-.12,.12)],
      [r*k*sx,r*k*sy,r*k*sz]
    );
  }

  const rootBatch=getRealisticVegetationBatch(
    'tree-root',()=>new THREE.CylinderGeometry(.004,.009,.070,8),bark,640
  );
  for(let i=0;i<5;i++){
    const a=i/5*Math.PI*2+rand(-.18,.18);
    addRealisticVegetationInstance(
      rootBatch,x,z,yaw,
      [Math.cos(a)*.022*k,.020*k,Math.sin(a)*.022*k],
      [0,0,a+Math.PI/2],[k,.75*k,k]
    );
  }
  return trunkBatch;
}

function addBatchedRealisticBush(x,z,s=.04){
  const colors=[0x315f38,0x477c43,0x5a894b];
  for(let i=0;i<7;i++){
    const tone=i%3;
    const a=i/7*Math.PI*2;
    const rr=s*(.28+(i%3)*.10);
    const radius=s*(.55+rand(-.08,.10));
    const batch=getRealisticVegetationBatch(
      `bush-${tone}`,
      ()=>new THREE.IcosahedronGeometry(1,2),
      ()=>realisticMat(colors[tone],'leaf'),
      384
    );
    addRealisticVegetationInstance(
      batch,x,z,0,
      [Math.cos(a)*rr,s*.56+rand(-.006,.008),Math.sin(a)*rr],
      [rand(-.12,.12),rand(0,Math.PI),rand(-.10,.10)],
      [radius,radius*rand(.70,.92),radius]
    );
  }
  return realisticVegetationBatches.get('bush-0');
}

function addRealisticTree(x,z,s=.1){
  if(ANDROID_OPTIMIZED_MODE)return addBatchedRealisticTree(x,z,s);
  const g=new THREE.Group();
  g.name='tree';
  g.position.set(x,0,z);
  g.rotation.y=rand(0,Math.PI*2);
  world.add(g);

  const k=s/.1;
  const bark=realisticMat(0x6e4c35,'bark',{roughness:.98});
  const leafDark=realisticMat(0x3f7146,'leaf',{roughness:.93});
  const leafMid=realisticMat(0x568e4e,'leaf',{roughness:.91});
  const leafLight=realisticMat(0x70a85d,'leaf',{roughness:.90});

  const trunk=mesh(
    new THREE.CylinderGeometry(.022*k,.033*k,.285*k,14,3),
    bark,
    [0,.145*k,0],
    [0,rand(-.025,.025),0]
  );
  g.add(trunk);

  // Visible branching is what makes it read as a tree instead of "sphere + cylinder".
  const branchSpecs=[
    [-.020,.245,.000,.105,-.52,.18],
    [ .018,.270,.006,.115,.48,-.12],
    [-.006,.300,-.010,.090,-.20,.52],
    [ .010,.322,.004,.070,.38,.36]
  ];
  for(const [bx,by,bz,len,rz,rx] of branchSpecs){
    const br=mesh(
      new THREE.CylinderGeometry(.007*k,.011*k,len*k,10),
      bark,
      [bx*k,by*k,bz*k],
      [rx,0,rz]
    );
    g.add(br);
  }

  const clusters=[
    [-.070,.355,.005,.082,1.00,.82,1.00,leafDark],
    [ .060,.370,.015,.090,1.05,.82,.95,leafMid],
    [-.012,.425,-.025,.095,1.00,.90,1.02,leafLight],
    [-.090,.420,-.030,.067,.95,.82,1.02,leafMid],
    [ .083,.438,-.018,.070,.92,.86,1.05,leafDark],
    [ .008,.490,.010,.072,.92,.82,.92,leafMid]
  ];

  for(const [cx,cy,cz,r,sx,sy,sz,material] of clusters){
    const crown=mesh(
      new THREE.IcosahedronGeometry(r*k,2),
      material,
      [cx*k,cy*k,cz*k],
      [rand(-.15,.15),rand(0,3.14),rand(-.12,.12)],
      [sx,sy,sz]
    );
    crown.userData.foliageBaseX=crown.rotation.x;
    crown.userData.foliageBaseZ=crown.rotation.z;
    crown.userData.foliagePhase=rand(0,Math.PI*2);
    foliageSwayObjects.push(crown);
    g.add(crown);
  }

  // roots around trunk base add contact with ground
  for(let i=0;i<5;i++){
    const a=i/5*Math.PI*2+rand(-.18,.18);
    const root=mesh(
      new THREE.CylinderGeometry(.004*k,.009*k,.070*k,8),
      bark,
      [Math.cos(a)*.022*k,.020*k,Math.sin(a)*.022*k],
      [0,0,a+Math.PI/2]
    );
    root.scale.y=.75;
    g.add(root);
  }

  g.userData.phase=rand(0,Math.PI*2);
  g.userData.swayAmount=.0035;
  swayObjects.push(g);
  return g;
}

function addRealisticBush(x,z,s=.04){
  if(ANDROID_OPTIMIZED_MODE)return addBatchedRealisticBush(x,z,s);
  const g=new THREE.Group();
  g.name='bush';
  g.position.set(x,0,z);
  world.add(g);
  const mats=[
    realisticMat(0x315f38,'leaf'),
    realisticMat(0x477c43,'leaf'),
    realisticMat(0x5a894b,'leaf')
  ];
  for(let i=0;i<7;i++){
    const a=i/7*Math.PI*2;
    const rr=s*(.28+(i%3)*.10);
    const leaf=mesh(
      new THREE.IcosahedronGeometry(s*(.55+rand(-.08,.10)),2),
      mats[i%3],
      [Math.cos(a)*rr,s*.56+rand(-.006,.008),Math.sin(a)*rr],
      [rand(-.12,.12),rand(0,Math.PI),rand(-.10,.10)],
      [1,rand(.70,.92),1]
    );
    leaf.userData.foliageBaseX=leaf.rotation.x;
    leaf.userData.foliageBaseZ=leaf.rotation.z;
    leaf.userData.foliagePhase=rand(0,Math.PI*2);
    foliageSwayObjects.push(leaf);
    g.add(leaf);
  }
  return g;
}

function addRealisticGrassTuft(x,z,s=.8){
  if(!realisticGrassBatch){
    realisticGrassBatch=new THREE.InstancedMesh(
      new THREE.ConeGeometry(.0045,.060,5),
      realisticMat(0x4f7e43,'grass',{roughness:.96}),
      512
    );
    realisticGrassBatch.name='realisticGrassBatch';
    realisticGrassBatch.count=0;
    realisticGrassBatch.castShadow=ENABLE_DYNAMIC_SHADOWS;
    realisticGrassBatch.receiveShadow=ENABLE_DYNAMIC_SHADOWS;
    realisticGrassBatch.frustumCulled=false;
    realisticGrassBatch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    world.add(realisticGrassBatch);
  }

  for(let i=0;i<9;i++){
    const angle=(i/9)*Math.PI*2;
    instanceTransform.position.set(
      x+Math.cos(angle)*.010*s,
      .030*s,
      z+Math.sin(angle)*.010*s
    );
    instanceTransform.rotation.set(rand(-.12,.12),0,angle+rand(-.18,.18));
    instanceTransform.scale.set(s,s*rand(.75,1.25),s);
    instanceTransform.updateMatrix();
    realisticGrassBatch.setMatrixAt(realisticGrassCount++,instanceTransform.matrix);
  }
  realisticGrassBatch.count=realisticGrassCount;
  realisticGrassBatch.instanceMatrix.needsUpdate=true;
  return realisticGrassBatch;
}

function createGableRoofGeometry(width,depth,height){
  const hw=width/2,hd=depth/2;
  const vertices=new Float32Array([
    -hw,0,-hd,  hw,0,-hd,  hw,0, hd, -hw,0, hd,
    -hw,0,-hd,  0,height,-hd,  hw,0,-hd,
    -hw,0, hd,  hw,0, hd,     0,height, hd,
    -hw,0,-hd, -hw,0, hd,     0,height, hd, 0,height,-hd,
     hw,0,-hd,  0,height,-hd,  0,height, hd, hw,0, hd
  ]);
  const indices=[
    0,1,2,0,2,3,
    4,5,6,
    7,8,9,
    10,11,12,10,12,13,
    14,15,16,14,16,17
  ];
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function addRealisticHouse(x,z,s=.13){
  const g=new THREE.Group();
  g.name='house';
  g.position.set(x,0,z);
  g.rotation.y=rand(-.035,.035);
  world.add(g);

  const k=s/.13;
  const wallMat=realisticMat(0xd8d0c0,'plaster',{roughness:.90});
  const concreteMat=realisticMat(0xa9a79e,'stone',{roughness:.94});
  const woodMat=realisticMat(0x765039,'bark',{roughness:.88,bumpScale:.005});
  const roofMat=realisticMat(0x8a5140,'roof',{roughness:.87});
  const metalMat=new THREE.MeshStandardMaterial({color:0x545b58,roughness:.40,metalness:.45});

  // Foundation / terrace
  const base=mesh(rb(.250*k,.030*k,.195*k,.010,4),concreteMat,[0,.025*k,0]);
  g.add(base);

  // Main plaster wall body
  const body=mesh(rb(.220*k,.145*k,.166*k,.006,3),wallMat,[0,.105*k,0]);
  g.add(body);

  // Real gable roof, not a cartoon cone
  const roof=mesh(
    createGableRoofGeometry(.265*k,.205*k,.085*k),
    roofMat,
    [0,.179*k,0]
  );
  g.add(roof);

  // fascia + ridge
  const ridge=mesh(rb(.012*k,.014*k,.215*k,.002,2),metalMat,[0,.267*k,0]);
  g.add(ridge);

  // Front door with frame + handle
  const doorFrame=mesh(rb(.060*k,.090*k,.010*k,.003,2),woodMat,[0,.083*k,.088*k]);
  g.add(doorFrame);
  const door=mesh(rb(.049*k,.080*k,.012*k,.002,2),realisticMat(0x5f4736,'bark'),[0,.083*k,.095*k]);
  g.add(door);
  const handle=mesh(new THREE.SphereGeometry(.004*k,10,8),metalMat,[.016*k,.083*k,.103*k]);
  g.add(handle);

  // Windows with real glass material and shallow frames
  for(const wx of [-.067,.067]){
    const frame=mesh(rb(.052*k,.050*k,.012*k,.003,2),woodMat,[wx*k,.118*k,.089*k]);
    g.add(frame);
    const glass=mesh(rb(.040*k,.038*k,.008*k,.002,2),realisticGlass(0x8bb8c7,.62),[wx*k,.118*k,.097*k]);
    glass.castShadow=false;
    g.add(glass);

    // window cross
    const vm=mesh(rb(.003*k,.039*k,.004*k,.001,1),woodMat,[wx*k,.118*k,.102*k]);
    const hm=mesh(rb(.041*k,.003*k,.004*k,.001,1),woodMat,[wx*k,.118*k,.102*k]);
    g.add(vm,hm);
  }

  // Side window adds parallax when user rotates the AR world.
  const sideFrame=mesh(rb(.012*k,.046*k,.048*k,.003,2),woodMat,[.114*k,.120*k,-.018*k]);
  g.add(sideFrame);
  const sideGlass=mesh(rb(.009*k,.035*k,.037*k,.002,2),realisticGlass(0x8fbac4,.58),[.119*k,.120*k,-.018*k]);
  sideGlass.castShadow=false;
  g.add(sideGlass);

  // Chimney
  const chimney=mesh(rb(.025*k,.080*k,.030*k,.003,2),realisticMat(0x8f6653,'stone'),[.065*k,.248*k,-.035*k]);
  g.add(chimney);
  const cap=mesh(rb(.034*k,.008*k,.038*k,.002,2),concreteMat,[.065*k,.291*k,-.035*k]);
  g.add(cap);

  // Porch steps
  for(let i=0;i<3;i++){
    const step=mesh(
      rb((.075+i*.026)*k,.009*k,(.030+i*.018)*k,.002,2),
      concreteMat,
      [0,(.009+i*.008)*k,(.110+i*.010)*k]
    );
    g.add(step);
  }

  // Rain gutter
  for(const side of [-1,1]){
    const gutter=mesh(
      new THREE.CylinderGeometry(.004*k,.004*k,.205*k,8),
      metalMat,
      [side*.127*k,.178*k,0],
      [Math.PI/2,0,0]
    );
    g.add(gutter);
  }

  return g;
}

function buildRealisticCar(color=0x718b98){
  const g=new THREE.Group();
  g.name='vehicle';
  g.userData.wheels=[];

  const paint=new THREE.MeshPhysicalMaterial({
    color,
    roughness:.24,
    metalness:.16,
    clearcoat:1,
    clearcoatRoughness:.08,
    reflectivity:.72
  });
  const paintDark=new THREE.MeshPhysicalMaterial({
    color:new THREE.Color(color).multiplyScalar(.78),
    roughness:.28,
    metalness:.14,
    clearcoat:.95,
    clearcoatRoughness:.10
  });
  const tire=new THREE.MeshStandardMaterial({
    color:0x111312,
    roughness:.98,
    metalness:0
  });
  const rubberTrim=new THREE.MeshStandardMaterial({
    color:0x202322,
    roughness:.84,
    metalness:.02
  });
  const metal=new THREE.MeshStandardMaterial({
    color:0x8d9491,
    roughness:.30,
    metalness:.78
  });
  const darkMetal=new THREE.MeshStandardMaterial({
    color:0x343a38,
    roughness:.36,
    metalness:.70
  });
  const headlamp=new THREE.MeshPhysicalMaterial({
    color:0xf3f6ef,
    emissive:0xf4e6b5,
    emissiveIntensity:.34,
    roughness:.06,
    clearcoat:1,
    clearcoatRoughness:.04
  });
  const taillamp=new THREE.MeshPhysicalMaterial({
    color:0xb62c29,
    emissive:0x5c0d0d,
    emissiveIntensity:.45,
    roughness:.12,
    clearcoat:.90
  });
  const indicator=new THREE.MeshPhysicalMaterial({
    color:0xf0a33b,
    emissive:0x6c2d06,
    emissiveIntensity:.25,
    roughness:.12,
    clearcoat:.9
  });
  const glass=realisticGlass(0x6f929c,.57);

  // --------------------------
  // Main lower body / rocker
  // --------------------------
  g.add(mesh(
    rb(.154,.030,.071,.010,4),
    paintDark,
    [0,.031,0]
  ));

  // Main passenger/body shell
  g.add(mesh(
    rb(.138,.036,.069,.010,5),
    paint,
    [-.002,.050,0]
  ));

  // Front bumper
  g.add(mesh(
    rb(.018,.020,.068,.004,3),
    rubberTrim,
    [-.080,.034,0]
  ));

  // Rear bumper
  g.add(mesh(
    rb(.018,.019,.068,.004,3),
    rubberTrim,
    [.080,.034,0]
  ));

  // Hood and trunk are separate pieces to create stronger silhouette
  g.add(mesh(
    rb(.050,.016,.066,.006,3),
    paint,
    [-.055,.066,0],
    [0,0,-.025]
  ));
  g.add(mesh(
    rb(.040,.015,.066,.006,3),
    paint,
    [.058,.065,0],
    [0,0,.018]
  ));

  // --------------------------
  // Cabin / windshield volume
  // --------------------------
  const cabinBase=mesh(
    rb(.073,.040,.060,.008,4),
    glass,
    [.004,.084,0]
  );
  cabinBase.castShadow=false;
  g.add(cabinBase);

  // Painted roof shell
  g.add(mesh(
    rb(.062,.010,.063,.005,3),
    paint,
    [.005,.107,0]
  ));

  // A-pillars / B-pillars / C-pillars
  for(const x of [-.031,.004,.036]){
    for(const z of [-.031,.031]){
      const pillar=mesh(
        rb(.006,.038,.006,.002,2),
        darkMetal,
        [x,.084,z]
      );
      pillar.rotation.z = x < -.02 ? -.20 : x > .02 ? .18 : 0;
      g.add(pillar);
    }
  }

  // Windshield and rear glass separate from side glass
  const windshield=mesh(
    rb(.012,.034,.054,.004,3),
    realisticGlass(0x7194a1,.60),
    [-.035,.086,0],
    [0,0,-.28]
  );
  windshield.castShadow=false;
  g.add(windshield);

  const rearGlass=mesh(
    rb(.011,.031,.054,.004,3),
    realisticGlass(0x7194a1,.58),
    [.041,.085,0],
    [0,0,.24]
  );
  rearGlass.castShadow=false;
  g.add(rearGlass);

  // Side windows, front + rear
  for(const side of [-1,1]){
    const z=side*.0318;

    const frontWindow=mesh(
      rb(.030,.031,.004,.002,2),
      realisticGlass(0x6b8d98,.58),
      [-.012,.086,z]
    );
    frontWindow.castShadow=false;
    g.add(frontWindow);

    const rearWindow=mesh(
      rb(.027,.030,.004,.002,2),
      realisticGlass(0x6b8d98,.56),
      [.023,.085,z]
    );
    rearWindow.castShadow=false;
    g.add(rearWindow);

    // Door seam / lower sill
    g.add(mesh(
      rb(.072,.003,.003,.001,1),
      darkMetal,
      [.005,.058,z+side*.002]
    ));

    // Door handle
    g.add(mesh(
      rb(.013,.004,.004,.0015,2),
      metal,
      [.015,.073,z+side*.003]
    ));

    // Side mirror
    const mirrorArm=mesh(
      new THREE.CylinderGeometry(.0022,.0025,.013,8),
      darkMetal,
      [-.027,.082,z+side*.008],
      [Math.PI/2,0,0]
    );
    g.add(mirrorArm);

    const mirror=mesh(
      rb(.012,.008,.004,.003,3),
      paintDark,
      [-.027,.083,z+side*.015]
    );
    g.add(mirror);
  }

  // --------------------------
  // Front grille + lamps
  // --------------------------
  g.add(mesh(
    rb(.006,.015,.035,.002,2),
    darkMetal,
    [-.089,.044,0]
  ));
  for(let i=-2;i<=2;i++){
    g.add(mesh(
      rb(.006,.002,.006,.001,1),
      metal,
      [-.092,.044,i*.006]
    ));
  }

  for(const z of [-.022,.022]){
    const h=mesh(
      rb(.008,.013,.016,.003,3),
      headlamp,
      [-.088,.054,z]
    );
    h.castShadow=false;
    g.add(h);

    const ind=mesh(
      rb(.006,.006,.006,.002,2),
      indicator,
      [-.091,.050,z+(z>0?.010:-.010)]
    );
    ind.castShadow=false;
    g.add(ind);

    const t=mesh(
      rb(.007,.013,.016,.003,3),
      taillamp,
      [.088,.053,z]
    );
    t.castShadow=false;
    g.add(t);
  }

  // license plates
  const plateMat=new THREE.MeshStandardMaterial({
    color:0xe5e5df,
    roughness:.65,
    metalness:.05
  });
  g.add(mesh(rb(.004,.012,.030,.001,1),plateMat,[-.092,.032,0]));
  g.add(mesh(rb(.004,.012,.030,.001,1),plateMat,[.092,.032,0]));

  // --------------------------
  // Wheels + realistic hubs
  // --------------------------
  for(const x of [-.050,.050]){
    for(const z of [-.0375,.0375]){
      const wheelGroup=new THREE.Group();
      wheelGroup.position.set(x,.019,z);

      const tyre=mesh(
        new THREE.CylinderGeometry(.016,.016,.014,24),
        tire,
        [0,0,0],
        [Math.PI/2,0,0]
      );
      tyre.userData.baseRotX=tyre.rotation.x;
      wheelGroup.add(tyre);

      const rim=mesh(
        new THREE.CylinderGeometry(.009,.009,.0145,20),
        metal,
        [0,0,0],
        [Math.PI/2,0,0]
      );
      wheelGroup.add(rim);

      const hub=mesh(
        new THREE.CylinderGeometry(.0035,.0035,.015,14),
        darkMetal,
        [0,0,0],
        [Math.PI/2,0,0]
      );
      wheelGroup.add(hub);

      // Simple spoke impression
      for(let i=0;i<6;i++){
        const a=i/6*Math.PI*2;
        const spoke=mesh(
          rb(.010,.002,.002,.0006,1),
          darkMetal,
          [0,0,0]
        );
        spoke.rotation.z=a;
        wheelGroup.add(spoke);
      }

      g.add(wheelGroup);
      g.userData.wheels.push(wheelGroup);
      wheelGroup.userData.baseRotX=wheelGroup.rotation.x;
    }
  }

  // Small underbody shadow/detail piece
  g.add(mesh(
    rb(.105,.010,.055,.003,2),
    rubberTrim,
    [0,.013,0]
  ));

  return g;
}

function addRealisticCar(x,z,color=0x718b98,moving=true){
  const ROAD_CAR_Y=.056;
  const g=buildRealisticCar(color);
  g.rotation.y=Math.PI;
  g.position.set(x,ROAD_CAR_Y,z);
  world.add(g);
  if(moving){
    g.userData.axis='x';
    g.userData.routeMin=ROAD_X_MIN+.07;
    g.userData.routeMax=ROAD_X_MAX-.07;
    g.userData.offset=rand(0,1);
    g.userData.speed=rand(.020,.034);
    g.userData.baseY=ROAD_CAR_Y;
    movingCars.push(g);
  }
  return g;
}

function buildRealisticMotorbike(color=0x4c5960){
  const g=new THREE.Group();
  g.name='vehicle';
  g.userData.wheels=[];

  const paint=new THREE.MeshPhysicalMaterial({
    color,
    roughness:.25,
    metalness:.14,
    clearcoat:.96,
    clearcoatRoughness:.09
  });
  const paintDark=new THREE.MeshPhysicalMaterial({
    color:new THREE.Color(color).multiplyScalar(.72),
    roughness:.30,
    metalness:.12,
    clearcoat:.84
  });
  const tire=new THREE.MeshStandardMaterial({
    color:0x121413,
    roughness:.99
  });
  const rubber=new THREE.MeshStandardMaterial({
    color:0x232625,
    roughness:.90
  });
  const metal=new THREE.MeshStandardMaterial({
    color:0x9aa09e,
    roughness:.28,
    metalness:.82
  });
  const darkMetal=new THREE.MeshStandardMaterial({
    color:0x3b4240,
    roughness:.35,
    metalness:.74
  });
  const seatMat=new THREE.MeshStandardMaterial({
    color:0x202322,
    roughness:.96
  });
  const headLamp=new THREE.MeshPhysicalMaterial({
    color:0xf1f3e8,
    emissive:0xe2d69f,
    emissiveIntensity:.38,
    roughness:.08,
    clearcoat:1
  });
  const tailLamp=new THREE.MeshStandardMaterial({
    color:0xb12220,
    emissive:0x5e0b0b,
    emissiveIntensity:.45,
    roughness:.12
  });

  // --------------------------
  // Wheels with rims
  // --------------------------
  for(const x of [-.046,.046]){
    const wheelGroup=new THREE.Group();
    wheelGroup.position.set(x,.022,0);

    const tyre=mesh(
      new THREE.TorusGeometry(.019,.0052,12,28),
      tire,
      [0,0,0],
      [Math.PI/2,0,0]
    );
    wheelGroup.add(tyre);

    const rim=mesh(
      new THREE.TorusGeometry(.011,.0018,8,24),
      metal,
      [0,0,0],
      [Math.PI/2,0,0]
    );
    wheelGroup.add(rim);

    const hub=mesh(
      new THREE.CylinderGeometry(.003,.003,.014,14),
      darkMetal,
      [0,0,0],
      [Math.PI/2,0,0]
    );
    wheelGroup.add(hub);

    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2;
      const spoke=mesh(
        rb(.012,.0015,.0015,.0005,1),
        metal,
        [0,0,0]
      );
      spoke.rotation.z=a;
      wheelGroup.add(spoke);
    }

    g.add(wheelGroup);
    g.userData.wheels.push(wheelGroup);
  }

  // --------------------------
  // Main frame
  // --------------------------
  const frame1=mesh(
    new THREE.CylinderGeometry(.0025,.003,.080,8),
    darkMetal,
    [0,.047,0],
    [0,0,Math.PI/2]
  );
  g.add(frame1);

  const frame2=mesh(
    new THREE.CylinderGeometry(.0025,.003,.067,8),
    darkMetal,
    [-.004,.050,0],
    [0,0,-.82]
  );
  g.add(frame2);

  const frame3=mesh(
    new THREE.CylinderGeometry(.0025,.003,.066,8),
    darkMetal,
    [.006,.050,0],
    [0,0,.83]
  );
  g.add(frame3);

  // Engine block
  g.add(mesh(
    rb(.030,.025,.028,.004,3),
    darkMetal,
    [0,.041,0]
  ));
  for(let i=-1;i<=1;i++){
    g.add(mesh(
      rb(.020,.002,.030,.0008,1),
      metal,
      [0,.037+i*.007,0]
    ));
  }

  // Fuel tank / front fairing
  g.add(mesh(
    rb(.043,.026,.031,.008,4),
    paint,
    [.006,.067,0],
    [0,0,-.10]
  ));

  // Side fairing panel
  for(const z of [-.016,.016]){
    g.add(mesh(
      rb(.040,.018,.005,.004,3),
      paintDark,
      [.003,.055,z]
    ));
  }

  // Seat
  g.add(mesh(
    rb(.045,.012,.030,.006,4),
    seatMat,
    [.014,.083,0],
    [0,0,.03]
  ));

  // Rear fender
  g.add(mesh(
    rb(.026,.007,.030,.004,3),
    paintDark,
    [.047,.063,0],
    [0,0,.15]
  ));

  // Front fork pair
  for(const z of [-.010,.010]){
    g.add(mesh(
      new THREE.CylinderGeometry(.0025,.003,.066,10),
      metal,
      [-.034,.055,z],
      [0,0,-.24]
    ));
  }

  // Rear swingarm
  for(const z of [-.010,.010]){
    g.add(mesh(
      new THREE.CylinderGeometry(.0024,.003,.058,10),
      darkMetal,
      [.027,.041,z],
      [0,0,.92]
    ));
  }

  // Handlebar stem + bar
  g.add(mesh(
    new THREE.CylinderGeometry(.0022,.0027,.044,10),
    darkMetal,
    [-.026,.088,0],
    [0,0,-.25]
  ));
  g.add(mesh(
    new THREE.CylinderGeometry(.002,.002,.050,10),
    metal,
    [-.034,.106,0],
    [Math.PI/2,0,0]
  ));

  // grips
  for(const z of [-.027,.027]){
    g.add(mesh(
      new THREE.CylinderGeometry(.003,.003,.015,10),
      rubber,
      [-.034,.106,z],
      [Math.PI/2,0,0]
    ));
  }

  // Headlight housing
  const headHousing=mesh(
    new THREE.CylinderGeometry(.011,.011,.010,18),
    darkMetal,
    [-.041,.090,0],
    [0,0,Math.PI/2]
  );
  g.add(headHousing);
  const lamp=mesh(
    new THREE.CylinderGeometry(.008,.008,.011,18),
    headLamp,
    [-.047,.090,0],
    [0,0,Math.PI/2]
  );
  lamp.castShadow=false;
  g.add(lamp);

  // Tail lamp
  const tail=mesh(
    rb(.008,.008,.015,.002,2),
    tailLamp,
    [.056,.076,0]
  );
  tail.castShadow=false;
  g.add(tail);

  // Exhaust pipe + muffler
  g.add(mesh(
    new THREE.CylinderGeometry(.0022,.0025,.070,10),
    darkMetal,
    [.021,.033,-.019],
    [0,0,.82]
  ));
  g.add(mesh(
    new THREE.CylinderGeometry(.005,.006,.040,12),
    metal,
    [.047,.028,-.020],
    [0,0,1.05]
  ));

  // Chain/sprocket impression
  const sprocket=mesh(
    new THREE.TorusGeometry(.010,.0015,8,18),
    darkMetal,
    [.033,.028,-.010],
    [Math.PI/2,0,0]
  );
  g.add(sprocket);

  // Small mirrors
  for(const z of [-.023,.023]){
    const stem=mesh(
      new THREE.CylinderGeometry(.0015,.0018,.025,8),
      darkMetal,
      [-.035,.113,z*.75],
      [0,0,z<0?.45:-.45]
    );
    g.add(stem);

    const mirror=mesh(
      rb(.010,.007,.003,.003,3),
      darkMetal,
      [-.036,.124,z]
    );
    g.add(mirror);
  }

  // Rear mudguard
  g.add(mesh(
    rb(.030,.005,.025,.004,3),
    rubber,
    [.047,.050,0],
    [0,0,.20]
  ));

  return g;
}


function addRealisticMotorbikeRider(bike,shirt=0x526b79){
  const rider=new THREE.Group();
  rider.name='motorbikeRider';

  const skin=new THREE.MeshStandardMaterial({
    color:0xb88465,
    roughness:.86,
    metalness:0
  });
  const cloth=new THREE.MeshStandardMaterial({
    color:shirt,
    roughness:.90,
    metalness:0
  });
  const pants=new THREE.MeshStandardMaterial({
    color:0x293235,
    roughness:.94,
    metalness:0
  });
  const shoe=new THREE.MeshStandardMaterial({
    color:0x1f2221,
    roughness:.92,
    metalness:0
  });
  const helmetMat=new THREE.MeshPhysicalMaterial({
    color:0x303b40,
    roughness:.24,
    metalness:.18,
    clearcoat:.92,
    clearcoatRoughness:.10
  });
  const visorMat=realisticGlass(0x6b8993,.62);

  // Hip / pelvis sits directly above the seat.
  const hip=mesh(
    rb(.025,.018,.027,.006,3),
    pants,
    [.014,.093,0]
  );
  rider.add(hip);

  // Torso leans slightly toward handlebar.
  const torso=mesh(
    rb(.035,.060,.027,.010,4),
    cloth,
    [-.002,.128,0],
    [0,0,-.18]
  );
  rider.add(torso);

  // Neck + head.
  rider.add(mesh(
    new THREE.CylinderGeometry(.006,.007,.013,10),
    skin,
    [-.014,.163,0],
    [0,0,-.12]
  ));
  rider.add(mesh(
    new THREE.SphereGeometry(.018,18,14),
    skin,
    [-.018,.181,0],
    [0,0,0],
    [.94,1.06,.96]
  ));

  // Helmet shell + visor.
  const helmet=mesh(
    new THREE.SphereGeometry(.021,20,16,0,Math.PI*2,0,Math.PI*.82),
    helmetMat,
    [-.019,.185,0],
    [0,0,-.05],
    [1.03,1.02,1.03]
  );
  rider.add(helmet);

  const visor=mesh(
    rb(.005,.012,.026,.004,3),
    visorMat,
    [-.038,.183,0],
    [0,0,-.13]
  );
  visor.castShadow=false;
  rider.add(visor);

  // Arms reach the handlebar.
  for(const side of [-1,1]){
    const z=side*.014;

    const upperArm=mesh(
      new THREE.CylinderGeometry(.0045,.0055,.044,10),
      cloth,
      [-.018,.137,z],
      [Math.PI/2,0,-.78]
    );
    rider.add(upperArm);

    const foreArm=mesh(
      new THREE.CylinderGeometry(.004,.0048,.040,10),
      skin,
      [-.031,.119,z*1.35],
      [Math.PI/2,0,-.38]
    );
    rider.add(foreArm);

    // Hand near grip.
    rider.add(mesh(
      new THREE.SphereGeometry(.0055,10,8),
      skin,
      [-.036,.107,z*1.65]
    ));
  }

  // Bent riding legs: thigh slopes forward/down, shin reaches footpeg.
  for(const side of [-1,1]){
    const z=side*.014;

    const thigh=mesh(
      new THREE.CylinderGeometry(.006,.007,.052,10),
      pants,
      [.008,.072,z],
      [Math.PI/2,0,-.78]
    );
    rider.add(thigh);

    const shin=mesh(
      new THREE.CylinderGeometry(.0055,.0065,.047,10),
      pants,
      [-.010,.048,z*1.25],
      [Math.PI/2,0,.48]
    );
    rider.add(shin);

    const foot=mesh(
      rb(.024,.008,.012,.003,2),
      shoe,
      [-.018,.032,z*1.45],
      [0,0,-.05]
    );
    rider.add(foot);
  }

  bike.add(rider);
  return rider;
}

function addRealisticMotorbike(x,z,color=0x4c5960,moving=true){
  const ROAD_BIKE_Y=.062;
  const g=buildRealisticMotorbike(color);

  // Model front is local -X while the road animation moves toward +X.
  // Rotate once so the motorcycle visually travels FORWARD, not backward.
  g.rotation.y=Math.PI;

  addRealisticMotorbikeRider(g,0x526b79);

  g.position.set(x,ROAD_BIKE_Y,z);
  world.add(g);

  if(moving){
    g.userData.axis='x';
    g.userData.routeMin=ROAD_X_MIN+.09;
    g.userData.routeMax=ROAD_X_MAX-.09;
    g.userData.offset=rand(0,1);
    g.userData.speed=rand(.026,.040);
    g.userData.baseY=ROAD_BIKE_Y;
    movingCars.push(g);
  }
  return g;
}

function buildRealisticHuman(shirt=0x5d7180,pose='walk'){
  const g=new THREE.Group();
  const skin=new THREE.MeshStandardMaterial({color:0xb98666,roughness:.86});
  const cloth=new THREE.MeshStandardMaterial({color:shirt,roughness:.90});
  const pants=new THREE.MeshStandardMaterial({color:0x303a3d,roughness:.94});
  const shoe=new THREE.MeshStandardMaterial({color:0x232625,roughness:.90});

  // Core Three.js geometries only: safe with current importmap.
  const torso=mesh(rb(.046,.075,.030,.012,4),cloth,[0,.122,0]);g.add(torso);
  const head=mesh(new THREE.SphereGeometry(.025,18,14),skin,[0,.180,0],[0,0,0],[.92,1.08,.95]);g.add(head);

  const armL=mesh(new THREE.CylinderGeometry(.0065,.0075,.060,10),skin,[-.030,.119,0]);
  const armR=mesh(new THREE.CylinderGeometry(.0065,.0075,.060,10),skin,[.030,.119,0]);
  const legL=mesh(new THREE.CylinderGeometry(.008,.009,.066,10),pants,[-.013,.050,0]);
  const legR=mesh(new THREE.CylinderGeometry(.008,.009,.066,10),pants,[.013,.050,0]);
  g.add(armL,armR,legL,legR);

  g.add(mesh(rb(.026,.010,.043,.004,2),shoe,[-.013,.011,.009]));
  g.add(mesh(rb(.026,.010,.043,.004,2),shoe,[.013,.011,.009]));

  if(pose==='walk'){
    armL.rotation.z=.25;armR.rotation.z=-.25;
    legL.rotation.z=-.10;legR.rotation.z=.10;
  }
  if(pose==='work'){armL.rotation.z=.55;armR.rotation.z=-.55;}
  g.userData.limbs={armL,armR,legL,legR};
  return g;
}

function addRealisticHuman(x,z,s=.72,shirt=0x5d7180,pose='walk'){
  const g=buildRealisticHuman(shirt,pose);
  g.scale.setScalar(s);
  g.position.set(x,.015,z);
  g.rotation.y=pose==='walk'?0:rand(-.35,.35);
  g.name='human';
  g.userData.baseY=g.position.y;
  g.userData.baseX=x;
  g.userData.phase=rand(0,Math.PI*2);
  g.userData.actorPose=pose;
  g.userData.walkAmp=pose==='walk'?rand(.015,.030):0;
  g.userData.walkSpeed=rand(.55,.80);
  world.add(g);
  ambientActors.push(g);
  return g;
}

function addRealisticVillageRoad(){
  const road=mesh(
    rb(ROAD_VISUAL_LENGTH,.026,.200,.018,5),
    realisticMat(0x555a56,'asphalt',{roughness:.97,bumpScale:.0028}),
    [0,.046,ROAD_Z]
  );
  road.name='roadDeck';
  road.receiveShadow=true;
  world.add(road);

  const curbMat=realisticMat(0xb7b6ae,'stone',{roughness:.96});
  for(const z of [ROAD_Z-ROAD_HALF_DEPTH-.032,ROAD_Z+ROAD_HALF_DEPTH+.032]){
    const curb=mesh(rb(ROAD_VISUAL_LENGTH,.020,.030,.004,3),curbMat,[0,.039,z]);
    world.add(curb);
  }

  const paintMat=new THREE.MeshStandardMaterial({color:0xe8e5d9,roughness:.88});
  for(const z of [ROAD_Z-ROAD_HALF_DEPTH+.015,ROAD_Z+ROAD_HALF_DEPTH-.015]){
    const edge=mesh(rb(ROAD_EDGE_LENGTH,.005,.008,.0015,2),paintMat,[0,.058,z]);
    edge.castShadow=false;world.add(edge);
  }

  const yellow=new THREE.MeshStandardMaterial({color:0xd7b94c,roughness:.84});
  for(let i=0;i<ROAD_DASH_COUNT;i++){
    const dash=mesh(rb(.072,.005,.009,.0015,2),yellow,[ROAD_DASH_START+i*ROAD_DASH_SPACING,.059,ROAD_Z]);
    dash.castShadow=false;world.add(dash);
  }
}

function addRealisticBridge(){
  const g=new THREE.Group();
  g.name='riverBridge';
  g.position.set(-.015,0,ROAD_Z);
  world.add(g);

  const stone=realisticMat(0x9b9a90,'stone',{roughness:.98});
  const asphalt=realisticMat(0x515552,'asphalt',{roughness:.97});

  g.add(mesh(rb(.245,.030,.183,.008,4),stone,[0,.050,0]));
  g.add(mesh(rb(.225,.009,.145,.006,3),asphalt,[0,.071,0]));

  // concrete railing columns + horizontal rail
  for(const z of [-.087,.087]){
    for(const x of [-.105,-.052,0,.052,.105]){
      g.add(mesh(rb(.012,.070,.012,.002,2),stone,[x,.100,z]));
    }
    g.add(mesh(rb(.235,.012,.012,.002,2),stone,[0,.132,z]));
  }

  for(const x of [-.105,.105]){
    g.add(mesh(rb(.025,.065,.135,.005,3),stone,[x,.020,0]));
  }
}

function addRealisticNatureStageOne(){
  const rng=seeded(410);
  const planted=[];
  const treeCount=QUALITY==='lite'?15:23;

  for(let i=0;i<treeCount;i++){
    let x=0,z=0,tries=0;
    do{
      x=-.70+rng()*1.40;
      z=-.39+rng()*.70;
      tries++;
    }while((!terrainSpotIsClear(x,z,0,.040)||planted.some(p=>Math.hypot(x-p.x,z-p.z)<.115))&&tries<60);

    if(!terrainSpotIsClear(x,z,0,.040)||planted.some(p=>Math.hypot(x-p.x,z-p.z)<.115))continue;
    addRealisticTree(x,z,.044+rng()*.026);
    planted.push({x,z});
  }

  const grassCount=QUALITY==='lite'?16:28;
  for(let i=0;i<grassCount;i++){
    const x=-.68+rng()*1.36,z=-.37+rng()*.68;
    if(!terrainSpotIsClear(x,z,0,.01))continue;
    addRealisticGrassTuft(x,z,.55+rng()*.50);
  }

  for(let i=0;i<13;i++){
    const x=-.67+rng()*1.34,z=-.36+rng()*.66;
    if(!terrainSpotIsClear(x,z,0,.02))continue;
    addRealisticBush(x,z,.020+rng()*.016);
  }
}

function addHouse(x,z,s=.13,solar=false,modern=false){
  const g=new THREE.Group();
  g.name='house';
  g.position.set(x,0,z);
  world.add(g);

  const k=s/.13;
  const variant=Math.abs(Math.round(x*1000+z*1700))%3;

  const classicBodies=[0xf2d9a3,0xe9c9a8,0xd9dfbd];
  const classicRoofs=[0xd96e50,0xb96f56,0x657c72];
  const modernBodies=[0xeaf3ec,0xdcebe7,0xf0eee4];
  const modernRoofs=[0x527a72,0x456d66,0x6d8179];

  const bodyColor=modern?modernBodies[variant]:classicBodies[variant];
  const trim=modern?0x365d55:0x735945;
  const roofColor=modern?modernRoofs[variant]:classicRoofs[variant];

  addBox(g,[.236*k,.025*k,.176*k],0xd4c6aa,[0,.027*k,0],[0,0,0],.012,true);
  addBox(g,[.220*k,.132*k,.158*k],bodyColor,[0,.092*k,0],[0,0,0],.018,true);
  addBox(g,[.250*k,.018*k,.185*k],trim,[0,.165*k,0],[0,0,0],.009);

  const roof=mesh(
    new THREE.ConeGeometry(.172*k,.100*k,4),
    toon(roofColor,{roughness:.90}),
    [0,.215*k,0],
    [0,Math.PI/4,0],
    [1.12,1,.82]
  );
  g.add(roof);

  // Extra roof ridge adds a clear silhouette from low AR camera angles.
  addBox(g,[.012*k,.020*k,.164*k],trim,[0,.247*k,0],[0,0,0],.004);

  addBox(g,[.048*k,.078*k,.012*k],0x805b3e,[0,.078*k,.086*k],[0,0,0],.006);
  addBox(g,[.085*k,.010*k,.047*k],0xb9976c,[0,.035*k,.108*k],[0,0,0],.005);

  for(const wx of [-.067,.067]){
    addBox(g,[.046*k,.040*k,.011*k],trim,[wx*k,.108*k,.087*k],[0,0,0],.006);
    addBox(g,[.034*k,.029*k,.013*k],0x8ed0e6,[wx*k,.108*k,.094*k],[0,0,0],.004);
    addBox(g,[.004*k,.031*k,.015*k],0xffffff,[wx*k,.108*k,.101*k],[0,0,0],.001);
    addBox(g,[.036*k,.004*k,.015*k],0xffffff,[wx*k,.108*k,.101*k],[0,0,0],.001);
  }

  // Side window gives the house depth when the user walks around / rotates it.
  addBox(g,[.010*k,.038*k,.044*k],trim,[.111*k,.108*k,-.015*k],[0,Math.PI/2,0],.005);
  addBox(g,[.012*k,.028*k,.033*k],0x8ed0e6,[.116*k,.108*k,-.015*k],[0,Math.PI/2,0],.003);

  addCyl(g,.012*k,.014*k,.072*k,0x82614e,[.070*k,.268*k,-.018*k],8);
  addBox(g,[.050*k,.006*k,.100*k],0xd0c6aa,[0,.015*k,.145*k],[0,0,0],.004);

  for(const sx of [-.12,.12]){
    for(let i=0;i<3;i++){
      addBox(g,[.008*k,.042*k,.008*k],0xe8dfc6,[sx*k,.026*k,(.09+i*.035)*k],[0,0,0],.002);
    }
  }

  // Tiny planter/detail makes each house read as a miniature, not a plain box.
  if(variant!==1){
    const pot=mesh(
      new THREE.CylinderGeometry(.011*k,.014*k,.025*k,10),
      toon(0xb56f4f),
      [-.083*k,.028*k,.101*k]
    );
    g.add(pot);
    const plant=mesh(
      new THREE.IcosahedronGeometry(.018*k,1),
      toon(0x5b9b55),
      [-.083*k,.051*k,.101*k]
    );
    g.add(plant);
  }

  if(solar){
    const p=buildSolarModel(.72);
    p.position.set(0,.282*k,.005);
    p.rotation.x=-.18;
    p.scale.setScalar(.66*k);
    g.add(p);
  }

  shadowBlob(world,x,z,.13*k,.075*k,.19);
  return g;
}
function addRoadDeck({clean=false}={}){
  // Asphalt dibuat lebih lebar, lebih gelap, dan lebih tinggi dari terrain.
  // Sidewalk + garis tepi membuat jalan terbaca jelas dari sudut kamera rendah.
  const asphaltColor=clean?0x3f5350:0x262f2d;
  const road=mesh(
    rb(ROAD_VISUAL_LENGTH,.030,.200,.030,5),
    toon(asphaltColor,{roughness:.90}),
    [0,.046,ROAD_Z]
  );
  road.receiveShadow=true;
  world.add(road);

  // Bahu / trotoar kiri-kanan.
  const sidewalkColor=clean?0xcbd4ca:0xaeb9b3;
  addBox(world,[ROAD_VISUAL_LENGTH,.018,.030],sidewalkColor,[0,.038,ROAD_Z-ROAD_HALF_DEPTH-.032],[0,0,0],.006);
  addBox(world,[ROAD_VISUAL_LENGTH,.018,.030],sidewalkColor,[0,.038,ROAD_Z+ROAD_HALF_DEPTH+.032],[0,0,0],.006);

  // Garis tepi putih.
  addBox(world,[ROAD_EDGE_LENGTH,.006,.009],0xf1f3ec,[0,.055,ROAD_Z-ROAD_HALF_DEPTH+.015],[0,0,0],.002);
  addBox(world,[ROAD_EDGE_LENGTH,.006,.009],0xf1f3ec,[0,.055,ROAD_Z+ROAD_HALF_DEPTH-.015],[0,0,0],.002);

  // Marka tengah putus-putus kuning.
  for(let i=0;i<ROAD_DASH_COUNT;i++){
    addBox(
      world,
      [.072,.006,.010],
      clean?0xf4e6a0:0xf0ca53,
      [ROAD_DASH_START+i*ROAD_DASH_SPACING,.057,ROAD_Z],
      [0,0,0],
      .002
    );
  }

  // Zebra cross di sisi kiri sebagai detail tambahan supaya jalan mudah dikenali.
  for(let i=0;i<5;i++){
    addBox(
      world,
      [.018,.007,.115],
      0xf5f6f1,
      [-.50+i*.030,.058,ROAD_Z],
      [0,0,0],
      .002
    );
  }
}

function addVillagePath(){
  addRoadDeck({clean:true});
}

function addRoad(){
  addRoadDeck({clean:false});
}
function buildCar(color=0xf08a4b,clean=false){
  const g=new THREE.Group();
  g.name='vehicle';
  g.userData.wheels=[];
  addBox(g,[.13,.038,.066],color,[0,.033,0],[0,0,0],.014,true);
  addBox(g,[.071,.037,.057],clean?0xa8dded:0x8fc8dc,[.005,.066,-.002],[0,0,0],.012,true);
  if(clean){
    addBox(g,[.018,.008,.006],0x72d26e,[.045,.041,.035],[0,0,0],.002);
  }
  for(const x of [-.045,.045])for(const z of [-.036,.036]){
    const w=mesh(new THREE.CylinderGeometry(.014,.014,.012,14),toon(0x252d2b),[x,.019,z],[Math.PI/2,0,0]);
    w.userData.baseRotX=w.rotation.x;
    g.userData.wheels.push(w);
    g.add(w);
  }
  return g;
}
function addCar(x,z,color=0xf08a4b,moving=true,clean=false){
  // Road top ≈ 0.061. Posisi ini membuat roda menyentuh asphalt tanpa tenggelam.
  const ROAD_CAR_Y=.056;
  const g=buildCar(color,clean);
  g.position.set(x,ROAD_CAR_Y,z);
  world.add(g);

  if(moving){
    g.userData={
      axis:'x',
      routeMin:ROAD_X_MIN+.07,
      routeMax:ROAD_X_MAX-.07,
      offset:rand(0,1),
      speed:rand(.020,.038),
      baseY:ROAD_CAR_Y
    };
    movingCars.push(g);
  }
  return g;
}
function buildMotorbike(color=0xe87548){
  const g=new THREE.Group();
  g.name='vehicle';
  g.userData.wheels=[];
  for(const x of [-.042,.042]){
    const w=mesh(new THREE.TorusGeometry(.018,.005,8,18),toon(0x252d2b),[x,.022,0],[Math.PI/2,0,0]);
    w.userData.baseRotX=w.rotation.x;
    g.userData.wheels.push(w);
    g.add(w);
  }
  addBox(g,[.065,.018,.026],color,[0,.042,0],[0,0,0],.008,true);
  addBox(g,[.028,.025,.022],0x393f3d,[.018,.061,0],[0,0,0],.006);
  addCyl(g,.004,.004,.052,0x555f5b,[.035,.070,0],8,[0,0,-.55]);
  return g;
}
function addMotorbike(x,z,color=0xe87548,moving=true){
  const ROAD_BIKE_Y=.062;
  const g=buildMotorbike(color);
  g.position.set(x,ROAD_BIKE_Y,z);
  world.add(g);

  if(moving){
    g.userData={
      axis:'x',
      routeMin:ROAD_X_MIN+.09,
      routeMax:ROAD_X_MAX-.09,
      offset:rand(0,1),
      speed:rand(.026,.045),
      baseY:ROAD_BIKE_Y
    };
    movingCars.push(g);
  }
  return g;
}
function buildHuman(shirt=0x4f8fbd,pants=0x3d4d59,pose='walk'){
  const g=new THREE.Group();
  addCyl(g,.015,.020,.075,pants,[0,.038,0],10);
  addBox(g,[.055,.075,.034],shirt,[0,.115,0],[0,0,0],.012,true);
  const head=mesh(new THREE.SphereGeometry(.031,16,12),toon(0xe0ae82),[0,.177,0]);g.add(head);
  const armL=addCyl(g,.008,.009,.065,0xe0ae82,[-.036,.118,0],8);const armR=addCyl(g,.008,.009,.065,0xe0ae82,[.036,.118,0],8);
  const legL=addCyl(g,.009,.011,.070,pants,[-.016,.035,0],8);const legR=addCyl(g,.009,.011,.070,pants,[.016,.035,0],8);
  if(pose==='walk'){armL.rotation.z=.35;armR.rotation.z=-.35;legL.rotation.z=-.16;legR.rotation.z=.16}
  if(pose==='work'){armL.rotation.z=.75;armR.rotation.z=-.75}
  g.userData.limbs={armL,armR,legL,legR};
  return g;
}
function addHuman(x,z,s=.72,shirt=0x4f8fbd,pose='walk'){
  const g=buildHuman(shirt,0x394b55,pose);
  g.scale.setScalar(s);
  g.position.set(x,.015,z);
  g.rotation.y=rand(-.5,.5);
  g.name='human';
  g.userData.baseY=g.position.y;
  g.userData.baseX=x;
  g.userData.phase=rand(0,Math.PI*2);
  g.userData.actorPose=pose;
  g.userData.walkAmp=pose==='walk'?rand(.018,.038):0;
  g.userData.walkSpeed=rand(.55,.85);
  world.add(g);
  ambientActors.push(g);
  return g;
}

function addBirdFlock(count=4){
  const flock=new THREE.Group();
  flock.name='birds';
  flock.position.set(-.48,.46,.10);
  flock.userData.phase=rand(0,Math.PI*2);
  flock.userData.radius=.22+rand(0,.08);
  world.add(flock);

  for(let i=0;i<count;i++){
    const bird=new THREE.Group();
    const wingMat=toon(0x33443c,{roughness:.9});
    const left=mesh(new THREE.ConeGeometry(.012,.060,3),wingMat,[-.020,0,0],[0,0,-1.05]);
    const right=mesh(new THREE.ConeGeometry(.012,.060,3),wingMat,[.020,0,0],[0,0,1.05]);
    left.castShadow=false; right.castShadow=false;
    bird.add(left,right);
    bird.position.set(i*.045,Math.sin(i)*.018,(i%2)*.025);
    bird.userData.left=left;
    bird.userData.right=right;
    bird.userData.phase=i*.72;
    flock.add(bird);
  }

  birdFlocks.push(flock);
  return flock;
}

function addWaterWasteChaos(stage){
  // Kebocoran/boros air: pipa terbuka + genangan biru di area permukiman, bukan di jalan.
  const pipe=new THREE.Group();pipe.position.set(-.57,0,-.05);world.add(pipe);
  addCyl(pipe,.012,.012,.12,0x8b9290,[0,.06,0],12);
  addCyl(pipe,.010,.010,.08,0x8b9290,[.035,.11,0],12,[0,0,Math.PI/2]);
  const water=mesh(new THREE.SphereGeometry(.055,18,8),phys(0x55bfe0,{transparent:true,opacity:.65,roughness:.12}),[-.56,.018,.015],[0,0,0],[1.8,.22,1.1]);world.add(water);
  // Sampah tercecer dekat industri, tetapi di luar jalan.
  for(const [x,z,c] of [[.61,.28,0xf2c94c],[.54,.33,0xe66d56],[.68,.22,0x5ca6d6],[.44,.30,0x8bbf6a]]){
    const bag=mesh(new THREE.DodecahedronGeometry(.026,1),toon(c),[x,.024,z],[rand(-.3,.3),rand(0,3),rand(-.2,.2)],[1,.75,.9]);world.add(bag);
  }
  if(stage>=2){
    for(const [x,z] of [[-.62,.22],[-.48,.28],[.30,.31]])addHuman(x,z,.68,0x8e6555,'walk');
  }
}
function buildCleanEV(scale=1){
  const g=buildRealisticCar(0x5f91a7);
  g.scale.setScalar(scale);
  g.rotation.y=Math.PI;
  return g;
}
function buildWaterSaver(scale=1){
  const g=new THREE.Group();
  addCyl(g,.040*scale,.046*scale,.12*scale,0x7fc4d6,[0,.065*scale,0],20);
  addBox(g,[.09*scale,.018*scale,.075*scale],0x3d756d,[0,.13*scale,0],[0,0,0],.009,true);
  addCyl(g,.008*scale,.008*scale,.07*scale,0xb8c8c6,[.025*scale,.165*scale,0],10,[0,0,Math.PI/2]);
  const drop=mesh(new THREE.SphereGeometry(.012*scale,12,10),phys(0x5ec9e8,{transparent:true,opacity:.8}),[.062*scale,.135*scale,0],[0,0,0],[.7,1.2,.7]);g.add(drop);
  return g;
}
function buildWasteStation(scale=1){
  const g=new THREE.Group();

  const colors=[0x4f8d64,0x4c7892,0xc49a45];
  const metal=new THREE.MeshStandardMaterial({
    color:0x37423e,
    roughness:.38,
    metalness:.64
  });

  for(let i=0;i<3;i++){
    const bodyMat=new THREE.MeshPhysicalMaterial({
      color:colors[i],
      roughness:.42,
      metalness:.12,
      clearcoat:.38,
      clearcoatRoughness:.22
    });

    const body=mesh(
      rb(.055*scale,.10*scale,.060*scale,.008,4),
      bodyMat,
      [(i-1)*.063*scale,.052*scale,0]
    );
    g.add(body);

    g.add(mesh(
      rb(.043*scale,.009*scale,.046*scale,.003,2),
      metal,
      [(i-1)*.063*scale,.107*scale,0]
    ));

    const mark=mesh(
      new THREE.RingGeometry(.010*scale,.015*scale,20),
      new THREE.MeshStandardMaterial({
        color:0xf2f3ef,
        roughness:.70,
        side:THREE.DoubleSide
      }),
      [(i-1)*.063*scale,.065*scale,.031*scale]
    );
    mark.castShadow=false;
    g.add(mark);
  }

  return g;
}
function buildFactory(stage=1){
  const polluted=isPollutedStage(stage);
  const g=new THREE.Group();g.name='factory';g.position.set(.52,0,.20);world.add(g);
  addBox(g,[.28,.13,.18],polluted?0x4e4944:0xb97950,[0,.075,0],[0,0,0],.015,true);
  addBox(g,[.19,.08,.12],polluted?0x51483f:0x9d7455,[-.18,.045,-.02],[0,0,0],.014,true);
  // sawtooth roof
  for(let i=-1;i<=1;i++){
    const roof=mesh(new THREE.ConeGeometry(.075,.065,4),toon(polluted?0x3e3c39:0x6f7771),[i*.075,.16,0],[0,Math.PI/4,0],[1,.8,1.2]);g.add(roof);
  }
  for(const x of [-.07,.07]){
    addCyl(g,.025,.03,.22,polluted?0x403b37:0x765548,[x,.25,-.03],14);
    addCyl(g,.031,.031,.018,0x342f2c,[x,.37,-.03],14);
    addSmokeEmitter(g,new THREE.Vector3(x,.39,-.03),polluted?1.35:.55);
  }
  // tanks + pipe
  for(const x of [-.20,.20]){
    addCyl(g,.045,.045,.10,0xbcc2b7,[x,.055,.11],18);
    const cap=mesh(new THREE.SphereGeometry(.045,16,8,0,Math.PI*2,0,Math.PI/2),toon(0xcbd2c6),[x,.105,.11]);g.add(cap);
  }
  const pipe=addCyl(g,.009,.009,.28,0x6c8b82,[-.20,.13,.11],10,[0,0,Math.PI/2]);
  shadowBlob(world,.52,.20,.25,.14,.18);return g;
}
function addSmokeEmitter(parent,origin,intensity=.7){
  const count=QUALITY==='lite'?5:9;
  for(let i=0;i<count;i++){
    const puff=mesh(
      new THREE.IcosahedronGeometry(.026+rand(0,.018),1),
      new THREE.MeshStandardMaterial({
        color:0x686a67,
        transparent:true,
        opacity:.58,
        roughness:1,
        metalness:0,
        depthWrite:false
      }),
      [origin.x+rand(-.01,.01),origin.y+i*.035,origin.z+rand(-.01,.01)]
    );
    puff.castShadow=false;parent.add(puff);puff.userData={base:origin.clone(),offset:i*.08,speed:.07+rand(0,.04),intensity,phase:rand(0,6)};smokePuffs.push(puff);
  }
}
function addDeadTree(x,z,s=.085){return addTree(x,z,s,false)}
function addCracks(){
  const mat=new THREE.MeshStandardMaterial({
    color:0x4f382c,
    roughness:1,
    metalness:0
  });
  for(let i=0;i<22;i++){
    const x=rand(-.55,.55),z=rand(-.32,.32);if(Math.abs(x)<.11&&z<.25)continue;
    const g=mesh(rb(rand(.035,.10),.002,.004,.001,1),mat,[x,.020,z],[0,rand(0,Math.PI),0]);g.castShadow=false;world.add(g);
  }
}
function buildSolarModel(scale=1){
  return buildRealisticSolarPanel(scale);
}
function buildWindTurbine(scale=1){
  const g=new THREE.Group();
  g.name='turbine';
  addCyl(g,.011*scale,.018*scale,.36*scale,0xf0f4eb,[0,.18*scale,0],12);
  const hub=mesh(new THREE.SphereGeometry(.028*scale,16,10),toon(0xe9f1e8),[0,.36*scale,0]);g.add(hub);
  const rotor=new THREE.Group();rotor.position.set(0,.36*scale,.028*scale);g.add(rotor);
  for(let i=0;i<3;i++){
    const blade=addBox(rotor,[.018*scale,.145*scale,.008*scale],0xf2f7f0,[0,.075*scale,0],[0,0,i*Math.PI*2/3],.004,true);
    blade.position.applyAxisAngle(new THREE.Vector3(0,0,1),i*Math.PI*2/3);
  }
  g.userData.rotor=rotor;turbines.push(rotor);return g;
}

function buildGreenPlanModel(scale=1){
  const g=new THREE.Group();
  const k=scale;

  // Mini master-plan board.
  addBox(g,[.19*k,.015*k,.145*k],0xe9efe4,[0,.010*k,0],[0,0,0],.010,true);
  addBox(g,[.025*k,.010*k,.125*k],0x77a96f,[0,.023*k,0],[0,0,0],.004);
  addBox(g,[.165*k,.010*k,.022*k],0x697a73,[0,.024*k,.012*k],[0,0,0],.004);

  // Three compact city blocks.
  for(const [x,z,c,h] of [
    [-.055,-.038,0xd9c89f,.055],
    [ .055,-.040,0xd6e2d5,.070],
    [ .050,.047,0xe3bf8a,.048]
  ]){
    addBox(g,[.045*k,h*k,.040*k],c,[x*k,(h*.5+.026)*k,z*k],[0,0,0],.007,true);
  }

  // Green open-space marker.
  const tree=buildTree(.038*k,true,false);
  tree.position.set(-.055*k,.025*k,.045*k);
  g.add(tree);

  return g;
}

function buildEnergyEfficiencyModel(scale=1){
  const g=new THREE.Group();
  const k=scale;

  // Efficient LED street light / energy-use symbol.
  addBox(g,[.105*k,.016*k,.075*k],0xdfe9df,[0,.008*k,0],[0,0,0],.010,true);
  addCyl(g,.007*k,.010*k,.165*k,0x536b63,[0,.092*k,0],10);

  const head=addBox(g,[.075*k,.018*k,.035*k],0x3e5953,[.018*k,.170*k,0],[0,0,-.08],.008,true);
  addBox(g,[.055*k,.006*k,.025*k],0xffe58a,[.020*k,.159*k,.001*k],[0,0,-.08],.003);

  // Small efficiency badge.
  const badge=mesh(
    new THREE.CircleGeometry(.027*k,20),
    new THREE.MeshBasicMaterial({color:0x7bc96f,side:THREE.DoubleSide}),
    [-.035*k,.050*k,.039*k],
    [0,0,0]
  );
  g.add(badge);
  return g;
}

function buildEcoBuildingModel(scale=1){
  const g=new THREE.Group();
  const k=scale;

  addBox(g,[.165*k,.018*k,.125*k],0xd6d1bd,[0,.010*k,0],[0,0,0],.010,true);
  addBox(g,[.145*k,.110*k,.105*k],0xe8efe4,[0,.073*k,0],[0,0,0],.014,true);

  // Green/insulated roof.
  const roof=mesh(
    new THREE.ConeGeometry(.112*k,.070*k,4),
    toon(0x5d8f63,{roughness:.92}),
    [0,.162*k,0],
    [0,Math.PI/4,0],
    [1.10,1,.82]
  );
  g.add(roof);

  addBox(g,[.036*k,.065*k,.009*k],0x76563f,[0,.064*k,.058*k],[0,0,0],.005);
  for(const x of [-.045,.045]){
    addBox(g,[.034*k,.031*k,.008*k],0x88c8dc,[x*k,.093*k,.058*k],[0,0,0],.004);
  }

  // Passive shading / awning.
  addBox(g,[.115*k,.010*k,.030*k],0xc6d7c5,[0,.128*k,.068*k],[-.12,0,0],.004);
  return g;
}

function buildCommunityGreenModel(scale=1){
  const g=new THREE.Group();
  const k=scale;

  addBox(g,[.175*k,.014*k,.120*k],0xdfead9,[0,.008*k,0],[0,0,0],.014,true);

  const people=[
    [-.045,0x4f88a8,'work'],
    [ .000,0x6c9d5c,'walk'],
    [ .045,0xd58a56,'work']
  ];
  for(const [x,shirt,pose] of people){
    const h=buildHuman(shirt,0x3d4d59,pose);
    h.scale.setScalar(.46*k);
    h.position.set(x*k,.016*k,0);
    g.add(h);
  }

  // Community green sign / small tree.
  const tree=buildTree(.028*k,true,true);
  tree.position.set(-.068*k,.014*k,-.035*k);
  g.add(tree);

  return g;
}

function buildPlacedPlan(pos){
  const g=buildGreenPlanModel(.76);
  g.position.copy(pos);
  g.userData={draggable:true,type:'plan'};
  return g;
}
function buildPlacedTree(pos){
  const g=buildTree(.075,true,Math.random()>.55);
  g.position.copy(pos);
  g.userData={...g.userData,draggable:true,type:'tree'};
  return g;
}
function buildPlacedEfficiency(pos){
  const g=buildEnergyEfficiencyModel(.82);
  g.position.copy(pos);
  g.userData={draggable:true,type:'efficiency'};
  return g;
}
function buildPlacedSolar(pos,roof=false){
  const g=buildSolarModel(roof ? .55 : .75);
  g.position.copy(pos);
  if(roof)g.position.y=roof.y;
  g.userData={draggable:true,type:'solar',roof:!!roof};
  return g;
}
function buildPlacedWaste(pos){
  const g=buildWasteStation(.82);
  g.position.copy(pos);
  g.userData={draggable:true,type:'waste'};
  return g;
}
function buildPlacedBuilding(pos){
  const g=buildEcoBuildingModel(.82);
  g.position.copy(pos);
  g.userData={draggable:true,type:'building'};
  return g;
}
function buildPlacedEV(pos){
  const g=buildCleanEV(.70);
  g.position.copy(pos);
  g.userData={...g.userData,draggable:true,type:'ev'};
  return g;
}
function buildPlacedCommunity(pos){
  const g=buildCommunityGreenModel(.80);
  g.position.copy(pos);
  g.userData={draggable:true,type:'community'};
  return g;
}

function activatePlacedObjectAnimation(obj){
  if(!obj)return;

  if(obj.userData?.type==='tree'){
    if(obj.userData.phase===undefined)obj.userData.phase=rand(0,6);
    if(!swayObjects.includes(obj))swayObjects.push(obj);
  }

  if(obj.userData?.type==='ev'){
    // Mobil listrik bergerak hanya di sepanjang jalan dan Y-nya dikunci.
    obj.userData.axis='x';
    obj.userData.routeMin=ROAD_X_MIN+.08;
    obj.userData.routeMax=ROAD_X_MAX-.08;
    obj.userData.offset=clamp(
      (obj.position.x-obj.userData.routeMin) /
      Math.max(.001,obj.userData.routeMax-obj.userData.routeMin),
      0,1
    );
    obj.userData.speed=obj.userData.speed||.020;
    obj.userData.baseY=.056;
    obj.position.y=obj.userData.baseY;
    if(!movingCars.includes(obj))movingCars.push(obj);
  }

  if(obj.userData?.type==='water'){
    obj.userData.animType='water-saver';
    obj.userData.phase=obj.userData.phase??rand(0,6);
    if(!animated.includes(obj))animated.push(obj);
  }

  if(obj.userData?.type==='waste'){
    obj.userData.animType='waste-station';
    obj.userData.phase=obj.userData.phase??rand(0,6);
    if(!animated.includes(obj))animated.push(obj);
  }

  if(obj.userData?.type==='solar'){
    obj.userData.animType='solar';
    obj.userData.phase=obj.userData.phase??rand(0,6);
    if(!animated.includes(obj))animated.push(obj);
  }

  if(['plan','efficiency','building','community'].includes(obj.userData?.type)){
    obj.userData.animType=obj.userData.type;
    obj.userData.phase=obj.userData.phase??rand(0,6);
    obj.userData.baseY=obj.position.y;
    if(!animated.includes(obj))animated.push(obj);
  }
}

function registerPlacedAnimations(){
  for(const obj of placedGroup.children){
    activatePlacedObjectAnimation(obj);
  }
}

function addNature(stage){
  const rng=seeded(410+stage*19);
  const polluted=isPollutedStage(stage),recovered=stage===4;
  const planted=[];
  const treeCount=recovered?(QUALITY==='lite'?23:34):stage===0?(QUALITY==='lite'?18:28):stage===1?(QUALITY==='lite'?11:17):(QUALITY==='lite'?6:9);
  for(let i=0;i<treeCount;i++){
    let x=0,z=0,tries=0;
    do{x=-.70+rng()*1.40;z=-.39+rng()*.70;tries++}while((!terrainSpotIsClear(x,z,stage,.035)||planted.some(p=>Math.hypot(x-p.x,z-p.z)<.105))&&tries<55);
    if(!terrainSpotIsClear(x,z,stage,.035)||planted.some(p=>Math.hypot(x-p.x,z-p.z)<.105))continue;
    const healthy=!polluted||rng()>.68;
    addTree(x,z,.048+rng()*.025,healthy,recovered&&rng()>.84);
    planted.push({x,z});
  }
  const grassCount=polluted?6:(QUALITY==='lite'?15:25);
  for(let i=0;i<grassCount;i++){const x=-.68+rng()*1.36,z=-.37+rng()*.68;if(!terrainSpotIsClear(x,z,stage,.01))continue;addGrass(x,z,.65+rng()*.45,polluted)}
  for(let i=0;i<(polluted?4:12);i++){const x=-.67+rng()*1.34,z=-.36+rng()*.66;if(!terrainSpotIsClear(x,z,stage,.02))continue;addBush(x,z,.020+rng()*.018,polluted)}
}

function addBridge(stage){
  const polluted=isPollutedStage(stage);
  const bridge=new THREE.Group();
  bridge.name='riverBridge';
  bridge.position.set(-.015,0,ROAD_Z);
  world.add(bridge);

  const stone=polluted?0x716357:stage===4?0xc7c7b4:0xb9b39e;

  // Deck aligned with the road, slightly emphasized over the river.
  addBox(bridge,[.245,.028,.183],stone,[0,.050,0],[0,0,0],.016,true);

  // Dark asphalt strip on bridge.
  addBox(
    bridge,
    [.225,.009,.145],
    stage===4?0x445854:0x2b3432,
    [0,.071,0],
    [0,0,0],
    .008
  );

  // Stone parapets.
  for(const z of [-.087,.087]){
    addBox(bridge,[.245,.035,.015],stone,[0,.089,z],[0,0,0],.005,true);
  }

  // Supports near river edges.
  for(const x of [-.105,.105]){
    addBox(bridge,[.025,.060,.135],stone,[x,.020,0],[0,0,0],.006);
  }

  // Small light-colored caps make it read as a bridge from oblique phone angles.
  for(const x of [-.105,0,.105]){
    for(const z of [-.087,.087]){
      addBox(bridge,[.018,.018,.020],0xdad6c3,[x,.114,z],[0,0,0],.004);
    }
  }
}

function buildBicycle(color=0x3c5f73){
  const g=new THREE.Group();

  for(const x of [-.045,.045]){
    const wheel=mesh(
      new THREE.TorusGeometry(.021,.004,8,18),
      toon(0x222b29),
      [x,.024,0],
      [Math.PI/2,0,0]
    );
    g.add(wheel);
  }

  // Frame.
  const frameMat=toon(color,{roughness:.75});
  const bar1=mesh(new THREE.CylinderGeometry(.003,.003,.072,8),frameMat,[0,.045,0],[0,0,Math.PI/2]);
  g.add(bar1);

  addCyl(g,.003,.003,.060,color,[-.010,.052,0],8,[0,0,-.65]);
  addCyl(g,.003,.003,.060,color,[ .020,.052,0],8,[0,0,.65]);

  // Rider.
  const rider=new THREE.Group();
  addCyl(rider,.011,.014,.060,0x365f88,[0,.098,0],10);
  rider.add(mesh(new THREE.SphereGeometry(.018,14,10),toon(0xe0b58a),[0,.142,0]));
  rider.position.x=.006;
  g.add(rider);

  return g;
}

function addCyclist(x,z,moving=true){
  const g=buildBicycle();
  g.name='vehicle';
  g.position.set(x,.057,z);
  world.add(g);

  if(moving){
    g.userData={
      routeMin:ROAD_X_MIN+.12,
      routeMax:ROAD_X_MAX-.12,
      offset:rand(0,1),
      speed:.018+rand(0,.006),
      baseY:.057
    };
    cyclists.push(g);
  }
  return g;
}

function addEcoDetails(stage){
  const polluted=isPollutedStage(stage);

  // Left forest sign.
  const sign=new THREE.Group();
  sign.position.set(-.64,0,-.02);
  world.add(sign);
  addCyl(sign,.008,.010,.105,polluted?0x625343:0x765238,[0,.055,0],8);
  addBox(sign,[.115,.065,.012],polluted?0x75604b:0x8a613e,[0,.118,0],[0,0,0],.006,true);

  // Right community / recycling corner in healthy future.
  if(stage===4){
    const bins=buildWasteStation(.70);
    bins.position.set(.56,.018,-.20);
    world.add(bins);

    addHuman(.47,-.16,.62,0x4f88a8,'work');
    addHuman(.63,-.16,.62,0x5f9a61,'work');
  }
}



function addStreetLamp(x,z,clean=false){
  const g=new THREE.Group();
  g.name='livingProp';
  g.position.set(x,0,z);
  world.add(g);

  addCyl(g,.005,.008,.145,clean?0x4d6f65:0x535e59,[0,.075,0],9);
  addBox(g,[.055,.010,.026],clean?0x456e62:0x48544f,[.015,.147,0],[0,0,-.10],.005,true);

  const glowMat=new THREE.MeshStandardMaterial({
    color:clean?0xffefb0:0xffd994,
    emissive:clean?0xffd85d:0xffb955,
    emissiveIntensity:clean?.85:.45,
    roughness:.55
  });
  const glow=mesh(new THREE.SphereGeometry(.010,12,8),glowMat,[.020,.139,.001]);
  glow.castShadow=false;
  g.add(glow);

  livingProps.push(g);
  return g;
}

function addBench(x,z,rot=0){
  const g=new THREE.Group();
  g.name='livingProp';
  g.position.set(x,0,z);
  g.rotation.y=rot;
  world.add(g);

  addBox(g,[.105,.012,.035],0x9a6a43,[0,.038,0],[0,0,0],.004);
  addBox(g,[.105,.012,.030],0x81583b,[0,.073,.014],[-.20,0,0],.004);
  for(const sx of [-.040,.040]){
    addBox(g,[.010,.045,.010],0x455b55,[sx,.020,0],[0,0,0],.003);
  }
  livingProps.push(g);
  return g;
}

function addFlowerPatch(x,z,scale=1,recovered=false){
  const g=new THREE.Group();
  g.name='flowerPatch';
  g.position.set(x,0,z);
  world.add(g);

  const colors=recovered
    ?[0xffd36d,0xf29cc2,0x8ed6e8,0xffffff]
    :[0xffcc62,0xf58cae,0xffffff];

  for(let i=0;i<7;i++){
    const a=i/7*Math.PI*2;
    const r=.018+(i%3)*.006;
    const px=Math.cos(a)*r;
    const pz=Math.sin(a)*r;
    addCyl(g,.0025*scale,.003*scale,.035*scale,0x4c8c4c,[px,.018*scale,pz],5);
    const head=mesh(
      new THREE.IcosahedronGeometry(.0065*scale,1),
      toon(colors[i%colors.length],{roughness:.8}),
      [px,.038*scale,pz]
    );
    head.userData.foliageBaseX=head.rotation.x;
    head.userData.foliageBaseZ=head.rotation.z;
    head.userData.foliagePhase=rand(0,Math.PI*2);
    foliageSwayObjects.push(head);
    g.add(head);
  }

  livingProps.push(g);
}

function addLivingDepthDetails(stage){
  const polluted=isPollutedStage(stage);
  const recovered=stage===4;

  // Street furniture creates foreground/midground vertical cues.
  if(!polluted){
    for(const x of [-.58,-.18,.22,.58]){
      addStreetLamp(x,ROAD_Z+.125,recovered);
    }
  }else{
    addStreetLamp(-.55,ROAD_Z+.125,false);
    addStreetLamp(.05,ROAD_Z+.125,false);
  }

  if(stage===0||recovered){
    addBench(-.57,-.015,.10);
    addBench(.42,.045,-.12);

    addFlowerPatch(-.62,.22,.90,recovered);
    addFlowerPatch(.17,.27,.78,recovered);
    addFlowerPatch(.55,-.03,.72,recovered);
  }

  // Smaller back-row trees = atmospheric perspective / depth.
  // Placement is fixed and outside the road corridor.
  if(!polluted){
    const backTrees=[
      [-.66,.315,.034],[-.49,.335,.031],[-.28,.325,.036],
      [.11,.337,.032],[.31,.326,.035],[.66,.315,.030]
    ];
    for(const [x,z,s] of backTrees){
      if(stage>=1&&stage<4&&x>.34)continue; // keep factory readable
      if(terrainSpotIsClear(x,z,stage,.012)){
        addRealisticTree(x,z,s);
      }
    }
  }
}


// ===========================================================================
// V14.3 — REALISTIC STAGES 2–5
// Internal stages:
// 0 = Alam Asri
// 1 = Aktivitas Manusia
// 2 = Emisi Tinggi
// 3 = Transformasi / drag solutions
// 4 = Kota Hijau
// ===========================================================================

function buildRealisticDeadTreeModel(scale=.075){
  const g=new THREE.Group();
  g.name='tree';

  const k=scale/.075;
  const bark=realisticMat(0x625246,'bark',{roughness:.99,bumpScale:.012});

  const trunk=mesh(
    new THREE.CylinderGeometry(.014*k,.025*k,.310*k,11,3),
    bark,
    [0,.155*k,0],
    [0,0,.035]
  );
  g.add(trunk);

  const branches=[
    [-.014,.235,.000,.100,-.66,.04],
    [ .011,.255,.000,.090,.62,-.08],
    [-.008,.292,.004,.075,-.35,.35],
    [ .006,.310,-.004,.065,.31,.52],
    [-.018,.205,-.004,.065,-.90,-.15]
  ];
  for(const [x,y,z,len,rz,rx] of branches){
    g.add(mesh(
      new THREE.CylinderGeometry(.0045*k,.008*k,len*k,8),
      bark,
      [x*k,y*k,z*k],
      [rx,0,rz]
    ));
  }
  return g;
}

function addRealisticDeadTree(x,z,s=.075){
  const g=buildRealisticDeadTreeModel(s);
  g.position.set(x,0,z);
  g.rotation.y=rand(0,Math.PI*2);
  world.add(g);
  return g;
}

function addRealisticNatureForStage(stage){
  if(stage===0){
    addRealisticNatureStageOne();
    return;
  }

  const rng=seeded(1510+stage*79);
  const polluted=isPollutedStage(stage);
  const recovered=stage===4;

  const treeCount=
    stage===1 ? (QUALITY==='lite'?9:14) :
    stage===2 ? (QUALITY==='lite'?5:8) :
    stage===3 ? (QUALITY==='lite'?5:8) :
    (QUALITY==='lite'?16:24);

  const planted=[];

  for(let i=0;i<treeCount;i++){
    let x=0,z=0,tries=0;
    do{
      x=-.70+rng()*1.40;
      z=-.39+rng()*.70;
      tries++;
    }while(
      (!terrainSpotIsClear(x,z,stage,.037) ||
       planted.some(p=>Math.hypot(x-p.x,z-p.z)<.110)) &&
      tries<60
    );

    if(!terrainSpotIsClear(x,z,stage,.037))continue;
    if(planted.some(p=>Math.hypot(x-p.x,z-p.z)<.110))continue;

    // In damaged stages a fraction of vegetation becomes bare/dead.
    if(polluted && rng()<.37){
      addRealisticDeadTree(x,z,.048+rng()*.022);
    }else{
      addRealisticTree(x,z,.043+rng()*.026);
    }
    planted.push({x,z});
  }

  const grassCount=
    polluted ? (QUALITY==='lite'?5:8) :
    recovered ? (QUALITY==='lite'?22:34) :
    (QUALITY==='lite'?12:19);

  for(let i=0;i<grassCount;i++){
    const x=-.68+rng()*1.36;
    const z=-.37+rng()*.68;
    if(!terrainSpotIsClear(x,z,stage,.012))continue;

    if(polluted){
      // Dry grass: still real geometry, muted material.
      const g=new THREE.Group();
      g.name='grass';
      g.position.set(x,0,z);
      world.add(g);
      const dryMat=realisticMat(0x9b8155,'soil',{roughness:.98,bumpScale:.003});
      for(let b=0;b<7;b++){
        const angle=b/7*Math.PI*2;
        g.add(mesh(
          new THREE.ConeGeometry(.004,.045+rand(0,.018),5),
          dryMat,
          [Math.cos(angle)*.008,.025,Math.sin(angle)*.008],
          [rand(-.12,.12),0,angle+rand(-.20,.20)]
        ));
      }
    }else{
      addRealisticGrassTuft(x,z,.50+rng()*.52);
    }
  }

  const bushCount=polluted?4:recovered?14:8;
  for(let i=0;i<bushCount;i++){
    const x=-.67+rng()*1.34;
    const z=-.36+rng()*.66;
    if(!terrainSpotIsClear(x,z,stage,.020))continue;
    addRealisticBush(x,z,.019+rng()*.017);
  }
}

function addRealisticHouseForStage(x,z,s,stage){
  const house=addRealisticHouse(x,z,s);

  if(stage===2||stage===3){
    // Small soot/dust details on industrial stages.
    const stainMat=new THREE.MeshStandardMaterial({
      color:0x554a43,
      transparent:true,
      opacity:.17,
      roughness:1,
      depthWrite:false
    });

    const stain=mesh(
      rb(.070*(s/.13),.002,.036*(s/.13),.002,2),
      stainMat,
      [0,.025*(s/.13),.101*(s/.13)]
    );
    stain.castShadow=false;
    house.add(stain);
  }

  if(stage===4){
    // Final stage: rooftop photovoltaic panel as part of green-city visual.
    const solar=buildRealisticSolarPanel(.44*(s/.13));
    solar.position.set(.018*(s/.13),.285*(s/.13),-.005);
    solar.rotation.z=-.05;
    house.add(solar);
  }

  return house;
}

function addRealisticRoadForStage(stage){
  const polluted=isPollutedStage(stage);
  const recovered=stage===4;

  const asphaltColor=
    polluted ? 0x3e403d :
    recovered ? 0x4c5754 :
    0x505552;

  const road=mesh(
    rb(ROAD_VISUAL_LENGTH,.026,.200,.018,5),
    realisticMat(asphaltColor,'asphalt',{
      roughness:.97,
      bumpScale:polluted?.004:.0028
    }),
    [0,.046,ROAD_Z]
  );
  road.name='roadDeck';
  road.receiveShadow=true;
  world.add(road);

  const curb=realisticMat(
    polluted?0x89867d:recovered?0xc4c9c0:0xb7b6ae,
    'stone',
    {roughness:.97}
  );

  for(const z of [
    ROAD_Z-ROAD_HALF_DEPTH-.032,
    ROAD_Z+ROAD_HALF_DEPTH+.032
  ]){
    world.add(mesh(
      rb(ROAD_VISUAL_LENGTH,.020,.030,.004,3),
      curb,
      [0,.039,z]
    ));
  }

  const lineMat=new THREE.MeshStandardMaterial({
    color:polluted?0xdbd5c5:0xeeeade,
    roughness:.87
  });

  for(const z of [
    ROAD_Z-ROAD_HALF_DEPTH+.015,
    ROAD_Z+ROAD_HALF_DEPTH-.015
  ]){
    const edge=mesh(
      rb(ROAD_EDGE_LENGTH,.005,.008,.0015,2),
      lineMat,
      [0,.058,z]
    );
    edge.castShadow=false;
    world.add(edge);
  }

  const centerMat=new THREE.MeshStandardMaterial({
    color:polluted?0xc3a350:0xd8ba51,
    roughness:.84
  });

  for(let i=0;i<ROAD_DASH_COUNT;i++){
    const dash=mesh(
      rb(.072,.005,.009,.0015,2),
      centerMat,
      [ROAD_DASH_START+i*ROAD_DASH_SPACING,.059,ROAD_Z]
    );
    dash.castShadow=false;
    world.add(dash);
  }

  // Final green city gets a clearly visible pedestrian crossing.
  if(recovered){
    for(let i=0;i<5;i++){
      const stripe=mesh(
        rb(.018,.005,.115,.0015,2),
        lineMat,
        [-.50+i*.030,.060,ROAD_Z]
      );
      stripe.castShadow=false;
      world.add(stripe);
    }
  }
}

function addRealisticBridgeForStage(stage){
  const polluted=isPollutedStage(stage);
  const recovered=stage===4;

  const g=new THREE.Group();
  g.name='riverBridge';
  g.position.set(-.015,0,ROAD_Z);
  world.add(g);

  const concrete=realisticMat(
    polluted?0x80776c:recovered?0xbfc5ba:0xa9a79e,
    'stone',
    {roughness:.98,bumpScale:.006}
  );
  const asphalt=realisticMat(
    polluted?0x41413e:0x515552,
    'asphalt',
    {roughness:.97,bumpScale:.0025}
  );
  const railMetal=new THREE.MeshStandardMaterial({
    color:recovered?0x687a72:0x59605d,
    roughness:.36,
    metalness:.66
  });

  g.add(mesh(rb(.245,.030,.183,.008,4),concrete,[0,.050,0]));
  g.add(mesh(rb(.225,.009,.145,.006,3),asphalt,[0,.071,0]));

  for(const z of [-.087,.087]){
    for(const x of [-.105,-.052,0,.052,.105]){
      g.add(mesh(
        rb(.010,.062,.010,.002,2),
        concrete,
        [x,.100,z]
      ));
    }

    // Horizontal rail reads better from oblique mobile angles.
    g.add(mesh(
      rb(.232,.010,.010,.002,2),
      railMetal,
      [0,.129,z]
    ));
  }

  for(const x of [-.105,.105]){
    g.add(mesh(
      rb(.025,.065,.135,.005,3),
      concrete,
      [x,.020,0]
    ));
  }
}

function buildRealisticSolarPanel(scale=1){
  const g=new THREE.Group();

  const frame=new THREE.MeshStandardMaterial({
    color:0x596462,
    roughness:.32,
    metalness:.78
  });
  const cell=new THREE.MeshPhysicalMaterial({
    color:0x184f74,
    roughness:.16,
    metalness:.28,
    clearcoat:1,
    clearcoatRoughness:.08
  });
  const grid=new THREE.MeshStandardMaterial({
    color:0xc6dce4,
    roughness:.34,
    metalness:.45
  });

  const panel=mesh(
    rb(.165*scale,.008*scale,.101*scale,.004,3),
    cell,
    [0,.080*scale,0],
    [-.42,0,0]
  );
  g.add(panel);

  // aluminium frame
  for(const x of [-.083,.083]){
    g.add(mesh(
      rb(.006*scale,.010*scale,.106*scale,.001,1),
      frame,
      [x*scale,.081*scale,0],
      [-.42,0,0]
    ));
  }

  for(const z of [-.051,.051]){
    g.add(mesh(
      rb(.170*scale,.010*scale,.005*scale,.001,1),
      frame,
      [0,.081*scale,z*scale],
      [-.42,0,0]
    ));
  }

  // cell division
  for(let i=-1;i<=1;i++){
    g.add(mesh(
      rb(.003*scale,.010*scale,.096*scale,.001,1),
      grid,
      [i*.052*scale,.086*scale,0],
      [-.42,0,0]
    ));
  }

  for(const x of [-.055,.055]){
    g.add(mesh(
      rb(.011*scale,.070*scale,.011*scale,.003,2),
      frame,
      [x*scale,.035*scale,.020*scale]
    ));
  }

  return g;
}

function buildRealisticFactory(stage=1){
  const polluted=isPollutedStage(stage);
  const g=new THREE.Group();
  g.name='factory';
  g.position.set(.52,0,.20);
  world.add(g);

  const concrete=realisticMat(
    polluted?0x77716b:0x9a8a78,
    'stone',
    {roughness:.96,bumpScale:.006}
  );
  const sideConcrete=realisticMat(
    polluted?0x68635e:0x877a6e,
    'stone',
    {roughness:.96}
  );
  const roofMat=new THREE.MeshStandardMaterial({
    color:polluted?0x555753:0x6f7773,
    roughness:.55,
    metalness:.52
  });
  const steel=new THREE.MeshStandardMaterial({
    color:0x78827e,
    roughness:.34,
    metalness:.76
  });
  const tankMat=new THREE.MeshStandardMaterial({
    color:polluted?0x959792:0xbcc2b7,
    roughness:.38,
    metalness:.54
  });

  g.add(mesh(
    rb(.28,.13,.18,.010,4),
    concrete,
    [0,.075,0]
  ));
  g.add(mesh(
    rb(.19,.08,.12,.010,4),
    sideConcrete,
    [-.18,.045,-.02]
  ));

  // Three industrial saw-tooth roof sections.
  for(let i=-1;i<=1;i++){
    const roof=mesh(
      createGableRoofGeometry(.083,.185,.055),
      roofMat,
      [i*.077,.142,0]
    );
    roof.rotation.z=.02;
    g.add(roof);
  }

  // Door + loading bay.
  g.add(mesh(
    rb(.070,.075,.009,.004,3),
    steel,
    [-.060,.050,-.095]
  ));
  for(let y=0;y<5;y++){
    g.add(mesh(
      rb(.062,.003,.010,.001,1),
      new THREE.MeshStandardMaterial({
        color:0xadb4af,
        roughness:.36,
        metalness:.62
      }),
      [-.060,.025+y*.013,-.101]
    ));
  }

  // Chimneys.
  for(const x of [-.07,.07]){
    const stack=mesh(
      new THREE.CylinderGeometry(.022,.029,.235,18),
      realisticMat(polluted?0x605b56:0x7c7066,'stone',{
        roughness:.90,
        bumpScale:.004
      }),
      [x,.260,-.03]
    );
    g.add(stack);

    g.add(mesh(
      new THREE.CylinderGeometry(.030,.030,.014,18),
      steel,
      [x,.383,-.03]
    ));

    addSmokeEmitter(
      g,
      new THREE.Vector3(x,.398,-.03),
      polluted?1.35:.48
    );
  }

  // Industrial tanks.
  for(const x of [-.20,.20]){
    g.add(mesh(
      new THREE.CylinderGeometry(.044,.044,.105,20),
      tankMat,
      [x,.058,.11]
    ));

    g.add(mesh(
      new THREE.SphereGeometry(.044,18,10,0,Math.PI*2,0,Math.PI/2),
      tankMat,
      [x,.111,.11]
    ));
  }

  // Pipe network.
  g.add(mesh(
    new THREE.CylinderGeometry(.008,.008,.275,12),
    steel,
    [-.20,.135,.11],
    [0,0,Math.PI/2]
  ));

  shadowBlob(world,.52,.20,.25,.14,.13);
  return g;
}

function addRealisticWasteChaos(stage){
  // Broken / wasteful pipe.
  const pipe=new THREE.Group();
  pipe.name='livingProp';
  pipe.position.set(-.57,0,-.05);
  world.add(pipe);

  const steel=new THREE.MeshStandardMaterial({
    color:0x8e9693,
    roughness:.38,
    metalness:.72
  });

  pipe.add(mesh(
    new THREE.CylinderGeometry(.011,.011,.12,14),
    steel,
    [0,.06,0]
  ));
  pipe.add(mesh(
    new THREE.CylinderGeometry(.009,.009,.08,14),
    steel,
    [.035,.11,0],
    [0,0,Math.PI/2]
  ));

  const spillMat=new THREE.MeshPhysicalMaterial({
    color:0x55aabd,
    transparent:true,
    opacity:.62,
    roughness:.10,
    transmission:.12,
    clearcoat:.85,
    clearcoatRoughness:.08
  });

  const spill=mesh(
    new THREE.SphereGeometry(.055,20,10),
    spillMat,
    [-.56,.018,.015],
    [0,0,0],
    [1.8,.20,1.1]
  );
  spill.castShadow=false;
  world.add(spill);

  const bagMats=[
    new THREE.MeshStandardMaterial({color:0xb9a44e,roughness:.86}),
    new THREE.MeshStandardMaterial({color:0x9a554c,roughness:.86}),
    new THREE.MeshStandardMaterial({color:0x506f7a,roughness:.84}),
    new THREE.MeshStandardMaterial({color:0x667a5b,roughness:.88})
  ];

  const positions=[
    [.61,.28],[.54,.33],[.68,.22],[.44,.30]
  ];

  positions.forEach(([x,z],i)=>{
    world.add(mesh(
      new THREE.DodecahedronGeometry(.024,1),
      bagMats[i],
      [x,.023,z],
      [rand(-.3,.3),rand(0,3),rand(-.2,.2)],
      [1,.72,.88]
    ));
  });

  // Stage 3 / 4 internal: more visible litter.
  if(stage>=2){
    for(const [x,z] of [[.58,.15],[.41,.26],[-.46,.29]]){
      world.add(mesh(
        rb(.030,.006,.022,.003,2),
        new THREE.MeshStandardMaterial({
          color:0x766a5d,
          roughness:.95
        }),
        [x,.020,z],
        [0,rand(0,Math.PI),0]
      ));
    }
  }
}

function addRealisticIndustrialPedestrians(stage){
  const pedestrianZ=ROAD_Z+ROAD_HALF_DEPTH+.052;

  if(stage===1){
    addRealisticHuman(-.45,pedestrianZ,.64,0x677784,'walk');
    addRealisticHuman(.10,pedestrianZ+.006,.62,0x7b6654,'walk');
  }else{
    addRealisticHuman(-.48,pedestrianZ,.63,0x6e6258,'walk');
    addRealisticHuman(.04,pedestrianZ+.006,.61,0x5f6770,'walk');
  }

  // Factory worker stays inside industrial area, not on the asphalt.
  addRealisticHuman(.31,.055,.60,0x626c71,'work');
}

function addRealisticTrafficForStage(stage){
  if(stage===1){
    addRealisticCar(-.34,ROAD_Z-.040,0x8b7566,true);
    addRealisticCar(.02,ROAD_Z+.040,0x6b7d87,true);
    addRealisticCar(.34,ROAD_Z-.040,0x8e8270,true);
    addRealisticMotorbike(.48,ROAD_Z+.040,0x59666c,true);
  }else if(stage===2||stage===3){
    // Slightly denser traffic to support the emissions narrative.
    addRealisticCar(-.42,ROAD_Z-.040,0x6f6965,true);
    addRealisticCar(-.12,ROAD_Z+.040,0x817463,true);
    addRealisticCar(.18,ROAD_Z-.040,0x65747a,true);
    addRealisticCar(.44,ROAD_Z+.040,0x75685e,true);
    addRealisticMotorbike(.30,ROAD_Z-.040,0x555d61,true);
  }
}

function buildRealisticBicycle(){
  const g=new THREE.Group();
  g.name='vehicle';

  const tire=new THREE.MeshStandardMaterial({
    color:0x141615,
    roughness:.98
  });
  const frame=new THREE.MeshStandardMaterial({
    color:0x577a72,
    roughness:.32,
    metalness:.62
  });
  const metal=new THREE.MeshStandardMaterial({
    color:0xa0a6a3,
    roughness:.27,
    metalness:.80
  });

  const wheelGroups=[];
  for(const x of [-.046,.046]){
    const wg=new THREE.Group();
    wg.position.set(x,.024,0);

    wg.add(mesh(
      new THREE.TorusGeometry(.021,.0036,10,28),
      tire,
      [0,0,0],
      [Math.PI/2,0,0]
    ));

    wg.add(mesh(
      new THREE.TorusGeometry(.014,.0012,8,24),
      metal,
      [0,0,0],
      [Math.PI/2,0,0]
    ));

    for(let i=0;i<10;i++){
      const spoke=mesh(
        rb(.014,.001,.001,.0003,1),
        metal,
        [0,0,0]
      );
      spoke.rotation.z=i/10*Math.PI*2;
      wg.add(spoke);
    }

    g.add(wg);
    wheelGroups.push(wg);
  }

  // frame triangle
  const addBar=(len,x,y,rz)=>{
    g.add(mesh(
      new THREE.CylinderGeometry(.0022,.0022,len,8),
      frame,
      [x,y,0],
      [0,0,rz]
    ));
  };
  addBar(.075,0,.048,Math.PI/2);
  addBar(.066,-.010,.053,-.68);
  addBar(.065,.018,.053,.68);
  addBar(.047,.022,.071,.20);

  // handlebar
  g.add(mesh(
    new THREE.CylinderGeometry(.0018,.0018,.041,8),
    metal,
    [-.038,.090,0],
    [Math.PI/2,0,0]
  ));

  // seat
  g.add(mesh(
    rb(.026,.006,.018,.004,3),
    new THREE.MeshStandardMaterial({color:0x292b2a,roughness:.92}),
    [.014,.086,0]
  ));

  // rider
  const rider=buildRealisticHuman(0x5b8276,'walk');
  rider.scale.setScalar(.55);
  rider.position.set(.005,.028,0);
  rider.rotation.z=-.10;
  g.add(rider);

  return g;
}

function addRealisticCyclist(x,z,moving=true){
  const g=buildRealisticBicycle();
  g.position.set(x,.057,z);

  // Bicycle front is local -X; route travels +X.
  g.rotation.y=Math.PI;
  world.add(g);

  if(moving){
    g.userData.routeMin=ROAD_X_MIN+.12;
    g.userData.routeMax=ROAD_X_MAX-.12;
    g.userData.offset=rand(0,1);
    g.userData.speed=.017+rand(0,.005);
    g.userData.baseY=.057;
    cyclists.push(g);
  }
  return g;
}

function buildRealisticWindTurbine(scale=1){
  const g=new THREE.Group();
  g.name='turbine';

  const towerMat=new THREE.MeshStandardMaterial({
    color:0xe7ebe7,
    roughness:.48,
    metalness:.28
  });
  const bladeMat=new THREE.MeshStandardMaterial({
    color:0xf1f3ef,
    roughness:.42,
    metalness:.18
  });
  const hubMat=new THREE.MeshStandardMaterial({
    color:0xdde2df,
    roughness:.38,
    metalness:.32
  });

  g.add(mesh(
    new THREE.CylinderGeometry(.008*scale,.018*scale,.36*scale,16),
    towerMat,
    [0,.18*scale,0]
  ));

  g.add(mesh(
    new THREE.SphereGeometry(.025*scale,18,14),
    hubMat,
    [0,.36*scale,0]
  ));

  const rotor=new THREE.Group();
  rotor.position.set(0,.36*scale,.028*scale);
  g.add(rotor);

  for(let i=0;i<3;i++){
    const blade=mesh(
      new THREE.ConeGeometry(.013*scale,.148*scale,5),
      bladeMat,
      [0,.073*scale,0],
      [0,0,i*Math.PI*2/3]
    );
    blade.position.applyAxisAngle(
      new THREE.Vector3(0,0,1),
      i*Math.PI*2/3
    );
    rotor.add(blade);
  }

  g.userData.rotor=rotor;
  turbines.push(rotor);
  return g;
}

function addRealisticFinalEcoDetails(){
  // Waste/recycling corner, using existing interaction asset but with PBR bins.
  const station=buildWasteStation(.72);
  station.position.set(.56,.018,-.20);
  world.add(station);

  addRealisticHuman(.46,-.16,.61,0x5d8075,'work');
  addRealisticHuman(.63,-.16,.61,0x6d8667,'work');

  const pedestrianZ=ROAD_Z+ROAD_HALF_DEPTH+.052;
  addRealisticHuman(-.42,pedestrianZ,.64,0x5b7d72,'walk');
  addRealisticHuman(.18,pedestrianZ+.006,.63,0x627f8b,'walk');
}

function buildStage(stage){
  const preserveSolutions =
    (stage===3 || stage===4) &&
    placedGroup &&
    placedGroup.children.length>0;

  clearWorld(preserveSolutions);
  currentStage=stage;

  // Environment foundation: now PBR in all five stages.
  makeTerrain(stage);
  addStageBackdrop(stage);
  addMountainBackdrop(stage);
  addRiver(stage);

  // Houses keep the same coordinates / footprint in every stage.
  for(const h of HOUSE_LAYOUT){
    addRealisticHouseForStage(h.x,h.z,h.s,stage);
  }

  addRealisticNatureForStage(stage);

  // Realistic rocks remain deterministic per stage.
  const rockRng=seeded(940+stage);
  for(let i=0;i<16;i++){
    const x=-.68+rockRng()*1.36;
    const z=-.37+rockRng()*.68;
    if(terrainSpotIsClear(x,z,stage,.01)){
      addRock(
        x,z,
        .007+rockRng()*.010,
        isPollutedStage(stage)
      );
    }
  }

  addLivingDepthDetails(stage);

  // -----------------------------------------------------------------------
  // TAHAP 1 — ALAM ASRI
  // -----------------------------------------------------------------------
  if(stage===0){
    addRealisticVillageRoad();
    addRealisticBridge();

    addRealisticCar(-.28,ROAD_Z-.040,0x637d89,true);
    addRealisticMotorbike(.24,ROAD_Z+.040,0x45565d,true);

    const pedestrianZ=ROAD_Z+ROAD_HALF_DEPTH+.052;
    addRealisticHuman(-.53,pedestrianZ,.66,0x546e7d,'walk');
    addRealisticHuman(-.10,pedestrianZ+.008,.64,0x8b7058,'walk');
    addRealisticHuman(.38,pedestrianZ-.006,.63,0x60795f,'walk');

    addBirdFlock(QUALITY==='lite'?3:6);
    addEcoDetails(stage);
  }

  // -----------------------------------------------------------------------
  // TAHAP 2 — AKTIVITAS MANUSIA
  // -----------------------------------------------------------------------
  if(stage===1){
    addRealisticRoadForStage(stage);
    addRealisticBridgeForStage(stage);
    buildRealisticFactory(stage);

    addRealisticTrafficForStage(stage);
    addRealisticWasteChaos(stage);
    addRealisticIndustrialPedestrians(stage);

    addEcoDetails(stage);
  }

  // -----------------------------------------------------------------------
  // TAHAP 3 — EMISI TINGGI
  // -----------------------------------------------------------------------
  if(stage===2){
    addRealisticRoadForStage(stage);
    addRealisticBridgeForStage(stage);
    buildRealisticFactory(stage);

    addRealisticTrafficForStage(stage);
    addRealisticWasteChaos(stage);
    addRealisticIndustrialPedestrians(stage);

    addCracks();
    addRealisticDeadTree(-.57,.13,.075);
    addRealisticDeadTree(.02,.31,.068);
    addRealisticDeadTree(-.25,-.30,.068);
  }

  // -----------------------------------------------------------------------
  // TAHAP 4 — TRANSFORMASI / USER MENEMPATKAN 8 SOLUSI
  // -----------------------------------------------------------------------
  if(stage===3){
    addRealisticRoadForStage(stage);
    addRealisticBridgeForStage(stage);
    buildRealisticFactory(stage);

    addRealisticTrafficForStage(stage);
    addRealisticWasteChaos(stage);
    addRealisticIndustrialPedestrians(stage);

    addCracks();
    addRealisticDeadTree(-.57,.13,.075);
    addRealisticDeadTree(.02,.31,.068);
    addRealisticDeadTree(-.25,-.30,.068);

    // Existing drag/drop solution group stays untouched.
    if(placedGroup.parent!==world)world.add(placedGroup);
    registerPlacedAnimations();
  }

  // -----------------------------------------------------------------------
  // TAHAP 5 — KOTA HIJAU / FINAL
  // -----------------------------------------------------------------------
  if(stage===4){
    addRealisticRoadForStage(stage);
    addRealisticBridgeForStage(stage);

    // Clean / EV-like traffic.
    addRealisticCar(-.30,ROAD_Z-.040,0x5f91a7,true);
    addRealisticCar(.24,ROAD_Z+.040,0x6f9c78,true);
    addRealisticMotorbike(.49,ROAD_Z-.040,0x557b82,true);
    addRealisticCyclist(-.02,ROAD_Z+.008,true);

    // Preserve every successfully placed solution from Tahap 4.
    if(placedGroup.parent!==world)world.add(placedGroup);
    registerPlacedAnimations();

    const t1=buildRealisticWindTurbine(.56);
    t1.position.set(.62,0,.28);
    world.add(t1);

    const t2=buildRealisticWindTurbine(.48);
    t2.position.set(.72,0,.10);
    world.add(t2);

    const t3=buildRealisticWindTurbine(.40);
    t3.position.set(.51,0,.35);
    world.add(t3);

    addRealisticFinalEcoDetails();
    addBirdFlock(QUALITY==='lite'?4:8);

    addRealisticBush(-.62,.19,.042);
    addRealisticBush(.16,.25,.038);
  }
}
function previewBackgroundColor(stage){
  if(isPollutedStage(stage))return 0x393a38;
  if(stage===4)return 0xbdebf4;
  return 0xd7ebf1;
}
function updateStageAtmosphere(stage){
  const polluted=isPollutedStage(stage);

  /*
    FIX TAHAP EMISI
    ----------------
    Fog THREE.js tidak cocok dipakai langsung pada Live AR karena depth dihitung
    dari kamera virtual. Pada HP tertentu hasilnya bisa membuat rumah, jalan,
    factory, manusia, dan kendaraan hampir hilang sementara mountain mesh tetap
    terlihat sebagai bidang gelap besar.

    Live AR tetap memakai kamera nyata tanpa fog. Polusi divisualkan lewat:
    terrain kering, dead tree, cracks, factory, smoke, sampah, dan warna material.
  */
  if(scene)scene.fog=null;

  // Preview desktop boleh memakai fog tipis sebagai atmosfer.
  if(previewScene){
    previewScene.background=new THREE.Color(previewBackgroundColor(stage));
    previewScene.fog=polluted?new THREE.FogExp2(0x575049,.055):null;
  }
}

function addLighting(target){
  // Lower ambient + stronger directional key gives much clearer volume/depth.
  target.add(new THREE.HemisphereLight(0xf2f7f5,0x71806f,1.55));

  const sun=new THREE.DirectionalLight(0xffeccb,3.70);
  sun.position.set(-1.65,2.85,1.75);
  sun.castShadow=ENABLE_DYNAMIC_SHADOWS;

  const shadowSize=QUALITY==='lite'
    ? (PLATFORM_ANDROID?512:1024)
    : (PLATFORM_ANDROID?(DEVICE_MEMORY_GB>=6?1536:1024):2048);
  sun.shadow.mapSize.set(shadowSize,shadowSize);
  sun.shadow.camera.left=-2.1;
  sun.shadow.camera.right=2.1;
  sun.shadow.camera.top=2.1;
  sun.shadow.camera.bottom=-2.1;
  sun.shadow.bias=-.00022;
  sun.shadow.normalBias=.012;
  target.add(sun);

  const fill=new THREE.DirectionalLight(0xc6e4ed,.72);
  fill.position.set(1.7,1.35,-1.45);
  target.add(fill);

  const warmBounce=new THREE.DirectionalLight(0xffd6aa,.40);
  warmBounce.position.set(.25,.55,1.85);
  target.add(warmBounce);

  const rim=new THREE.DirectionalLight(0xe6fff2,.28);
  rim.position.set(-1.1,.85,-1.8);
  target.add(rim);
}
function configureRenderer(r){
  r.outputColorSpace=THREE.SRGBColorSpace;
  r.toneMapping=THREE.ACESFilmicToneMapping;
  r.toneMappingExposure=1.38;

  r.shadowMap.enabled=ENABLE_DYNAMIC_SHADOWS;
  r.shadowMap.type=QUALITY==='lite'?THREE.PCFShadowMap:THREE.PCFSoftShadowMap;
  // Keep the same soft shadow resolution, but avoid rebuilding the complete
  // shadow atlas on every Android frame. Moving shadows still refresh often
  // enough to read naturally on a small AR diorama.
  r.shadowMap.autoUpdate=!ANDROID_OPTIMIZED_MODE;
  r.shadowMap.needsUpdate=true;

  r.setPixelRatio(
    Math.min(devicePixelRatio,AR_MAX_PIXEL_RATIO)
  );

  r.setClearColor(0x000000,0);

  if(r.domElement){
    Object.assign(r.domElement.style,{
      position:'absolute',
      inset:'0',
      width:'100%',
      height:'100%',
      zIndex:'2',
      background:'transparent',
      pointerEvents:'none'
    });
  }
}

function refreshAndroidShadows(r,now=performance.now()){
  if(!ANDROID_OPTIMIZED_MODE||!ENABLE_DYNAMIC_SHADOWS||!r?.shadowMap)return;
  if(now-lastAndroidShadowRefreshAt<ANDROID_SHADOW_INTERVAL_MS)return;
  lastAndroidShadowRefreshAt=now;
  r.shadowMap.needsUpdate=true;
}

function buildAprilTagWorkerSource(){
  return `
const BASES=[
  ${JSON.stringify(APRILTAG_CDN_BASE)},
  'https://arenaxr.github.io/apriltag-js-standalone/'
];

let BASE='';
let loaderError=null;

for(const candidate of BASES){
  try{
    importScripts(candidate+'apriltag_wasm.js');
    if(typeof AprilTagWasm==='function'){
      BASE=candidate;
      break;
    }
  }catch(error){
    loaderError=error;
  }
}

if(!BASE || typeof AprilTagWasm!=='function'){
  throw loaderError || new Error('apriltag_wasm.js gagal dimuat');
}

let Module=null;
let api=null;

function configureApi(){
  const init=Module.cwrap('atagjs_init','number',[]);
  const destroy=Module.cwrap('atagjs_destroy','number',[]);
  const setOpts=Module.cwrap('atagjs_set_detector_options','number',
    ['number','number','number','number','number','number','number']);
  const setPose=Module.cwrap('atagjs_set_pose_info','number',
    ['number','number','number','number']);
  const setImg=Module.cwrap('atagjs_set_img_buffer','number',
    ['number','number','number']);
  const setTag=Module.cwrap('atagjs_set_tag_size',null,['number','number']);
  const detect=Module.cwrap('atagjs_detect','number',[]);

  init();

  // Stability first: more edge refinement and lower decimation than default.
  setOpts(1.0,0.0,1,1,8,1,1);

  api={destroy,setPose,setImg,setTag,detect};
}

function runDetect(gray,width,height){
  const ptr=api.setImg(width,height,width);
  Module.HEAPU8.set(gray,ptr);
  const jsonPtr=api.detect();
  const len=Module.getValue(jsonPtr,'i32');
  if(!len)return [];
  const strPtr=Module.getValue(jsonPtr+4,'i32');
  const view=new Uint8Array(Module.HEAP8.buffer,strPtr,len);
  let s='';
  for(let i=0;i<len;i++)s+=String.fromCharCode(view[i]);
  return JSON.parse(s);
}

(async()=>{
  try{
    Module=await AprilTagWasm({
      locateFile:(path)=>BASE+path
    });
    configureApi();

    [0].forEach(id=>api.setTag(id,${TRACK_TAG_SIZE_M}));
    postMessage({type:'ready'});
  }catch(error){
    postMessage({type:'error',message:String(error?.stack||error)});
  }
})();

onmessage=(event)=>{
  const m=event.data||{};
  try{
    if(m.type==='camera'){
      api?.setPose(m.fx,m.fy,m.cx,m.cy);
      return;
    }
    if(m.type==='detect'){
      if(!api)return;
      const gray=new Uint8Array(m.buffer);
      const detections=runDetect(gray,m.width,m.height);
      postMessage({type:'detections',seq:m.seq,detections});
      return;
    }
    if(m.type==='stop'){
      try{api?.destroy?.()}catch(_){}
      close();
    }
  }catch(error){
    postMessage({type:'detect-error',seq:m.seq,message:String(error?.stack||error)});
  }
};
`;
}

function initAprilTagWorker(){
  if(detectorReady && apriltagWorker)return Promise.resolve(true);
  if(detectorReadyPromise)return detectorReadyPromise;

  detectorInitError=null;
  detectorReady=false;

  detectorReadyPromise=new Promise((resolve,reject)=>{
    let settled=false;

    const blob=new Blob([buildAprilTagWorkerSource()],{type:'application/javascript'});
    const url=URL.createObjectURL(blob);

    try{
      apriltagWorker=new Worker(url);
    }finally{
      URL.revokeObjectURL(url);
    }

    const fail=(error)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timeout);

      detectorReady=false;
      detectorBusy=false;
      detectorInitError=error instanceof Error ? error : new Error(String(error));

      try{apriltagWorker?.terminate();}catch(_){}
      apriltagWorker=null;
      detectorReadyPromise=null;

      reject(detectorInitError);
    };

    const timeout=setTimeout(()=>{
      fail(new Error('AprilTag WASM timeout'));
    },22000);

    apriltagWorker.onmessage=event=>{
      const m=event.data||{};

      if(m.type==='ready'){
        if(settled)return;
        settled=true;
        clearTimeout(timeout);

        detectorReady=true;
        detectorBusy=false;
        detectorInitError=null;

        resolve(true);
        return;
      }

      if(m.type==='detections'){
        detectorBusy=false;
        processAprilTagDetections(m.detections||[]);
        return;
      }

      if(m.type==='detect-error'){
        detectorBusy=false;
        console.warn('AprilTag detect error:',m.message);
        return;
      }

      if(m.type==='error'){
        fail(new Error(m.message||'AprilTag worker error'));
      }
    };

    apriltagWorker.onerror=error=>{
      fail(error instanceof Error ? error : new Error(error?.message||'Worker error'));
    };
  });

  return detectorReadyPromise;
}

function cleanupCamera(){
  androidCompositeActive=false;

  if(androidCameraTexture){
    if(scene?.background===androidCameraTexture)scene.background=null;
    try{androidCameraTexture.dispose()}catch(_){}
    androidCameraTexture=null;
  }

  if(androidOverlayCanvas){
    try{androidOverlayCanvas.remove();}catch(_){}
  }
  if(androidCameraCanvas){
    try{androidCameraCanvas.remove();}catch(_){}
  }
  try{androidARTarget?.dispose?.();}catch(_){}

  androidOverlayCanvas=null;
  androidOverlayCtx=null;
  androidCameraCanvas=null;
  androidCameraCtx=null;
  androidARCanvas=null;
  androidARCtx=null;
  androidARTarget=null;
  androidARPixels=null;
  androidARImageData=null;
  androidCompositeW=0;
  androidCompositeH=0;
  androidLastCompositeAt=0;
  if(cameraVideo){
    try{cameraVideo.pause();}catch(_){}
    cameraVideo.srcObject=null;
    cameraVideo.remove();
    cameraVideo=null;
  }

  if(cameraStream){
    try{cameraStream.getTracks().forEach(track=>track.stop());}catch(_){}
    cameraStream=null;
  }
}

function createCameraVideo(){
  if(cameraVideo)return cameraVideo;

  cameraVideo=document.createElement('video');
  cameraVideo.id='climateCameraDisplay';
  cameraVideo.autoplay=true;
  cameraVideo.muted=true;
  cameraVideo.setAttribute('playsinline','');
  cameraVideo.setAttribute('webkit-playsinline','');
  cameraVideo.setAttribute('muted','');
  cameraVideo.disablePictureInPicture=true;

  Object.assign(cameraVideo.style,{
    position:'absolute',
    inset:'0',
    width:'100%',
    height:'100%',
    objectFit:'cover',
    objectPosition:'center center',
    display:'block',
    visibility:'visible',
    opacity:'1',
    zIndex:'1',
    pointerEvents:'none',
    background:'#000'
  });

  // Use one proven browser pipeline on both iOS and Android: native camera
  // video inside the AR container with a transparent WebGL canvas above it.
  // The former Android-only CPU compositor was the common failure point on
  // otherwise unrelated Android devices.
  container.prepend(cameraVideo);
  return cameraVideo;
}

async function requestCameraStream(){
  const androidHD={
    facingMode:{exact:'environment'},
    width:{ideal:1280},
    height:{ideal:720},
    frameRate:{ideal:30,max:30}
  };
  const androidBalanced={
    facingMode:{ideal:'environment'},
    width:{ideal:960},
    height:{ideal:540},
    frameRate:{ideal:24,max:30}
  };
  const androidAttempts=ANDROID_LIGHT_MODE
    ? [androidBalanced,androidHD,true]
    : [androidHD,androidBalanced,true];
  const iosAttempts=[{
    facingMode:{ideal:'environment'},
    width:{ideal:1280},
    height:{ideal:720},
    frameRate:{ideal:30,max:60}
  }];
  const attempts=PLATFORM_ANDROID?androidAttempts:iosAttempts;
  let lastError=null;

  for(const video of attempts){
    try{
      return await navigator.mediaDevices.getUserMedia({audio:false,video});
    }catch(error){
      lastError=error;
      // Never issue another permission request after an explicit denial.
      if(error?.name==='NotAllowedError'||error?.name==='SecurityError')throw error;
    }
  }
  throw lastError||new Error('Camera stream unavailable');
}

function waitForFirstVideoFrame(video,timeoutMs=5000){
  return new Promise((resolve,reject)=>{
    let settled=false;
    let timer=0;
    let frameRequest=0;
    const cleanup=()=>{
      clearTimeout(timer);
      video.removeEventListener('loadeddata',onReady);
      video.removeEventListener('canplay',onReady);
      if(frameRequest&&video.cancelVideoFrameCallback){
        try{video.cancelVideoFrameCallback(frameRequest)}catch(_){}
      }
    };
    const finish=(error=null)=>{
      if(settled)return;
      settled=true;
      cleanup();
      error?reject(error):resolve();
    };
    const onReady=()=>{
      if(video.readyState>=2&&video.videoWidth&&video.videoHeight)finish();
    };

    video.addEventListener('loadeddata',onReady);
    video.addEventListener('canplay',onReady);
    if(video.requestVideoFrameCallback){
      frameRequest=video.requestVideoFrameCallback(()=>finish());
    }
    timer=setTimeout(()=>{
      const error=new Error('Camera opened but no decoded frame arrived');
      error.name='NotReadableError';
      finish(error);
    },timeoutMs);
    onReady();
  });
}

function updateAndroidCameraTextureCrop(){
  if(!androidCameraTexture||!cameraVideo?.videoWidth||!cameraVideo?.videoHeight)return;
  const rect=container.getBoundingClientRect();
  const viewAspect=Math.max(.01,rect.width/Math.max(1,rect.height));
  const videoAspect=cameraVideo.videoWidth/cameraVideo.videoHeight;

  if(videoAspect>viewAspect){
    const visibleX=viewAspect/videoAspect;
    androidCameraTexture.repeat.set(visibleX,1);
    androidCameraTexture.offset.set((1-visibleX)/2,0);
  }else{
    const visibleY=videoAspect/viewAspect;
    androidCameraTexture.repeat.set(1,visibleY);
    androidCameraTexture.offset.set(0,(1-visibleY)/2);
  }
  androidCameraTexture.needsUpdate=true;
}

function setupAndroidCameraTexture(){
  if(!PLATFORM_ANDROID||!cameraVideo?.videoWidth||!scene)return false;
  if(androidCameraTexture){
    try{androidCameraTexture.dispose()}catch(_){}
  }
  androidCameraTexture=new THREE.VideoTexture(cameraVideo);
  androidCameraTexture.colorSpace=THREE.SRGBColorSpace;
  androidCameraTexture.minFilter=THREE.LinearFilter;
  androidCameraTexture.magFilter=THREE.LinearFilter;
  androidCameraTexture.generateMipmaps=false;
  androidCameraTexture.wrapS=THREE.ClampToEdgeWrapping;
  androidCameraTexture.wrapT=THREE.ClampToEdgeWrapping;
  updateAndroidCameraTextureCrop();
  scene.background=androidCameraTexture;
  return true;
}


function setImportant(el,property,value){
  if(!el)return;
  try{el.style.setProperty(property,value,'important');}
  catch(_){el.style[property]=value;}
}

function chooseAndroidCompositeSize(){
  const rect=interactionHost?.getBoundingClientRect?.() || container.getBoundingClientRect();
  const w=Math.max(1,rect.width);
  const h=Math.max(1,rect.height);
  const aspect=w/h;

  // Conservative size because readRenderTargetPixels is synchronous.
  if(aspect>=1){
    androidCompositeW=640;
    androidCompositeH=Math.max(300,Math.round(640/aspect));
  }else{
    androidCompositeW=360;
    androidCompositeH=Math.max(560,Math.round(360/aspect));
  }
}

function destroyAndroidRenderTargetOnly(){
  try{androidARTarget?.dispose?.();}catch(_){}
  androidARTarget=null;
  androidARPixels=null;
  androidARImageData=null;
}

function setupAndroidCPUCompositor(){
  if(!PLATFORM_ANDROID||!renderer||!cameraVideo?.videoWidth)return false;

  try{
    if(androidOverlayCanvas){
      try{androidOverlayCanvas.remove();}catch(_){}
    }
    if(androidCameraCanvas){
      try{androidCameraCanvas.remove();}catch(_){}
    }
    destroyAndroidRenderTargetOnly();

    chooseAndroidCompositeSize();
    androidCameraCanvas=null;
    androidCameraCtx=null;

    // ---------------------------------------------------------
    // Visible layer: transparent Canvas2D AR overlay ONLY.
    // Raw camera video stays visible underneath.
    // ---------------------------------------------------------
    androidOverlayCanvas=document.createElement('canvas');
    androidOverlayCanvas.id='androidAROverlayCanvas';
    androidOverlayCanvas.width=androidCompositeW;
    androidOverlayCanvas.height=androidCompositeH;

    setImportant(androidOverlayCanvas,'position','absolute');
    setImportant(androidOverlayCanvas,'inset','0');
    setImportant(androidOverlayCanvas,'width','100%');
    setImportant(androidOverlayCanvas,'height','100%');
    setImportant(androidOverlayCanvas,'display','block');
    setImportant(androidOverlayCanvas,'visibility','visible');
    setImportant(androidOverlayCanvas,'opacity','1');
    setImportant(androidOverlayCanvas,'z-index','2');
    setImportant(androidOverlayCanvas,'pointer-events','none');
    setImportant(androidOverlayCanvas,'background','transparent');

    androidOverlayCtx=androidOverlayCanvas.getContext('2d',{
      alpha:true,
      desynchronized:true
    });
    if(!androidOverlayCtx)throw new Error('AR overlay Canvas2D unavailable');

    // ---------------------------------------------------------
    // Offscreen AR conversion canvas.
    // ---------------------------------------------------------
    androidARCanvas=document.createElement('canvas');
    androidARCanvas.width=androidCompositeW;
    androidARCanvas.height=androidCompositeH;

    androidARCtx=androidARCanvas.getContext('2d',{
      alpha:true,
      willReadFrequently:true
    });
    if(!androidARCtx)throw new Error('AR working Canvas2D unavailable');

    androidARImageData=androidARCtx.createImageData(
      androidCompositeW,
      androidCompositeH
    );

    // ---------------------------------------------------------
    // Three.js renders offscreen only.
    // ---------------------------------------------------------
    androidARTarget=new THREE.WebGLRenderTarget(
      androidCompositeW,
      androidCompositeH,
      {
        format:THREE.RGBAFormat,
        type:THREE.UnsignedByteType,
        depthBuffer:true,
        stencilBuffer:false,
        generateMipmaps:false,
        minFilter:THREE.LinearFilter,
        magFilter:THREE.LinearFilter
      }
    );
    androidARTarget.texture.colorSpace=THREE.NoColorSpace;

    androidARPixels=new Uint8Array(
      androidCompositeW*androidCompositeH*4
    );

    // ---------------------------------------------------------
    // Critical change:
    // RAW camera video is visible and NEVER copied/redrawn.
    // Diagnostic page already proved this path is stable.
    // ---------------------------------------------------------
    setImportant(cameraVideo,'position','absolute');
    setImportant(cameraVideo,'inset','0');
    setImportant(cameraVideo,'width','100%');
    setImportant(cameraVideo,'height','100%');
    setImportant(cameraVideo,'object-fit','cover');
    setImportant(cameraVideo,'display','block');
    setImportant(cameraVideo,'visibility','visible');
    // Native camera stays fully visible. Only the AR pixels are copied to the
    // transparent Canvas2D overlay on Android.
    setImportant(cameraVideo,'opacity','1');
    setImportant(cameraVideo,'z-index','1');
    setImportant(cameraVideo,'background','#000');

    // Keep requestAnimationFrame/WebGL alive on Android, but below both camera
    // layers. display:none/visibility:hidden can suspend animation or GPU work
    // on some Chrome/WebView builds.
    setImportant(renderer.domElement,'display','block');
    setImportant(renderer.domElement,'visibility','visible');
    setImportant(renderer.domElement,'opacity','0.001');
    setImportant(renderer.domElement,'z-index','0');
    setImportant(renderer.domElement,'background','transparent');

    /*
      Append overlay directly to #arStage, outside #mindarContainer.
      This avoids old ".mindar-container canvas { ... !important }" rules.
    */
    // Do not append androidCameraCanvas. The native <video> is the reliable
    // camera preview; this compositor is strictly an AR-only overlay.
    interactionHost.appendChild(androidOverlayCanvas);

    androidCompositeActive=true;
    androidLastCompositeAt=0;

    // Start completely transparent: raw camera must remain visible.
    androidOverlayCtx.clearRect(
      0,0,
      androidOverlayCanvas.width,
      androidOverlayCanvas.height
    );

    console.info('Android raw-video + AR overlay active',{
      overlay:[androidCompositeW,androidCompositeH],
      camera:[cameraVideo.videoWidth,cameraVideo.videoHeight]
    });

    return true;
  }catch(error){
    console.error('Android AR overlay setup failed:',error);
    androidCompositeActive=false;

    // Camera remains visible even if AR overlay setup fails.
    if(cameraVideo){
      setImportant(cameraVideo,'opacity','1');
      setImportant(cameraVideo,'z-index','1');
    }
    if(renderer?.domElement){
      setImportant(renderer.domElement,'opacity','0');
      setImportant(renderer.domElement,'z-index','0');
    }
    return false;
  }
}

function drawAndroidCameraFrame(){
  if(!androidCameraCtx||!androidCameraCanvas||!cameraVideo)return false;
  if(cameraVideo.readyState<2||!cameraVideo.videoWidth||!cameraVideo.videoHeight)return false;

  const dw=androidCameraCanvas.width;
  const dh=androidCameraCanvas.height;
  const sw=cameraVideo.videoWidth;
  const sh=cameraVideo.videoHeight;
  const sourceAspect=sw/sh;
  const destAspect=dw/dh;
  let sx=0,sy=0,cropW=sw,cropH=sh;

  if(sourceAspect>destAspect){
    cropW=sh*destAspect;
    sx=(sw-cropW)/2;
  }else{
    cropH=sw/destAspect;
    sy=(sh-cropH)/2;
  }

  try{
    androidCameraCtx.drawImage(cameraVideo,sx,sy,cropW,cropH,0,0,dw,dh);
    return true;
  }catch(error){
    console.warn('Android camera frame copy failed:',error);
    return false;
  }
}


function copyRenderTargetPixelsToARCanvas(){
  if(
    !androidARTarget ||
    !androidARPixels ||
    !androidARImageData ||
    !androidARCtx
  )return false;

  try{
    renderer.readRenderTargetPixels(
      androidARTarget,
      0,0,
      androidCompositeW,
      androidCompositeH,
      androidARPixels
    );

    /*
      Do NOT trust WebGL alpha on this Android path.
      Instead, the render target is cleared to opaque magenta (#ff00ff).
      Anything sufficiently close to that exact key is background and becomes
      transparent. Every other pixel is treated as visible AR.
    */
    const dst=androidARImageData.data;
    const rowBytes=androidCompositeW*4;
    let visible=0;

    for(let y=0;y<androidCompositeH;y++){
      const srcY=androidCompositeH-1-y;
      const srcRow=srcY*rowBytes;
      const dstRow=y*rowBytes;

      for(let x=0;x<androidCompositeW;x++){
        const si=srcRow+x*4;
        const di=dstRow+x*4;

        const r=androidARPixels[si];
        const g=androidARPixels[si+1];
        const b=androidARPixels[si+2];

        // Slight tolerance accounts for color conversion at target edges.
        const key=
          r>238 &&
          b>238 &&
          g<24 &&
          Math.abs(r-b)<18;

        if(key){
          dst[di]=0;
          dst[di+1]=0;
          dst[di+2]=0;
          dst[di+3]=0;
        }else{
          dst[di]=r;
          dst[di+1]=g;
          dst[di+2]=b;

          // Keep anti-aliased edge alpha from source when usable,
          // otherwise make the rendered object opaque.
          const srcA=androidARPixels[si+3];
          dst[di+3]=srcA>8?srcA:255;
          visible++;
        }
      }
    }

    androidLastVisibleARPixels=visible;

    androidARCtx.clearRect(0,0,androidCompositeW,androidCompositeH);
    androidARCtx.putImageData(androidARImageData,0,0);
    return true;
  }catch(error){
    console.warn('Android WebGL chroma readback failed:',error);
    androidLastVisibleARPixels=0;
    return false;
  }
}

function renderAndroidCPUComposite(now){
  if(
    !androidCompositeActive ||
    !androidOverlayCtx ||
    !androidOverlayCanvas ||
    !androidARTarget
  )return;

  if(now-androidLastCompositeAt<ANDROID_COMPOSITE_INTERVAL_MS)return;
  androidLastCompositeAt=now;

  // 1) Render AR only against chroma background OFFSCREEN.
  renderer.setRenderTarget(androidARTarget);
  renderer.autoClear=true;
  renderer.setClearColor(0xff00ff,1);
  renderer.clear(true,true,true);
  renderer.render(scene,arCamera);

  // 2) Convert chroma pixels to a transparent Canvas2D AR layer.
  copyRenderTargetPixelsToARCanvas();

  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000,0);

  /*
    3) Replace ONLY the AR overlay.
       NEVER clear or redraw the raw camera video.
       Therefore a slow/missed AR frame cannot produce black camera flicker.
  */
  androidOverlayCtx.clearRect(
    0,0,
    androidOverlayCanvas.width,
    androidOverlayCanvas.height
  );

  if(androidLastVisibleARPixels>20){
    androidOverlayCtx.drawImage(
      androidARCanvas,
      0,0,
      androidOverlayCanvas.width,
      androidOverlayCanvas.height
    );
  }

  // Diagnostic only.
  if(trackingEventFound && now-androidLastARStatusAt>900){
    androidLastARStatusAt=now;

    if(androidLastVisibleARPixels<30){
      console.warn(
        'Android tracking locked but AR render target has no visible pixels',
        {
          position:trackingRenderPosition.toArray(),
          visible:stickyRoot.visible,
          targetPixels:androidLastVisibleARPixels
        }
      );
      if(statusText){
        statusText.textContent='Anchor terkunci · pose AR di luar frame';
      }
    }else if(statusText && statusText.textContent.includes('di luar frame')){
      statusText.textContent='Board terkunci · 1 tag aktif · pinch untuk zoom';
    }
  }
}

function resizeAndroidCPUCompositor(){
  if(!PLATFORM_ANDROID||!androidCompositeActive)return;

  const oldW=androidCompositeW;
  const oldH=androidCompositeH;
  chooseAndroidCompositeSize();

  if(oldW===androidCompositeW&&oldH===androidCompositeH)return;

  setupAndroidCPUCompositor();
}

function renderLiveFrame(){
  if(!renderer||!scene||!arCamera)return;

  refreshAndroidShadows(renderer);

  if(PLATFORM_ANDROID&&androidCompositeActive){
    renderAndroidCPUComposite(performance.now());
    return;
  }

  // Native camera video remains underneath this transparent AR canvas.
  renderer.setRenderTarget(null);
  renderer.autoClear=true;
  renderer.setClearColor(0x000000,0);
  renderer.render(scene,arCamera);
}

function createARRenderer(){
  scene=new THREE.Scene();
  scene.background=null;

  arCamera=new THREE.PerspectiveCamera(50,1,.01,20);
  arCamera.position.set(0,0,0);
  arCamera.quaternion.identity();
  scene.add(arCamera);

  renderer=new THREE.WebGLRenderer({
    antialias:QUALITY!=='lite',
    alpha:true,
    premultipliedAlpha:true,
    powerPreference:'high-performance'
  });
  configureRenderer(renderer);
  renderer.setSize(
    Math.max(1,container.clientWidth),
    Math.max(1,container.clientHeight)
  );

  container.appendChild(renderer.domElement);
  addLighting(scene);

  if(world.parent!==stickyRoot)stickyRoot.add(world);
  scene.add(stickyRoot);

  stickyRoot.visible=false;
  stickyRoot.scale.setScalar(TRACKING_WORLD_SCALE);
}

function updateCameraProjectionFromIntrinsics(){
  if(!arCamera||!cameraIntrinsics)return;

  const rect=container.getBoundingClientRect();
  const w=Math.max(1,rect.width);
  const h=Math.max(1,rect.height);

  const sx=w/detectorWidth;
  const sy=h/detectorHeight;

  const fx=cameraIntrinsics.fx*sx;
  const fy=cameraIntrinsics.fy*sy;
  const cx=cameraIntrinsics.cx*sx;
  const cy=cameraIntrinsics.cy*sy;

  const near=arCamera.near;
  const far=arCamera.far;
  const left=-cx*near/fx;
  const right=(w-cx)*near/fx;
  const top=cy*near/fy;
  const bottom=-(h-cy)*near/fy;

  arCamera.projectionMatrix.makePerspective(left,right,top,bottom,near,far);
  arCamera.projectionMatrixInverse.copy(arCamera.projectionMatrix).invert();
}

function updateDetectionGeometry(){
  if(!cameraVideo?.videoWidth||!cameraVideo?.videoHeight)return false;

  const rect=container.getBoundingClientRect();
  const viewAspect=Math.max(.25,Math.min(4,rect.width/Math.max(1,rect.height)));

  const detectorLongSide=PLATFORM_ANDROID?(ANDROID_LIGHT_MODE?448:512):640;
  if(viewAspect>=1){
    detectorWidth=detectorLongSide;
    detectorHeight=Math.max(240,Math.round(detectorLongSide/viewAspect));
  }else{
    detectorHeight=detectorLongSide;
    detectorWidth=Math.max(240,Math.round(detectorLongSide*viewAspect));
  }

  if(!detectorCanvas){
    detectorCanvas=document.createElement('canvas');
    detectorCtx=detectorCanvas.getContext('2d',{willReadFrequently:true});
  }

  detectorCanvas.width=detectorWidth;
  detectorCanvas.height=detectorHeight;
  detectorGray=new Uint8Array(detectorWidth*detectorHeight);

  const srcW=cameraVideo.videoWidth;
  const srcH=cameraVideo.videoHeight;

  // Approximate main-camera intrinsics from horizontal FOV, then account for
  // the same centered "cover" crop used by the visible video.
  const hfov=THREE.MathUtils.degToRad(TRACK_HFOV_DEG);
  const fxSrc=srcW/(2*Math.tan(hfov/2));
  const fySrc=fxSrc;

  const coverScale=Math.max(detectorWidth/srcW,detectorHeight/srcH);
  const fx=fxSrc*coverScale;
  const fy=fySrc*coverScale;
  const cx=detectorWidth/2;
  const cy=detectorHeight/2;

  cameraIntrinsics={fx,fy,cx,cy};

  apriltagWorker?.postMessage({type:'camera',fx,fy,cx,cy});
  updateCameraProjectionFromIntrinsics();

  renderer?.setSize(
    Math.max(1,container.clientWidth),
    Math.max(1,container.clientHeight)
  );
  updateAndroidCameraTextureCrop();

  return true;
}

function drawCameraCoverToDetectorCanvas(){
  if(!cameraVideo||!detectorCtx)return false;

  const sw=cameraVideo.videoWidth;
  const sh=cameraVideo.videoHeight;
  if(!sw||!sh)return false;

  const dw=detectorWidth;
  const dh=detectorHeight;

  const scale=Math.max(dw/sw,dh/sh);
  const cropW=dw/scale;
  const cropH=dh/scale;
  const sx=(sw-cropW)/2;
  const sy=(sh-cropH)/2;

  detectorCtx.drawImage(
    cameraVideo,
    sx,sy,cropW,cropH,
    0,0,dw,dh
  );
  return true;
}

function submitDetectionFrame(now){
  if(!running||!detectorReady||detectorBusy||!apriltagWorker||!cameraVideo)return;
  // Search quickly before lock. Once the marker is stable, a lower detector
  // cadence saves CPU while the 30 FPS pose interpolation remains smooth.
  const detectionInterval=ANDROID_OPTIMIZED_MODE&&trackingFound
    ? ANDROID_LOCKED_DETECTION_INTERVAL_MS
    : TRACKING_LIMITS.detectionIntervalMs;
  if(now-lastDetectorSubmit<detectionInterval)return;
  if(cameraVideo.readyState<2)return;
  if(!detectorWidth||!detectorHeight)updateDetectionGeometry();
  if(!drawCameraCoverToDetectorCanvas())return;

  const imageData=detectorCtx.getImageData(0,0,detectorWidth,detectorHeight);
  const rgba=imageData.data;

  if(!detectorGray||detectorGray.length!==detectorWidth*detectorHeight){
    detectorGray=new Uint8Array(detectorWidth*detectorHeight);
  }

  for(let i=0,j=0;i<rgba.length;i+=4,j++){
    // integer approximation of Rec.601 luma
    detectorGray[j]=(rgba[i]*77+rgba[i+1]*150+rgba[i+2]*29)>>8;
  }

  const sendBuffer=detectorGray.buffer;
  detectorBusy=true;
  lastDetectorSubmit=now;
  detectorSeq++;

  apriltagWorker.postMessage({
    type:'detect',
    seq:detectorSeq,
    width:detectorWidth,
    height:detectorHeight,
    buffer:sendBuffer
  },[sendBuffer]);

  // transferred buffer must be recreated for the next frame
  detectorGray=new Uint8Array(detectorWidth*detectorHeight);
}

function nestedRVariants(R){
  if(!Array.isArray(R)||R.length!==3)return [];

  const a=[
    [Number(R[0][0]),Number(R[0][1]),Number(R[0][2])],
    [Number(R[1][0]),Number(R[1][1]),Number(R[1][2])],
    [Number(R[2][0]),Number(R[2][1]),Number(R[2][2])]
  ];

  const t=[
    [a[0][0],a[1][0],a[2][0]],
    [a[0][1],a[1][1],a[2][1]],
    [a[0][2],a[1][2],a[2][2]]
  ];

  return [a,t];
}

function mul3(A,B){
  const out=[[0,0,0],[0,0,0],[0,0,0]];
  for(let r=0;r<3;r++){
    for(let c=0;c<3;c++){
      out[r][c]=
        A[r][0]*B[0][c]+
        A[r][1]*B[1][c]+
        A[r][2]*B[2][c];
    }
  }
  return out;
}

function mul3v(A,v){
  return[
    A[0][0]*v[0]+A[0][1]*v[1]+A[0][2]*v[2],
    A[1][0]*v[0]+A[1][1]*v[1]+A[1][2]*v[2],
    A[2][0]*v[0]+A[2][1]*v[1]+A[2][2]*v[2]
  ];
}

function tagPoseCandidateToBoard(det,poseCandidate){
  const layout=TRACK_TAG_LAYOUT[det.id];
  if(!layout||!poseCandidate?.R||!poseCandidate?.t)return [];

  const output=[];

  // Camera CV -> Three camera: x same, y up, camera looks -z.
  const C=[
    [1,0,0],
    [0,-1,0],
    [0,0,-1]
  ];

  // Existing diorama axes -> AprilTag board axes:
  // local X = board right
  // local Y = out of board toward viewer
  // local Z = board down
  const A=[
    [1,0,0],
    [0,0,1],
    [0,-1,0]
  ];

  for(const R of nestedRVariants(poseCandidate.R)){
    const tagOffset=[layout.x,layout.y,layout.z];
    const rotatedOffset=mul3v(R,tagOffset);

    // tag center = board center + R * tagOffset
    const tb=[
      Number(poseCandidate.t[0])-rotatedOffset[0],
      Number(poseCandidate.t[1])-rotatedOffset[1],
      Number(poseCandidate.t[2])-rotatedOffset[2]
    ];

    if(!tb.every(Number.isFinite))continue;

    const Rthree=mul3(C,mul3(R,A));
    const position=new THREE.Vector3(tb[0],-tb[1],-tb[2]);

    // Object must be in front of the Three camera.
    if(position.z>=-.035||position.length()>.01+8)continue;

    const m=new THREE.Matrix4().set(
      Rthree[0][0],Rthree[0][1],Rthree[0][2],position.x,
      Rthree[1][0],Rthree[1][1],Rthree[1][2],position.y,
      Rthree[2][0],Rthree[2][1],Rthree[2][2],position.z,
      0,0,0,1
    );

    const q=new THREE.Quaternion();
    const dummyScale=new THREE.Vector3();
    const dummyPos=new THREE.Vector3();
    m.decompose(dummyPos,q,dummyScale);
    q.normalize();

    // Local +Y is the board normal OUT toward the camera.
    const outward=new THREE.Vector3(0,1,0).applyQuaternion(q).normalize();
    const toCamera=position.clone().multiplyScalar(-1).normalize();

    /*
      V13.3 FIX:
      The sign of the plane normal depends on the AprilTag/CV -> Three.js
      coordinate convention. A valid front-facing tag can therefore produce
      dot ~= -1 instead of +1.

      We only need the MAGNITUDE here to reject near-edge-on views.
      Using the signed value caused valid tags to be rejected completely.
    */
    const facingSigned=outward.dot(toCamera);
    const facing=Math.abs(facingSigned);

    if(facing<TRACKING_LIMITS.edgeFacingMin)continue;

    output.push({
      position,
      quaternion:q,
      error:Number(poseCandidate.e??det.pose?.e??.001),
      facing,
      facingSigned
    });
  }

  return output;
}

function detectionArea(det){
  const p=det?.corners;
  if(!Array.isArray(p)||p.length<4)return 1;
  let area=0;
  for(let i=0;i<4;i++){
    const a=p[i],b=p[(i+1)%4];
    area+=a.x*b.y-b.x*a.y;
  }
  return Math.max(1,Math.abs(area*.5));
}

function selectPerTagPose(det,now){
  if(!TRACK_TAG_LAYOUT[det.id]||!det.pose)return null;

  const poseVariants=[
    {R:det.pose.R,t:det.pose.t,e:det.pose.e},
    det.pose.asol ? {
      R:det.pose.asol.R,
      t:det.pose.asol.t,
      e:det.pose.asol.e
    } : null
  ].filter(Boolean);

  let candidates=[];
  for(const p of poseVariants){
    candidates.push(...tagPoseCandidateToBoard(det,p));
  }

  if(!candidates.length)return null;

  const recent=trackingPoseReady&&(now-lastSeenAt)<650;

  candidates.forEach(c=>{
    let score=(Number.isFinite(c.error)?c.error:.001)*1600;
    score+=(1-c.facing)*.10;

    if(recent){
      score+=c.position.distanceTo(trackingTargetPosition)*1.15;
      score+=trackingTargetQuaternion.angleTo(c.quaternion)*.32;
    }

    c.score=score;
  });

  candidates.sort((a,b)=>a.score-b.score);
  const best=candidates[0];
  best.weight=Math.sqrt(detectionArea(det))/
    (1+Math.max(0,best.error)*7000);

  return best;
}

function fuseBoardPoses(poses){
  if(!poses.length)return null;

  // Remove obvious translation outliers around the best candidate.
  const ref=poses.slice().sort((a,b)=>a.score-b.score)[0];
  const kept=poses.filter(p=>
    p.position.distanceTo(ref.position)<.18 &&
    p.quaternion.angleTo(ref.quaternion)<THREE.MathUtils.degToRad(35)
  );

  const list=kept.length?kept:[ref];

  let total=0;
  const pos=new THREE.Vector3();
  const qAcc={x:0,y:0,z:0,w:0};
  const qRef=list[0].quaternion;

  for(const p of list){
    const w=clamp(p.weight||1,.2,8);
    total+=w;
    pos.addScaledVector(p.position,w);

    const q=p.quaternion.clone();
    if(q.dot(qRef)<0)q.set(-q.x,-q.y,-q.z,-q.w);

    qAcc.x+=q.x*w;
    qAcc.y+=q.y*w;
    qAcc.z+=q.z*w;
    qAcc.w+=q.w*w;
  }

  pos.multiplyScalar(1/Math.max(.0001,total));

  const quat=new THREE.Quaternion(
    qAcc.x/total,qAcc.y/total,qAcc.z/total,qAcc.w/total
  ).normalize();

  return{position:pos,quaternion:quat,count:list.length};
}

function posePassesContinuityGate(pose,now){
  if(!trackingPoseReady){
    pendingJumpFrames=0;
    return true;
  }

  // After a meaningful gap, allow reacquisition to choose a new valid pose.
  const gap=now-lastSeenAt;
  if(gap>700){
    if(pendingJumpFrames===0){
      pendingJumpPosition.copy(pose.position);
      pendingJumpQuaternion.copy(pose.quaternion);
      pendingJumpFrames=1;
      return false;
    }

    const same=
      pendingJumpPosition.distanceTo(pose.position)<TRACKING_LIMITS.confirmDistance &&
      pendingJumpQuaternion.angleTo(pose.quaternion)<TRACKING_LIMITS.confirmAngle;

    if(same)pendingJumpFrames++;
    else{
      pendingJumpPosition.copy(pose.position);
      pendingJumpQuaternion.copy(pose.quaternion);
      pendingJumpFrames=1;
    }

    if(pendingJumpFrames>=2){
      pendingJumpFrames=0;
      return true;
    }

    return false;
  }

  const distance=trackingTargetPosition.distanceTo(pose.position);
  const angle=trackingTargetQuaternion.angleTo(pose.quaternion);
  const suspicious=
    distance>TRACKING_LIMITS.jumpDistance ||
    angle>TRACKING_LIMITS.jumpAngle;

  if(!suspicious){
    pendingJumpFrames=0;
    return true;
  }

  if(pendingJumpFrames===0){
    pendingJumpPosition.copy(pose.position);
    pendingJumpQuaternion.copy(pose.quaternion);
    pendingJumpFrames=1;
    return false;
  }

  const same=
    pendingJumpPosition.distanceTo(pose.position)<TRACKING_LIMITS.confirmDistance &&
    pendingJumpQuaternion.angleTo(pose.quaternion)<TRACKING_LIMITS.confirmAngle;

  if(same){
    pendingJumpFrames++;
    pendingJumpPosition.lerp(pose.position,.35);
    pendingJumpQuaternion.slerp(pose.quaternion,.35);
  }else{
    pendingJumpPosition.copy(pose.position);
    pendingJumpQuaternion.copy(pose.quaternion);
    pendingJumpFrames=1;
  }

  if(pendingJumpFrames<TRACKING_LIMITS.confirmFrames)return false;

  pendingJumpFrames=0;
  return true;
}

function setTrackingEvent(found){
  if(found===trackingEventFound)return;
  trackingEventFound=found;
  trackingFound=found;

  // Before an anchor exists Android only needs the native camera layer. This
  // guarantees that even a driver which composites a transparent WebGL canvas
  // incorrectly cannot cover the live preview with black. WebGL becomes
  // visible only when there is actual AR content to draw.
  if(PLATFORM_ANDROID&&renderer?.domElement){
    setImportant(renderer.domElement,'opacity',(found||hasEverTracked)?'1':'0');
  }

  window.dispatchEvent(new CustomEvent('climate-ar-tracking',{
    detail:{found}
  }));

  statusWrap?.classList.toggle('found',found);
}

function acceptTrackingPose(pose,now){
  if(!posePassesContinuityGate(pose,now))return false;

  trackingTargetPosition.copy(pose.position);
  trackingTargetQuaternion.copy(pose.quaternion);
  trackingPoseReady=true;
  lastSeenAt=now;
  lastPoseAcceptedAt=now;

  if(!renderPoseReady){
    trackingRenderPosition.copy(pose.position);
    trackingRenderQuaternion.copy(pose.quaternion);
    renderPoseReady=true;
  }

  if(!hasEverTracked){
    hasEverTracked=true;
    revealed=false;
    lastTrackingStatusAt=now;
    if(statusText)statusText.textContent='Gambar terbaca · geser 1 jari / cubit 2 jari';
    setTrackingEvent(true);
    playPaperReveal();
  }else{
    setTrackingEvent(true);
    if(now-lastTrackingStatusAt<=500){
      stickyRoot.visible=true;
      return true;
    }
    lastTrackingStatusAt=now;
    if(statusText)statusText.textContent=`Board terkunci · ${pose.count} tag aktif · pinch untuk zoom`;
  }

  stickyRoot.visible=true;
  return true;
}

function processAprilTagDetections(detections){
  if(!running)return;

  const now=performance.now();
  const boardDetections=detections.filter(d=>TRACK_TAG_LAYOUT[d.id]);
  lastRawTagCount=boardDetections.length;

  const valid=boardDetections.filter(d=>d.pose);
  if(!valid.length){
    lastValidPoseCount=0;
    return;
  }

  const perTag=valid
    .map(d=>selectPerTagPose(d,now))
    .filter(Boolean);

  lastValidPoseCount=perTag.length;

  if(!perTag.length){
    // Detector can see a tag but its pose is being rejected.
    // Show this only occasionally so the normal status is not spammed.
    if(now-lastDetectorDebugAt>800 && statusText && !trackingEventFound){
      statusText.textContent=`Tag terbaca (${lastRawTagCount}) · menghitung pose…`;
      lastDetectorDebugAt=now;
    }
    return;
  }

  const fused=fuseBoardPoses(perTag);
  if(!fused)return;

  acceptTrackingPose(fused,now);
}

function updateTrackingRender(){
  if(!running||!renderPoseReady)return;

  const now=performance.now();
  const dt=clamp((now-trackingLastRenderTime)/1000,1/120,.08);
  trackingLastRenderTime=now;

  const sinceSeen=now-lastSeenAt;

  if(trackingPoseReady&&sinceSeen<TRACKING_LIMITS.holdVisibleMs){
    const posError=trackingRenderPosition.distanceTo(trackingTargetPosition);
    const rotError=trackingRenderQuaternion.angleTo(trackingTargetQuaternion);

    /*
      "Board lock":
      - small noise gets smoothed;
      - real marker motion catches up aggressively so the model does not look
        like it is floating behind the board.
    */
    // Adaptive smoothing removes small AprilTag pose noise without adding lag:
    // tiny errors settle softly, while intentional camera movement catches up
    // quickly. This affects motion only, never model/render quality.
    const posResponse=
      posError<.0015 ? 8 :
      posError<.0050 ? 19 :
      posError<.0120 ? 34 : 52;
    const rotResponse=
      rotError<THREE.MathUtils.degToRad(.55) ? 8 :
      rotError<THREE.MathUtils.degToRad(2.2) ? 18 :
      rotError<THREE.MathUtils.degToRad(6) ? 32 : 48;

    let posAlpha=1-Math.exp(-posResponse*dt);
    let rotAlpha=1-Math.exp(-rotResponse*dt);

    if(posError>.012)posAlpha=Math.max(posAlpha,.62);
    else if(posError>.005)posAlpha=Math.max(posAlpha,.42);

    if(rotError>THREE.MathUtils.degToRad(6))rotAlpha=Math.max(rotAlpha,.58);
    else if(rotError>THREE.MathUtils.degToRad(2))rotAlpha=Math.max(rotAlpha,.38);

    if(posError>.00035){
      trackingRenderPosition.lerp(trackingTargetPosition,posAlpha);
    }
    if(rotError>THREE.MathUtils.degToRad(.12)){
      trackingRenderQuaternion.slerp(trackingTargetQuaternion,rotAlpha).normalize();
    }

    /*
      The content root is placed at the BOARD center, then lifted a few mm
      along the board's local +Y normal. This makes the miniature sit just
      above the printed surface instead of intersecting it.
    */
    trackingBoardNormal
      .set(0,1,0)
      .applyQuaternion(trackingRenderQuaternion)
      .normalize();

    trackingLockedPosition
      .copy(trackingRenderPosition)
      .addScaledVector(trackingBoardNormal,BOARD_SURFACE_OFFSET_M);

    stickyRoot.position.copy(trackingLockedPosition);
    stickyRoot.quaternion.copy(trackingRenderQuaternion);

    /*
      IMPORTANT:
      Tracker scale is constant.
      Pinch zoom is applied to `world.scale` through userScale, never here.
      This prevents tracking noise from changing the diorama size.
    */
    stickyRoot.scale.setScalar(TRACKING_WORLD_SCALE);
    stickyRoot.visible=true;
  }

  if(sinceSeen>TRACKING_LIMITS.foundTimeoutMs&&trackingEventFound){
    setTrackingEvent(false);
    if(statusText)statusText.textContent='Tag lepas sebentar · posisi terakhir dikunci';
  }

  if(sinceSeen>TRACKING_LIMITS.holdVisibleMs){
    stickyRoot.visible=false;
    if(statusText)statusText.textContent='Gambar AR belum terlihat · arahkan kamera kembali';
  }
}
function detectionLoop(now){
  if(!running)return;
  submitDetectionFrame(now);
  requestAnimationFrame(detectionLoop);
}

async function initAR(){
  createARRenderer();

  try{
    buildStage(0);
  }catch(error){
    console.error('Climate AR Stage 1 build error:',error);
    if(statusText)statusText.textContent='Scene 3D gagal dibuat · cek console';
  }
  world.rotation.set(userPitch,userYaw,0);
  world.scale.setScalar(userScale);

  stickyRoot.position.set(0,0,-.55);
  stickyRoot.quaternion.identity();
  stickyRoot.scale.setScalar(TRACKING_WORLD_SCALE);
  stickyRoot.visible=false;

  initToolPreviews();
  freezeStaticWorldMatrices();

  /*
    V13.1:
    Jangan memulai WASM detector sebelum user menekan Aktifkan Kamera.
    Beberapa mobile browser/CDN dapat membuat init worker menggantung,
    sehingga alur permission kamera terasa seperti tidak berjalan.
  */
}

function syncStickyPose(){
  // V13 uses AprilTag board pose in updateTrackingRender().
}

function cacheTrackedPose(){
  // No MindAR anchor cache in V13.
}

function createPaperFlaps(){
  const group=new THREE.Group();
  group.name='bookOpenEffect';

  const paperMat=new THREE.MeshPhysicalMaterial({
    color:0xfffbec,roughness:.82,metalness:0,side:THREE.DoubleSide,
    clearcoat:.08,clearcoatRoughness:.7
  });
  const edgeMat=new THREE.MeshStandardMaterial({color:0x2d7655,roughness:.8});
  const lineMat=new THREE.MeshStandardMaterial({color:0xd8cfb8,roughness:.9});

  const makePage=side=>{
    const pivot=new THREE.Group();
    pivot.position.set(0,.012,0);
    group.add(pivot);
    const page=mesh(rb(.85,.014,1.05,.035,5),paperMat,[side*.425,0,0]);
    page.castShadow=true;page.receiveShadow=true;pivot.add(page);
    const border=mesh(rb(.025,.008,.96,.008,2),edgeMat,[side*.82,.012,0]);pivot.add(border);
    for(let z=-.33;z<=.33;z+=.16){
      const line=mesh(rb(.56,.003,.008,.003,2),lineMat,[side*.43,.013,z]);line.castShadow=false;pivot.add(line);
    }
    pivot.userData={side};
    return pivot;
  };

  group.userData.flaps=[makePage(-1),makePage(1)];

  stickyRoot.add(group);
  return group;
}

function playPaperReveal(){
  if(revealed)return;
  revealed=true;

  // Keep the rising-world reveal, but do not render decorative white pages.
  // Tracking is driven by the camera detector and is independent of this effect.
  const ring=createRevealRing();
  const start=performance.now();
  const duration=1350;
  const target=userScale;

  world.scale.set(target,.018,target);
  stageBackdrop?.scale.set(target,.018,target);
  world.position.y=-.025;

  const tick=now=>{
    const t=clamp((now-start)/duration,0,1);
    const rise=THREE.MathUtils.smootherstep(clamp((t-.22)/.78,0,1),0,1);

    const spring=rise + Math.sin(rise*Math.PI*2.6)*(1-rise)*.08;
    world.scale.set(target,target*clamp(spring,.018,1.04),target);
    stageBackdrop?.scale.set(target,target*clamp(spring,.018,1.04),target);
    world.position.y=THREE.MathUtils.lerp(-.025,0,rise);

    ring.scale.setScalar(1+t*6);
    ring.material.opacity=1-t;

    if(t<1){
      requestAnimationFrame(tick);
    }else{
      world.scale.setScalar(target);
      stageBackdrop?.scale.setScalar(target);
      world.position.y=0;
      ring.removeFromParent();
      ring.geometry.dispose();
      ring.material.dispose();
    }
  };
  requestAnimationFrame(tick);
}

function createRevealRing(){
  const mat=new THREE.MeshBasicMaterial({color:0x9de17c,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false});
  const ring=mesh(new THREE.RingGeometry(.12,.16,64),mat,[0,.018,0],[-Math.PI/2,0,0]);world.add(ring);return ring;
}
function playReveal(){
  playPaperReveal();
}

function animate(){
  const t=clock.getElapsedTime();

  // Trees / grass sway.
  for(const g of swayObjects){
    if(!g?.rotation)continue;
    const phase=g.userData?.phase||0;
    const amount=g.userData?.swayAmount??.016;
    g.rotation.z=Math.sin(t*1.05+phase)*amount;
    g.rotation.x=Math.sin(t*.68+phase)*(amount*.22);
  }

  // Human movement: short local walking loops + limb swing.
  for(const actor of ambientActors){
    const phase=actor.userData.phase||0;
    actor.position.y=(actor.userData.baseY||.015)+Math.sin(t*2.0+phase)*.0014;

    if(actor.userData.actorPose==='walk'){
      const speed=actor.userData.walkSpeed||.7;
      const amp=actor.userData.walkAmp||.025;
      const travel=Math.sin(t*speed+phase);
      actor.position.x=(actor.userData.baseX??actor.position.x)+travel*amp;

      const limbs=actor.userData.limbs;
      if(limbs){
        const stride=Math.sin(t*speed*5+phase)*.42;
        limbs.armL.rotation.z=.20+stride;
        limbs.armR.rotation.z=-.20-stride;
        limbs.legL.rotation.z=-stride*.38;
        limbs.legR.rotation.z=stride*.38;
      }

      // Model faces along X according to current local walking direction.
      const walkingForward=Math.cos(t*speed+phase)>=0;
      actor.rotation.y=walkingForward?Math.PI/2:-Math.PI/2;
    }else{
      actor.rotation.z=Math.sin(t*1.15+phase)*.008;
    }
  }

  // Canopies move independently, making trees feel layered instead of rigid.
  for(const leaf of foliageSwayObjects){
    const phase=leaf.userData.foliagePhase||0;
    leaf.rotation.x=(leaf.userData.foliageBaseX||0)+Math.sin(t*1.35+phase)*.012;
    leaf.rotation.z=(leaf.userData.foliageBaseZ||0)+Math.cos(t*1.05+phase)*.016;
  }

  // River surface "breathes" very subtly under changing highlights.
  for(const water of riverSurfaces){
    const base=water.userData.baseOpacity??.86;
    water.material.opacity=clamp(base+Math.sin(t*1.55+(water.userData.phase||0))*.025,.35,1);
  }

  // Birds.
  for(const flock of birdFlocks){
    const phase=flock.userData.phase||0;
    flock.position.x=-.54+((t*.050+phase*.04)%1.22);
    flock.position.z=.10+Math.sin(t*.52+phase)*.075;
    flock.position.y=.45+Math.sin(t*.82+phase)*.022;
    flock.rotation.y=Math.sin(t*.32+phase)*.13;

    for(const bird of flock.children){
      const p=bird.userData.phase||0;
      if(bird.userData.left)bird.userData.left.rotation.z=-1.05+Math.sin(t*7+p)*.36;
      if(bird.userData.right)bird.userData.right.rotation.z=1.05-Math.sin(t*7+p)*.36;
    }
  }

  // Factory smoke.
  for(const s of smokePuffs){
    const u=(t*s.userData.speed+s.userData.offset)%1;
    s.position.y=s.userData.base.y+u*.33;
    s.position.x=s.userData.base.x+Math.sin(t*1.1+s.userData.phase)*.025*u;
    s.scale.setScalar(.65+u*1.25);
    s.material.opacity=(1-u)*.55*s.userData.intensity;
  }

  // Cars / motorbikes.
  for(const c of movingCars){
    const min=c.userData.routeMin??-.40;
    const max=c.userData.routeMax??.08;
    const u=(t*c.userData.speed+(c.userData.offset||0))%1;
    const v=THREE.MathUtils.lerp(min,max,u);

    if(c.userData.axis==='x')c.position.x=v;
    else c.position.z=v;

    if(Number.isFinite(c.userData.baseY))c.position.y=c.userData.baseY;

    // Visible wheel rotation gives movement a real 3D cue.
    if(c.userData.wheels){
      const roll=t*(c.userData.speed||.025)*95;
      for(const w of c.userData.wheels){
        // Wheel groups rotate as one piece so tyre + rim + hub stay aligned.
        w.rotation.z=-roll;
      }
    }
  }

  // Cyclists: slower than cars.
  for(const c of cyclists){
    const min=c.userData.routeMin??-.40;
    const max=c.userData.routeMax??.40;
    const u=(t*c.userData.speed+(c.userData.offset||0))%1;
    c.position.x=THREE.MathUtils.lerp(min,max,u);
    c.position.y=c.userData.baseY??.057;
    c.rotation.y=Math.sin(t*.45+c.userData.offset)*.015;
  }

  // Wind turbines.
  for(const r of turbines)r.rotation.z=-t*.88;

  // River sparkles.
  for(const g of waterGlints){
    g.position.z+=.00075;
    if(g.position.z>.50)g.position.z=-.50;
    g.material.opacity=.22+.30*Math.sin(t*2.0+g.userData.phase);
  }

  // Waterfall streaks run downward and loop.
  for(const s of waterfallStreams){
    const base=s.userData.baseY||.11;
    const u=(t*s.userData.speed+s.userData.phase*.08)%1;
    s.position.y=base-u*.060;
    s.material.opacity=.18+(1-u)*.55;
  }

  // User-placed solutions stay alive.
  for(const obj of animated){
    if(obj.userData.animType==='water-saver'){
      obj.rotation.y=Math.sin(t*1.30+obj.userData.phase)*.030;
    }else if(obj.userData.animType==='waste-station'){
      obj.rotation.y=Math.sin(t*.85+obj.userData.phase)*.015;
    }else if(obj.userData.animType==='solar'){
      obj.rotation.z=Math.sin(t*.68+obj.userData.phase)*.0035;
    }else if(obj.userData.animType==='efficiency'){
      obj.rotation.y=Math.sin(t*.9+obj.userData.phase)*.010;
    }else if(obj.userData.animType==='community'){
      obj.position.y=(obj.userData.baseY??obj.position.y)+Math.sin(t*1.5+obj.userData.phase)*.0008;
    }else if(obj.userData.animType==='plan'||obj.userData.animType==='building'){
      obj.rotation.y=Math.sin(t*.55+obj.userData.phase)*.004;
    }
  }
}

async function startCameraOnce(){
  if(running)return;
  if(preview)stopPreview();

  // Every fresh scan starts at the physical marker-fit scale. Pinch zoom still
  // works normally after the first lock.
  userScale=INITIAL_USER_SCALE;

  hasEverTracked=false;
  trackingPoseReady=false;
  renderPoseReady=false;
  trackingFound=false;
  trackingEventFound=false;
  lastSeenAt=0;
  pendingJumpFrames=0;
  trackingLastRenderTime=performance.now();

  stickyRoot.visible=false;
  world.rotation.set(userPitch,userYaw,0);
  world.scale.setScalar(userScale);

  loadingEl?.classList.add('show');

  try{
    /*
      CAMERA FIRST.
      Permission dialog + camera preview must never depend on AprilTag WASM.
    */
    if(!window.isSecureContext){
      const err=new Error('Camera requires HTTPS or localhost');
      err.name='SecurityError';
      throw err;
    }

    if(!navigator.mediaDevices?.getUserMedia){
      const err=new Error('getUserMedia is not available');
      err.name='NotSupportedError';
      throw err;
    }

    if(statusText)statusText.textContent='Meminta izin kamera…';

    cleanupCamera();
    createCameraVideo();
    cameraStream=await requestCameraStream();
    cameraVideo.srcObject=cameraStream;

    await cameraVideo.play();
    await waitForFirstVideoFrame(cameraVideo,PLATFORM_ANDROID?6500:4000);

    if(!cameraVideo.videoWidth || !cameraVideo.videoHeight){
      const err=new Error('Camera opened but no video frames arrived');
      err.name='NotReadableError';
      throw err;
    }

    interactionHost?.classList.add('camera-live');

    // The camera is the native video element. The healthy main WebGL context
    // is used only as a transparent AR layer above it.
    androidCompositeActive=false;
    if(androidCameraTexture){
      try{androidCameraTexture.dispose()}catch(_){}
      androidCameraTexture=null;
    }
    scene.background=null;
    setImportant(cameraVideo,'opacity','1');
    setImportant(cameraVideo,'visibility','visible');
    setImportant(cameraVideo,'display','block');
    setImportant(cameraVideo,'z-index','1');
    setImportant(renderer.domElement,'display','block');
    setImportant(renderer.domElement,'visibility','visible');
    setImportant(renderer.domElement,'opacity',PLATFORM_ANDROID?'0':'1');
    setImportant(renderer.domElement,'z-index','2');
    setImportant(renderer.domElement,'background','transparent');
    setImportant(renderer.domElement,'mix-blend-mode','normal');

    running=true;
    lastLiveRenderAt=0;

    renderer.setAnimationLoop((now=performance.now())=>{
      if(ANDROID_OPTIMIZED_MODE&&now-lastLiveRenderAt<ANDROID_RENDER_INTERVAL_MS)return;
      lastLiveRenderAt=now;
      updateTrackingRender();
      animate();
      renderLiveFrame();
    });

    requestAnimationFrame(detectionLoop);

    loadingEl?.classList.remove('show');
    if(statusText)statusText.textContent='Kamera aktif · menyiapkan tampilan AR…';

    /*
      Detector starts AFTER camera is already visible.
      If WASM/CDN fails, camera remains active and the user receives a precise
      status instead of a dead "camera belum aktif" screen.
    */
    try{
      await initAprilTagWorker();

      if(!running)return;

      updateDetectionGeometry();

      if(statusText)statusText.textContent='Kamera aktif · arahkan ke gambar AR';
      window.dispatchEvent(new CustomEvent('climate-ar-detector-ready',{detail:{ready:true}}));
    }catch(detectorError){
      console.error('AprilTag detector init failed:',detectorError);

      if(running && statusText){
        statusText.textContent='Kamera aktif · engine tracking gagal dimuat';
      }

      window.dispatchEvent(new CustomEvent('climate-ar-detector-ready',{
        detail:{ready:false,error:String(detectorError?.message||detectorError)}
      }));

      // Camera stays open deliberately.
    }

  }catch(error){
    running=false;
    cleanupCamera();
    loadingEl?.classList.remove('show');
    interactionHost?.classList.remove('camera-live');

    if(statusText){
      if(error?.name==='NotAllowedError'){
        statusText.textContent='Izin kamera ditolak';
      }else if(error?.name==='NotFoundError'){
        statusText.textContent='Kamera tidak ditemukan';
      }else if(error?.name==='NotReadableError'){
        statusText.textContent='Kamera sedang digunakan aplikasi lain';
      }else if(error?.name==='SecurityError'){
        statusText.textContent='Kamera memerlukan HTTPS';
      }else{
        statusText.textContent='Kamera gagal dibuka';
      }
    }

    console.error('Climate AR V13.1 camera start error:',error);
    throw error;
  }
}

function start(){
  if(running)return Promise.resolve();
  if(cameraStartPromise)return cameraStartPromise;
  cameraStartPromise=startCameraOnce().finally(()=>{
    cameraStartPromise=null;
  });
  return cameraStartPromise;
}

async function stop(){
  if(!running){
    cleanupCamera();
    return;
  }

  running=false;
  renderer?.setAnimationLoop(null);
  cleanupCamera();

  detectorBusy=false;
  trackingFound=false;
  trackingPoseReady=false;
  renderPoseReady=false;
  stickyRoot.visible=false;

  setTrackingEvent(false);
  interactionHost?.classList.remove('camera-live');
  statusWrap?.classList.remove('found');
  if(statusText)statusText.textContent='Kamera belum aktif';
}
function makePaperTexture(){
  const c=document.createElement('canvas');c.width=768;c.height=480;const x=c.getContext('2d');
  x.fillStyle='#f7f0df';x.fillRect(0,0,c.width,c.height);x.fillStyle='#164a3a';x.roundRect(20,18,728,64,20);x.fill();x.fillStyle='#fff';x.font='bold 28px system-ui';x.fillText('CLIMATE AR V14.2 REALISTIC STAGE-1 BOARD',42,60);
  x.fillStyle='#1497c7';x.roundRect(96,115,576,310,25);x.fill();x.fillStyle='#ffea45';x.roundRect(140,195,210,130,18);x.fill();x.fillStyle='#1c1c1c';x.font='bold 92px system-ui';x.fillText('AR',390,310);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}
async function startPreview(){
  if(running)await stop();
  if(preview)return;
  preview=true;
  container.classList.add('preview-mode');
  interactionHost?.classList.add('preview-live','tracking-locked');

  previewScene=new THREE.Scene();
  previewScene.background=new THREE.Color(previewBackgroundColor(currentStage));
  updateStageAtmosphere(currentStage);
  addLighting(previewScene);

  previewCamera=new THREE.PerspectiveCamera(42,container.clientWidth/container.clientHeight,.01,25);
  previewCamera.position.set(2.15,1.48,2.30);
  previewCamera.lookAt(0,.13,0);

  previewRenderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  configureRenderer(previewRenderer);
  previewRenderer.setSize(container.clientWidth,container.clientHeight);
  container.appendChild(previewRenderer.domElement);

  const table=mesh(new THREE.PlaneGeometry(6.2,4.5),std(0xb78e65),[0,-.12,0],[-Math.PI/2,0,0]);
  table.receiveShadow=true;
  previewScene.add(table);

  // Preview the diorama directly on the table. The scan image is intentionally
  // not recreated as a 3D mesh; Android/iOS tracking uses the camera feed below.

  stickyRoot.position.set(0,0,0);
  stickyRoot.quaternion.identity();
  stickyRoot.scale.set(1,1,1);
  stickyRoot.visible=true;
  previewScene.add(stickyRoot);

  world.rotation.set(userPitch,userYaw,0);
  world.scale.setScalar(userScale);

  revealed=false;
  playPaperReveal();

  lastPreviewRenderAt=0;
  const loop=now=>{
    if(!preview)return;
    requestAnimationFrame(loop);
    if(ANDROID_OPTIMIZED_MODE&&now-lastPreviewRenderAt<ANDROID_RENDER_INTERVAL_MS)return;
    lastPreviewRenderAt=now;
    animate();
    refreshAndroidShadows(previewRenderer,now);
    previewRenderer.render(previewScene,previewCamera);
  };
  requestAnimationFrame(loop);

  statusWrap?.classList.add('found');
  if(statusText)statusText.textContent='Preview meja · diorama diperbesar · putar 360°';
}
function stopPreview(){
  if(!preview)return;
  preview=false;
  container.classList.remove('preview-mode');
  interactionHost?.classList.remove('preview-live','tracking-locked');
  previewRenderer?.dispose();
  previewRenderer?.domElement?.remove();
  previewRenderer=null;
  previewScene=null;

  if(scene){
    scene.add(stickyRoot);
    stickyRoot.scale.setScalar(TRACKING_WORLD_SCALE);
    stickyRoot.visible=false;
  }

  world.rotation.set(userPitch,userYaw,0);
  world.scale.setScalar(userScale);
  statusWrap?.classList.remove('found');
}

function collectTransitionMaterials(root){
  const seen=new Set();
  const list=[];
  root.traverse(o=>{
    if(!o.material)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const m of mats){
      if(!m||seen.has(m))continue;
      seen.add(m);
      list.push({
        material:m,
        opacity:m.opacity,
        transparent:m.transparent
      });
    }
  });
  return list;
}

function playStageExit(){
  const items=world.children.filter(o=>o!==placedGroup);
  const mats=collectTransitionMaterials(world);

  return new Promise(resolve=>{
    const start=performance.now();
    const duration=260;

    const tick=now=>{
      const t=clamp((now-start)/duration,0,1);
      const e=THREE.MathUtils.smootherstep(t,0,1);

      for(const item of items){
        if(item.name==='terrainBase'||item.name==='terrainSoil'||item.name==='terrainRim')continue;
        item.position.y-=.00010*(1-e);
      }

      for(const state of mats){
        state.material.transparent=true;
        state.material.opacity=state.opacity*THREE.MathUtils.lerp(1,.28,e);
      }

      if(t<1)requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function stageEntranceStyle(obj,index){
  const name=obj.name||'';
  let delay=80+index*12;
  let duration=520;
  let mode='pop';

  if(name==='mountainBackdrop'){delay=0;duration=820;mode='rise'}
  else if(name==='terrainSurface'||name==='terrainSoil'||name==='terrainRim'||name==='terrainBase'){
    delay=0;duration=460;mode='base'
  }
  else if(name==='riverBed'||name==='riverSurface'||name==='waterfall'){
    delay=160;duration=720;mode='water'
  }
  else if(name==='roadDeck'||name==='riverBridge'){
    delay=130;duration=520;mode='road'
  }
  else if(name==='house'){delay=210+index*18;duration=560;mode='pop'}
  else if(name==='tree'||name==='bush'||name==='grass'||name==='flowerPatch'){
    delay=260+(index%9)*28;duration=620;mode='grow'
  }
  else if(name==='factory'){delay=260;duration=690;mode='rise'}
  else if(name==='vehicle'||name==='human'||name==='livingProp'){
    delay=420+(index%7)*25;duration=440;mode='pop'
  }
  else if(name==='birds'||name==='turbine'){
    delay=520;duration=560;mode='pop'
  }

  return{delay,duration,mode};
}

function playStageEntrance(){
  const entries=[];

  world.children.forEach((obj,index)=>{
    if(obj===placedGroup)return;

    const style=stageEntranceStyle(obj,index);
    const baseScale=obj.scale.clone();
    const basePos=obj.position.clone();
    const mats=collectTransitionMaterials(obj);

    entries.push({obj,baseScale,basePos,mats,...style});

    for(const m of mats){
      m.material.transparent=true;
      m.material.opacity=0;
    }

    if(style.mode==='base'){
      obj.scale.set(baseScale.x,Math.max(.05,baseScale.y*.35),baseScale.z);
      obj.position.y=basePos.y-.012;
    }else if(style.mode==='road'){
      obj.scale.set(Math.max(.05,baseScale.x*.18),baseScale.y,baseScale.z);
    }else if(style.mode==='water'){
      obj.scale.set(Math.max(.05,baseScale.x*.28),baseScale.y,baseScale.z);
    }else if(style.mode==='rise'){
      obj.scale.set(baseScale.x,Math.max(.03,baseScale.y*.25),baseScale.z);
      obj.position.y=basePos.y-.040;
    }else if(style.mode==='grow'){
      obj.scale.set(baseScale.x*.08,baseScale.y*.02,baseScale.z*.08);
      obj.position.y=basePos.y-.012;
    }else{
      obj.scale.copy(baseScale).multiplyScalar(.06);
      obj.position.y=basePos.y-.015;
    }
  });

  return new Promise(resolve=>{
    const started=performance.now();
    const total=1050;

    const tick=now=>{
      const elapsed=now-started;

      for(const e of entries){
        const t=clamp((elapsed-e.delay)/e.duration,0,1);
        const eased=THREE.MathUtils.smootherstep(t,0,1);
        const spring=eased+Math.sin(eased*Math.PI*2.2)*(1-eased)*.055;

        if(e.mode==='base'||e.mode==='rise'){
          e.obj.scale.set(
            e.baseScale.x,
            THREE.MathUtils.lerp(
              e.mode==='base'?e.baseScale.y*.35:e.baseScale.y*.25,
              e.baseScale.y,
              clamp(spring,0,1.04)
            ),
            e.baseScale.z
          );
          e.obj.position.y=THREE.MathUtils.lerp(
            e.mode==='base'?e.basePos.y-.012:e.basePos.y-.040,
            e.basePos.y,
            eased
          );
        }else if(e.mode==='road'||e.mode==='water'){
          const startX=e.mode==='road'?e.baseScale.x*.18:e.baseScale.x*.28;
          e.obj.scale.set(
            THREE.MathUtils.lerp(startX,e.baseScale.x,eased),
            e.baseScale.y,
            e.baseScale.z
          );
        }else if(e.mode==='grow'){
          e.obj.scale.set(
            THREE.MathUtils.lerp(e.baseScale.x*.08,e.baseScale.x,eased),
            THREE.MathUtils.lerp(e.baseScale.y*.02,e.baseScale.y,clamp(spring,0,1.04)),
            THREE.MathUtils.lerp(e.baseScale.z*.08,e.baseScale.z,eased)
          );
          e.obj.position.y=THREE.MathUtils.lerp(e.basePos.y-.012,e.basePos.y,eased);
        }else{
          const s=THREE.MathUtils.lerp(.06,1,clamp(spring,0,1.04));
          e.obj.scale.set(e.baseScale.x*s,e.baseScale.y*s,e.baseScale.z*s);
          e.obj.position.y=THREE.MathUtils.lerp(e.basePos.y-.015,e.basePos.y,eased);
        }

        for(const m of e.mats){
          m.material.opacity=THREE.MathUtils.lerp(0,m.opacity,eased);
        }
      }

      if(elapsed<total){
        requestAnimationFrame(tick);
      }else{
        for(const e of entries){
          e.obj.scale.copy(e.baseScale);
          e.obj.position.copy(e.basePos);
          for(const m of e.mats){
            m.material.opacity=m.opacity;
            m.material.transparent=m.transparent;
          }
        }
        resolve();
      }
    };

    requestAnimationFrame(tick);
  });
}

async function setStage(i){
  const nextStage=clamp(i,0,4);
  if(nextStage===currentStage)return;

  // Keep tracking, anchor pose, zoom and user rotation completely untouched.
  thawWorldMatrices();
  await playStageExit();

  currentStage=nextStage;
  buildStage(currentStage);
  updateStageAtmosphere(currentStage);

  world.rotation.set(userPitch,userYaw,0);
  world.scale.setScalar(userScale);
  stageBackdrop?.scale.setScalar(userScale);

  await playStageEntrance();
  freezeStaticWorldMatrices();
}
function activeCamera(){return preview?previewCamera:arCamera}
function activeScene(){return preview?previewScene:scene}
function pointerToNDC(x,y){const rect=container.getBoundingClientRect();pointerNDC.x=((x-rect.left)/rect.width)*2-1;pointerNDC.y=-((y-rect.top)/rect.height)*2+1;return pointerNDC}
function raycastTerrain(x,y){
  if(!terrainMesh||(!preview&&!running))return null;const cam=activeCamera();if(!cam)return null;activeScene()?.updateMatrixWorld(true);raycaster.setFromCamera(pointerToNDC(x,y),cam);const hit=raycaster.intersectObject(terrainMesh,false)[0];if(!hit)return null;return world.worldToLocal(hit.point.clone());
}
function raycastPlaced(x,y){
  if(currentStage!==3||!placedGroup.children.length)return null;const cam=activeCamera();activeScene()?.updateMatrixWorld(true);raycaster.setFromCamera(pointerToNDC(x,y),cam);
  const hit=raycaster.intersectObjects(placedGroup.children,true)[0];if(!hit)return null;let o=hit.object;while(o&&o.parent&&o.parent!==placedGroup&&!o.userData?.draggable)o=o.parent;if(o?.userData?.draggable)return o;if(o?.parent?.userData?.draggable)return o.parent;return null;
}
function placementRule(type,p,existing=null){
  if(!p)return{valid:false,reason:'Arahkan ke permukaan diorama'};

  // Delapan atribut Kota Hijau semuanya diletakkan di daratan/jalan,
  // bukan di dalam sungai.
  if(Math.abs(p.x)<.11&&p.z<.27){
    return{valid:false,reason:'Jangan ditempatkan di sungai'};
  }

  const roofs=HOUSE_LAYOUT.map(h=>({x:h.x,z:h.z,y:h.roofY}));
  const radius={
    plan:.12,tree:.105,efficiency:.085,solar:.09,waste:.11,
    building:.13,ev:.11,community:.12
  }[type]||.10;

  const overlapsPlaced=placedGroup.children.some(
    o=>o!==existing&&Math.hypot(p.x-o.position.x,p.z-o.position.z)<radius
  );
  if(overlapsPlaced)return{valid:false,reason:'Beri jarak antar aset agar tidak saling menembus'};

  if(type==='plan'){
    if(Math.abs(p.x)>.70||Math.abs(p.z)>.40)return{valid:false,reason:'Tempatkan rencana kota di dalam area diorama'};
    if(Math.abs(p.z-ROAD_Z)<ROAD_HALF_DEPTH+.045)return{valid:false,reason:'Jangan letakkan masterplan di atas jalan'};
    return{valid:true,snap:new THREE.Vector3(p.x,p.y+.016,p.z)};
  }

  if(type==='tree'){
    if(Math.abs(p.x)>.72||Math.abs(p.z)>.43)return{valid:false,reason:'Pilih area hijau di dalam diorama'};
    if(roofs.some(r=>Math.hypot(p.x-r.x,p.z-r.z)<.12))return{valid:false,reason:'Ruang hijau tidak ditempatkan di atas rumah'};
    if(Math.abs(p.z-ROAD_Z)<ROAD_HALF_DEPTH+.055)return{valid:false,reason:'Jangan tanam pohon di jalan'};
    return{valid:true,snap:new THREE.Vector3(p.x,p.y+.012,p.z)};
  }

  if(type==='efficiency'){
    const nearHouse=roofs.some(r=>Math.hypot(p.x-r.x,p.z-r.z)<.22);
    const nearRoad=Math.abs(p.z-ROAD_Z)<ROAD_HALF_DEPTH+.13;
    if(!nearHouse&&!nearRoad)return{valid:false,reason:'Tempatkan efisiensi energi dekat bangunan atau koridor jalan'};
    return{valid:true,snap:new THREE.Vector3(p.x,p.y+.015,p.z)};
  }

  if(type==='solar'){
    const roof=roofs.find(r=>Math.hypot(p.x-r.x,p.z-r.z)<.10);
    if(roof)return{valid:true,roof,snap:new THREE.Vector3(roof.x,roof.y,roof.z)};
    if(Math.abs(p.x)>.70||Math.abs(p.z)>.42)return{valid:false,reason:'Pilih lahan atau atap di dalam diorama'};
    if(p.x>.38&&p.z>.08)return{valid:false,reason:'Jangan pasang pengelolaan energi di area pabrik aktif'};
    return{valid:true,snap:new THREE.Vector3(p.x,p.y+.022,p.z)};
  }

  if(type==='waste'){
    if(Math.abs(p.x)>.70||Math.abs(p.z)>.42)return{valid:false,reason:'Tempatkan fasilitas 3R di dalam diorama'};
    if(Math.abs(p.z-ROAD_Z)<ROAD_HALF_DEPTH+.025)return{valid:false,reason:'Jangan letakkan fasilitas 3R di tengah jalan'};
    return{valid:true,snap:new THREE.Vector3(p.x,p.y+.018,p.z)};
  }

  if(type==='building'){
    if(Math.abs(p.x)>.67||Math.abs(p.z)>.39)return{valid:false,reason:'Tempatkan bangunan hemat energi di area permukiman'};
    if(Math.abs(p.z-ROAD_Z)<ROAD_HALF_DEPTH+.085)return{valid:false,reason:'Bangunan tidak boleh menutup jalan'};
    if(roofs.some(r=>Math.hypot(p.x-r.x,p.z-r.z)<.15))return{valid:false,reason:'Beri jarak dari bangunan yang sudah ada'};
    return{valid:true,snap:new THREE.Vector3(p.x,p.y+.012,p.z)};
  }

  if(type==='ev'){
    if(Math.abs(p.z-ROAD_Z)>ROAD_HALF_DEPTH+.035)return{valid:false,reason:'Tempatkan transportasi berkelanjutan di jalan'};
    const laneZ=p.z<ROAD_Z?ROAD_Z-.040:ROAD_Z+.040;
    return{valid:true,snap:new THREE.Vector3(clamp(p.x,ROAD_X_MIN+.07,ROAD_X_MAX-.07),.056,laneZ)};
  }

  if(type==='community'){
    const nearHouse=roofs.some(r=>Math.hypot(p.x-r.x,p.z-r.z)<.27);
    if(!nearHouse)return{valid:false,reason:'Tempatkan komunitas hijau dekat kawasan permukiman'};
    if(Math.abs(p.z-ROAD_Z)<ROAD_HALF_DEPTH+.04)return{valid:false,reason:'Komunitas tidak ditempatkan di badan jalan'};
    return{valid:true,snap:new THREE.Vector3(p.x,p.y+.015,p.z)};
  }

  return{valid:false,reason:'Jenis atribut Kota Hijau belum dikenali'};
}

function buildPlacementObject(type,pos,rule={}){
  let obj=null;
  if(type==='plan')obj=buildPlacedPlan(pos);
  else if(type==='tree')obj=buildPlacedTree(pos);
  else if(type==='efficiency')obj=buildPlacedEfficiency(pos);
  else if(type==='solar')obj=buildPlacedSolar(pos,rule.roof);
  else if(type==='waste')obj=buildPlacedWaste(pos);
  else if(type==='building')obj=buildPlacedBuilding(pos);
  else if(type==='ev')obj=buildPlacedEV(pos);
  else if(type==='community')obj=buildPlacedCommunity(pos);
  return obj;
}

function setDragPreviewStyle(obj,preview=true,valid=true){
  if(!obj)return;
  obj.traverse?.(node=>{
    if(!node.material)return;
    const mats=Array.isArray(node.material)?node.material:[node.material];
    for(const mat of mats){
      if(mat.userData.__origOpacity===undefined){
        mat.userData.__origOpacity=mat.opacity ?? 1;
        mat.userData.__origTransparent=Boolean(mat.transparent);
        if('emissive' in mat)mat.userData.__origEmissive=mat.emissive.getHex();
      }

      if(preview){
        mat.transparent=true;
        mat.opacity=valid ? .86 : .48;
        if('emissive' in mat){
          mat.emissive.setHex(valid ? 0x0f321c : 0x4d130d);
          mat.emissiveIntensity=valid ? .10 : .20;
        }
      }else{
        mat.opacity=mat.userData.__origOpacity ?? 1;
        mat.transparent=mat.userData.__origTransparent ?? false;
        if('emissive' in mat && mat.userData.__origEmissive!==undefined){
          mat.emissive.setHex(mat.userData.__origEmissive);
          mat.emissiveIntensity=0;
        }
      }
      mat.needsUpdate=true;
    }
  });
}

function removeDragPreview(){
  if(!dragPreviewObject)return;
  dragPreviewObject.removeFromParent();
  dragPreviewObject=null;
}

function incrementRecoveryFor(type){
  if(type==='plan')recoveryState.plan++;
  else if(type==='tree')recoveryState.trees++;
  else if(type==='efficiency')recoveryState.efficiency++;
  else if(type==='solar')recoveryState.solar++;
  else if(type==='waste')recoveryState.waste++;
  else if(type==='building')recoveryState.building++;
  else if(type==='ev')recoveryState.ev++;
  else if(type==='community')recoveryState.community++;
}

function updateRecovery(){
  const {
    plan,trees,efficiency,solar,waste,building,ev,community
  }=recoveryState;

  const indicators={
    planning:plan>=1,
    greenSpace:trees>=1,
    efficientConsumption:efficiency>=1,
    efficientEnergyManagement:solar>=1,
    waste3R:waste>=1,
    efficientBuilding:building>=1,
    sustainableTransport:ev>=1,
    greenCommunity:community>=1
  };

  const indicatorCount=Object.values(indicators).filter(Boolean).length;
  const recovery=Math.round(indicatorCount/8*100);

  // Stage 4 starts around 86% emission. Each fulfilled attribute lowers
  // the visual environmental pressure until the recovered stage reaches ~22%.
  const emission=clamp(86-indicatorCount*8,22,86);
  const ready=indicatorCount===8;

  recoveryState={
    plan,trees,efficiency,solar,waste,building,ev,community,
    indicators,indicatorCount,recovery,emission,ready
  };

  window.dispatchEvent(new CustomEvent('climate-ar-placement',{detail:{...recoveryState}}));

  if(ready&&!recoveryReadyFired){
    recoveryReadyFired=true;
    window.dispatchEvent(new CustomEvent('climate-ar-recovery-ready',{detail:{...recoveryState}}));
  }
}


function placeNew(type,p,rule){
  const obj=buildPlacementObject(type,rule.snap||p,rule);
  if(!obj)return null;
  setDragPreviewStyle(obj,false,true);
  if(placedGroup.parent!==world)world.add(placedGroup);
  obj.visible=true;
  placedGroup.add(obj);
  activatePlacedObjectAnimation(obj);
  incrementRecoveryFor(type);
  updateRecovery();
  freezeStaticWorldMatrices();
  return obj;
}
function setObjectPosition(o,p,rule){
  const target=rule?.snap||p;
  if(!o||!target)return;
  o.position.copy(target);
  if(o.userData.type==='solar'&&rule?.roof)o.position.y=rule.roof.y;
  if(o.matrixAutoUpdate===false)o.updateMatrix();
}
function resetRecovery(){
  removeDragPreview();
  dragPlacement=null;
  while(placedGroup.children.length)placedGroup.remove(placedGroup.children[0]);
  recoveryReadyFired=false;
  recoveryState={plan:0,trees:0,efficiency:0,solar:0,waste:0,building:0,ev:0,community:0,indicatorCount:0,recovery:0,emission:86,ready:false};
  updateRecovery();
  freezeStaticWorldMatrices();
}
function showDragGhost(type,x,y,valid=null,reason=''){
  if(!dragGhost)return;dragGhost.hidden=false;dragGhost.style.left=`${x}px`;dragGhost.style.top=`${y}px`;dragGhost.className=`drag-ghost asset-drag-ghost ${valid===true?'valid':valid===false?'invalid':''}`;
  if(toolImages[type])dragGhost.style.backgroundImage=`url(${toolImages[type]})`;
  if(placementFeedback){placementFeedback.hidden=false;placementFeedback.textContent=valid===false?reason:(valid===true?'Lepaskan untuk menempatkan':'Drag model 3D ke diorama');placementFeedback.className=`placement-feedback ${valid===true?'valid':valid===false?'invalid':''}`}
}
function hideDragGhost(){if(dragGhost)dragGhost.hidden=true;if(placementFeedback)placementFeedback.hidden=true}
function beginPlacement(type,e,existing=null){
  if(currentStage!==3)return;

  manualOrbit=true;
  removeDragPreview();

  dragPlacement={
    type,
    existing,
    last:null,
    rule:null,
    startPosition:existing ? existing.position.clone() : null
  };

  if(!existing){
    // Langsung buat model 3D preview nyata.
    dragPreviewObject=buildPlacementObject(type,new THREE.Vector3(0,.12,0),{});
    if(dragPreviewObject){
      dragPreviewObject.userData.__isDragPreview=true;
      dragPreviewObject.visible=false;
      setDragPreviewStyle(dragPreviewObject,true,true);
      world.add(dragPreviewObject);
    }
  }else{
    setDragPreviewStyle(existing,true,true);
  }

  showDragGhost(type,e.clientX,e.clientY);
}

function updatePlacement(e){
  if(!dragPlacement)return;

  const p=raycastTerrain(e.clientX,e.clientY);

  if(!p){
    dragPlacement.last=null;
    dragPlacement.rule={valid:false,reason:'Arahkan ke permukaan diorama'};
    if(dragPreviewObject)dragPreviewObject.visible=false;
    showDragGhost(
      dragPlacement.type,
      e.clientX,
      e.clientY,
      false,
      'Arahkan ke permukaan diorama'
    );
    return;
  }

  const rule=placementRule(
    dragPlacement.type,
    p,
    dragPlacement.existing || dragPreviewObject
  );

  dragPlacement.last=p;
  dragPlacement.rule=rule;

  // Object 3D mengikuti pointer secara langsung.
  const target=rule.valid
    ? (rule.snap||p)
    : new THREE.Vector3(p.x,p.y+.035,p.z);

  if(dragPreviewObject){
    dragPreviewObject.visible=true;
    dragPreviewObject.position.copy(target);
    setDragPreviewStyle(dragPreviewObject,true,rule.valid);
  }

  if(dragPlacement.existing){
    if(rule.valid)setObjectPosition(dragPlacement.existing,p,rule);
    setDragPreviewStyle(dragPlacement.existing,true,rule.valid);
  }

  showDragGhost(
    dragPlacement.type,
    e.clientX,
    e.clientY,
    rule.valid,
    rule.reason
  );
}

function finishPlacement(){
  if(!dragPlacement)return;

  const {type,existing,last,rule,startPosition}=dragPlacement;

  if(rule?.valid&&last){
    if(existing){
      setObjectPosition(existing,last,rule);
      setDragPreviewStyle(existing,false,true);
      window.showClimateToast?.('Posisi aset 3D diperbarui.');
    }else if(dragPreviewObject){
      // Model preview yang bergerak menjadi model final.
      dragPreviewObject.removeFromParent();
      dragPreviewObject.userData.__isDragPreview=false;
      dragPreviewObject.visible=true;

      setObjectPosition(dragPreviewObject,last,rule);
      setDragPreviewStyle(dragPreviewObject,false,true);

      // Pastikan placedGroup memang aktif di world.
      if(placedGroup.parent!==world)world.add(placedGroup);
      placedGroup.add(dragPreviewObject);

      // Langsung aktifkan animasi setelah object dilepas.
      activatePlacedObjectAnimation(dragPreviewObject);

      incrementRecoveryFor(type);
      updateRecovery();

      const labels={
        plan:'Perencanaan kota ramah lingkungan terpenuhi.',
        tree:'Ketersediaan ruang terbuka hijau terpenuhi.',
        efficiency:'Konsumsi energi efisien terpenuhi.',
        solar:'Pengelolaan energi efisien terpenuhi.',
        waste:'Pengelolaan limbah 3R terpenuhi.',
        building:'Bangunan hemat energi terpenuhi.',
        ev:'Transportasi berkelanjutan terpenuhi.',
        community:'Peran masyarakat sebagai komunitas hijau terpenuhi.'
      };
      window.showClimateToast?.(labels[type]||'Solusi berhasil ditempatkan.');
      dragPreviewObject=null;
    }else{
      placeNew(type,last,rule);
    }
  }else{
    if(existing&&startPosition){
      existing.position.copy(startPosition);
      setDragPreviewStyle(existing,false,true);
    }
    if(rule?.reason)window.showClimateToast?.(rule.reason);
    removeDragPreview();
  }

  dragPlacement=null;
  hideDragGhost();
  freezeStaticWorldMatrices();
}

function onPointerDown(e){
  if(e.target.closest?.('.hotspot,.ar-status,.stage-chip,.live-flow-hud,.immersive-close'))return;if(!preview&&!running)return;
  if(currentStage===3){const placed=raycastPlaced(e.clientX,e.clientY);if(placed){e.preventDefault();beginPlacement(placed.userData.type,e,placed);return}}
  manualOrbit=true;activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(activePointers.size===1){gestureMode='rotate';gestureStart={x:e.clientX,y:e.clientY,yaw:userYaw,pitch:userPitch}}
  else if(activePointers.size===2){const pts=[...activePointers.values()];gestureMode='pinch';gestureStart={dist:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),scale:userScale}}
}
function onPointerMove(e){
  if(dragPlacement)return
  if(!activePointers.has(e.pointerId))return;activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(activePointers.size===1&&gestureMode==='rotate'){
    /*
      V14 SINGLE ANCHOR:
      One-finger horizontal drag rotates the CONTENT around the fixed tag center.
      stickyRoot remains controlled only by the tag pose, so the AR never
      translates away from the marker while the user looks left/right.
    */
    const p=[...activePointers.values()][0];
    userYaw=gestureStart.yaw+(p.x-gestureStart.x)*.008;
    userPitch=0;
    world.rotation.set(0,userYaw,0);
  }
  else if(activePointers.size>=2){const pts=[...activePointers.values()].slice(0,2),dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);if(gestureMode!=='pinch'){gestureMode='pinch';gestureStart={dist,scale:userScale}}userScale=clamp(
      gestureStart.scale*(dist/Math.max(1,gestureStart.dist)),
      USER_ZOOM_MIN,
      USER_ZOOM_MAX
    );
    world.scale.setScalar(userScale);
    stageBackdrop?.scale.setScalar(userScale)}
}
function onPointerUp(e){if(dragPlacement)return;activePointers.delete(e.pointerId);if(activePointers.size===0){gestureMode=null;gestureStart=null}else if(activePointers.size===1){const p=[...activePointers.values()][0];gestureMode='rotate';gestureStart={x:p.x,y:p.y,yaw:userYaw,pitch:userPitch}}}
interactionHost?.addEventListener('pointerdown',onPointerDown,{passive:false});
interactionHost?.addEventListener('pointermove',onPointerMove,{passive:false});
interactionHost?.addEventListener('pointerup',onPointerUp,{passive:false});
interactionHost?.addEventListener('pointercancel',onPointerUp,{passive:false});

// Aset berada DI LUAR arStage, jadi listener harus langsung dipasang ke kartu aset.
document.querySelectorAll('.asset-drag-handle').forEach(tool=>{
  tool.addEventListener('pointerdown',e=>{
    if(currentStage!==3)return;
    e.stopPropagation();

    // On touchscreens, wait for the user's direction before deciding. A
    // vertical gesture belongs to the scrollable tool rail; a horizontal
    // pull toward the diorama starts placement. Mouse drag stays immediate.
    if(e.pointerType==='touch'){
      pendingToolGesture={
        pointerId:e.pointerId,
        type:tool.dataset.place,
        startX:e.clientX,
        startY:e.clientY
      };
      return;
    }

    e.preventDefault();
    beginPlacement(tool.dataset.place,e);
  },{passive:false});
});

// Pointer tetap dipantau walau jari/mouse berpindah dari rak aset ke viewport AR.
window.addEventListener('pointermove',e=>{
  if(pendingToolGesture?.pointerId===e.pointerId){
    const dx=e.clientX-pendingToolGesture.startX;
    const dy=e.clientY-pendingToolGesture.startY;
    const ax=Math.abs(dx);
    const ay=Math.abs(dy);

    // Let Chrome handle vertical panning natively. Clearing this pending
    // gesture also prevents a scroll from accidentally placing an object.
    if(ay>=7&&ay>ax*1.08){
      pendingToolGesture=null;
      return;
    }

    // The rail is on the left, so placement naturally starts with a pull to
    // the right. A small threshold avoids turning taps/jitter into a drag.
    if(dx>=9&&ax>=ay*.86){
      const type=pendingToolGesture.type;
      pendingToolGesture=null;
      e.preventDefault();
      beginPlacement(type,e);
      updatePlacement(e);
      return;
    }
  }

  if(!dragPlacement)return;
  e.preventDefault();
  updatePlacement(e);
},{passive:false});

window.addEventListener('pointerup',e=>{
  if(pendingToolGesture?.pointerId===e.pointerId)pendingToolGesture=null;
  if(!dragPlacement)return;
  e.preventDefault();
  finishPlacement();
},{passive:false});

window.addEventListener('pointercancel',e=>{
  if(pendingToolGesture?.pointerId===e.pointerId)pendingToolGesture=null;
  if(!dragPlacement)return;
  if(dragPlacement.existing&&dragPlacement.startPosition){
    dragPlacement.existing.position.copy(dragPlacement.startPosition);
    setDragPreviewStyle(dragPlacement.existing,false,true);
  }
  removeDragPreview();
  dragPlacement=null;
  hideDragGhost();
});
function resizePreview(){
  const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);

  if(previewRenderer&&previewCamera){
    previewRenderer.setSize(w,h);
    previewCamera.aspect=w/h;
    previewCamera.updateProjectionMatrix();
  }

  if(renderer&&!preview){
    renderer.setSize(w,h);
    if(running&&cameraVideo?.videoWidth){
      updateDetectionGeometry();
      resizeAndroidCPUCompositor();
    }
  }
}
let resizeFrameRequest=0;
function scheduleResponsiveResize(){
  cancelAnimationFrame(resizeFrameRequest);
  resizeFrameRequest=requestAnimationFrame(resizePreview);
}
window.addEventListener('resize',scheduleResponsiveResize,{passive:true});
window.addEventListener('orientationchange',scheduleResponsiveResize,{passive:true});
window.visualViewport?.addEventListener('resize',scheduleResponsiveResize,{passive:true});
if('ResizeObserver' in window){
  new ResizeObserver(scheduleResponsiveResize).observe(interactionHost);
}

function renderTool(canvas,type,r,sourceCanvas){
  if(!canvas||!r||!sourceCanvas)return;
  r.setSize(canvas.width,canvas.height,false);
  const sc=new THREE.Scene(),c=new THREE.PerspectiveCamera(32,1,.01,10);c.position.set(.58,.42,.72);c.lookAt(0,.09,0);
  sc.add(new THREE.HemisphereLight(0xffffff,0x597060,2.4));
  const dl=new THREE.DirectionalLight(0xfff0cf,3.1);dl.position.set(-1,2,1);sc.add(dl);
  const floor=mesh(new THREE.CircleGeometry(.18,32),new THREE.MeshStandardMaterial({color:0xe6efe6,roughness:1}),[0,-.004,0],[-Math.PI/2,0,0]);floor.castShadow=false;sc.add(floor);
  let obj=null;
  if(type==='plan')obj=buildGreenPlanModel(1.10);
  else if(type==='tree'){
    // A pair of smaller trees reads as public green space and stays fully
    // inside the thumbnail. The former single tall tree clipped its canopy.
    obj=new THREE.Group();
    const treeA=buildTree(.062,true,false);
    const treeB=buildTree(.052,true,true);
    treeA.position.set(-.045,0,.012);
    treeB.position.set(.055,0,-.018);
    obj.add(treeA,treeB);
  }
  else if(type==='efficiency')obj=buildEnergyEfficiencyModel(1.10);
  else if(type==='solar')obj=buildSolarModel(1.35);
  else if(type==='waste')obj=buildWasteStation(1.18);
  else if(type==='building')obj=buildEcoBuildingModel(1.12);
  else if(type==='ev')obj=buildCleanEV(1.12);
  else if(type==='community')obj=buildCommunityGreenModel(1.05);
  if(!obj)return;
  sc.add(obj);obj.rotation.y=-.55;
  r.render(sc,c);
  const ctx=canvas.getContext('2d');
  if(ctx){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(sourceCanvas,0,0,canvas.width,canvas.height);
    toolImages[type]=canvas.toDataURL('image/png');
  }
}
function initToolPreviews(){
  const tools=[
    ['planToolCanvas','plan'],
    ['treeToolCanvas','tree'],
    ['efficiencyToolCanvas','efficiency'],
    ['solarToolCanvas','solar'],
    ['wasteToolCanvas','waste'],
    ['buildingToolCanvas','building'],
    ['evToolCanvas','ev'],
    ['communityToolCanvas','community']
  ];
  /*
    IMPORTANT: use ONE temporary WebGL context for all eight thumbnails.
    The old code created eight permanent contexts plus the AR and preview
    contexts. Android then evicted the oldest context (the main AR renderer),
    producing a white/black AR canvas and a broken first attribute thumbnail.
  */
  const sourceCanvas=document.createElement('canvas');
  sourceCanvas.width=180;
  sourceCanvas.height=180;
  const thumbnailRenderer=new THREE.WebGLRenderer({
    canvas:sourceCanvas,
    antialias:true,
    alpha:true,
    preserveDrawingBuffer:true,
    powerPreference:'low-power'
  });
  thumbnailRenderer.setPixelRatio(1);
  thumbnailRenderer.outputColorSpace=THREE.SRGBColorSpace;
  thumbnailRenderer.toneMapping=THREE.ACESFilmicToneMapping;
  thumbnailRenderer.toneMappingExposure=1.18;
  thumbnailRenderer.setClearColor(0x000000,0);

  // Thumbnail builders reuse the real model factories, some of which register
  // animation objects globally. Preserve the live stage registries so detached
  // thumbnail objects are not updated forever during AR rendering.
  const animationRegistries=[
    animated,smokePuffs,movingCars,turbines,waterGlints,swayObjects,
    ambientActors,birdFlocks,waterfallStreams,cyclists,foliageSwayObjects,
    riverSurfaces,livingProps
  ];
  const registryLengths=animationRegistries.map(list=>list.length);

  tools.forEach(([id,type])=>renderTool(
    document.querySelector('#'+id),
    type,
    thumbnailRenderer,
    sourceCanvas
  ));

  animationRegistries.forEach((list,index)=>{
    list.length=registryLengths[index];
  });

  thumbnailRenderer.dispose();
  thumbnailRenderer.forceContextLoss();
}

initAR();
window.RealisticAR={start,stop,startPreview,stopPreview,setStage,resetRecovery,get recoveryState(){return{...recoveryState}},get running(){return running},get starting(){return Boolean(cameraStartPromise)},get preview(){return preview},quality:QUALITY};
window.dispatchEvent(new CustomEvent('realistic-ar-ready'));
