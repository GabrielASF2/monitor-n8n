import { useState, useEffect, useCallback, useRef } from "react";

const N8N_BASE = "https://n8n.developern8n.org/api/v1";

// ── STORAGE helpers ──────────────────────────────────────────────────
async function storageGet(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function storageSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}

// ── PROXY fetch through n8n API ──────────────────────────────────────
async function n8nFetch(path, apiKey) {
  const res = await fetch(`${N8N_BASE}${path}`, {
    headers: { "X-N8N-API-KEY": apiKey, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── THEME ─────────────────────────────────────────────────────────────
const T = {
  bg: "#07090f",
  surface: "#0f1520",
  border: "#1c2a45",
  borderHover: "#2d4070",
  red: "#ff3d5a",
  green: "#00e887",
  yellow: "#ffcc00",
  blue: "#3d9dff",
  muted: "#3d5070",
  text: "#a8c0e0",
  white: "#e8f0ff",
};

const css = (obj) => Object.entries(obj).map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}:${v}`).join(";");

// ── COMPONENTS ────────────────────────────────────────────────────────

function Badge({ status }) {
  const map = {
    error: { bg: "rgba(255,61,90,0.15)", color: T.red, label: "ERRO" },
    success: { bg: "rgba(0,232,135,0.12)", color: T.green, label: "OK" },
    waiting: { bg: "rgba(255,204,0,0.12)", color: T.yellow, label: "AGUARDANDO" },
    canceled: { bg: "rgba(61,93,112,0.3)", color: T.muted, label: "CANCELADO" },
    running: { bg: "rgba(61,157,255,0.15)", color: T.blue, label: "RODANDO" },
  };
  const s = map[status] || map.canceled;
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 9, fontWeight: 700, letterSpacing: "1.5px",
      padding: "3px 8px", borderRadius: 4,
      fontFamily: "'JetBrains Mono', monospace",
    }}>{s.label}</span>
  );
}

function StatCard({ label, value, sub, color = T.white, accent }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: "18px 20px", position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: accent || T.border }} />
      <div style={{ fontSize: 10, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color, fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: T.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function ExecRow({ exec, workflows }) {
  const wfName = workflows[exec.workflowId] || exec.workflowId;
  const started = exec.startedAt ? new Date(exec.startedAt) : null;
  const ended = exec.stoppedAt ? new Date(exec.stoppedAt) : null;
  const dur = started && ended ? Math.round((ended - started) / 1000) : null;
  const dateStr = started ? started.toLocaleString("pt-BR") : "—";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 12px", borderRadius: 8,
      background: exec.status === "error" ? "rgba(255,61,90,0.04)" : "transparent",
      borderBottom: `1px solid ${T.border}`,
      transition: "background 0.2s",
      fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
    }}
    onMouseEnter={e => e.currentTarget.style.background = exec.status === "error" ? "rgba(255,61,90,0.08)" : "rgba(255,255,255,0.02)"}
    onMouseLeave={e => e.currentTarget.style.background = exec.status === "error" ? "rgba(255,61,90,0.04)" : "transparent"}
    >
      <Badge status={exec.status} />
      <div style={{ flex: 1, color: T.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={wfName}>{wfName}</div>
      <div style={{ color: T.muted, minWidth: 130, fontSize: 11 }}>{dateStr}</div>
      <div style={{ color: T.muted, minWidth: 60, textAlign: "right" }}>
        {dur !== null ? `${dur}s` : "—"}
      </div>
      <div style={{ fontSize: 10, color: T.muted, minWidth: 40, textAlign: "right" }}>#{exec.id}</div>
    </div>
  );
}

function MiniChart({ data, color }) {
  const max = Math.max(...data, 1);
  const h = 40;
  const w = 200;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [executions, setExecutions] = useState([]); // accumulated
  const [workflows, setWorkflows] = useState({}); // id → name
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWorkflow, setFilterWorkflow] = useState("all");
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const syncTimer = useRef(null);

  // Load stored data on mount
  useEffect(() => {
    (async () => {
      const storedKey = await storageGet("n8n:apikey");
      const storedExecs = await storageGet("n8n:executions");
      const storedWfs = await storageGet("n8n:workflows");
      if (storedKey) { setApiKey(storedKey); setApiKeyInput(storedKey); }
      if (storedExecs) setExecutions(storedExecs);
      if (storedWfs) setWorkflows(storedWfs);
      if (storedKey && storedExecs) setConnected(true);
    })();
  }, []);

  const mergeExecutions = useCallback((newExecs, existing) => {
    const map = {};
    [...existing, ...newExecs].forEach(e => { map[e.id] = e; });
    return Object.values(map).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }, []);

  const fetchAll = useCallback(async (key) => {
    setSyncing(true);
    setError("");
    try {
      // Fetch workflows
      const wfRes = await n8nFetch("/workflows?limit=250", key);
      const wfMap = {};
      (wfRes.data || []).forEach(w => { wfMap[w.id] = w.name; });

      // Fetch executions (last 100 of each status)
      const statuses = ["error", "success", "waiting", "canceled"];
      const allNew = [];
      for (const st of statuses) {
        try {
          const res = await n8nFetch(`/executions?status=${st}&limit=100`, key);
          allNew.push(...(res.data || []));
        } catch {}
      }

      setWorkflows(wfMap);
      setExecutions(prev => {
        const merged = mergeExecutions(allNew, prev);
        storageSet("n8n:executions", merged.slice(0, 5000)); // keep up to 5000
        return merged;
      });
      await storageSet("n8n:workflows", wfMap);
      setLastSync(new Date());
    } catch (e) {
      setError("Erro ao buscar dados: " + e.message);
    } finally {
      setSyncing(false);
    }
  }, [mergeExecutions]);

  const connect = async () => {
    setLoading(true);
    setError("");
    try {
      // Test connection
      await n8nFetch("/workflows?limit=1", apiKeyInput);
      setApiKey(apiKeyInput);
      await storageSet("n8n:apikey", apiKeyInput);
      setConnected(true);
      await fetchAll(apiKeyInput);
    } catch (e) {
      setError("Não foi possível conectar. Verifique a API Key e se o CORS está habilitado no seu n8n.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-sync every 2 minutes
  useEffect(() => {
    if (!connected || !apiKey) return;
    syncTimer.current = setInterval(() => fetchAll(apiKey), 120_000);
    return () => clearInterval(syncTimer.current);
  }, [connected, apiKey, fetchAll]);

  // ── Derived stats ──
  const errExecs = executions.filter(e => e.status === "error");
  const successExecs = executions.filter(e => e.status === "success");
  const errorRate = executions.length ? ((errExecs.length / executions.length) * 100).toFixed(1) : "0";

  // Last 14 days chart data (errors per day)
  const chartData = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return errExecs.filter(e => e.startedAt?.startsWith(key)).length;
  });

  const wfList = Object.entries(workflows);
  const filtered = executions.filter(e => {
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (filterWorkflow !== "all" && e.workflowId !== filterWorkflow) return false;
    return true;
  });

  // ── LOGIN SCREEN ──
  if (!connected) {
    return (
      <div style={{
        minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'JetBrains Mono', monospace",
        backgroundImage: "radial-gradient(ellipse at 30% 20%, rgba(0,232,135,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(61,157,255,0.04) 0%, transparent 60%)",
      }}>
        <div style={{ width: 420, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: 40 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: T.white, marginBottom: 4 }}>
            n8n<span style={{ color: T.green }}>Monitor</span>
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 32, letterSpacing: "0.5px" }}>
            Histórico ilimitado · Falhas em destaque · Filtros avançados
          </div>

          <div style={{ fontSize: 10, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>Instância</div>
          <div style={{
            background: "rgba(61,157,255,0.06)", border: `1px solid ${T.border}`,
            borderRadius: 8, padding: "10px 14px", fontSize: 12, color: T.blue, marginBottom: 20
          }}>{N8N_BASE}</div>

          <div style={{ fontSize: 10, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 8 }}>API Key</div>
          <input
            type="password"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && connect()}
            placeholder="Cole sua X-N8N-API-KEY aqui"
            style={{
              width: "100%", background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: "12px 14px", fontSize: 12, color: T.white,
              outline: "none", fontFamily: "'JetBrains Mono', monospace",
              marginBottom: 8,
            }}
          />
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 24 }}>
            Gere em: Settings → API → Create API Key
          </div>

          {error && <div style={{ background: "rgba(255,61,90,0.1)", border: `1px solid ${T.red}`, borderRadius: 8, padding: "10px 14px", fontSize: 11, color: T.red, marginBottom: 16 }}>{error}</div>}

          <button onClick={connect} disabled={loading || !apiKeyInput}
            style={{
              width: "100%", background: loading ? T.muted : T.green, color: T.bg,
              border: "none", borderRadius: 8, padding: "13px", fontSize: 13, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer", fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "1px", transition: "background 0.2s",
            }}>
            {loading ? "CONECTANDO..." : "CONECTAR"}
          </button>
        </div>
      </div>
    );
  }

  // ── DASHBOARD ──
  return (
    <div style={{
      minHeight: "100vh", background: T.bg, padding: "24px",
      fontFamily: "'JetBrains Mono', monospace", color: T.text,
      backgroundImage: "radial-gradient(ellipse at 10% 0%, rgba(0,232,135,0.03) 0%, transparent 50%), radial-gradient(ellipse at 90% 90%, rgba(61,157,255,0.04) 0%, transparent 50%)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28, borderBottom: `1px solid ${T.border}`, paddingBottom: 18 }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: T.white }}>
            n8n<span style={{ color: T.green }}>Monitor</span>
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
            {N8N_BASE} · {executions.length.toLocaleString("pt-BR")} execuções armazenadas
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {lastSync && <div style={{ fontSize: 10, color: T.muted }}>sync {lastSync.toLocaleTimeString("pt-BR")}</div>}
          <button onClick={() => fetchAll(apiKey)} disabled={syncing}
            style={{
              background: syncing ? T.border : "rgba(0,232,135,0.1)", color: syncing ? T.muted : T.green,
              border: `1px solid ${syncing ? T.border : T.green}`, borderRadius: 8,
              padding: "8px 16px", fontSize: 11, cursor: syncing ? "not-allowed" : "pointer",
              fontFamily: "'JetBrains Mono', monospace", letterSpacing: "1px",
            }}>{syncing ? "SYNC..." : "↻ SYNC"}</button>
          <button onClick={() => { setConnected(false); setApiKey(""); }}
            style={{ background: "transparent", color: T.muted, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 14px", fontSize: 11, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>
            SAIR
          </button>
        </div>
      </div>

      {error && <div style={{ background: "rgba(255,61,90,0.1)", border: `1px solid ${T.red}`, borderRadius: 8, padding: "10px 16px", fontSize: 11, color: T.red, marginBottom: 20 }}>{error}</div>}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        <StatCard label="Total armazenado" value={executions.length.toLocaleString("pt-BR")} sub="histórico acumulado" accent={T.blue} color={T.blue} />
        <StatCard label="Com falha" value={errExecs.length} sub={`${errorRate}% taxa de erro`} accent={T.red} color={T.red} />
        <StatCard label="Com sucesso" value={successExecs.length} sub="execuções ok" accent={T.green} color={T.green} />
        <StatCard label="Workflows" value={wfList.length} sub="monitorados" accent={T.yellow} color={T.yellow} />
      </div>

      {/* Chart + top errors */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 10, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
            <span>Erros — últimos 14 dias</span>
            <span style={{ color: T.red }}>{errExecs.length} total</span>
          </div>
          <MiniChart data={chartData} color={T.red} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.muted, marginTop: 6 }}>
            <span>14 dias atrás</span><span>hoje</span>
          </div>
        </div>

        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 20 }}>
          <div style={{ fontSize: 10, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 16 }}>
            Workflows com mais falhas
          </div>
          {(() => {
            const wfErrCount = {};
            errExecs.forEach(e => { wfErrCount[e.workflowId] = (wfErrCount[e.workflowId] || 0) + 1; });
            return Object.entries(wfErrCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, cnt]) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: T.white, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={workflows[id]}>
                  {workflows[id] || id}
                </div>
                <div style={{ height: 4, borderRadius: 2, background: T.red, opacity: 0.7, width: `${Math.min((cnt / errExecs.length) * 200, 80)}px` }} />
                <div style={{ fontSize: 11, color: T.red, minWidth: 24, textAlign: "right" }}>{cnt}</div>
              </div>
            ));
          })()}
          {errExecs.length === 0 && <div style={{ fontSize: 12, color: T.muted }}>Nenhuma falha registrada 🎉</div>}
        </div>
      </div>

      {/* Filters + Table */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 20 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 18, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 10, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase", marginRight: 4 }}>Filtrar</div>

          {/* Status filter */}
          {["all", "error", "success", "waiting", "canceled"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              style={{
                background: filterStatus === s ? (s === "error" ? T.red : s === "success" ? T.green : s === "waiting" ? T.yellow : T.blue) : "transparent",
                color: filterStatus === s ? T.bg : T.muted,
                border: `1px solid ${filterStatus === s ? "transparent" : T.border}`,
                borderRadius: 6, padding: "5px 12px", fontSize: 10, cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: "1px", fontWeight: 700,
                transition: "all 0.15s",
              }}>
              {s === "all" ? "TODOS" : s === "error" ? "ERRO" : s === "success" ? "OK" : s === "waiting" ? "AGUARDANDO" : "CANCELADO"}
            </button>
          ))}

          <div style={{ borderLeft: `1px solid ${T.border}`, height: 20, margin: "0 4px" }} />

          {/* Workflow filter */}
          <select value={filterWorkflow} onChange={e => setFilterWorkflow(e.target.value)}
            style={{
              background: T.bg, color: T.text, border: `1px solid ${T.border}`,
              borderRadius: 6, padding: "5px 10px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer", outline: "none",
            }}>
            <option value="all">Todos os workflows</option>
            {wfList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>

          <div style={{ marginLeft: "auto", fontSize: 10, color: T.muted }}>
            {filtered.length} resultado{filtered.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Table header */}
        <div style={{ display: "flex", gap: 12, padding: "6px 12px", fontSize: 9, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase", borderBottom: `1px solid ${T.border}`, marginBottom: 4 }}>
          <div style={{ minWidth: 70 }}>Status</div>
          <div style={{ flex: 1 }}>Workflow</div>
          <div style={{ minWidth: 130 }}>Iniciado em</div>
          <div style={{ minWidth: 60, textAlign: "right" }}>Duração</div>
          <div style={{ minWidth: 40, textAlign: "right" }}>ID</div>
        </div>

        {/* Rows */}
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: T.muted, fontSize: 12 }}>
              {executions.length === 0 ? "Clique em SYNC para carregar execuções do seu n8n." : "Nenhuma execução encontrada com os filtros aplicados."}
            </div>
          )}
          {filtered.slice(0, 200).map(exec => (
            <ExecRow key={exec.id} exec={exec} workflows={workflows} />
          ))}
          {filtered.length > 200 && (
            <div style={{ textAlign: "center", padding: 12, color: T.muted, fontSize: 11 }}>
              Mostrando 200 de {filtered.length}. Use os filtros para refinar.
            </div>
          )}
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 20, fontSize: 10, color: T.muted }}>
        Os dados são salvos localmente neste dispositivo · Sincroniza automaticamente a cada 2 min
      </div>
    </div>
  );
}
