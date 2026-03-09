import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase,
  upsertWorkflows,
  loadWorkflows,
  upsertExecutions,
  loadExecutions,
  countExecutions,
  saveExecutionDetail,
  loadExecutionDetail,
} from "./lib/supabase.js";

const N8N_BASE = "/api/v1";
const N8N_DISPLAY_URL = "n8n.developern8n.org";

// ── n8n API fetch ──────────────────────────────────────────────────────
async function n8nFetch(path, apiKey) {
  const res = await fetch(`${N8N_BASE}${path}`, {
    headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── THEME ──────────────────────────────────────────────────────────────
const T = {
  bg: "#07090f",
  surface: "#0d1117",
  surfaceHover: "#111820",
  border: "#1c2a45",
  borderHover: "#2d4070",
  red: "#ff3d5a",
  redDim: "rgba(255,61,90,0.12)",
  green: "#00e887",
  greenDim: "rgba(0,232,135,0.10)",
  yellow: "#ffcc00",
  yellowDim: "rgba(255,204,0,0.10)",
  blue: "#3d9dff",
  blueDim: "rgba(61,157,255,0.10)",
  muted: "#3d5070",
  text: "#a8c0e0",
  white: "#e8f0ff",
};

// ── HOOKS ──────────────────────────────────────────────────────────────
function useIsMobile(bp = 768) {
  const [m, setM] = useState(window.innerWidth < bp);
  useEffect(() => {
    const h = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [bp]);
  return m;
}

// ── COMPONENTS ─────────────────────────────────────────────────────────

function Badge({ status }) {
  const map = {
    error: { bg: T.redDim, color: T.red, label: "ERRO" },
    success: { bg: T.greenDim, color: T.green, label: "OK" },
    waiting: { bg: T.yellowDim, color: T.yellow, label: "ESPERA" },
    canceled: { bg: "rgba(61,93,112,0.2)", color: T.muted, label: "CANCEL" },
    running: { bg: T.blueDim, color: T.blue, label: "EXEC" },
  };
  const s = map[status] || map.canceled;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "1.2px",
        padding: "3px 8px",
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function StatCard({ label, value, sub, color = T.white, accent, isMobile }) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: isMobile ? "14px 16px" : "20px 22px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${accent || T.border}, transparent)`,
        }}
      />
      <div
        style={{
          fontSize: 10,
          color: T.muted,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: isMobile ? 26 : 34,
          fontWeight: 700,
          color,
          fontFamily: "'Inter', sans-serif",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MiniChart({ data, color }) {
  const max = Math.max(...data, 1);
  const h = 48;
  const w = 300;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (v / max) * (h - 6) - 3;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPath = `M0,${h} ${data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - (v / max) * (h - 6) - 3;
      return `L${x},${y}`;
    })
    .join(" ")} L${w},${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#grad-${color})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExecRow({ exec, workflows, expanded, onToggle, detail, loadingDetail, isMobile }) {
  const wfName = workflows[exec.workflowId] || exec.workflowId;
  const started = exec.startedAt ? new Date(exec.startedAt) : null;
  const ended = exec.stoppedAt ? new Date(exec.stoppedAt) : null;
  const dur = started && ended ? Math.round((ended - started) / 1000) : null;
  const dateStr = started ? started.toLocaleString("pt-BR") : "—";

  const errorInfo = (() => {
    if (!detail) return null;
    // detail can come from n8n API (full) or from Supabase (summarized)
    if (detail._fromSupabase) {
      return {
        topError: detail.error_message
          ? {
              message: detail.error_message,
              description: detail.error_description,
              node: detail.error_node ? { name: detail.error_node } : null,
            }
          : null,
        failedNodes: (detail.failed_nodes || []).map((n) => ({
          name: n.name,
          message: n.message,
          type: n.type || "Error",
        })),
        runData: detail.run_data,
      };
    }
    const result = detail.data?.resultData;
    if (!result) return null;
    const topError = result.error;
    const failedNodes = [];
    if (result.runData) {
      for (const [nodeName, nodeRuns] of Object.entries(result.runData)) {
        for (const run of nodeRuns) {
          if (run.error) {
            failedNodes.push({
              name: nodeName,
              message: run.error.message || run.error.description || JSON.stringify(run.error),
              type: run.error.name || "Error",
            });
          }
        }
      }
    }
    return { topError, failedNodes, runData: result.runData };
  })();

  // Mobile layout: card style
  if (isMobile) {
    return (
      <div style={{ borderBottom: `1px solid ${T.border}` }}>
        <div
          onClick={() => onToggle(exec.id)}
          style={{
            padding: "12px 14px",
            background: exec.status === "error" ? "rgba(255,61,90,0.04)" : "transparent",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              style={{
                fontSize: 8,
                color: T.muted,
                transition: "transform 0.2s",
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                display: "inline-block",
              }}
            >
              ▶
            </span>
            <Badge status={exec.status} />
            <span style={{ fontSize: 9, color: T.muted, marginLeft: "auto" }}>#{exec.id}</span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: T.white,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginBottom: 4,
            }}
          >
            {wfName}
          </div>
          <div style={{ display: "flex", gap: 12, fontSize: 10, color: T.muted }}>
            <span>{dateStr}</span>
            {dur !== null && <span>{dur}s</span>}
          </div>
        </div>
        {expanded && <DetailPanel exec={exec} detail={detail} errorInfo={errorInfo} loadingDetail={loadingDetail} isMobile={isMobile} />}
      </div>
    );
  }

  // Desktop layout: table row
  return (
    <div style={{ borderBottom: `1px solid ${T.border}` }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          borderRadius: 6,
          background: exec.status === "error" ? "rgba(255,61,90,0.04)" : "transparent",
          transition: "background 0.15s",
          fontSize: 12,
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => onToggle(exec.id)}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background =
            exec.status === "error" ? "rgba(255,61,90,0.08)" : "rgba(255,255,255,0.02)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background =
            exec.status === "error" ? "rgba(255,61,90,0.04)" : "transparent")
        }
      >
        <span
          style={{
            fontSize: 9,
            color: T.muted,
            transition: "transform 0.2s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            width: 12,
          }}
        >
          ▶
        </span>
        <Badge status={exec.status} />
        <div
          style={{
            flex: 1,
            color: T.white,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: 500,
          }}
          title={wfName}
        >
          {wfName}
        </div>
        <div style={{ color: T.muted, minWidth: 140, fontSize: 11 }}>{dateStr}</div>
        <div style={{ color: T.muted, minWidth: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {dur !== null ? `${dur}s` : "—"}
        </div>
        <div style={{ fontSize: 10, color: T.muted, minWidth: 50, textAlign: "right" }}>
          #{exec.id}
        </div>
      </div>
      {expanded && <DetailPanel exec={exec} detail={detail} errorInfo={errorInfo} loadingDetail={loadingDetail} isMobile={isMobile} />}
    </div>
  );
}

function DetailPanel({ exec, detail, errorInfo, loadingDetail, isMobile }) {
  return (
    <div
      style={{
        padding: isMobile ? "12px 14px" : "14px 18px 18px 40px",
        background: exec.status === "error" ? "rgba(255,61,90,0.02)" : "rgba(61,157,255,0.02)",
        borderTop: `1px dashed ${T.border}`,
      }}
    >
      {loadingDetail && <div style={{ fontSize: 11, color: T.muted, padding: "8px 0" }}>Carregando detalhes...</div>}

      {!loadingDetail && !detail && (
        <div style={{ fontSize: 11, color: T.muted, padding: "8px 0" }}>
          Detalhes não disponíveis para esta execução.
        </div>
      )}

      {!loadingDetail && detail && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Info geral */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11 }}>
            <div>
              <span style={{ color: T.muted }}>Modo: </span>
              <span style={{ color: T.text }}>{detail.mode || exec.mode || "—"}</span>
            </div>
            <div>
              <span style={{ color: T.muted }}>Workflow: </span>
              <span style={{ color: T.text }}>{exec.workflowId}</span>
            </div>
          </div>

          {/* Erro principal */}
          {errorInfo?.topError && (
            <div
              style={{
                background: "rgba(255,61,90,0.06)",
                border: `1px solid rgba(255,61,90,0.18)`,
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: T.red,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  marginBottom: 6,
                  fontWeight: 700,
                }}
              >
                ERRO PRINCIPAL
              </div>
              <div style={{ fontSize: 12, color: T.white, lineHeight: 1.5, wordBreak: "break-word" }}>
                {errorInfo.topError.message || JSON.stringify(errorInfo.topError)}
              </div>
              {errorInfo.topError.description && (
                <div style={{ fontSize: 11, color: T.text, marginTop: 6, lineHeight: 1.4 }}>
                  {errorInfo.topError.description}
                </div>
              )}
              {errorInfo.topError.node && (
                <div style={{ fontSize: 10, color: T.muted, marginTop: 8 }}>
                  Nó:{" "}
                  <span style={{ color: T.yellow }}>
                    {errorInfo.topError.node.name || errorInfo.topError.node}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Nós que falharam */}
          {errorInfo?.failedNodes?.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  color: T.red,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  marginBottom: 8,
                  fontWeight: 700,
                }}
              >
                NÓS COM ERRO ({errorInfo.failedNodes.length})
              </div>
              {errorInfo.failedNodes.map((node, idx) => (
                <div
                  key={idx}
                  style={{
                    background: "rgba(255,61,90,0.04)",
                    border: `1px solid rgba(255,61,90,0.12)`,
                    borderRadius: 6,
                    padding: "10px 12px",
                    marginBottom: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: T.yellow, fontWeight: 700 }}>{node.name}</span>
                    <span
                      style={{
                        fontSize: 9,
                        color: T.muted,
                        background: "rgba(255,61,90,0.12)",
                        padding: "2px 6px",
                        borderRadius: 3,
                      }}
                    >
                      {node.type}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: T.white, lineHeight: 1.4, wordBreak: "break-word" }}>
                    {node.message}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pipeline */}
          {errorInfo?.runData && (
            <div>
              <div
                style={{
                  fontSize: 9,
                  color: T.muted,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                PIPELINE
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(errorInfo.runData).map(([nodeName, runs]) => {
                  const runsArr = Array.isArray(runs) ? runs : [runs];
                  const hasError = runsArr.some((r) => r.error);
                  const itemCount = runsArr.reduce((acc, r) => {
                    if (r.itemCount !== undefined) return acc + r.itemCount;
                    const main = r.data?.main;
                    if (main) {
                      for (const output of main) if (output) acc += output.length;
                    }
                    return acc;
                  }, 0);
                  return (
                    <div
                      key={nodeName}
                      style={{
                        fontSize: 10,
                        padding: "4px 10px",
                        borderRadius: 4,
                        background: hasError ? T.redDim : T.greenDim,
                        color: hasError ? T.red : T.green,
                        border: `1px solid ${hasError ? "rgba(255,61,90,0.18)" : "rgba(0,232,135,0.15)"}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span>{nodeName}</span>
                      {itemCount > 0 && (
                        <span style={{ fontSize: 9, color: T.muted }}>({itemCount})</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────────────
export default function App() {
  const isMobile = useIsMobile();

  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [executions, setExecutions] = useState([]);
  const [workflows, setWorkflows] = useState({});
  const [counts, setCounts] = useState({ total: 0, errors: 0, success: 0 });
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWorkflow, setFilterWorkflow] = useState("all");
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [expandedExec, setExpandedExec] = useState(null);
  const [execDetails, setExecDetails] = useState({});
  const [loadingDetail, setLoadingDetail] = useState(null);

  const syncTimer = useRef(null);

  // ── Load from Supabase on mount ──
  useEffect(() => {
    (async () => {
      const storedKey = localStorage.getItem("n8n:apikey");
      if (storedKey) {
        setApiKey(storedKey);
        setApiKeyInput(storedKey);
      }

      try {
        const [wfs, execs, cnts] = await Promise.all([
          loadWorkflows(),
          loadExecutions({ limit: 500 }),
          countExecutions(),
        ]);
        setWorkflows(wfs);
        setExecutions(execs);
        setCounts(cnts);
        if (storedKey && cnts.total > 0) setConnected(true);
      } catch (e) {
        console.error("Load from Supabase failed:", e);
      }
    })();
  }, []);

  // ── Reload filtered data when filters change ──
  useEffect(() => {
    if (!connected) return;
    (async () => {
      const execs = await loadExecutions({
        status: filterStatus,
        workflowId: filterWorkflow,
        limit: 500,
      });
      setExecutions(execs);
    })();
  }, [filterStatus, filterWorkflow, connected]);

  const fetchAll = useCallback(
    async (key) => {
      setSyncing(true);
      setError("");
      try {
        // Fetch workflows from n8n
        const wfRes = await n8nFetch("/workflows?limit=250", key);
        const wfMap = {};
        (wfRes.data || []).forEach((w) => (wfMap[w.id] = w.name));

        // Fetch executions from n8n
        const statuses = ["error", "success", "waiting", "canceled"];
        const allNew = [];
        for (const st of statuses) {
          try {
            const res = await n8nFetch(`/executions?status=${st}&limit=100`, key);
            allNew.push(...(res.data || []));
          } catch {}
        }

        // Save to Supabase
        await Promise.all([upsertWorkflows(wfMap), upsertExecutions(allNew)]);

        // Reload from Supabase
        const [freshWfs, freshExecs, freshCnts] = await Promise.all([
          loadWorkflows(),
          loadExecutions({ status: filterStatus, workflowId: filterWorkflow, limit: 500 }),
          countExecutions(),
        ]);

        setWorkflows(freshWfs);
        setExecutions(freshExecs);
        setCounts(freshCnts);
        setLastSync(new Date());
      } catch (e) {
        setError("Erro ao sincronizar: " + e.message);
      } finally {
        setSyncing(false);
      }
    },
    [filterStatus, filterWorkflow]
  );

  const toggleExecDetail = useCallback(
    async (execId) => {
      if (expandedExec === execId) {
        setExpandedExec(null);
        return;
      }
      setExpandedExec(execId);
      if (execDetails[execId]) return;

      setLoadingDetail(execId);
      try {
        // Try Supabase first
        const cached = await loadExecutionDetail(execId);
        if (cached) {
          setExecDetails((prev) => ({ ...prev, [execId]: { ...cached, _fromSupabase: true } }));
          setLoadingDetail(null);
          return;
        }

        // Fetch from n8n API
        const detail = await n8nFetch(`/executions/${execId}?includeData=true`, apiKey);
        setExecDetails((prev) => ({ ...prev, [execId]: detail }));

        // Save to Supabase for future
        await saveExecutionDetail(execId, detail);
      } catch (e) {
        console.error("Erro ao buscar detalhes:", e);
        setExecDetails((prev) => ({ ...prev, [execId]: null }));
      } finally {
        setLoadingDetail(null);
      }
    },
    [expandedExec, execDetails, apiKey]
  );

  const connect = async () => {
    setLoading(true);
    setError("");
    try {
      await n8nFetch("/workflows?limit=1", apiKeyInput);
      setApiKey(apiKeyInput);
      localStorage.setItem("n8n:apikey", apiKeyInput);
      setConnected(true);
      await fetchAll(apiKeyInput);
    } catch {
      setError("Não foi possível conectar. Verifique a API Key.");
    } finally {
      setLoading(false);
    }
  };

  const disconnect = () => {
    setConnected(false);
    setApiKey("");
    localStorage.removeItem("n8n:apikey");
  };

  // Auto-sync every 2 minutes
  useEffect(() => {
    if (!connected || !apiKey) return;
    syncTimer.current = setInterval(() => fetchAll(apiKey), 120_000);
    return () => clearInterval(syncTimer.current);
  }, [connected, apiKey, fetchAll]);

  // ── Derived stats ──
  const errorRate = counts.total ? ((counts.errors / counts.total) * 100).toFixed(1) : "0";

  // Last 14 days chart (from current loaded executions)
  const errExecs = executions.filter((e) => e.status === "error");
  const chartData = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return errExecs.filter((e) => e.startedAt?.startsWith(key)).length;
  });

  const wfList = Object.entries(workflows);

  // ── LOGIN SCREEN ──
  if (!connected) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: T.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          fontFamily: "'Inter', sans-serif",
          backgroundImage:
            "radial-gradient(ellipse at 30% 20%, rgba(0,232,135,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(61,157,255,0.04) 0%, transparent 60%)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 16,
            padding: isMobile ? 24 : 40,
          }}
        >
          <div
            style={{
              fontSize: isMobile ? 22 : 28,
              fontWeight: 800,
              color: T.white,
              marginBottom: 4,
              letterSpacing: "-0.5px",
            }}
          >
            n8n<span style={{ color: T.green }}>Monitor</span>
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginBottom: 28, letterSpacing: "0.3px" }}>
            Histórico permanente · Falhas em destaque · Filtros avançados
          </div>

          <label style={labelStyle}>Instância</label>
          <div
            style={{
              background: T.blueDim,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 12,
              color: T.blue,
              marginBottom: 20,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {N8N_DISPLAY_URL}
          </div>

          <label style={labelStyle}>API Key</label>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            placeholder="Cole sua X-N8N-API-KEY aqui"
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: T.muted, marginBottom: 24 }}>
            Gere em: Settings → API → Create API Key
          </div>

          {error && <div style={errorBoxStyle}>{error}</div>}

          <button onClick={connect} disabled={loading || !apiKeyInput} style={btnPrimaryStyle(loading)}>
            {loading ? "CONECTANDO..." : "CONECTAR"}
          </button>
        </div>
      </div>
    );
  }

  // ── DASHBOARD ──
  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        padding: isMobile ? "16px 12px" : "24px 32px",
        fontFamily: "'Inter', sans-serif",
        color: T.text,
        backgroundImage:
          "radial-gradient(ellipse at 10% 0%, rgba(0,232,135,0.03) 0%, transparent 50%), radial-gradient(ellipse at 90% 90%, rgba(61,157,255,0.04) 0%, transparent 50%)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: isMobile ? "flex-start" : "center",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 12 : 0,
          marginBottom: 24,
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: T.white, letterSpacing: "-0.5px" }}>
            n8n<span style={{ color: T.green }}>Monitor</span>
          </div>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
            {N8N_DISPLAY_URL} · {counts.total.toLocaleString("pt-BR")} execuções salvas
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {lastSync && (
            <div style={{ fontSize: 10, color: T.muted }}>
              sync {lastSync.toLocaleTimeString("pt-BR")}
            </div>
          )}
          <button
            onClick={() => fetchAll(apiKey)}
            disabled={syncing}
            style={{
              background: syncing ? T.border : T.greenDim,
              color: syncing ? T.muted : T.green,
              border: `1px solid ${syncing ? T.border : "rgba(0,232,135,0.3)"}`,
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 11,
              fontWeight: 600,
              cursor: syncing ? "not-allowed" : "pointer",
              fontFamily: "'Inter', sans-serif",
              letterSpacing: "0.5px",
              transition: "all 0.15s",
            }}
          >
            {syncing ? "SYNC..." : "↻ SYNC"}
          </button>
          <button onClick={disconnect} style={btnOutlineStyle}>
            SAIR
          </button>
        </div>
      </div>

      {error && <div style={{ ...errorBoxStyle, marginBottom: 20 }}>{error}</div>}

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
          gap: isMobile ? 10 : 14,
          marginBottom: 20,
        }}
      >
        <StatCard
          label="Total salvo"
          value={counts.total.toLocaleString("pt-BR")}
          sub="no banco de dados"
          accent={T.blue}
          color={T.blue}
          isMobile={isMobile}
        />
        <StatCard
          label="Falhas"
          value={counts.errors.toLocaleString("pt-BR")}
          sub={`${errorRate}% taxa de erro`}
          accent={T.red}
          color={T.red}
          isMobile={isMobile}
        />
        <StatCard
          label="Sucesso"
          value={counts.success.toLocaleString("pt-BR")}
          sub="execuções ok"
          accent={T.green}
          color={T.green}
          isMobile={isMobile}
        />
        <StatCard
          label="Workflows"
          value={wfList.length}
          sub="monitorados"
          accent={T.yellow}
          color={T.yellow}
          isMobile={isMobile}
        />
      </div>

      {/* Chart + Top errors */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: isMobile ? 10 : 14,
          marginBottom: 20,
        }}
      >
        {/* Chart */}
        <div
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: isMobile ? 14 : 20,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: T.muted,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              marginBottom: 14,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>Erros — 14 dias</span>
            <span style={{ color: T.red }}>{counts.errors} total</span>
          </div>
          <MiniChart data={chartData} color={T.red} />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 9,
              color: T.muted,
              marginTop: 6,
            }}
          >
            <span>14d atrás</span>
            <span>hoje</span>
          </div>
        </div>

        {/* Top error workflows */}
        <div
          style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            padding: isMobile ? 14 : 20,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: T.muted,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Workflows com mais falhas
          </div>
          {(() => {
            const wfErrCount = {};
            errExecs.forEach((e) => {
              wfErrCount[e.workflowId] = (wfErrCount[e.workflowId] || 0) + 1;
            });
            const top = Object.entries(wfErrCount)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);
            if (top.length === 0)
              return <div style={{ fontSize: 12, color: T.muted }}>Nenhuma falha nos dados carregados</div>;
            const maxCnt = top[0]?.[1] || 1;
            return top.map(([id, cnt]) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: T.white,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={workflows[id]}
                >
                  {workflows[id] || id}
                </div>
                <div
                  style={{
                    height: 4,
                    borderRadius: 2,
                    background: T.red,
                    opacity: 0.6,
                    width: `${Math.max((cnt / maxCnt) * 80, 8)}px`,
                    transition: "width 0.3s",
                  }}
                />
                <div style={{ fontSize: 11, color: T.red, minWidth: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {cnt}
                </div>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Filters + Table */}
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: isMobile ? 12 : 20,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: T.muted,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              marginRight: 4,
            }}
          >
            Filtrar
          </div>

          {["all", "error", "success", "waiting", "canceled"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                background:
                  filterStatus === s
                    ? s === "error"
                      ? T.red
                      : s === "success"
                        ? T.green
                        : s === "waiting"
                          ? T.yellow
                          : T.blue
                    : "transparent",
                color: filterStatus === s ? T.bg : T.muted,
                border: `1px solid ${filterStatus === s ? "transparent" : T.border}`,
                borderRadius: 6,
                padding: isMobile ? "4px 8px" : "5px 12px",
                fontSize: isMobile ? 9 : 10,
                cursor: "pointer",
                fontFamily: "'Inter', sans-serif",
                letterSpacing: "0.5px",
                fontWeight: 700,
                transition: "all 0.15s",
              }}
            >
              {s === "all" ? "TODOS" : s === "error" ? "ERRO" : s === "success" ? "OK" : s === "waiting" ? "ESPERA" : "CANCEL"}
            </button>
          ))}

          {!isMobile && <div style={{ borderLeft: `1px solid ${T.border}`, height: 20, margin: "0 2px" }} />}

          <select
            value={filterWorkflow}
            onChange={(e) => setFilterWorkflow(e.target.value)}
            style={{
              background: T.bg,
              color: T.text,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 11,
              fontFamily: "'Inter', sans-serif",
              cursor: "pointer",
              outline: "none",
              maxWidth: isMobile ? "100%" : 220,
            }}
          >
            <option value="all">Todos os workflows</option>
            {wfList.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          <div style={{ marginLeft: "auto", fontSize: 10, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
            {executions.length} resultado{executions.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Table header (desktop only) */}
        {!isMobile && (
          <div
            style={{
              display: "flex",
              gap: 12,
              padding: "6px 12px",
              fontSize: 9,
              color: T.muted,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              borderBottom: `1px solid ${T.border}`,
              marginBottom: 4,
            }}
          >
            <div style={{ width: 12 }} />
            <div style={{ minWidth: 56 }}>Status</div>
            <div style={{ flex: 1 }}>Workflow</div>
            <div style={{ minWidth: 140 }}>Data</div>
            <div style={{ minWidth: 60, textAlign: "right" }}>Duração</div>
            <div style={{ minWidth: 50, textAlign: "right" }}>ID</div>
          </div>
        )}

        {/* Rows */}
        <div style={{ maxHeight: isMobile ? "60vh" : 500, overflowY: "auto" }}>
          {executions.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: T.muted, fontSize: 12 }}>
              {counts.total === 0
                ? "Clique em SYNC para carregar execuções do n8n."
                : "Nenhuma execução com os filtros aplicados."}
            </div>
          )}
          {executions.slice(0, 200).map((exec) => (
            <ExecRow
              key={exec.id}
              exec={exec}
              workflows={workflows}
              expanded={expandedExec === exec.id}
              onToggle={toggleExecDetail}
              detail={execDetails[exec.id]}
              loadingDetail={loadingDetail === exec.id}
              isMobile={isMobile}
            />
          ))}
          {executions.length > 200 && (
            <div style={{ textAlign: "center", padding: 12, color: T.muted, fontSize: 11 }}>
              Mostrando 200 de {executions.length}. Use os filtros para refinar.
            </div>
          )}
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: T.muted }}>
        Dados salvos no Supabase · Sincroniza automaticamente a cada 2 min
      </div>
    </div>
  );
}

// ── Shared Styles ──────────────────────────────────────────────────────

const labelStyle = {
  display: "block",
  fontSize: 10,
  color: T.muted,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  marginBottom: 8,
};

const inputStyle = {
  width: "100%",
  background: T.bg,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "12px 14px",
  fontSize: 13,
  color: T.white,
  outline: "none",
  fontFamily: "'Inter', sans-serif",
  marginBottom: 8,
  transition: "border-color 0.15s",
};

const errorBoxStyle = {
  background: "rgba(255,61,90,0.08)",
  border: `1px solid ${T.red}`,
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 11,
  color: T.red,
  marginBottom: 16,
};

const btnPrimaryStyle = (loading) => ({
  width: "100%",
  background: loading ? T.muted : T.green,
  color: T.bg,
  border: "none",
  borderRadius: 8,
  padding: "13px",
  fontSize: 13,
  fontWeight: 700,
  cursor: loading ? "not-allowed" : "pointer",
  fontFamily: "'Inter', sans-serif",
  letterSpacing: "0.5px",
  transition: "background 0.2s",
});

const btnOutlineStyle = {
  background: "transparent",
  color: T.muted,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "7px 14px",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'Inter', sans-serif",
  transition: "all 0.15s",
};
