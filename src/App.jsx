import { useState, useEffect, useCallback, useRef } from "react";
import {
  upsertWorkflows,
  loadWorkflows,
  upsertExecutions,
  loadExecutions,
  countExecutions,
  saveExecutionDetail,
  loadExecutionDetail,
  getExecutionsMissingDetails,
} from "./lib/supabase.js";

const N8N_BASE = "/api/v1";
const N8N_DISPLAY_URL = "n8n.developern8n.org";
const N8N_API_KEY = import.meta.env.VITE_N8N_API_KEY;

// ── n8n API fetch ──────────────────────────────────────────────────────
async function n8nFetch(path) {
  const res = await fetch(`${N8N_BASE}${path}`, {
    headers: { "X-N8N-API-KEY": N8N_API_KEY, Accept: "application/json" },
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
  const wfName = workflows[exec.workflowId]?.name || exec.workflowId;
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

function NodeDataViewer({ data, isMobile }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ fontSize: 11, color: T.muted, padding: "8px 0" }}>
        Sem dados de saída para este nó.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
      {data.map((item, idx) => (
        <div
          key={idx}
          style={{
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 9, color: T.muted, marginBottom: 6, fontWeight: 700 }}>
            ITEM {idx + 1}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {Object.entries(item).map(([key, val]) => (
              <div key={key} style={{ display: "flex", gap: 8, fontSize: 11, lineHeight: 1.5 }}>
                <span style={{
                  color: T.blue,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  minWidth: isMobile ? 80 : 120,
                  flexShrink: 0,
                  fontWeight: 600,
                }}>
                  {key}
                </span>
                <span style={{
                  color: T.white,
                  wordBreak: "break-word",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                }}>
                  {typeof val === "object" && val !== null
                    ? JSON.stringify(val, null, 2)
                    : String(val ?? "null")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {data.length >= 50 && (
        <div style={{ fontSize: 10, color: T.yellow, textAlign: "center", padding: 4 }}>
          Mostrando até 50 items (limite de armazenamento)
        </div>
      )}
    </div>
  );
}

function DetailPanel({ exec, detail, errorInfo, loadingDetail, isMobile }) {
  const [expandedNode, setExpandedNode] = useState(null);

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
                PIPELINE{" "}
                <span style={{ fontSize: 8, color: T.text, letterSpacing: 0, textTransform: "none" }}>
                  (clique para ver dados)
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(errorInfo.runData).map(([nodeName, runs]) => {
                  const runsArr = Array.isArray(runs) ? runs : [runs];
                  const hasError = runsArr.some((r) => r.error);
                  const hasData = runsArr.some((r) => r.outputData && r.outputData.length > 0);
                  const itemCount = runsArr.reduce((acc, r) => {
                    if (r.itemCount !== undefined) return acc + r.itemCount;
                    const main = r.data?.main;
                    if (main) {
                      for (const output of main) if (output) acc += output.length;
                    }
                    return acc;
                  }, 0);
                  const isExpanded = expandedNode === nodeName;
                  return (
                    <div
                      key={nodeName}
                      onClick={() => hasData && setExpandedNode(isExpanded ? null : nodeName)}
                      style={{
                        fontSize: 10,
                        padding: "4px 10px",
                        borderRadius: 4,
                        background: isExpanded
                          ? T.blueDim
                          : hasError
                            ? T.redDim
                            : T.greenDim,
                        color: isExpanded
                          ? T.blue
                          : hasError
                            ? T.red
                            : T.green,
                        border: `1px solid ${
                          isExpanded
                            ? "rgba(61,157,255,0.3)"
                            : hasError
                              ? "rgba(255,61,90,0.18)"
                              : "rgba(0,232,135,0.15)"
                        }`,
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        cursor: hasData ? "pointer" : "default",
                        transition: "all 0.15s",
                        opacity: hasData ? 1 : 0.7,
                      }}
                    >
                      <span>{nodeName}</span>
                      {itemCount > 0 && (
                        <span style={{ fontSize: 9, color: T.muted }}>({itemCount})</span>
                      )}
                      {hasData && (
                        <span style={{ fontSize: 8, opacity: 0.6 }}>
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {expandedNode && errorInfo.runData[expandedNode] && (
                <div style={{
                  marginTop: 10,
                  background: "rgba(0,0,0,0.2)",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  padding: isMobile ? 10 : 14,
                }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}>
                    <div style={{
                      fontSize: 10,
                      color: T.blue,
                      fontWeight: 700,
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                    }}>
                      {expandedNode} — Dados de saída
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedNode(null); }}
                      style={{
                        background: "transparent",
                        border: `1px solid ${T.border}`,
                        borderRadius: 4,
                        color: T.muted,
                        fontSize: 9,
                        padding: "2px 8px",
                        cursor: "pointer",
                        fontFamily: "'Inter', sans-serif",
                      }}
                    >
                      ✕ Fechar
                    </button>
                  </div>
                  <NodeDataViewer
                    data={(() => {
                      const runs = errorInfo.runData[expandedNode];
                      const runsArr = Array.isArray(runs) ? runs : [runs];
                      const allData = [];
                      for (const run of runsArr) {
                        if (run.outputData) allData.push(...run.outputData);
                      }
                      return allData;
                    })()}
                    isMobile={isMobile}
                  />
                </div>
              )}
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

  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");

  const [executions, setExecutions] = useState([]);
  const [workflows, setWorkflows] = useState({});
  const [counts, setCounts] = useState({ total: 0, errors: 0, success: 0 });
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWorkflow, setFilterWorkflow] = useState("all");
  const [filterScope, setFilterScope] = useState("active");
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [expandedExec, setExpandedExec] = useState(null);
  const [execDetails, setExecDetails] = useState({});
  const [loadingDetail, setLoadingDetail] = useState(null);
  const [detailSyncProgress, setDetailSyncProgress] = useState(null);

  const syncTimer = useRef(null);

  const scopedWfIds = Object.entries(workflows)
    .filter(([, w]) => filterScope === "active" ? w.active : !w.active)
    .map(([id]) => id);

  const deactivatedCount = Object.values(workflows).filter((w) => !w.active).length;

  // ── Load from Supabase on mount + first sync ──
  useEffect(() => {
    (async () => {
      try {
        const wfs = await loadWorkflows();
        const activeIds = Object.entries(wfs).filter(([, w]) => w.active).map(([id]) => id);
        const [execs, cnts] = await Promise.all([
          loadExecutions({ workflowIds: activeIds, limit: 500 }),
          countExecutions({ workflowIds: activeIds }),
        ]);
        setWorkflows(wfs);
        setExecutions(execs);
        setCounts(cnts);
      } catch (e) {
        console.error("Load from Supabase failed:", e);
      } finally {
        setInitialLoading(false);
      }
      fetchAll();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload filtered data when filters or scope change ──
  useEffect(() => {
    if (Object.keys(workflows).length === 0) return;
    (async () => {
      const ids = scopedWfIds;
      if (ids.length === 0) {
        setExecutions([]);
        setCounts({ total: 0, errors: 0, success: 0 });
        return;
      }
      const [execs, cnts] = await Promise.all([
        loadExecutions({
          status: filterStatus,
          workflowId: filterWorkflow,
          workflowIds: filterWorkflow !== "all" ? undefined : ids,
          limit: 500,
        }),
        countExecutions({ workflowIds: ids }),
      ]);
      setExecutions(execs);
      setCounts(cnts);
    })();
  }, [filterStatus, filterWorkflow, filterScope, workflows]); // eslint-disable-line react-hooks/exhaustive-deps

  const DETAIL_BATCH_SIZE = 5;

  const fetchAll = useCallback(
    async () => {
      setSyncing(true);
      setError("");
      try {
        const wfRes = await n8nFetch("/workflows?limit=250");
        const wfList = (wfRes.data || []).map((w) => ({
          id: String(w.id),
          name: w.name,
          active: w.active !== false,
        }));

        const statuses = ["error", "success", "waiting", "canceled"];
        const allNew = [];
        for (const st of statuses) {
          try {
            const res = await n8nFetch(`/executions?status=${st}&limit=100`);
            allNew.push(...(res.data || []));
          } catch {}
        }

        await Promise.all([upsertWorkflows(wfList), upsertExecutions(allNew)]);

        const freshWfs = await loadWorkflows();
        const ids = Object.entries(freshWfs)
          .filter(([, w]) => filterScope === "active" ? w.active : !w.active)
          .map(([id]) => id);

        const [freshExecs, freshCnts] = await Promise.all([
          loadExecutions({
            status: filterStatus,
            workflowId: filterWorkflow,
            workflowIds: filterWorkflow !== "all" ? undefined : ids,
            limit: 500,
          }),
          countExecutions({ workflowIds: ids }),
        ]);

        setWorkflows(freshWfs);
        setExecutions(freshExecs);
        setCounts(freshCnts);
        setLastSync(new Date());

        // Auto-fetch ALL missing details from Supabase
        const missingIds = await getExecutionsMissingDetails(500);

        if (missingIds.length > 0) {
          setDetailSyncProgress({ current: 0, total: missingIds.length });
          let fetched = 0;

          for (let i = 0; i < missingIds.length; i += DETAIL_BATCH_SIZE) {
            const batch = missingIds.slice(i, i + DETAIL_BATCH_SIZE);
            const results = await Promise.allSettled(
              batch.map((id) => n8nFetch(`/executions/${id}?includeData=true`))
            );

            for (let j = 0; j < results.length; j++) {
              if (results[j].status === "fulfilled") {
                const detail = results[j].value;
                await saveExecutionDetail(batch[j], detail);
                setExecDetails((prev) => ({ ...prev, [batch[j]]: { ...detail, _fromApi: true } }));
              } else {
                // n8n doesn't have this execution anymore — save empty detail to avoid retrying
                await saveExecutionDetail(batch[j], { data: { resultData: null } });
              }
            }

            fetched += batch.length;
            setDetailSyncProgress({ current: fetched, total: missingIds.length });
          }

          setDetailSyncProgress(null);
        }
      } catch (e) {
        setError("Erro ao sincronizar: " + e.message);
      } finally {
        setSyncing(false);
        setDetailSyncProgress(null);
      }
    },
    [filterStatus, filterWorkflow, filterScope]
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
        const detail = await n8nFetch(`/executions/${execId}?includeData=true`);
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
    [expandedExec, execDetails]
  );

  // Auto-sync every 2 minutes
  useEffect(() => {
    syncTimer.current = setInterval(() => fetchAll(), 120_000);
    return () => clearInterval(syncTimer.current);
  }, [fetchAll]);

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

  const wfList = Object.entries(workflows)
    .filter(([, w]) => filterScope === "active" ? w.active : !w.active);
  const activeWfCount = Object.values(workflows).filter((w) => w.active).length;

  // ── LOADING SCREEN ──
  if (initialLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: T.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: T.white, marginBottom: 8, letterSpacing: "-0.5px" }}>
            n8n<span style={{ color: T.green }}>Monitor</span>
          </div>
          <div style={{ fontSize: 12, color: T.muted }}>Carregando dados...</div>
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
            onClick={() => fetchAll()}
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
            {syncing
              ? detailSyncProgress
                ? `DETALHES ${detailSyncProgress.current}/${detailSyncProgress.total}`
                : "SYNC..."
              : "↻ SYNC"}
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
          value={activeWfCount}
          sub={deactivatedCount > 0 ? `${deactivatedCount} despublicado${deactivatedCount !== 1 ? "s" : ""}` : "publicados"}
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
                  title={workflows[id]?.name}
                >
                  {workflows[id]?.name || id}
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
        {/* Scope selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[
            { key: "active", label: "Publicados", color: T.green },
            { key: "deactivated", label: `Despublicados — Auditoria${deactivatedCount > 0 ? ` (${deactivatedCount})` : ""}`, color: T.yellow },
          ].map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => { setFilterScope(key); setFilterWorkflow("all"); }}
              style={{
                background: filterScope === key ? color : "transparent",
                color: filterScope === key ? T.bg : T.muted,
                border: `1px solid ${filterScope === key ? "transparent" : T.border}`,
                borderRadius: 6,
                padding: isMobile ? "5px 10px" : "6px 14px",
                fontSize: isMobile ? 9 : 10,
                cursor: "pointer",
                fontFamily: "'Inter', sans-serif",
                letterSpacing: "0.5px",
                fontWeight: 700,
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {filterScope === "deactivated" && deactivatedCount > 0 && (
          <div style={{
            background: T.yellowDim,
            border: "1px solid rgba(255,204,0,0.2)",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 12,
            fontSize: 10,
            color: T.yellow,
            lineHeight: 1.5,
          }}>
            Workflows despublicados ficam disponíveis por 60 dias para auditoria.
            {(() => {
              const oldest = Object.values(workflows)
                .filter((w) => !w.active && w.deactivatedAt)
                .map((w) => new Date(w.deactivatedAt))
                .sort((a, b) => a - b)[0];
              if (!oldest) return null;
              const daysLeft = Math.max(0, 60 - Math.floor((Date.now() - oldest) / 86400000));
              return ` Próxima expiração em ${daysLeft} dia${daysLeft !== 1 ? "s" : ""}.`;
            })()}
          </div>
        )}

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
            <option value="all">{filterScope === "active" ? "Todos os publicados" : "Todos os despublicados"}</option>
            {wfList.map(([id, w]) => (
              <option key={id} value={id}>
                {w.name}
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

const errorBoxStyle = {
  background: "rgba(255,61,90,0.08)",
  border: `1px solid ${T.red}`,
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 11,
  color: T.red,
  marginBottom: 16,
};
