import type { ArchitectureEvent, ArchitectureNodeId } from "./types";

export type Vec3 = [number, number, number];
export type ArchitectureNode = { id: ArchitectureNodeId; name: string; subtitle: string; position: Vec3; color: string; height?: number; assumed?: boolean; detail: string };
export const nodes: ArchitectureNode[] = [
  { id: "browser", name: "Demo App", subtitle: "React · browser", position: [-460, 0, 400], color: "#80caff", detail: "The browser sends a chat request and consumes streaming SSE responses. Request and response arrows represent the configured Nginx route." },
  { id: "proxy", name: "Nginx", subtitle: "Docker · :3040", position: [-220, 0, 400], color: "#80caff", detail: "Serves the React build and proxies /api to FastAPI with buffering disabled. This is a configured route, not packet-level telemetry." },
  { id: "api", name: "FastAPI", subtitle: "Docker · :8040", position: [20, 0, 420], color: "#70e6c1", detail: "Coordinates semantic routing, cache lookup, memory enrichment and the LangGraph agent. Sends observed operation boundaries to this view over SSE." },
  { id: "router", name: "Semantic Router", subtitle: "Request classification", position: [-55, 15, 155], color: "#f5cd7b", detail: "A component in the same Python process as FastAPI and LangGraph. Embeds the question through OpenAI, then classifies it using Redis vector search. Blocking Redis routing runs in a worker thread, not a separate process. An off-topic result ends the request before cache, memory and agent calls." },
  { id: "agent", name: "LangGraph", subtitle: "Model + tool loop", position: [-295, 15, 155], color: "#70e6c1", detail: "Runs the LLM and tool loop in the same Python process as FastAPI and Semantic Router. It is a logical component, not a separate service. Uses Context Retriever MCP and memory tools. Actual Redis checkpoint reads, checkpoint writes and pending-update writes are traced at their SDK boundaries. Each call has its own start/end/error event; these are SDK calls, not individual Redis commands." },
  { id: "cache", name: "LangCache", subtitle: "Redis managed API", position: [-490, 35, -430], color: "#f5cd7b", detail: "Looks for a semantically matching FAQ. A cache hit returns an answer immediately without running the agent's chat model. Query embedding for routing still occurs first. This app calls the managed LangCache HTTP API; its internal storage is not traced or assumed to be the demo Redis database." },
  { id: "memory", name: "Agent Memory", subtitle: "Session + long-term", position: [-245, 35, -430], color: "#c7a7ff", detail: "Stores session events and retrieves session history and long-term preferences. This app uses the managed Agent Memory API; internal storage is not traced or assumed to be the demo Redis database. Explicit memory tools and their outcomes are shown separately from session persistence." },
  { id: "retriever", name: "Context Retriever", subtitle: "Managed MCP", position: [10, 35, -430], color: "#70e6c1", detail: "Exposes typed MCP tools for the active domain’s structured records and policy documents. In the illustrated backend, source database changes flow through RDI into Redis, which supplies the retrieval data. Tool timings measure the API boundary, not individual Redis commands inside the managed service." },
  { id: "openai", name: "OpenAI", subtitle: "Chat + embeddings", position: [-800, 65, -560], color: "#a4bbff", detail: "Creates query embeddings and runs chat-model calls. Model start/end events are reported independently of the Activity panel's optional LLM trace setting." },
  { id: "redis", name: "Redis Database", subtitle: "Data · vectors · state", position: [300, -20, -220], color: "#ff8992", height: 220, detail: "Holds the demo's structured data, policy vectors, routing index and LangGraph checkpoints. Context Retriever reads this data through its MCP tools. The amber Source DB → RDI → Redis path illustrates assumed continuous ingestion; it is not connected RDI telemetry. Router and LangGraph links show observed Redis SDK calls. The Context Retriever storage link is correlated with MCP activity, but its internal Redis commands are not measured." },
  { id: "rdi", name: "RDI", subtitle: "Capture · transform · sync", position: [525, 35, -220], color: "#f5cd7b", height: 45, assumed: true, detail: "Redis Data Integration mediates the assumed Source DB → Redis ingestion path. Moving amber particles illustrate continuous change capture, transformation and delivery, independently of chat requests. No RDI service or ingestion telemetry is connected by this visualization." },
  { id: "source", name: "Source DB", subtitle: "Context backend · assumed", position: [820, 35, -220], color: "#f5cd7b", height: 65, assumed: true, detail: "Assumed source database for the Context Retriever backend’s business records. Changes continuously flow left through RDI into Redis, where Context Retriever can retrieve them. This source is an architecture scenario, not a newly provisioned database." },
];
export function domainNodes(appName: string, domainId: string, webPort: string): ArchitectureNode[] {
  return nodes.map(node => {
    if (node.id === "browser") return { ...node, name: appName };
    if (node.id === "proxy") return { ...node, subtitle: `Docker · :${webPort}` };
    if (domainId === "radish-bank" && node.id === "retriever") return { ...node, detail: "Exposes typed MCP tools for customers, accounts, cards, deposits, insurance, branches, holdings, service requests and bank documents. Tool timings measure the managed API boundary. The illustrated Source DB → RDI → Redis path is assumed ingestion." };
    if (domainId === "radish-bank" && node.id === "source") return { ...node, detail: "Assumed banking source database: customers, accounts, cards, product holdings and service requests. The animation illustrates Source DB → RDI → Redis ingestion; no source database or RDI service is connected." };
    return node;
  });
}

// Illustrative ingestion is separate from recorded request events and counters.
export const ingestionRoute: ArchitectureNodeId[] = ["source", "rdi", "redis"];
export const dependencies: [ArchitectureNodeId, ArchitectureNodeId][] = [
  ["browser", "proxy"], ["proxy", "api"], ["api", "router"], ["api", "cache"],
  ["api", "memory"], ["api", "agent"], ["api", "openai"], ["agent", "openai"],
  ["agent", "retriever"], ["agent", "memory"], ["agent", "redis"], ["router", "redis"], ["retriever", "redis"],
];

export type Span = ArchitectureEvent & { start: number; end?: number; status: "running" | "success" | "error" | "interrupted" };

export function redisAccess(spans: Span[]) {
  return (["router", "agent", "retriever"] as const).map(module => {
    // MCP tool boundaries only correlate retrieval activity; they are not Redis telemetry.
    const linked = module === "retriever";
    const calls = spans.filter(s => linked ? s.to === "retriever" : s.from === module && s.to === "redis");
    const latest = [...calls].reverse().find(s => s.status === "running") ?? calls.at(-1);
    return { module, linked, calls, latest, status: latest?.status ?? "idle" };
  });
}

export function buildSpans(events: ArchitectureEvent[], finished = false): Span[] {
  const spans: Span[] = [];
  for (const event of events) {
    if (event.phase === "start") {
      spans.push({ ...event, start: event.ts, status: "running" });
    } else {
      const existing = [...spans].reverse().find(s => s.id === event.id && s.status === "running");
      if (existing) Object.assign(existing, event, { start: existing.start, end: event.ts, status: event.phase === "error" ? "error" : "success" });
      else spans.push({ ...event, start: Math.max(0, event.ts - (event.durationMs ?? 0)), end: event.ts, status: event.phase === "error" ? "error" : "success" });
    }
  }
  if (finished) for (const span of spans) if (span.status === "running") span.status = "interrupted";
  return spans;
}

// Reduce only operation metadata. Never copy prompts, results or credentials into the graph.
export function architectureEvent(ev: Record<string, any>, prior: ArchitectureEvent[]): ArchitectureEvent | null {
  if (ev.type === "architecture-event") {
    if (!nodes.some(n => n.id === ev.from) || !nodes.some(n => n.id === ev.to)) return null;
    if (!["start", "end", "error"].includes(ev.phase)) return null;
    return { id: ev.id, from: ev.from, to: ev.to, label: ev.label, phase: ev.phase, ts: ev.ts ?? 0, durationMs: ev.durationMs };
  }
  if (ev.type !== "tool-call" && ev.type !== "tool-result") return null;
  const name = String(ev.toolName ?? "tool");
  const kind = ev.toolKind;
  let from: ArchitectureNodeId = "api";
  let to: ArchitectureNodeId = "agent";
  if (kind === "mcp_tool") { from = "agent"; to = "retriever"; }
  else if (kind === "memory") { to = "memory"; if (name === "search_customer_memory") from = "agent"; }
  else if (kind === "langcache") to = "cache";
  else if (kind === "guardrail") to = "router";
  // An explicit remember tool is a local demo stub, not a managed memory write.
  if (name.startsWith("remember_")) { from = "api"; to = "agent"; }
  const isStart = ev.type === "tool-call";
  const open = buildSpans(prior).reverse().find(s => s.label === name && s.status === "running");
  const id = ev.callId || (!isStart && open?.id) || `tool-${prior.length}-${name}`;
  const p = ev.payload ?? {};
  const failed = !!p.error || p.isError === true;
  const outcome = failed ? "Failed" : p.demo_blocked ? "Simulated tool" : p.hit === true ? "Cache hit" : p.hit === false ? "Cache miss" : p.allowed === false ? (p.reason === "no_match" ? "Needs clarification" : "Blocked") : p.allowed === true ? "Allowed" : undefined;
  return { id, from, to, label: name, phase: isStart ? "start" : failed ? "error" : "end", ts: ev.ts ?? 0, durationMs: ev.durationMs, outcome };
}

export function project(point: Vec3, width: number, height: number, yaw: number, pitch: number, zoom: number) {
  const [worldX, y, z] = point;
  const x = worldX;
  const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
  const rz = x * Math.sin(yaw) + z * Math.cos(yaw);
  const sy = y * Math.cos(pitch) - rz * Math.sin(pitch);
  const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
  const scale = Math.min(width / 1540, height / 750) * zoom * 1100 / (1100 - depth);
  return { x: width / 2 + rx * scale, y: height * .54 - sy * scale, depth, scale };
}
