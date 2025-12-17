(function(){const r=document.createElement("link").relList;if(r&&r.supports&&r.supports("modulepreload"))return;for(const l of document.querySelectorAll('link[rel="modulepreload"]'))g(l);new MutationObserver(l=>{for(const c of l)if(c.type==="childList")for(const v of c.addedNodes)v.tagName==="LINK"&&v.rel==="modulepreload"&&g(v)}).observe(document,{childList:!0,subtree:!0});function s(l){const c={};return l.integrity&&(c.integrity=l.integrity),l.referrerPolicy&&(c.referrerPolicy=l.referrerPolicy),l.crossOrigin==="use-credentials"?c.credentials="include":l.crossOrigin==="anonymous"?c.credentials="omit":c.credentials="same-origin",c}function g(l){if(l.ep)return;l.ep=!0;const c=s(l);fetch(l.href,c)}})();const I=["Historical","SSP245","SSP585"],f=["ACCESS-CM2","CanESM5","CESM2","CMCC-CM2-SR5","EC-Earth3","GFDL-ESM4","INM-CM5-0","IPSL-CM6A-LR","MIROC6","MPI-ESM1-2-HR","MRI-ESM2-0"],T=["tas","pr","rsds","hurs","rlds","sfcWind","tasmin","tasmax"],A=[{name:"Viridis",colors:["#440154","#3b528b","#21908d","#5dc863","#fde725"]},{name:"Magma",colors:["#000004","#3b0f70","#8c2981","#de4968","#fe9f6d"]},{name:"Cividis",colors:["#00204c","#31456a","#6b6d7f","#a59c8f","#fdea9b"]},{name:"Thermal",colors:["#04142f","#155570","#1fa187","#f8c932","#f16623"]}],a={page:{position:"relative",minHeight:"100vh",color:"white",overflow:"hidden",fontFamily:"Inter, system-ui, sans-serif"},bgLayer1:{position:"absolute",inset:0,background:"linear-gradient(135deg, #05070f, #0b1326)"},bgLayer2:{position:"absolute",inset:0,background:"radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 32%), radial-gradient(circle at 80% 10%, rgba(139,92,246,0.15), transparent 30%), radial-gradient(circle at 50% 70%, rgba(34,197,94,0.08), transparent 28%)"},bgOverlay:{position:"absolute",inset:0,background:"#050505",opacity:.35},topBar:{position:"fixed",top:12,left:16,right:380,zIndex:3,display:"flex",alignItems:"center",gap:8,padding:"0 2px",background:"transparent",border:"none",boxShadow:"none",backdropFilter:"none",overflowX:"auto",overflowY:"visible",whiteSpace:"nowrap"},field:{minWidth:0,display:"flex",flexDirection:"column",gap:4},fieldLabel:{fontSize:11,letterSpacing:.5,color:"rgba(255,255,255,0.72)",textTransform:"uppercase"},mapArea:{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,textAlign:"center",pointerEvents:"none",zIndex:1},canvasToggle:{position:"fixed",top:14,display:"flex",alignItems:"center",gap:8,pointerEvents:"auto",zIndex:100,transition:"right 0.25s ease"},canvasSwitch:{position:"relative",display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,padding:3,borderRadius:11,background:"rgba(9,11,16,0.9)",border:"1px solid rgba(255,255,255,0.12)",boxShadow:"0 10px 26px rgba(0,0,0,0.45)",zIndex:101},canvasIndicator:{position:"absolute",top:3,bottom:3,left:3,width:"calc(50% - 3px)",borderRadius:9,background:"linear-gradient(135deg, rgba(125,211,252,0.2), rgba(167,139,250,0.2))",boxShadow:"0 8px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",transition:"transform 180ms ease",zIndex:0,pointerEvents:"none"},canvasBtn:{width:40,height:40,borderRadius:9,border:"1px solid transparent",background:"transparent",color:"rgba(255,255,255,0.82)",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"color 120ms ease",position:"relative",zIndex:1},canvasBtnActive:{color:"white"},mapTitle:{fontSize:18,fontWeight:600},mapSubtitle:{fontSize:14,color:"rgba(255,255,255,0.75)"},sidebar:{position:"fixed",top:0,right:0,bottom:0,width:320,transition:"transform 0.25s ease, box-shadow 0.2s ease",zIndex:1,background:"rgba(9,11,16,0.88)",borderLeft:"1px solid rgba(255,255,255,0.08)",boxShadow:"-10px 0 35px rgba(0,0,0,0.55)",backdropFilter:"blur(20px)",overflow:"hidden",display:"flex",flexDirection:"column"},sidebarTop:{display:"flex",alignItems:"center",justifyContent:"flex-start",padding:"16px 16px 46px",gap:10,borderBottom:"1px solid rgba(255,255,255,0.08)",background:"linear-gradient(135deg, rgba(125,211,252,0.08), rgba(167,139,250,0.06))",position:"relative",overflow:"hidden"},logoDot:{width:16,height:16,background:"linear-gradient(135deg, #7dd3fc, #a78bfa, #22c55e)",borderRadius:"50%",boxShadow:"0 0 0 4px rgba(125,211,252,0.08)"},toggle:{width:44,height:44,padding:0,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.16)",background:"rgba(18,22,28,0.85)",boxShadow:"0 14px 40px rgba(0,0,0,0.5)",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:14,lineHeight:1,transition:"right 0.25s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease"},sidebarContent:{padding:"28px 14px 14px",display:"flex",flexDirection:"column",gap:12,overflow:"hidden",flex:1,position:"relative"},tabViewport:{overflow:"hidden",width:"100%",position:"relative",flex:1,display:"flex",flexDirection:"column"},tabTrack:{display:"grid",gridTemplateColumns:"1fr 1fr",width:"200%",transition:"transform 220ms ease",flex:1},tabPane:{width:"100%",display:"flex",flexDirection:"column",gap:12,overflow:"auto",paddingRight:4},sidebarBrand:{display:"flex",alignItems:"center",gap:10},modeSwitch:{position:"relative",display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,padding:2,borderRadius:10,border:"1px solid rgba(255,255,255,0.05)",background:"rgba(255,255,255,0.02)",boxShadow:"none"},modeIndicator:{position:"absolute",top:2,bottom:2,left:2,width:"calc(50% - 2px)",borderRadius:8,background:"linear-gradient(135deg, rgba(125,211,252,0.18), rgba(167,139,250,0.16))",boxShadow:"0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",transition:"transform 200ms ease",zIndex:0},modeBtn:{flex:1,padding:"8px 0",borderRadius:8,border:"none",color:"rgba(255,255,255,0.8)",cursor:"pointer",transition:"all 0.15s ease",background:"transparent",textAlign:"center",fontSize:12.5,fontWeight:700,letterSpacing:.2,outline:"none",boxShadow:"none",position:"relative",zIndex:1},modeBtnActive:{background:"linear-gradient(135deg, rgba(125,211,252,0.22), rgba(167,139,250,0.2))",border:"none",color:"white",boxShadow:"0 6px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)"},tabSwitch:{position:"absolute",left:32,right:12,bottom:-8,display:"flex",gap:10,padding:"0 8px",alignItems:"flex-end",pointerEvents:"auto",zIndex:0},tabBtn:{borderRadius:"14px 14px 0 0",padding:"12px 18px",background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.78)",fontWeight:700,fontSize:13,letterSpacing:.35,cursor:"pointer",transition:"all 0.18s ease",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 18px rgba(0,0,0,0.32)",borderTop:"1px solid rgba(255,255,255,0.12)",borderRight:"1px solid rgba(255,255,255,0.12)",borderLeft:"1px solid rgba(255,255,255,0.12)",borderBottom:"none",transform:"translateY(4px)"},tabBtnActive:{background:"linear-gradient(135deg, rgba(125,211,252,0.32), rgba(167,139,250,0.28))",color:"white",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.12), 0 12px 26px rgba(0,0,0,0.42)",borderTop:"1px solid rgba(125,211,252,0.6)",borderRight:"1px solid rgba(125,211,252,0.6)",borderLeft:"1px solid rgba(125,211,252,0.6)",borderBottom:"none",transform:"translateY(-4px)",zIndex:1},modeViewport:{overflow:"hidden",width:"100%",position:"relative"},modeTrack:{display:"grid",gridTemplateColumns:"1fr 1fr",width:"200%",transition:"transform 220ms ease"},modePane:{width:"100%",paddingRight:4},chatBox:{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(15,18,25,0.96)",boxShadow:"inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 20px rgba(0,0,0,0.38)"},chatInput:{flex:1,padding:"12px 0",borderRadius:8,border:"none",background:"transparent",color:"white",fontSize:14,lineHeight:1.4,outline:"none",minHeight:24},chatSend:{padding:"10px 14px",borderRadius:12,border:"1px solid rgba(125,211,252,0.5)",background:"linear-gradient(135deg, rgba(125,211,252,0.22), rgba(167,139,250,0.2))",color:"white",fontWeight:700,fontSize:14,letterSpacing:.1,cursor:"pointer",boxShadow:"0 10px 22px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.08)",transition:"transform 120ms ease, box-shadow 120ms ease"},chatStack:{display:"flex",flexDirection:"column",gap:12},chatLead:{fontSize:13,color:"rgba(255,255,255,0.78)",lineHeight:1.45,marginTop:10},chatMessages:{display:"flex",flexDirection:"column",gap:10,padding:"4px 0 6px"},chatBubble:{maxWidth:"100%",width:"fit-content",padding:"16px 16px",borderRadius:12,fontSize:13,lineHeight:1.4,boxShadow:"0 6px 14px rgba(0,0,0,0.3)"},chatBubbleUser:{alignSelf:"flex-end",background:"linear-gradient(135deg, rgba(125,211,252,0.25), rgba(167,139,250,0.25))",border:"1px solid rgba(125,211,252,0.45)",color:"white"},chatBubbleAgent:{alignSelf:"flex-start",background:"rgba(20,24,31,0.95)",border:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.9)"},sectionTitle:{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.9)",letterSpacing:.3,textTransform:"uppercase"},paramGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10},range:{width:"100%",background:"transparent",appearance:"none",WebkitAppearance:"none",height:10,outline:"none",padding:0,margin:0},resolutionRow:{display:"flex",alignItems:"center",gap:12},resolutionValue:{fontSize:12.5,color:"rgba(255,255,255,0.78)",minWidth:60,textAlign:"right"},toggleIcon:{fontSize:16,lineHeight:1}},$=360,e={mode:"Explore",panelTab:"Manual",sidebarOpen:!0,canvasView:"map",scenario:I[0],model:f[0],variable:T[0],date:"2025-01-01",palette:A[0].name,resolution:18,chatInput:"",chatMessages:[],compareMode:"Scenarios",compareModelA:f[0],compareModelB:f[1]??f[0],compareDateStart:"2025-01-01",compareDateEnd:"2025-12-31"};let D=null,M=null;function O(d){return d.replace(/[A-Z]/g,r=>`-${r.toLowerCase()}`)}function t(d){return Object.entries(d).filter(([,r])=>r!=null).map(([r,s])=>{const g=r.startsWith("--")?r:O(r),l=typeof s=="number"?`${s}px`:String(s);return`${g}:${l}`}).join(";")}function m(...d){return d.reduce((r,s)=>s?{...r,...s}:r,{})}function y(){if(!M)return;const d=(e.resolution-15)/6*100,r=m(a.sidebar,{width:$,transform:e.sidebarOpen?"translateX(0)":`translateX(${$+24}px)`,pointerEvents:e.sidebarOpen?"auto":"none"}),s=m(a.toggle,{right:e.sidebarOpen?$+10:14,background:e.sidebarOpen?"linear-gradient(135deg, rgba(125,211,252,0.2), rgba(167,139,250,0.18))":"rgba(18,22,28,0.85)",borderColor:"rgba(255,255,255,0.16)",color:"white"}),g=e.mode==="Explore"?"translateX(0%)":"translateX(-50%)",l=e.mode==="Explore"?"translateX(0%)":"translateX(100%)",c=e.canvasView==="map"?"translateX(0%)":"translateX(100%)",v=e.panelTab==="Manual"?"translateX(0%)":"translateX(-50%)";M.innerHTML=`
    <div style="${t(a.page)}">
      <div style="${t(a.bgLayer1)}"></div>
      <div style="${t(a.bgLayer2)}"></div>
      <div style="${t(a.bgOverlay)}"></div>

      <div style="${t(a.mapArea)}">
        <div style="${t(a.mapTitle)}">
          ${e.canvasView==="map"?"Climate map placeholder":"Chart placeholder"}
        </div>
        <div style="${t(a.mapSubtitle)}">
          ${e.canvasView==="map"?"Data layers will render here once the feed is connected.":"Chart view coming soon. Visualizations will render here."}
        </div>
      </div>

      <div style="${t(a.topBar)}">
        ${p("Scenario",b("scenario",I,e.scenario))}
        ${p("Model",b("model",f,e.model))}
        ${p("Date",w("date",e.date))}
        ${p("Variable",b("variable",T,e.variable))}
      </div>

      <aside data-role="sidebar" style="${t(r)}" aria-hidden="${!e.sidebarOpen}">
        <div style="${t(a.sidebarTop)}">
          <div style="${t(a.sidebarBrand)}">
            <div style="${t(a.logoDot)}"></div>
          </div>
          <div style="${t(a.tabSwitch)}">
            ${["Manual","Chat"].map(E=>q(E,e.panelTab===E?a.tabBtnActive:void 0,"panel-tab")).join("")}
          </div>
        </div>

        <div style="${t(a.sidebarContent)}">
          <div style="${t(a.tabViewport)}">
            <div data-role="tab-track" style="${t({...a.tabTrack,transform:v})}">
              <div style="${t(a.tabPane)}">
                ${H({modeTransform:g,resolutionFill:d,modeIndicatorTransform:l})}
              </div>
              <div style="${t(a.tabPane)}">
                ${K()}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div data-role="canvas-toggle" style="${t({...a.canvasToggle,right:e.sidebarOpen?$+24:24})}">
        <div style="${t(a.canvasSwitch)}">
          <div data-role="canvas-indicator" style="${t({...a.canvasIndicator,transform:c})}"></div>
          <button
            type="button"
            aria-label="Show map canvas"
            data-action="set-canvas"
            data-value="map"
            style="${t(m(a.canvasBtn,e.canvasView==="map"?a.canvasBtnActive:void 0))}"
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
            style="${t(m(a.canvasBtn,e.canvasView==="chart"?a.canvasBtnActive:void 0))}"
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
        style="${t(m(s,{position:"fixed",top:"50%",transform:"translateY(-50%)",zIndex:12}))}"
      >
        <span style="${t(a.toggleIcon)}">${e.sidebarOpen?"›":"‹"}</span>
      </button>
    </div>
  `,W()}function p(d,r){return`
    <div style="${t(a.field)}">
      <div style="${t(a.fieldLabel)}">${d}</div>
      ${r}
    </div>
  `}function w(d,r,s){const g=s?.type??"date",l=s?.dataKey??d;return`
    <input
      type="${g}"
      value="${r}"
      data-action="update-input"
      data-key="${l}"
    />
  `}function b(d,r,s,g){const l=g?.dataKey??d,c=g?.disabled?"disabled":"";return`
    <select data-action="update-select" data-key="${l}" ${c}>
      ${r.map(v=>`
            <option value="${v}" ${v===s?"selected":""}>
              ${v}
            </option>
          `).join("")}
    </select>
  `}function q(d,r,s="panel-tab"){return`
    <button
      type="button"
      data-action="set-tab"
      data-key="${s}"
      data-value="${d}"
      style="${t(m(a.tabBtn,r))}"
    >
      ${d}
    </button>
  `}function H(d){const{modeTransform:r,resolutionFill:s,modeIndicatorTransform:g}=d,l=e.compareMode==="Models"?[p("Scenario",b("scenario",I,e.scenario)),p("Date",w("date",e.date))]:e.compareMode==="Dates"?[p("Scenario",b("scenario",I,e.scenario)),p("Model",b("model",f,e.model))]:[p("Model",b("model",f,e.model)),p("Date",w("date",e.date))];return`
    <div style="${t(a.modeSwitch)}">
      <div data-role="mode-indicator" style="${t({...a.modeIndicator,transform:g})}"></div>
      ${["Explore","Compare"].map(c=>`
            <button
              type="button"
              class="mode-btn"
              data-action="set-mode"
              data-value="${c}"
              style="${t(m(a.modeBtn,e.mode===c?a.modeBtnActive:void 0))}"
            >
              ${c}
            </button>
          `).join("")}
    </div>

    <div style="${t(a.modeViewport)}">
      <div data-role="mode-track" style="${t({...a.modeTrack,transform:r})}">
        <div style="${t(a.modePane)}">
          <div style="${t({display:"flex",flexDirection:"column",gap:8})}">
            <div style="${t(a.sectionTitle)}">Parameters</div>
            <div style="${t(a.paramGrid)}">
              ${p("Scenario",b("scenario",I,e.scenario))}
              ${p("Model",b("model",f,e.model))}
              ${p("Date",w("date",e.date))}
              ${p("Variable",b("variable",T,e.variable))}
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${t({display:"flex",flexDirection:"column",gap:8})}">
              <div style="${t(a.sectionTitle)}">Color palette</div>
              ${p("Palette",b("palette",A.map(c=>c.name),e.palette,{dataKey:"palette"}))}
            </div>
          </div>

          <div style="margin-top:14px">
            <div style="${t({display:"flex",flexDirection:"column",gap:8})}">
              <div style="${t(a.sectionTitle)}">Resolution</div>
              <div style="${t(a.resolutionRow)}">
                <input
                  type="range"
                  min="15"
                  max="21"
                  step="1"
                  value="${e.resolution}"
                  data-action="set-resolution"
                  class="resolution-slider"
                  style="${t(m(a.range,{"--slider-fill":`${s}%`}))}"
                />
                <div data-role="resolution-value" style="${t(a.resolutionValue)}">${e.resolution}</div>
              </div>
            </div>
          </div>
        </div>

        <div style="${t(a.modePane)}">
          <div style="${t({display:"flex",flexDirection:"column",gap:14})}">
            <div style="${t({display:"flex",flexDirection:"column",gap:8})}">
              <div style="${t(a.sectionTitle)}">Compare</div>
              <div style="${t(a.paramGrid)}">
                ${p("What do you want to compare?",b("compareMode",["Scenarios","Models","Dates"],e.compareMode,{dataKey:"compareMode"}))}
              </div>

              ${e.compareMode==="Scenarios"?`
                      <div style="${t(a.paramGrid)}">
                        ${p("Scenario A",b("compareScenarioA",["SSP245"],"SSP245",{disabled:!0}))}
                        ${p("Scenario B",b("compareScenarioB",["SSP585"],"SSP585",{disabled:!0}))}
                      </div>
                    `:""}

              ${e.compareMode==="Models"?`
                      <div style="${t(a.paramGrid)}">
                        ${p("Model A",b("compareModelA",f,e.compareModelA,{dataKey:"compareModelA"}))}
                        ${p("Model B",b("compareModelB",f,e.compareModelB,{dataKey:"compareModelB"}))}
                      </div>
                    `:""}

              ${e.compareMode==="Dates"?`
                      <div style="${t(a.paramGrid)}">
                        ${p("Start date",w("compareDateStart",e.compareDateStart,{dataKey:"compareDateStart"}))}
                        ${p("End date",w("compareDateEnd",e.compareDateEnd,{dataKey:"compareDateEnd"}))}
  </div>
`:""}

              <div style="${t(a.paramGrid)}">
                ${l.join("")}
                ${p("Variable",b("variable",T,e.variable))}
              </div>

              <div style="margin-top:14px">
                <div style="${t({display:"flex",flexDirection:"column",gap:8})}">
                  <div style="${t(a.sectionTitle)}">Color palette</div>
                  ${p("Palette",b("palette",A.map(c=>c.name),e.palette,{dataKey:"palette"}))}
                </div>
              </div>

              <div style="margin-top:14px">
                <div style="${t({display:"flex",flexDirection:"column",gap:8})}">
                  <div style="${t(a.sectionTitle)}">Resolution</div>
                  <div style="${t(a.resolutionRow)}">
                    <input
                      type="range"
                      min="15"
                      max="21"
                      step="1"
                      value="${e.resolution}"
                      data-action="set-resolution"
                      class="resolution-slider"
                      style="${t(m(a.range,{"--slider-fill":`${s}%`}))}"
                    />
                    <div data-role="resolution-value" style="${t(a.resolutionValue)}">${e.resolution}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `}function K(){return`
    <div style="${t({display:"flex",flexDirection:"column",gap:8})}">
      <div style="${t(a.sectionTitle)}">Chat</div>
      <div style="${t(a.chatStack)}">
        <div style="${t(a.chatLead)}">Discuss the data with an agent, or ask questions.</div>

        <div style="${t(a.chatMessages)}">
          ${e.chatMessages.map(d=>{const r=d.sender==="user"?m(a.chatBubble,a.chatBubbleUser):m(a.chatBubble,a.chatBubbleAgent);return`<div style="${t(r)}">${d.text}</div>`}).join("")}
        </div>

        <div style="${t(a.chatBox)}">
          <input
            type="text"
            value="${e.chatInput}"
            data-action="chat-input"
            style="${t(a.chatInput)}"
            placeholder="Ask a question"
          />
          <button type="button" data-action="chat-send" aria-label="Send chat message" style="${t(a.chatSend)}">
            ➤
          </button>
        </div>
      </div>
    </div>
  `}function W(d){if(!M)return;const r=M,s=r.querySelector('[data-action="toggle-sidebar"]');s?.addEventListener("click",()=>{const o=r.querySelector('[data-role="sidebar"]'),n=r.querySelector('[data-role="canvas-toggle"]');if(!o||!n||!s)return;const i=!e.sidebarOpen;e.sidebarOpen=i;const x=i?"translateX(0)":`translateX(${$+24}px)`;o.style.transform=x,o.style.pointerEvents=i?"auto":"none",o.setAttribute("aria-hidden",String(!i));const h=i?`${$+10}px`:"14px";s.style.right=h,s.setAttribute("aria-label",i?"Collapse sidebar":"Expand sidebar");const u=s.querySelector("span");u&&(u.textContent=i?"›":"‹");const C=i?$+24:24;n.style.right=`${C}px`}),r.querySelectorAll('[data-action="set-canvas"]').forEach(o=>o.addEventListener("click",()=>{const n=o.dataset.value;if(n){if(n===e.canvasView)return;const x=e.canvasView==="map"?"translateX(0%)":"translateX(100%)",h=n==="map"?"translateX(0%)":"translateX(100%)";e.canvasView=n,y();const u=r.querySelector('[data-role="canvas-indicator"]');if(!u)return;u.style.removeProperty("transition"),u.style.transform=x,u.offsetHeight,u.getBoundingClientRect(),requestAnimationFrame(()=>{u.style.transition="transform 180ms ease",u.style.transform=h})}})),r.querySelectorAll('[data-action="set-mode"]').forEach(o=>o.addEventListener("click",()=>{const n=o.dataset.value;if(n){if(n===e.mode)return;const i=e.mode,x=i==="Explore"?"translateX(0%)":"translateX(-50%)",h=i==="Explore"?"translateX(0%)":"translateX(100%)",u=n==="Explore"?"translateX(0%)":"translateX(-50%)",C=n==="Explore"?"translateX(0%)":"translateX(100%)";e.mode=n,y();const S=r.querySelector('[data-role="mode-track"]'),k=r.querySelector('[data-role="mode-indicator"]');if(!S||!k)return;S.style.transition="none",k.style.transition="none",S.style.transform=x,k.style.transform=h,S.offsetHeight,S.style.transition="transform 220ms ease",k.style.transition="transform 200ms ease",S.style.transform=u,k.style.transform=C}})),r.querySelectorAll('[data-action="set-tab"]').forEach(o=>o.addEventListener("click",()=>{const n=o.dataset.value;if(n){if(n===e.panelTab)return;const x=e.panelTab==="Manual"?"translateX(0%)":"translateX(-50%)",h=n==="Manual"?"translateX(0%)":"translateX(-50%)";e.panelTab=n,y();const u=r.querySelector('[data-role="tab-track"]');if(!u)return;u.style.removeProperty("transition"),u.style.transform=x,u.offsetHeight,u.getBoundingClientRect(),requestAnimationFrame(()=>{u.style.transition="transform 220ms ease",u.style.transform=h})}})),r.querySelectorAll('[data-action="update-select"]').forEach(o=>o.addEventListener("change",()=>{const n=o.dataset.key,i=o.value;if(n){switch(n){case"scenario":e.scenario=i;break;case"model":e.model=i;break;case"variable":e.variable=i;break;case"palette":e.palette=i;break;case"compareMode":e.compareMode=i;break;case"compareModelA":e.compareModelA=i;break;case"compareModelB":e.compareModelB=i;break}y()}})),r.querySelectorAll('[data-action="update-input"]').forEach(o=>o.addEventListener("input",()=>{const n=o.dataset.key;if(!n)return;const i=o.value;switch(n){case"date":e.date=i;break;case"compareDateStart":e.compareDateStart=i;break;case"compareDateEnd":e.compareDateEnd=i;break}y()}));const R=r.querySelectorAll('[data-action="set-resolution"]'),z=r.querySelectorAll('[data-role="resolution-value"]'),V=o=>{const n=(o-15)/6*100;R.forEach(i=>{i.value=String(o),i.style.setProperty("--slider-fill",`${n}%`)}),z.forEach(i=>{i.textContent=String(o)})};R.forEach(o=>o.addEventListener("input",()=>{const n=Number.parseInt(o.value,10);Number.isNaN(n)||(e.resolution=n,V(n))}));const B=r.querySelector('[data-action="chat-input"]'),P=r.querySelector('[data-action="chat-send"]');B?.addEventListener("input",()=>{e.chatInput=B.value}),B?.addEventListener("keydown",o=>{o.key==="Enter"&&(o.preventDefault(),L())}),P?.addEventListener("click",L)}function L(){const d=e.chatInput.trim();if(!d)return;const r={id:Date.now(),sender:"user",text:d};e.chatMessages=[...e.chatMessages,r],e.chatInput="",D&&window.clearTimeout(D),D=window.setTimeout(()=>{const s={id:Date.now()+1,sender:"agent",text:"I don't work yet."};e.chatMessages=[...e.chatMessages,s],y()},1e3),y()}function X(){if(M=document.querySelector("#app"),!M)throw new Error("Root element #app not found");y()}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",X):X();
