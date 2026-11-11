/**
 * The landing page's "Pop-Up Campus" (a low-poly school that rises out of the ground, with the school bus driving the ring road) as a
 * self-contained page for a WebView / iframe. Same procedural scene as apps/web/src/components/landing/Campus3D.tsx — keep them in step.
 * three.js is loaded from unpkg (like the map's Leaflet); if it cannot load, the page stays transparent and the app shows its logo instead
 * (the host listens for the "ready" / "fail" messages). Transparent background so the app's star sky shows behind it.
 */
const TEMPLATE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}canvas{display:block;width:100%;height:100%;touch-action:none}</style></head>
<body><script src="https://unpkg.com/three@0.158.0/build/three.min.js"></script><script>
(function(){
function say(m){try{if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(m);else if(window.parent!==window)window.parent.postMessage(m,'*');}catch(e){}}
if(!window.THREE){say('fail');return;}
var C={slate:0x23303a,paper:0xece5d3,wall:0xf1ead8,roof:0xd9831f,saffron:0xf5a524,glass:0x7fb4d6,grass:0x4f8f6b,grass2:0x3d7357,trunk:0x6b4f3a,road:0x1d2830,white:0xffffff};
var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function ease(t){var c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);}
function mat(c,x){var p={color:c,roughness:0.85,metalness:0,flatShading:true};if(x)for(var k in x)p[k]=x[k];return new THREE.MeshStandardMaterial(p);}
var renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch(e){say('fail');return;}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000,0);
document.body.appendChild(renderer.domElement);
var scene=new THREE.Scene();var camera=new THREE.PerspectiveCamera(32,1,0.1,100);
scene.add(new THREE.HemisphereLight(0xcfe3f2,0x2d3d49,0.9));
var sun=new THREE.DirectionalLight(0xfff0d0,2.1);sun.position.set(-7,11,6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-9;sun.shadow.camera.near=1;sun.shadow.camera.far=30;sun.shadow.bias=-0.0006;scene.add(sun);
var campus=new THREE.Group();scene.add(campus);var pops=[];
function stand(w,h,d,x,y,z,m,pop){var g=new THREE.BoxGeometry(w,h,d);g.translate(0,h/2,0);var o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;campus.add(o);if(pop!==false)pops.push({obj:o,delay:pops.length*70});return o;}
var ground=new THREE.Mesh(new THREE.CylinderGeometry(7.4,7.7,0.5,64),mat(C.grass));ground.position.y=-0.25;ground.receiveShadow=true;campus.add(ground);
var rim=new THREE.Mesh(new THREE.TorusGeometry(7.55,0.09,8,96),mat(C.saffron));rim.rotation.x=Math.PI/2;campus.add(rim);
var road=new THREE.Mesh(new THREE.RingGeometry(5.3,6.3,80),mat(C.road));road.rotation.x=-Math.PI/2;road.position.y=0.012;road.receiveShadow=true;campus.add(road);
var dash=new THREE.Mesh(new THREE.RingGeometry(5.78,5.82,80),mat(C.paper));dash.rotation.x=-Math.PI/2;dash.position.y=0.02;campus.add(dash);
var wallM=mat(C.wall),roofM=mat(C.roof),glassM=mat(C.glass,{roughness:0.3,emissive:0x2a4a63,emissiveIntensity:0.35});
stand(5,2.1,2.4,0,0,0,wallM);stand(2.4,1.7,2,-3.7,0,0.5,wallM);stand(2.4,1.7,2,3.7,0,0.5,wallM);
function prism(w,h,d,x,y,z){var s=new THREE.Shape();s.moveTo(-d/2-0.15,0);s.lineTo(0,h);s.lineTo(d/2+0.15,0);s.closePath();var g=new THREE.ExtrudeGeometry(s,{depth:w+0.3,bevelEnabled:false});g.translate(0,0,-(w+0.3)/2);g.rotateY(Math.PI/2);var o=new THREE.Mesh(g,roofM);o.position.set(x,y,z);o.castShadow=true;campus.add(o);pops.push({obj:o,delay:pops.length*70});}
prism(5,1.0,2.4,0,2.1,0);prism(2.4,0.8,2,-3.7,1.7,0.5);prism(2.4,0.8,2,3.7,1.7,0.5);
stand(1,3.6,1,0,2.1,-0.2,wallM);
var spire=new THREE.Mesh(new THREE.ConeGeometry(0.85,1.2,4),roofM);spire.geometry.translate(0,0.6,0);spire.rotation.y=Math.PI/4;spire.position.set(0,5.7,-0.2);spire.castShadow=true;campus.add(spire);pops.push({obj:spire,delay:pops.length*70});
var clock=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.06,24),mat(C.white));clock.rotation.x=Math.PI/2;clock.position.set(0,4.7,0.34);campus.add(clock);
var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,1.2,8),mat(0xcccccc));pole.geometry.translate(0,0.6,0);pole.position.set(0,6.8,-0.2);campus.add(pole);
var flag=new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.36,6,1),new THREE.MeshStandardMaterial({color:C.saffron,side:THREE.DoubleSide,roughness:0.9}));flag.position.set(0.3,7.7,-0.2);campus.add(flag);
var door=new THREE.Mesh(new THREE.BoxGeometry(0.7,1.2,0.08),mat(0x5a3d2b));door.position.set(0,0.6,1.22);campus.add(door);
function win(x,y,z){var w=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.55,0.06),glassM);w.position.set(x,y,z);campus.add(w);}
var SCHOOL="__SCHOOL__";
if(SCHOOL){
  // the school's own name as a banner on the front wall, above the door
  var bc=document.createElement('canvas');bc.width=1024;bc.height=200;var g2=bc.getContext('2d');
  var gr=g2.createLinearGradient(0,0,1024,0);gr.addColorStop(0,'#ffc560');gr.addColorStop(1,'#e8891a');g2.fillStyle=gr;g2.fillRect(0,0,1024,200);
  g2.strokeStyle='#7a4a0c';g2.lineWidth=10;g2.strokeRect(8,8,1008,184);
  var fs=110;g2.textAlign='center';g2.textBaseline='middle';g2.fillStyle='#1a1405';
  do{g2.font='800 '+fs+'px sans-serif';fs-=4;}while(g2.measureText(SCHOOL).width>940&&fs>28);
  g2.fillText(SCHOOL,512,104);
  var tex=new THREE.CanvasTexture(bc);if(THREE.sRGBEncoding)tex.encoding=THREE.sRGBEncoding;
  var banner=new THREE.Mesh(new THREE.PlaneGeometry(4.2,0.82),new THREE.MeshBasicMaterial({map:tex}));banner.position.set(0,1.62,1.215);campus.add(banner);
}else{[-1.8,-1.1,1.1,1.8].forEach(function(x){win(x,1.25,1.22);});}
[-4.3,-3.1,3.1,4.3].forEach(function(x){win(x,1.0,1.52);});
stand(1.4,0.15,0.6,0,0,1.55,mat(0xb9b2a0),false);
var path=new THREE.Mesh(new THREE.PlaneGeometry(1.1,3.2),mat(0xcfc7b3));path.rotation.x=-Math.PI/2;path.position.set(0,0.015,3.3);path.receiveShadow=true;campus.add(path);
function tree(x,z,s){var t=new THREE.Group();t.position.set(x,0,z);
var tr=new THREE.Mesh(new THREE.CylinderGeometry(0.09*s,0.12*s,0.7*s,6),mat(C.trunk));tr.geometry.translate(0,0.35*s,0);tr.castShadow=true;t.add(tr);
var l1=new THREE.Mesh(new THREE.ConeGeometry(0.6*s,1.1*s,7),mat(C.grass2));l1.geometry.translate(0,1.2*s,0);l1.castShadow=true;t.add(l1);
var l2=new THREE.Mesh(new THREE.ConeGeometry(0.45*s,0.9*s,7),mat(0x468a63));l2.geometry.translate(0,1.85*s,0);l2.castShadow=true;t.add(l2);
campus.add(t);pops.push({obj:t,delay:pops.length*70});}
[[-2.6,3.2,1],[2.6,3.3,1.1],[-4.8,-2.4,1.2],[4.9,-2.2,1],[-1.4,-3.2,0.9],[1.9,-3.4,1.1],[-5.6,1.4,0.9],[5.6,1.6,1]].forEach(function(a){tree(a[0],a[1],a[2]);});
var bus=new THREE.Group();
var body=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.62,0.62),mat(C.saffron));body.position.y=0.55;body.castShadow=true;bus.add(body);
var top=new THREE.Mesh(new THREE.BoxGeometry(1.35,0.1,0.58),mat(0xd9831f));top.position.y=0.9;bus.add(top);
[-0.45,0,0.45].forEach(function(x){var w=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.2,0.64),glassM);w.position.set(x,0.66,0);bus.add(w);});
[[-0.5,0.31],[0.5,0.31],[-0.5,-0.31],[0.5,-0.31]].forEach(function(p){var wh=new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.1,12),mat(0x14191e));wh.rotation.x=Math.PI/2;wh.position.set(p[0],0.17,p[1]);bus.add(wh);});
bus.visible=!reduced;campus.add(bus);
function resize(){var w=window.innerWidth||1,h=window.innerHeight||1;renderer.setSize(w,h,false);camera.aspect=w/h;var k=Math.max(1.3,1.9/camera.aspect);camera.position.set(10.5*k,8.5*k,12.5*k);camera.lookAt(0,1.6,0);camera.updateProjectionMatrix();}
window.addEventListener('resize',resize);resize();
var dragging=false,lastX=0,vel=0,yaw=-0.5;var cv=renderer.domElement;
cv.addEventListener('pointerdown',function(e){dragging=true;lastX=e.clientX;vel=0;try{cv.setPointerCapture(e.pointerId);}catch(x){}});
cv.addEventListener('pointermove',function(e){if(!dragging)return;var dx=e.clientX-lastX;lastX=e.clientX;yaw+=dx*0.008;vel=dx*0.008;});
function up(){dragging=false;}cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
var t0=performance.now()+250,announced=false,running=false,raf=0;
function draw(now){var t=now-t0;
for(var i=0;i<pops.length;i++){var p=pops[i];var k=reduced?1:Math.min(1,Math.max(0,(t-p.delay)/900));p.obj.scale.y=Math.max(0.001,ease(k));p.obj.visible=k>0||reduced;}
if(!reduced){if(!dragging){yaw+=0.0022+vel;vel*=0.94;}var a=now*0.00045;bus.position.set(Math.cos(a)*5.8,0,Math.sin(a)*5.8);bus.rotation.y=-a-Math.PI/2;
var pos=flag.geometry.attributes.position;for(var j=0;j<pos.count;j++){var x=pos.getX(j);pos.setZ(j,Math.sin(now*0.006+x*6)*0.05*(x+0.3));}pos.needsUpdate=true;}
campus.rotation.y=yaw;renderer.render(scene,camera);if(!announced){announced=true;say('ready');}}
function loop(now){if(!running)return;draw(now);raf=requestAnimationFrame(loop);}
function start(){if(reduced){draw(performance.now()+5000);return;}if(running||document.hidden)return;running=true;raf=requestAnimationFrame(loop);}
function stop(){running=false;cancelAnimationFrame(raf);}
document.addEventListener('visibilitychange',function(){document.hidden?stop():start();});
start();
})();
</script></body></html>`;

/** The page with the school's name painted on the front wall (empty name = no banner). The name is JSON-escaped, never raw HTML. */
export const campusHtml = (name?: string) =>
  // a replacer function, so "$&" or "$1" typed into a school name is never treated as a replacement pattern
  TEMPLATE.replace('"__SCHOOL__"', () => JSON.stringify((name ?? '').slice(0, 60)).replace(/</g, String.fromCharCode(92) + 'u003c'));
