(function(){const a=document.createElement("link").relList;if(a&&a.supports&&a.supports("modulepreload"))return;for(const r of document.querySelectorAll('link[rel="modulepreload"]'))l(r);new MutationObserver(r=>{for(const s of r)if(s.type==="childList")for(const u of s.addedNodes)u.tagName==="LINK"&&u.rel==="modulepreload"&&l(u)}).observe(document,{childList:!0,subtree:!0});function i(r){const s={};return r.integrity&&(s.integrity=r.integrity),r.referrerPolicy&&(s.referrerPolicy=r.referrerPolicy),r.crossOrigin==="use-credentials"?s.credentials="include":r.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function l(r){if(r.ep)return;r.ep=!0;const s=i(r);fetch(r.href,s)}})();const ie="http://localhost:8000";class W extends Error{statusCode;details;constructor(a,i,l){super(a),this.name="DataClientError",this.statusCode=i,this.details=l}}function me(t){return{Historical:"historical",SSP245:"ssp245",SSP585:"ssp585"}[t]||t.toLowerCase()}function be(t){return t<=16?"low":t<=19?"medium":"high"}function fe(t,a,i="float32"){const l=atob(t),r=new Uint8Array(l.length);for(let s=0;s<l.length;s++)r[s]=l.charCodeAt(s);if(i.includes("float32"))return new Float32Array(r.buffer);if(i.includes("float64"))return new Float64Array(r.buffer);throw new Error(`Unsupported dtype: ${i}`)}function ve(t,a){const i=t.flat(),l=new Float32Array(i.length);for(let r=0;r<i.length;r++)l[r]=i[r];return l}async function he(t,a){const l=`${ie}/data`;try{const r=await fetch(l,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...t,scenario:t.scenario?me(t.scenario):void 0,data_format:t.data_format||"base64"})});if(!r.ok){const s=await r.json().catch(()=>({detail:r.statusText}));throw new W(s.detail||`HTTP ${r.status}: ${r.statusText}`,r.status,s)}return await r.json()}catch(r){throw r instanceof W?r:new W(`Failed to fetch data: ${r instanceof Error?r.message:String(r)}`,void 0,r)}}function ye(t){return!t.data||t.data_encoding==="none"?null:t.data_encoding==="base64"&&typeof t.data=="string"?fe(t.data,t.shape,t.dtype):t.data_encoding==="list"&&Array.isArray(t.data)?ve(t.data,t.shape):null}function xe(t){return{variable:t.variable,time:t.date,model:t.model,scenario:t.scenario,resolution:be(t.resolution),data_format:t.dataFormat||"base64"}}async function $e(t){const i=`${ie}/health`;try{return(await fetch(i,{method:"GET",signal:AbortSignal.timeout(5e3)})).ok}catch{return!1}}const H=["Historical","SSP245","SSP585"],T=["ACCESS-CM2","CanESM5","CESM2","CMCC-CM2-SR5","EC-Earth3","GFDL-ESM4","INM-CM5-0","IPSL-CM6A-LR","MIROC6","MPI-ESM1-2-HR","MRI-ESM2-0"],Y=["tas","pr","rsds","hurs","rlds","sfcWind","tasmin","tasmax"],Z=[{name:"Viridis",colors:["#440154","#3b528b","#21908d","#5dc863","#fde725"]},{name:"Magma",colors:["#000004","#3b0f70","#8c2981","#de4968","#fe9f6d"]},{name:"Cividis",colors:["#00204c","#31456a","#6b6d7f","#a59c8f","#fdea9b"]},{name:"Thermal",colors:["#04142f","#155570","#1fa187","#f8c932","#f16623"]}],n={page:{position:"relative",minHeight:"100vh",color:"white",overflow:"hidden",fontFamily:"Inter, system-ui, sans-serif"},bgLayer1:{position:"absolute",inset:0,background:"linear-gradient(135deg, #05070f, #0b1326)"},bgLayer2:{position:"absolute",inset:0,background:"radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 32%), radial-gradient(circle at 80% 10%, rgba(139,92,246,0.15), transparent 30%), radial-gradient(circle at 50% 70%, rgba(34,197,94,0.08), transparent 28%)"},bgOverlay:{position:"absolute",inset:0,background:"#050505",opacity:.35},topBar:{position:"fixed",top:12,left:16,right:380,zIndex:3,display:"flex",alignItems:"center",gap:8,padding:"0 2px",background:"transparent",border:"none",boxShadow:"none",backdropFilter:"none",overflowX:"auto",overflowY:"visible",whiteSpace:"nowrap"},field:{minWidth:0,display:"flex",flexDirection:"column",gap:4},fieldLabel:{fontSize:11,letterSpacing:.5,color:"rgba(255,255,255,0.72)",textTransform:"uppercase"},mapArea:{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,textAlign:"center",pointerEvents:"none",zIndex:1},canvasToggle:{position:"fixed",top:14,display:"flex",alignItems:"center",gap:8,pointerEvents:"auto",zIndex:100,transition:"right 0.25s ease"},canvasSwitch:{position:"relative",display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,padding:3,borderRadius:11,background:"rgba(9,11,16,0.9)",border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 10px 26px rgba(0,0,0,0.45)",zIndex:101},canvasIndicator:{position:"absolute",top:3,bottom:3,left:3,width:"calc(50% - 3px)",borderRadius:9,background:"linear-gradient(135deg, rgba(125,211,252,0.2), rgba(167,139,250,0.2))",boxShadow:"0 8px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",transition:"transform 180ms ease",zIndex:0,pointerEvents:"none"},canvasBtn:{width:40,height:40,borderRadius:9,border:"1px solid transparent",background:"transparent",color:"rgba(255,255,255,0.82)",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"color 120ms ease",position:"relative",zIndex:1},canvasBtnActive:{color:"white"},mapTitle:{fontSize:18,fontWeight:600},mapSubtitle:{fontSize:14,color:"rgba(255,255,255,0.75)"},sidebar:{position:"fixed",top:0,right:0,bottom:0,width:320,transition:"transform 0.25s ease, box-shadow 0.2s ease",zIndex:1,background:"rgba(9,11,16,0.88)",borderLeft:"1px solid rgba(255,255,255,0.08)",boxShadow:"-10px 0 35px rgba(0,0,0,0.55)",backdropFilter:"blur(20px)",overflow:"hidden",display:"flex",flexDirection:"column"},sidebarTop:{display:"flex",alignItems:"center",justifyContent:"flex-start",padding:"16px 16px 46px",gap:10,borderBottom:"1px solid rgba(255,255,255,0.08)",background:"linear-gradient(135deg, rgba(125,211,252,0.08), rgba(167,139,250,0.06))",position:"relative",overflow:"hidden"},logoDot:{width:16,height:16,background:"linear-gradient(135deg, #7dd3fc, #a78bfa, #22c55e)",borderRadius:"50%",boxShadow:"0 0 0 4px rgba(125,211,252,0.08)"},toggle:{width:44,height:44,padding:0,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.16)",background:"rgba(18,22,28,0.85)",boxShadow:"0 14px 40px rgba(0,0,0,0.5)",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:14,lineHeight:1,transition:"right 0.25s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease"},sidebarContent:{padding:"28px 14px 14px",display:"flex",flexDirection:"column",gap:12,overflow:"hidden",flex:1,position:"relative"},tabViewport:{overflow:"hidden",width:"100%",position:"relative",flex:1,display:"flex",flexDirection:"column"},tabTrack:{display:"grid",gridTemplateColumns:"1fr 1fr",width:"200%",transition:"transform 220ms ease",flex:1},tabPane:{width:"100%",display:"flex",flexDirection:"column",gap:12,overflow:"auto",paddingRight:4},sidebarBrand:{display:"flex",alignItems:"center",gap:10},modeSwitch:{position:"relative",display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,padding:2,borderRadius:10,border:"1px solid rgba(255,255,255,0.05)",background:"rgba(255,255,255,0.02)",boxShadow:"none"},modeIndicator:{position:"absolute",top:2,bottom:2,left:2,width:"calc(50% - 2px)",borderRadius:8,background:"linear-gradient(135deg, rgba(125,211,252,0.18), rgba(167,139,250,0.16))",boxShadow:"0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",transition:"transform 200ms ease",zIndex:0},modeBtn:{flex:1,padding:"8px 0",borderRadius:8,border:"none",color:"rgba(255,255,255,0.8)",cursor:"pointer",transition:"all 0.15s ease",background:"transparent",textAlign:"center",fontSize:12.5,fontWeight:700,letterSpacing:.2,outline:"none",boxShadow:"none",position:"relative",zIndex:1},modeBtnActive:{background:"linear-gradient(135deg, rgba(125,211,252,0.22), rgba(167,139,250,0.2))",border:"none",color:"white",boxShadow:"0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)"},tabSwitch:{position:"absolute",left:32,right:12,bottom:-8,display:"flex",gap:10,padding:"0 8px",alignItems:"flex-end",pointerEvents:"auto",zIndex:0},tabBtn:{borderRadius:"14px 14px 0 0",padding:"12px 18px",background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.78)",fontWeight:700,fontSize:13,letterSpacing:.35,cursor:"pointer",transition:"all 0.18s ease",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 18px rgba(0,0,0,0.32)",borderTop:"1px solid rgba(255,255,255,0.12)",borderRight:"1px solid rgba(255,255,255,0.12)",borderLeft:"1px solid rgba(255,255,255,0.12)",borderBottom:"none",transform:"translateY(4px)"},tabBtnActive:{background:"linear-gradient(135deg, rgba(125,211,252,0.32), rgba(167,139,250,0.28))",color:"white",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.12), 0 12px 26px rgba(0,0,0,0.42)",borderTop:"1px solid rgba(125,211,252,0.6)",borderRight:"1px solid rgba(125,211,252,0.6)",borderLeft:"1px solid rgba(125,211,252,0.6)",borderBottom:"none",transform:"translateY(-4px)",zIndex:1},modeViewport:{overflow:"hidden",width:"100%",position:"relative"},modeTrack:{display:"grid",gridTemplateColumns:"1fr 1fr",width:"200%",transition:"transform 220ms ease"},modePane:{width:"100%",paddingRight:4},chatBox:{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(15,18,25,0.96)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 20px rgba(0,0,0,0.38)"},chatInput:{flex:1,padding:"12px 0",borderRadius:8,border:"none",background:"transparent",color:"white",fontSize:14,lineHeight:1.4,outline:"none",minHeight:24},chatSend:{padding:"10px 14px",borderRadius:12,border:"1px solid rgba(125,211,252,0.5)",background:"linear-gradient(135deg, rgba(125,211,252,0.22), rgba(167,139,250,0.2))",color:"white",fontWeight:700,fontSize:14,letterSpacing:.1,cursor:"pointer",boxShadow:"0 10px 22px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)",transition:"transform 120ms ease, box-shadow 120ms ease"},chatStack:{display:"flex",flexDirection:"column",gap:12},chatLead:{fontSize:13,color:"rgba(255,255,255,0.78)",lineHeight:1.45,marginTop:10},chatMessages:{display:"flex",flexDirection:"column",gap:10,padding:"4px 0 6px"},chatBubble:{maxWidth:"100%",width:"fit-content",padding:"16px 16px",borderRadius:12,fontSize:13,lineHeight:1.4,boxShadow:"0 6px 14px rgba(0,0,0,0.3)"},chatBubbleUser:{alignSelf:"flex-end",background:"linear-gradient(135deg, rgba(125,211,252,0.25), rgba(167,139,250,0.25))",border:"1px solid rgba(125,211,252,0.45)",color:"white"},chatBubbleAgent:{alignSelf:"flex-start",background:"rgba(20,24,31,0.95)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.9)"},sectionTitle:{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.9)",letterSpacing:.3,textTransform:"uppercase"},paramGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10},range:{width:"100%",background:"transparent",appearance:"none",WebkitAppearance:"none",height:10,outline:"none",padding:0,margin:0},resolutionRow:{display:"flex",alignItems:"center",gap:12},resolutionValue:{fontSize:12.5,color:"rgba(255,255,255,0.78)",minWidth:60,textAlign:"right"},toggleIcon:{fontSize:16,lineHeight:1}},L=360,e={mode:"Explore",panelTab:"Manual",sidebarOpen:!0,canvasView:"map",scenario:H[0],model:T[0],variable:Y[0],date:"2000-01-01",palette:Z[0].name,resolution:18,chatInput:"",chatMessages:[],compareMode:"Scenarios",compareModelA:T[0],compareModelB:T[1]??T[0],compareDateStart:"2000-01-01",compareDateEnd:"2000-12-31",isLoading:!1,dataError:null,currentData:null,apiAvailable:null};let U=null,I=null,b=1,z=0,x=0,P=!1,Q=0,ee=0,te=0,ae=0,S=null;function we(t){return t.replace(/[A-Z]/g,a=>`-${a.toLowerCase()}`)}function o(t){return Object.entries(t).filter(([,a])=>a!=null).map(([a,i])=>{const l=a.startsWith("--")?a:we(a),r=typeof i=="number"?`${i}px`:String(i);return`${l}:${r}`}).join(";")}function $(...t){return t.reduce((a,i)=>i?{...a,...i}:a,{})}async function Se(){try{const t=await $e();e.apiAvailable=t}catch{e.apiAvailable=!1}}async function q(){if(!(e.canvasView!=="map"||e.mode!=="Explore")){e.isLoading=!0,e.dataError=null;try{const t=xe({variable:e.variable,date:e.date,model:e.model,scenario:e.scenario,resolution:e.resolution}),a=await he(t);if(e.currentData=a,e.isLoading=!1,w(),S){const i=S.querySelector("#map-canvas");if(i){I=i,se(i);const l=i.getBoundingClientRect();if(l&&a.shape){const[r,s]=a.shape,u=l.width/s,y=l.height/r;b=Math.min(u,y),z=0,x=0}j(a)}}}catch(t){t instanceof W&&t.statusCode?e.dataError=t.message:e.dataError=t instanceof Error?t.message:String(t),e.isLoading=!1,e.currentData=null,w()}}}function se(t){t.addEventListener("wheel",a=>{a.preventDefault();const i=t.getBoundingClientRect(),l=a.clientX-i.left,r=a.clientY-i.top,s=a.deltaY>0?.9:1.1,u=b*s;if(e.currentData){const[y,k]=e.currentData.shape,B=i.width/k,D=i.height/y,M=Math.min(B,D);if(u>=M&&u<=5){const d=(l+z)/b,c=(r+x)/b;b=u,z=d*b-l,x=c*b-r,j(e.currentData)}}},{passive:!1}),t.addEventListener("mousedown",a=>{a.button===0&&(P=!0,Q=a.clientX,ee=a.clientY,te=z,ae=x,t.style.cursor="grabbing")}),t.addEventListener("mousemove",a=>{if(P&&e.currentData){const i=a.clientX-Q,l=a.clientY-ee;z=te-i,x=ae-l;const[r,s]=e.currentData.shape,u=t.getBoundingClientRect(),y=r*b,k=u.width/s,B=u.height/r,D=Math.min(k,B);if(!(Math.abs(b-D)<.001)&&y>u.height){const O=y-u.height;x=Math.max(0,Math.min(x,O))}j(e.currentData)}}),t.addEventListener("mouseup",()=>{P&&(P=!1,t.style.cursor="grab")}),t.addEventListener("mouseleave",()=>{P&&(P=!1,t.style.cursor="grab")}),t.style.cursor="grab"}async function j(t){if(!I)return;const a=ye(t);if(!a){console.warn("No data to render");return}const i=I.getContext("2d");if(!i)return;const[l,r]=t.shape,s=I.getBoundingClientRect();I.width=s.width*window.devicePixelRatio,I.height=s.height*window.devicePixelRatio,i.scale(window.devicePixelRatio,window.devicePixelRatio),i.clearRect(0,0,s.width,s.height),i.save();const u=s.width,y=s.height,k=u/r,B=y/l,D=Math.min(k,B);b<D&&(b=D);const M=l*b;if(Math.abs(b-D)<.001)M<y?x=(y-M)/2:x=0;else{const h=Math.max(0,M-y);x=Math.max(0,Math.min(x,h))}let d=1/0,c=-1/0;for(let h=0;h<a.length;h++){const C=a[h];isFinite(C)&&(d=Math.min(d,C),c=Math.max(c,C))}const v=(Z.find(h=>h.name===e.palette)||Z[0]).colors;i.translate(0,-x),i.scale(b,b);const E=(z%(r*b)+r*b)%(r*b),m=-E/b,V=Math.ceil((E+u)/(r*b))+1,A=-1;for(let h=A;h<A+V;h++){i.save(),i.translate(h*r+m,0);for(let C=0;C<l;C++)for(let F=0;F<r;F++){const le=(l-1-C)*r+F,G=a[le];if(!isFinite(G))continue;const J=(G-d)/(c-d),K=Math.floor(J*(v.length-1)),de=v[Math.min(K,v.length-1)],ce=v[Math.min(K+1,v.length-1)],N=J*(v.length-1)-K,R=oe(de),_=oe(ce),pe=Math.round(R.r+(_.r-R.r)*N),ue=Math.round(R.g+(_.g-R.g)*N),ge=Math.round(R.b+(_.b-R.b)*N);i.fillStyle=`rgb(${pe}, ${ue}, ${ge})`,i.fillRect(F,C,1,1)}i.restore()}i.restore()}function oe(t){const a=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(t);return a?{r:parseInt(a[1],16),g:parseInt(a[2],16),b:parseInt(a[3],16)}:{r:0,g:0,b:0}}function w(){if(!S)return;const t=(e.resolution-15)/6*100,a=$(n.sidebar,{width:L,transform:e.sidebarOpen?"translateX(0)":`translateX(${L+24}px)`,pointerEvents:e.sidebarOpen?"auto":"none"}),i=$(n.toggle,{right:e.sidebarOpen?L+10:14,background:e.sidebarOpen?"linear-gradient(135deg, rgba(125,211,252,0.2), rgba(167,139,250,0.18))":"rgba(18,22,28,0.85)",borderColor:"rgba(255,255,255,0.16)",color:"white"}),l=e.mode==="Explore"?"translateX(0%)":"translateX(-50%)",r=e.mode==="Explore"?"translateX(0%)":"translateX(100%)",s=e.canvasView==="map"?"translateX(0%)":"translateX(100%)",u=e.panelTab==="Manual"?"translateX(0%)":"translateX(-50%)";S.innerHTML=`
    <div style="${o(n.page)}">
      <div style="${o(n.bgLayer1)}"></div>
      <div style="${o(n.bgLayer2)}"></div>
      <div style="${o(n.bgOverlay)}"></div>

      <div style="${o(n.mapArea)}">
        ${e.canvasView==="map"?`
              <canvas
                id="map-canvas"
                style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: auto;"
              ></canvas>
              ${e.isLoading?`<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.7); z-index: 10;">
                      <div style="text-align: center;">
                        <div style="${o(n.mapTitle)}">Loading climate data...</div>
                        <div style="${o(n.mapSubtitle)}">Fetching data from API</div>
                      </div>
                    </div>`:""}
              ${e.dataError?`<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); z-index: 10;">
                      <div style="text-align: center; max-width: 600px; padding: 20px;">
                        <div style="${o(n.mapTitle)}">Error loading data</div>
                        <div style="${o(n.mapSubtitle)}">${e.dataError}</div>
                        ${e.apiAvailable===!1?`<div style="${o($(n.mapSubtitle,{marginTop:12,fontSize:12}))}">
                                Make sure the Python API server is running. Check the terminal for connection details.
                              </div>`:""}
                      </div>
                    </div>`:""}
              ${!e.isLoading&&!e.dataError&&!e.currentData?`<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); z-index: 5;">
                      <div style="text-align: center;">
                        <div style="${o(n.mapTitle)}">No data loaded</div>
                        <div style="${o(n.mapSubtitle)}">
                          Adjust parameters to load climate data
                        </div>
                      </div>
                    </div>`:""}
            `:`<div style="text-align: center;">
                <div style="${o(n.mapTitle)}">Chart placeholder</div>
                <div style="${o(n.mapSubtitle)}">Chart view coming soon. Visualizations will render here.</div>
              </div>`}
      </div>

      <div style="${o(n.topBar)}">
        ${g("Scenario",f("scenario",H,e.scenario))}
        ${g("Model",f("model",T,e.model))}
        ${g("Date",X("date",e.date))}
        ${g("Variable",f("variable",Y,e.variable))}
      </div>

      <aside data-role="sidebar" style="${o(a)}" aria-hidden="${!e.sidebarOpen}">
        <div style="${o(n.sidebarTop)}">
          <div style="${o(n.sidebarBrand)}">
            <div style="${o(n.logoDot)}"></div>
          </div>
          <div style="${o(n.tabSwitch)}">
            ${["Manual","Chat"].map(y=>Me(y,e.panelTab===y?n.tabBtnActive:void 0,"panel-tab")).join("")}
          </div>
        </div>

        <div style="${o(n.sidebarContent)}">
          <div style="${o(n.tabViewport)}">
            <div data-role="tab-track" style="${o({...n.tabTrack,transform:u})}">
              <div style="${o(n.tabPane)}">
                ${Ee({modeTransform:l,resolutionFill:t,modeIndicatorTransform:r})}
              </div>
              <div style="${o(n.tabPane)}">
                ${Te()}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div data-role="canvas-toggle" style="${o({...n.canvasToggle,right:e.sidebarOpen?L+24:24})}">
        <div style="${o(n.canvasSwitch)}">
          <div data-role="canvas-indicator" style="${o({...n.canvasIndicator,transform:s})}"></div>
          <button
            type="button"
            aria-label="Show map canvas"
            data-action="set-canvas"
            data-value="map"
            style="${o($(n.canvasBtn,e.canvasView==="map"?n.canvasBtnActive:void 0))}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M4 6.5 9 4l6 2.5L20 4v14l-5 2.5L9 18 4 20.5V6.5Z" />
              <path d="m9 4v14m6-11.5v14" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Show chart canvas"
            data-action="set-canvas"
            data-value="chart"
            style="${o($(n.canvasBtn,e.canvasView==="chart"?n.canvasBtnActive:void 0))}"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 18h16" />
              <path d="M6 18 11 9l4 5 3-6" />
              <circle cx="6" cy="18" r="1.2" />
              <circle cx="11" cy="9" r="1.2" />
              <circle cx="15" cy="14" r="1.2" />
              <circle cx="18" cy="8" r="1.2" />
            </svg>
          </button>
        </div>
      </div>

      <button
        type="button"
        aria-label="${e.sidebarOpen?"Collapse sidebar":"Expand sidebar"}"
        data-action="toggle-sidebar"
        style="${o($(i,{position:"fixed",top:"50%",transform:"translateY(-50%)",zIndex:12}))}"
      >
        <span style="${o(n.toggleIcon)}">${e.sidebarOpen?"›":"‹"}</span>
      </button>
    </div>
  `,Ie(),I=S.querySelector("#map-canvas"),I&&(se(I),e.currentData&&!e.isLoading&&!e.dataError&&j(e.currentData))}function g(t,a){return`
    <div style="${o(n.field)}">
      <div style="${o(n.fieldLabel)}">${t}</div>
      ${a}
    </div>
  `}function X(t,a,i){const l=i?.type??"date",r=i?.dataKey??t;return`
    <input
      type="${l}"
      value="${a}"
      data-action="update-input"
      data-key="${r}"
    />
  `}function f(t,a,i,l){const r=l?.dataKey??t,s=l?.disabled?"disabled":"";return`
    <select data-action="update-select" data-key="${r}" ${s}>
      ${a.map(u=>`
            <option value="${u}" ${u===i?"selected":""}>
              ${u}
            </option>
          `).join("")}
    </select>
  `}function Me(t,a,i="panel-tab"){return`
    <button
      type="button"
      data-action="set-tab"
      data-key="${i}"
      data-value="${t}"
      style="${o($(n.tabBtn,a))}"
    >
      ${t}
    </button>
  `}function Ee(t){const{modeTransform:a,resolutionFill:i,modeIndicatorTransform:l}=t,r=e.compareMode==="Models"?[g("Scenario",f("scenario",H,e.scenario)),g("Date",X("date",e.date))]:e.compareMode==="Dates"?[g("Scenario",f("scenario",H,e.scenario)),g("Model",f("model",T,e.model))]:[g("Model",f("model",T,e.model)),g("Date",X("date",e.date))];return`
    <div style="${o(n.modeSwitch)}">
      <div data-role="mode-indicator" style="${o({...n.modeIndicator,transform:l})}"></div>
      ${["Explore","Compare"].map(s=>`
            <button
              type="button"
              class="mode-btn"
              data-action="set-mode"
              data-value="${s}"
              style="${o($(n.modeBtn,e.mode===s?n.modeBtnActive:void 0))}"
            >
              ${s}
            </button>
          `).join("")}
    </div>

    <div style="${o(n.modeViewport)}">
      <div data-role="mode-track" style="${o({...n.modeTrack,transform:a})}">
        <div style="${o(n.modePane)}">
          <div style="${o({display:"flex",flexDirection:"column",gap:8})}">
            <div style="${o(n.sectionTitle)}">Parameters</div>
            <div style="${o(n.paramGrid)}">
              ${g("Scenario",f("scenario",H,e.scenario))}
              ${g("Model",f("model",T,e.model))}
              ${g("Date",X("date",e.date))}
              ${g("Variable",f("variable",Y,e.variable))}
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${o({display:"flex",flexDirection:"column",gap:8})}">
              <div style="${o(n.sectionTitle)}">Color palette</div>
              ${g("Palette",f("palette",Z.map(s=>s.name),e.palette,{dataKey:"palette"}))}
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${o({display:"flex",flexDirection:"column",gap:8})}">
              <div style="${o(n.sectionTitle)}">Resolution</div>
              <div style="${o(n.resolutionRow)}">
                <input
                  type="range"
                  min="15"
                  max="21"
                  step="1"
                  value="${e.resolution}"
                  data-action="set-resolution"
                  class="resolution-slider"
                  style="${o($(n.range,{"--slider-fill":`${i}%`}))}"
                />
                <div data-role="resolution-value" style="${o(n.resolutionValue)}">${e.resolution}</div>
              </div>
            </div>
          </div>
        </div>

        <div style="${o(n.modePane)}">
          <div style="${o({display:"flex",flexDirection:"column",gap:14})}">
            <div style="${o({display:"flex",flexDirection:"column",gap:8})}">
              <div style="${o(n.sectionTitle)}">Compare</div>
              <div style="${o(n.paramGrid)}">
                ${g("What do you want to compare?",f("compareMode",["Scenarios","Models","Dates"],e.compareMode,{dataKey:"compareMode"}))}
              </div>

              ${e.compareMode==="Scenarios"?`
                      <div style="${o(n.paramGrid)}">
                        ${g("Scenario A",f("compareScenarioA",["SSP245"],"SSP245",{disabled:!0}))}
                        ${g("Scenario B",f("compareScenarioB",["SSP585"],"SSP585",{disabled:!0}))}
                      </div>
                    `:""}

              ${e.compareMode==="Models"?`
                      <div style="${o(n.paramGrid)}">
                        ${g("Model A",f("compareModelA",T,e.compareModelA,{dataKey:"compareModelA"}))}
                        ${g("Model B",f("compareModelB",T,e.compareModelB,{dataKey:"compareModelB"}))}
                      </div>
                    `:""}

              ${e.compareMode==="Dates"?`
                      <div style="${o(n.paramGrid)}">
                        ${g("Start date",X("compareDateStart",e.compareDateStart,{dataKey:"compareDateStart"}))}
                        ${g("End date",X("compareDateEnd",e.compareDateEnd,{dataKey:"compareDateEnd"}))}
  </div>
`:""}

              <div style="${o(n.paramGrid)}">
                ${r.join("")}
                ${g("Variable",f("variable",Y,e.variable))}
              </div>

              <div style="margin-top:14px">
                <div style="${o({display:"flex",flexDirection:"column",gap:8})}">
                  <div style="${o(n.sectionTitle)}">Color palette</div>
                  ${g("Palette",f("palette",Z.map(s=>s.name),e.palette,{dataKey:"palette"}))}
                </div>
              </div>

              <div style="margin-top:14px">
                <div style="${o({display:"flex",flexDirection:"column",gap:8})}">
                  <div style="${o(n.sectionTitle)}">Resolution</div>
                  <div style="${o(n.resolutionRow)}">
                    <input
                      type="range"
                      min="15"
                      max="21"
                      step="1"
                      value="${e.resolution}"
                      data-action="set-resolution"
                      class="resolution-slider"
                      style="${o($(n.range,{"--slider-fill":`${i}%`}))}"
                    />
                    <div data-role="resolution-value" style="${o(n.resolutionValue)}">${e.resolution}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `}function Te(){return`
    <div style="${o({display:"flex",flexDirection:"column",gap:8})}">
      <div style="${o(n.sectionTitle)}">Chat</div>
      <div style="${o(n.chatStack)}">
        <div style="${o(n.chatLead)}">Discuss the data with an agent, or ask questions.</div>

        <div style="${o(n.chatMessages)}">
          ${e.chatMessages.map(t=>{const a=t.sender==="user"?$(n.chatBubble,n.chatBubbleUser):$(n.chatBubble,n.chatBubbleAgent);return`<div style="${o(a)}">${t.text}</div>`}).join("")}
        </div>

        <div style="${o(n.chatBox)}">
          <input
            type="text"
            value="${e.chatInput}"
            data-action="chat-input"
            style="${o(n.chatInput)}"
            placeholder="Ask a question"
          />
          <button type="button" data-action="chat-send" aria-label="Send chat message" style="${o(n.chatSend)}">
            ➤
          </button>
        </div>
      </div>
    </div>
  `}function Ie(t){if(!S)return;const a=S,i=a.querySelector('[data-action="toggle-sidebar"]');i?.addEventListener("click",()=>{const d=a.querySelector('[data-role="sidebar"]'),c=a.querySelector('[data-role="canvas-toggle"]');if(!d||!c||!i)return;const p=!e.sidebarOpen;e.sidebarOpen=p;const v=p?"translateX(0)":`translateX(${L+24}px)`;d.style.transform=v,d.style.pointerEvents=p?"auto":"none",d.setAttribute("aria-hidden",String(!p));const E=p?`${L+10}px`:"14px";i.style.right=E,i.setAttribute("aria-label",p?"Collapse sidebar":"Expand sidebar");const m=i.querySelector("span");m&&(m.textContent=p?"›":"‹");const V=p?L+24:24;c.style.right=`${V}px`}),a.querySelectorAll('[data-action="set-canvas"]').forEach(d=>d.addEventListener("click",()=>{const c=d.dataset.value;if(c){if(c===e.canvasView)return;const v=e.canvasView==="map"?"translateX(0%)":"translateX(100%)",E=c==="map"?"translateX(0%)":"translateX(100%)";e.canvasView=c,w(),c==="map"&&q();const m=a.querySelector('[data-role="canvas-indicator"]');if(!m)return;m.style.removeProperty("transition"),m.style.transform=v,m.offsetHeight,m.getBoundingClientRect(),requestAnimationFrame(()=>{m.style.transition="transform 180ms ease",m.style.transform=E})}})),a.querySelectorAll('[data-action="set-mode"]').forEach(d=>d.addEventListener("click",()=>{const c=d.dataset.value;if(c){if(c===e.mode)return;const p=e.mode,v=p==="Explore"?"translateX(0%)":"translateX(-50%)",E=p==="Explore"?"translateX(0%)":"translateX(100%)",m=c==="Explore"?"translateX(0%)":"translateX(-50%)",V=c==="Explore"?"translateX(0%)":"translateX(100%)";e.mode=c,w();const A=a.querySelector('[data-role="mode-track"]'),h=a.querySelector('[data-role="mode-indicator"]');if(!A||!h)return;A.style.transition="none",h.style.transition="none",A.style.transform=v,h.style.transform=E,A.offsetHeight,A.style.transition="transform 220ms ease",h.style.transition="transform 200ms ease",A.style.transform=m,h.style.transform=V}})),a.querySelectorAll('[data-action="set-tab"]').forEach(d=>d.addEventListener("click",()=>{const c=d.dataset.value;if(c){if(c===e.panelTab)return;const v=e.panelTab==="Manual"?"translateX(0%)":"translateX(-50%)",E=c==="Manual"?"translateX(0%)":"translateX(-50%)";e.panelTab=c,w();const m=a.querySelector('[data-role="tab-track"]');if(!m)return;m.style.removeProperty("transition"),m.style.transform=v,m.offsetHeight,m.getBoundingClientRect(),requestAnimationFrame(()=>{m.style.transition="transform 220ms ease",m.style.transform=E})}})),a.querySelectorAll('[data-action="update-select"]').forEach(d=>d.addEventListener("change",()=>{const c=d.dataset.key,p=d.value;if(c){switch(c){case"scenario":e.scenario=p;break;case"model":e.model=p;break;case"variable":e.variable=p;break;case"palette":if(e.palette=p,w(),e.currentData&&S){const v=S.querySelector("#map-canvas");v&&(I=v,j(e.currentData))}return;case"compareMode":e.compareMode=p;break;case"compareModelA":e.compareModelA=p;break;case"compareModelB":e.compareModelB=p;break}w(),q()}})),a.querySelectorAll('[data-action="update-input"]').forEach(d=>d.addEventListener("input",()=>{const c=d.dataset.key;if(!c)return;const p=d.value;switch(c){case"date":e.date=p;break;case"compareDateStart":e.compareDateStart=p;break;case"compareDateEnd":e.compareDateEnd=p;break}w(),c==="date"&&q()}));const k=a.querySelectorAll('[data-action="set-resolution"]'),B=a.querySelectorAll('[data-role="resolution-value"]'),D=d=>{const c=(d-15)/6*100;k.forEach(p=>{p.value=String(d),p.style.setProperty("--slider-fill",`${c}%`)}),B.forEach(p=>{p.textContent=String(d)})};k.forEach(d=>d.addEventListener("input",()=>{const c=Number.parseInt(d.value,10);Number.isNaN(c)||(e.resolution=c,D(c),q())}));const M=a.querySelector('[data-action="chat-input"]'),O=a.querySelector('[data-action="chat-send"]');M?.addEventListener("input",()=>{e.chatInput=M.value}),M?.addEventListener("keydown",d=>{d.key==="Enter"&&(d.preventDefault(),ne())}),O?.addEventListener("click",ne)}function ne(){const t=e.chatInput.trim();if(!t)return;const a={id:Date.now(),sender:"user",text:t};e.chatMessages=[...e.chatMessages,a],e.chatInput="",U&&window.clearTimeout(U),U=window.setTimeout(()=>{const i={id:Date.now()+1,sender:"agent",text:"I don't work yet."};e.chatMessages=[...e.chatMessages,i],w()},1e3),w()}async function re(){if(S=document.querySelector("#app"),!S)throw new Error("Root element #app not found");w(),Se().then(()=>{w()}),e.canvasView==="map"&&e.mode==="Explore"&&q()}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",re):re();
