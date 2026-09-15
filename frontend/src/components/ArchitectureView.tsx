import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ArchitectureNodeId, DomainConfig } from "../types";
import { buildSpans, dependencies, ingestionRoute, domainNodes, project, redisAccess } from "../architecture";
import type { Span, Vec3, ArchitectureNode } from "../architecture";
import "./architecture.css";

const duration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;

function Scene({ nodes, spans, selected, onSelect, animated, observedAnimated, resetKey }: {
  nodes: ArchitectureNode[]; spans: Span[]; selected: ArchitectureNodeId; onSelect: (id: ArchitectureNodeId) => void; animated: boolean; observedAnimated: boolean; resetKey: number;
}) {
  const nodeById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ spans, selected, animated, observedAnimated, onSelect });
  const dirty = useRef(true);
  const camera = useRef({ yaw: -.1, pitch: .62, zoom: .9 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const hits = useRef<{ id: ArchitectureNodeId; x: number; y: number; w: number; h: number }[]>([]);
  props.current = { spans, selected, animated, observedAnimated, onSelect };
  dirty.current = true;
  useEffect(() => { camera.current = { yaw: -.1, pitch: .62, zoom: .9 }; dirty.current = true; }, [resetKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0, width = 600, height = 420, last = 0;
    const accessFlashes = new Map<string, { key: string; until: number }>();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width; height = entry.contentRect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio; canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); dirty.current = true;
    });
    resize.observe(canvas);
    const zoom = (event: WheelEvent) => {
      event.preventDefault();
      camera.current.zoom = Math.max(.65, Math.min(1.6, camera.current.zoom - event.deltaY * .001));
      dirty.current = true;
    };
    canvas.addEventListener("wheel", zoom, { passive: false });

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const { spans: current, selected: focus, animated: motion } = props.current;
      // The assumed ingestion runs independently of the observed request lifecycle.
      const running = motion && !reducedMotion.matches;
      if (document.hidden || now - last < 32 || (!dirty.current && !running)) return;
      last = now; dirty.current = false;
      const p = (v: Vec3) => project(v, width, height, camera.current.yaw, camera.current.pitch, camera.current.zoom);
      ctx.clearRect(0, 0, width, height);
      const background = ctx.createRadialGradient(width * .46, height * .45, 20, width * .5, height * .5, width * .7);
      background.addColorStop(0, "#132b34"); background.addColorStop(1, "#08151d");
      ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);

      const line = (a: Vec3, b: Vec3, color: string, size = 1) => {
        const pa = p(a), pb = p(b); ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.strokeStyle = color; ctx.lineWidth = size; ctx.stroke();
      };
      // A real 3D coordinate scene projected with a perspective camera.
      for (let x = -600; x <= 850; x += 50) line([x, -35, -690], [x, -35, 470], "#20364066");
      for (let z = -650; z <= 450; z += 50) line([-600, -35, z], [850, -35, z], "#20364066");
      const zone = (label: string, z: number) => {
        const a = p([-570, -30, z]); ctx.font = "600 9px Inter, sans-serif"; ctx.fillStyle = "#67838f";
        ctx.textAlign = "left"; ctx.fillText(label, a.x, a.y);
      };
      zone("BACKEND COMPONENTS", -50); zone("LOCAL DOCKER / BROWSER", 350);

      // Group volumes use the same world-space projection as their children.
      // These are architecture boundaries, not additional services or spans.
      const group = (bounds: [number, number, number, number, number, number], title: string, subtitle: string, color: string, active: boolean) => {
        const [x0,x1,y0,y1,z0,z1] = bounds;
        const corners: Vec3[] = [
          [x0,y0,z0], [x1,y0,z0], [x1,y0,z1], [x0,y0,z1],
          [x0,y1,z0], [x1,y1,z0], [x1,y1,z1], [x0,y1,z1],
        ];
        const faces = [[0,1,2,3],[0,1,5,4],[0,3,7,4],[1,2,6,5],[3,2,6,7],[4,5,6,7]]
          .sort((a,b)=>a.reduce((sum,i)=>sum+p(corners[i]).depth,0)-b.reduce((sum,i)=>sum+p(corners[i]).depth,0));
        for (const face of faces) {
          ctx.beginPath(); face.forEach((index,i)=>{const q=p(corners[index]);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});
          ctx.closePath();ctx.fillStyle=color+"09";ctx.fill();
        }
        for (const [a,b] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]])
          line(corners[a],corners[b],color+(active?"dd":"88"),active?1.8:1.2);
        const label = p([(x0+x1)/2,y1+14,(z0+z1)/2]);
        ctx.textAlign="center";ctx.fillStyle="#091922ee";ctx.beginPath();ctx.roundRect(label.x-86,label.y-37,172,34,6);ctx.fill();
        ctx.font="600 14px Inter, sans-serif";ctx.fillStyle=color;ctx.fillText(title,label.x,label.y-22);
        ctx.font="9px Inter, sans-serif";ctx.fillStyle="#a0bdb8";ctx.fillText(subtitle,label.x,label.y-9);
      };
      group([-610,630,-30,280,-540,-60], "Redis Cloud", "Managed services + data", "#ff9ca5", false);
      const agentActive = current.some(s=>s.status === "running" && (["agent", "router"].includes(s.from) || ["agent", "router"].includes(s.to)));
      group([-410,80,-15,165,20,215], "Agent", "in backend · shared process", "#a2f2d5", agentActive);

      function path(from: ArchitectureNodeId, to: ArchitectureNodeId): Vec3[] {
        if ((from === "browser" && to === "api") || (from === "api" && to === "browser")) {
          const ids: ArchitectureNodeId[] = from === "browser" ? ["browser", "proxy", "api"] : ["api", "proxy", "browser"];
          return ids.map(id => { const v = nodeById[id].position; return [v[0], v[1] + 22, v[2]]; });
        }
        const a = nodeById[from].position, b = nodeById[to].position;
        return Array.from({ length: 25 }, (_, i) => {
          const t = i / 24;
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + 22 + Math.sin(Math.PI * t) * 65, a[2] + (b[2] - a[2]) * t] as Vec3;
        });
      }
      const strokePath = (points: Vec3[], color: string, size: number, dashed: boolean) => {
        ctx.beginPath(); points.forEach((v, i) => { const q = p(v); if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
        ctx.setLineDash(dashed ? [3, 5] : []); ctx.strokeStyle = color; ctx.lineWidth = size; ctx.stroke(); ctx.setLineDash([]);
      };
      for (const [a, b] of dependencies) if (b !== "redis") strokePath(path(a, b), "#54748266", 1, true);
      const edgeSpans = new Map<string, Span>();
      for (const span of current) {
        const key = `${span.from}-${span.to}`;
        if (edgeSpans.get(key)?.status !== "running") edgeSpans.set(key, span);
      }
      for (const span of edgeSpans.values()) {
        if (span.to === "redis") continue; // Draw storage access above blocks using face anchors.
        const points = path(span.from, span.to);
        const active = span.status === "running";
        const color = span.status === "error" ? "#ff8992" : span.status === "interrupted" ? "#f5cd7b" : nodeById[span.to].color;
        strokePath(points, color + (active ? "dd" : "77"), active ? 2 : 1.5, false);
        // Arrowheads give direction even with motion disabled.
        const end = p(points[points.length - 1]), before = p(points[points.length - 2]);
        const angle = Math.atan2(end.y - before.y, end.x - before.x);
        ctx.beginPath(); ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - 9 * Math.cos(angle - .45), end.y - 9 * Math.sin(angle - .45));
        ctx.lineTo(end.x - 9 * Math.cos(angle + .45), end.y - 9 * Math.sin(angle + .45));
        ctx.fillStyle = color; ctx.fill();
        if (active && props.current.observedAnimated && !reducedMotion.matches) for (let dot = 0; dot < 3; dot++) {
          const progress = ((now / 1800 + dot / 3) % 1) * (points.length - 1);
          const i = Math.min(points.length - 2, Math.floor(progress)), t = progress - i;
          const a = points[i], b = points[i + 1];
          const q = p(a.map((v, j) => v + (b[j] - v) * t) as Vec3);
          ctx.shadowBlur = 12; ctx.shadowColor = color; ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.shadowBlur = 0;
        }
      }

      hits.current = [];
      const ordered = [...nodes].sort((a, b) => p(a.position).depth - p(b.position).depth);
      for (const node of ordered) {
        const [x, y, z] = node.position;
        const active = current.some(s => s.status === "running" && (s.from === node.id || s.to === node.id));
        const visited = current.some(s => s.from === node.id || s.to === node.id);
        const failed = current.some(s => s.status === "error" && s.to === node.id);
        const color = failed ? "#ff8992" : node.color;
        const face = (verts: Vec3[], fill: string) => {
          ctx.beginPath(); verts.forEach((v, i) => { const q = p(v); if (!i) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = color + (active || focus === node.id ? "cc" : "55"); ctx.lineWidth = 1; ctx.stroke();
        };
        const w = 47, d = 30, h = node.height ?? 30;
        // Shaded cuboids establish height and depth; labels remain readable billboards.
        face([[x-w,y,z+d],[x+w,y,z+d],[x+w,y+h,z+d],[x-w,y+h,z+d]], "#18313e");
        face([[x+w,y,z-d],[x+w,y,z+d],[x+w,y+h,z+d],[x+w,y+h,z-d]], "#102630");
        face([[x-w,y+h,z-d],[x+w,y+h,z-d],[x+w,y+h,z+d],[x-w,y+h,z+d]], active ? "#28534e" : "#24424c");
        if (node.id === "redis") {
          for (const [offset, label] of [[165, "DATA"], [105, "VECTORS"], [45, "STATE"]] as const) {
            line([x-w,y+offset-18,z+d], [x+w,y+offset-18,z+d], "#ff899255");
            const row = p([x,y+offset,z+d+1]);
            ctx.textAlign = "center"; ctx.font = "600 8px Inter, sans-serif"; ctx.fillStyle = "#ffb7bd";
            ctx.fillText(label,row.x,row.y);
          }
        }
        if (node.id === "source") {
          // Cylinder rims distinguish the source database from processing services.
          for (const offset of [0, 22, 44, h]) {
            const rim = Array.from({length:33},(_,i) => {
              const angle = i / 32 * Math.PI * 2;
              return [x + Math.cos(angle)*w, y+offset, z+Math.sin(angle)*d] as Vec3;
            });
            strokePath(rim, "#f5cd7b99", 1, false);
          }
        }
        const q = p([x, y + h + 4, z]);
        if (focus === node.id || active) { ctx.beginPath(); ctx.ellipse(q.x, q.y + 14, 50 * q.scale, 18 * q.scale, 0, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
        ctx.fillStyle = visited ? color : "#a6bfc8";
        ctx.font = `600 ${Math.max(10, Math.min(13, 15 * q.scale))}px Inter, sans-serif`;
        ctx.textAlign = "center";
        const labelWidth = Math.max(ctx.measureText(node.name).width + 20, 92);
        ctx.fillStyle = "#091922ee"; ctx.beginPath(); ctx.roundRect(q.x-labelWidth/2,q.y-47,labelWidth,39,6);ctx.fill();
        ctx.fillStyle = color; ctx.fillText(node.name, q.x, q.y - 31);
        ctx.font = "9px Inter, sans-serif"; ctx.fillStyle = "#97aeb8"; ctx.fillText(node.subtitle, q.x, q.y - 17);
        hits.current.push({ id: node.id, x: q.x-labelWidth/2, y: q.y-50, w: labelWidth, h: 75 });
      }

      // Draw access above the geometry so the tall Redis block cannot hide it.
      for (const [index, access] of redisAccess(current).entries()) {
        const source = nodeById[access.module], target = nodeById.redis;
        const isRouter = access.module === "router";
        // Route the router's short storage link along the right side of the scene,
        // from its right edge to Redis's vector section, clear of LangGraph.
        const a: Vec3 = [source.position[0]+47, source.position[1]+18, source.position[2]+32];
        const b: Vec3 = [target.position[0]-49, target.position[1]+[105,55,195][index], target.position[2]+32];
        const points = Array.from({length:33}, (_,i) => {
          const t=i/32;
          // Checkpoint traffic bends toward the front of the Agent cuboid,
          // leaving the router and its vector link clear.
          const frontBend = access.module === "agent" ? Math.sin(t*Math.PI)*115 : 0;
          return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+Math.sin(t*Math.PI)*(isRouter?20:35),a[2]+(b[2]-a[2])*t+frontBend] as Vec3;
        });
        const key = `${access.latest?.id ?? "idle"}:${access.status}`;
        if (accessFlashes.get(access.module)?.key !== key) accessFlashes.set(access.module,{key,until:now+1600});
        const flash = !!access.latest && now < (accessFlashes.get(access.module)?.until ?? 0);
        const active = access.status === "running";
        const failed = access.status === "error" || access.status === "interrupted";
        const color = failed ? "#ff8992" : access.linked ? "#b7b5ff" : "#73e6c7";
        const highlighted = active || flash || focus===access.module || focus==="redis";
        strokePath(points, color+(highlighted?"ee":"99"), highlighted?2.4:1.5, access.linked);
        for (const endIndex of [0,32]) {
          const q=p(points[endIndex]), before=p(points[endIndex===0?1:31]);
          const angle=Math.atan2(q.y-before.y,q.x-before.x);
          ctx.beginPath();ctx.moveTo(q.x,q.y);ctx.lineTo(q.x-7*Math.cos(angle-.45),q.y-7*Math.sin(angle-.45));ctx.lineTo(q.x-7*Math.cos(angle+.45),q.y-7*Math.sin(angle+.45));ctx.fillStyle=color;ctx.fill();
        }
        // Label storage links in the open space between Agent and Redis.
        const midpoint=p(points[access.linked?19:isRouter?22:26]);
        const label=access.module==="router"?"VECTOR SEARCH":access.module==="agent"?"STATE READ / WRITE":"RETRIEVE · LINKED";
        ctx.font="600 8px Inter, sans-serif";ctx.textAlign="center";
        const labelWidth=ctx.measureText(label).width+10;
        ctx.fillStyle="#091922ee";ctx.fillRect(midpoint.x-labelWidth/2,midpoint.y-14,labelWidth,13);ctx.fillStyle=color;ctx.fillText(label,midpoint.x,midpoint.y-4);
        // A brief terminal pulse makes sub-frame SDK calls visible, including responses.
        // This is visual emphasis only; recorded duration and operation counts stay exact.
        if ((active || flash) && !failed && props.current.observedAnimated && !reducedMotion.matches) {
          for(let dot=0;dot<3;dot++) {
            let progress=((now/1500+dot/3)%1)*32;
            if (!active) progress=32-progress;
            const i=Math.min(31,Math.floor(progress)),t=progress-i;
            const q=p(points[i].map((v,j)=>v+(points[i+1][j]-v)*t) as Vec3);
            ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=10;ctx.beginPath();ctx.arc(q.x,q.y,3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
          }
        }
      }

      // A distinct amber route depicts the user's assumed ingestion architecture.
      // It never creates SSE spans, request timing, operation counts or throughput.
      for (let edge = 0; edge < ingestionRoute.length - 1; edge++) {
        const source = nodeById[ingestionRoute[edge]], target = nodeById[ingestionRoute[edge+1]];
        const a: Vec3 = [source.position[0]-50, source.position[1]+25, source.position[2]+35];
        const b: Vec3 = [target.position[0]+50, target.position[1]+(target.id==="redis"?110:25), target.position[2]+35];
        const points = Array.from({length:25},(_,i) => {
          const t=i/24;
          return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+Math.sin(t*Math.PI)*12,a[2]+(b[2]-a[2])*t] as Vec3;
        });
        strokePath(points, "#f5cd7baa", 2, true);
        const end=p(b), before=p(points[23]), angle=Math.atan2(end.y-before.y,end.x-before.x);
        ctx.beginPath();ctx.moveTo(end.x,end.y);
        ctx.lineTo(end.x-8*Math.cos(angle-.5),end.y-8*Math.sin(angle-.5));
        ctx.lineTo(end.x-8*Math.cos(angle+.5),end.y-8*Math.sin(angle+.5));
        ctx.fillStyle="#f5cd7b";ctx.fill();
        for(let dot=0;dot<3;dot++) {
          const progress=(((running?now/2400:0)+dot/3)%1)*24;
          const i=Math.min(23,Math.floor(progress)),t=progress-i;
          const q=p(points[i].map((v,j)=>v+(points[i+1][j]-v)*t) as Vec3);
          ctx.shadowColor="#f5cd7b";ctx.shadowBlur=10;ctx.fillStyle="#ffe5a1";
          ctx.fillRect(q.x-2.5,q.y-2.5,5,5);ctx.shadowBlur=0;
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); canvas.removeEventListener("wheel", zoom); };
  }, [nodes, nodeById]);

  return <canvas ref={canvasRef} className="arch-canvas" aria-label="Interactive 3D software architecture. Redis Cloud contains LangCache, Agent Memory, Context Retriever, Redis Database and RDI. Agent contains LangGraph and Semantic Router in one backend process. Drag to rotate; use arrow keys to rotate and plus or minus to zoom. Select components using the buttons below." tabIndex={0}
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x:e.clientX, y:e.clientY, moved:false }; }}
    onPointerMove={e => { if (!drag.current) return; const dx=e.clientX-drag.current.x, dy=e.clientY-drag.current.y; if (Math.abs(dx)+Math.abs(dy)>2) drag.current.moved=true; camera.current.yaw += dx*.006; camera.current.pitch = Math.max(.2,Math.min(1.25,camera.current.pitch+dy*.005)); drag.current.x=e.clientX;drag.current.y=e.clientY;dirty.current=true; }}
    onPointerUp={e => { if (drag.current && !drag.current.moved) { const r=e.currentTarget.getBoundingClientRect(); const hit=[...hits.current].reverse().find(h=>e.clientX-r.left>=h.x&&e.clientX-r.left<=h.x+h.w&&e.clientY-r.top>=h.y&&e.clientY-r.top<=h.y+h.h); if(hit)props.current.onSelect(hit.id); } drag.current=null; }}
    onPointerCancel={()=>{drag.current=null;}}
    onKeyDown={e=> { if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","=","-"].includes(e.key)) return; e.preventDefault(); if(e.key==="ArrowLeft")camera.current.yaw-=.1;if(e.key==="ArrowRight")camera.current.yaw+=.1;if(e.key==="ArrowUp")camera.current.pitch=Math.min(1.25,camera.current.pitch+.1);if(e.key==="ArrowDown")camera.current.pitch=Math.max(.2,camera.current.pitch-.1);if(e.key==="+"||e.key==="=")camera.current.zoom=Math.min(1.6,camera.current.zoom+.1);if(e.key==="-")camera.current.zoom=Math.max(.65,camera.current.zoom-.1);dirty.current=true; }}
    />;
}

export function ArchitectureView({ messages, isStreaming, domain }: { messages: ChatMessage[]; isStreaming: boolean; domain: DomainConfig }) {
  const appName = domain?.app_name ?? "Redis Iris";
  const nodes = useMemo(() => domainNodes(appName, domain?.id ?? "", window.location.port || (window.location.protocol === "https:" ? "443" : "80")), [appName, domain?.id]);
  const nodeById = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const turns = messages.filter(m => m.role === "assistant");
  const latestId = turns.at(-1)?.id ?? "";
  const [turnId, setTurnId] = useState(latestId);
  const [selected, setSelected] = useState<ArchitectureNodeId>("api");
  const [animated, setAnimated] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [replay, setReplay] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [clock, setClock] = useState(performance.now());
  useEffect(() => { setTurnId(latestId);setReplay(false);setReplaying(false); }, [latestId]);
  const turn = turns.find(m=>m.id===turnId) ?? turns.at(-1);
  const live = !!turn && turn.id===latestId && isStreaming && !turn.requestFinished;
  const events = turn?.architectureEvents ?? [];
  const elapsed = turn?.requestElapsedMs ?? (live ? Math.max(0,clock-(turn?.requestStartedAt ?? clock)) : events.at(-1)?.ts ?? 0);
  useEffect(()=> { if(!live) return; const id=window.setInterval(()=>setClock(performance.now()),100);return ()=>clearInterval(id); },[live]);
  useEffect(()=> { if(!replaying) return; const id=window.setInterval(()=>setCursor(t=> { const next=Math.min(elapsed,t+100); if(next>=elapsed)setReplaying(false);return next; }),100);return ()=>clearInterval(id); },[replaying,elapsed]);
  const viewTime = replay ? cursor : elapsed;
  const spans = useMemo(()=>buildSpans(replay ? events.filter(e=>e.ts<=cursor) : events, replay ? cursor>=elapsed : !!turn?.requestFinished),[events,replay,cursor,elapsed,turn?.requestFinished]);
  const operations=spans.filter(s=>s.id!=="request"&&s.id!=="response");
  const pending=operations.filter(s=>s.status==="running");
  const selectedNode=nodeById[selected];
  const nodeSpans=operations.filter(s=>s.from===selected||s.to===selected);
  const storageAccess=redisAccess(spans);
  const hasError=spans.some(s=>s.status==="error"||s.status==="interrupted") || turn?.requestFailed;
  const outcome=spans.find(s=>s.id==="request")?.outcome;
  const status=replay?"REPLAY":live?"LIVE":!turn?"READY":hasError?"WITH ERRORS":outcome==="Blocked"?"BLOCKED":outcome==="Cache hit"?"CACHE HIT":"COMPLETE";
  return <section className="architecture-view" aria-label="Data Flow">
    <div className="arch-heading"><div><span className="arch-eyebrow">{appName.toUpperCase()} / DATA FLOW</span><h2>Follow the context.</h2><p>Agent contains LangGraph and Semantic Router. Both share the FastAPI backend process. Redis Cloud groups managed services, Redis Database and RDI.</p></div><span className={`arch-status ${live&&!replay?"is-live":""} ${hasError?"has-error":""}`} role="status"><i/>{status}</span></div>
    <div className="arch-request"><label htmlFor="architecture-request">Request</label><select id="architecture-request" value={turn?.id??""} disabled={!turns.length} onChange={e=>{setTurnId(e.target.value);setReplay(false);setReplaying(false);}}>{!turns.length&&<option value="">Send a message to see live traffic</option>}{turns.map((t,i)=>{const prev=messages[messages.indexOf(t)-1];return <option key={t.id} value={t.id}>{i+1}. {prev?.content.slice(0,85)||"Chat request"}</option>;})}</select></div>
    <div className="arch-stats"><div><strong>{operations.length}</strong><span>observed operations</span></div><div><strong>{operations.filter(s=>s.label==="Chat model").length}</strong><span>chat model calls</span></div><div><strong>{duration(viewTime)}</strong><span>request elapsed</span></div></div>
    <div className="arch-ingestion"><span className="arch-ingestion-badge">ASSUMED INGESTION</span><strong>Source DB → RDI → Redis Database → Context Retriever</strong><span>Continuous data sync · illustration independent of chat requests</span></div>
    <div className="arch-stage"><div className="arch-stage-tools"><span>3D PERSPECTIVE</span><div><button type="button" onClick={()=>setAnimated(a=>!a)} aria-pressed={!animated}>{animated?"Pause motion":"Resume motion"}</button><button type="button" onClick={()=>setResetKey(k=>k+1)}>Reset view</button></div></div><Scene nodes={nodes} spans={spans} selected={selected} onSelect={setSelected} animated={animated} observedAnimated={animated&&(!replay||replaying)} resetKey={resetKey}/><div className="arch-stage-foot"><span>Drag to orbit · scroll / + − to zoom</span><span><i className="arch-line"/>Observed <i className="arch-line linked"/>Tool-linked <i className="arch-line dashed"/>Configured <i className="arch-line ingestion"/>Assumed ingestion</span></div></div>
    <div className="arch-now" aria-live="polite"><i/>{pending.length?`${pending.map(s=>s.label).join(" · ")}`:!turn?"Waiting for your first request. Amber ingestion illustrates the assumed backend.":live?"Waiting for the next operation…":replay?"Recorded event playback":outcome==="Cache hit"?"Cache returned the answer. Chat model skipped.":outcome==="Blocked"?"Router blocked the request. Agent skipped.":hasError?"An operation failed or the stream was interrupted.":"Request finished. Select a component or replay the trace."}</div>
    {turn?.requestFinished&&events.length>0&&<div className="arch-replay"><button type="button" onClick={()=>{setReplay(true);if(!replay||cursor>=elapsed)setCursor(0);setReplaying(p=>!p);}}>{replaying?"Pause replay":"Replay trace"}</button><input aria-label="Replay position" type="range" min={0} max={Math.max(elapsed,1)} value={replay?cursor:elapsed} onChange={e=>{setReplay(true);setReplaying(false);setCursor(Number(e.target.value));}}/><button type="button" onClick={()=>{setReplay(false);setReplaying(false);}}>Latest</button></div>}
    <div className="arch-storage"><div className="arch-section-title"><h3>Redis access</h3><span>SDK BOUNDARIES / TOOL CORRELATION</span></div><div className="arch-storage-grid">{storageAccess.map(access=><button type="button" className={`arch-storage-card ${access.status}`} key={access.module} onClick={()=>setSelected(access.module)}><strong>{nodeById[access.module].name} ↔ Redis</strong><span>{access.linked?"TOOL-LINKED · internal Redis untraced":"OBSERVED SDK CALLS"}</span><b>{access.calls.length} {access.linked?"MCP calls":"Redis calls"}</b><small>{access.status==="idle"?"No calls in this request":access.status==="running"?"Access in progress":access.status==="error"?"Access failed":access.status==="interrupted"?"Access interrupted":access.linked?"MCP finished · storage unverified":"Redis access completed"}</small>{!access.linked&&access.latest&&<small>{access.latest.label} · {duration(access.latest.durationMs??0)}</small>}</button>)}</div><p>LangCache &amp; Agent Memory: managed APIs; their backing storage is not traced or assumed to share this Redis DB.</p></div>
    <div className="arch-node-list" aria-label="Architecture components">{[
      { label: "", ids: ["browser", "proxy", "api", "openai", "source"] },
      { label: "Agent · in backend", ids: ["agent", "router"] },
      { label: "Redis Cloud", ids: ["cache", "memory", "retriever", "redis", "rdi"] },
    ].map(group => {
      const buttons = nodes.filter(node=>group.ids.includes(node.id)).map(node=><button type="button" key={node.id} aria-pressed={selected===node.id} onClick={()=>setSelected(node.id)}><i style={{background:node.color}}/>{node.name}</button>);
      return group.label ? <fieldset className="arch-agent-group" key={group.label}><legend>{group.label}</legend>{buttons}</fieldset> : <div className="arch-ungrouped" key="external">{buttons}</div>;
    })}</div>
    <div className="arch-detail"><div><span className="arch-eyebrow">COMPONENT DETAIL</span><h3>{selectedNode.name}</h3></div><span className="arch-detail-count">{selectedNode.assumed?"Assumed component":`${nodeSpans.length} operations`}</span><p>{selectedNode.detail}</p></div>
    <div className="arch-timeline"><div className="arch-section-title"><h3>Request timeline</h3><span>{replay?"RECORDED EVENTS":"SSE OPERATION EVENTS"}</span></div>{!operations.length?<p className="arch-empty">Keep this tab open and send a question in the chat. The diagram updates as each operation starts and finishes.</p>:<ol>{operations.slice(-18).reverse().map((span,i)=><li key={`${span.id}-${i}`}><time>{duration(span.start)}</time><i className={`arch-event-dot ${span.status}`}/><button type="button" onClick={()=>setSelected(span.to)}><strong>{span.label}</strong><span>{nodeById[span.from].name} → {nodeById[span.to].name}</span></button><span className={`arch-event-state ${span.status}`}>{span.outcome??(span.status==="running"?"Running":span.status==="interrupted"?"Interrupted":span.status==="error"?"Failed":duration(span.durationMs??((span.end??span.start)-span.start)))}</span></li>)}</ol>}</div>
    <p className="arch-evidence">Live within this browser's chat session. Timings measure API/tool boundaries. Green storage paths trace Redis SDK calls, including routing and checkpoint reads/writes. Purple paths correlate Context Retriever tool activity, without measuring internal Redis commands. Fast completed calls flash briefly for visibility; timings retain their measured values. Replay uses recorded request events. Amber DB → RDI → Redis ingestion is an always-running illustration, not measured traffic; no source database or RDI service has been provisioned. Pause motion stops the animation, and reduced-motion preferences are respected.</p>
  </section>;
}
