import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Workflows ──────────────────────────────────────────────────────────

const AUDIT_RETENTION_DAYS = 60;

export async function upsertWorkflows(wfList) {
  if (wfList.length === 0) return;

  const { data: existing } = await supabase
    .from("workflows")
    .select("id, active, deactivated_at");

  const existingMap = {};
  (existing || []).forEach((w) => (existingMap[w.id] = w));

  const rows = wfList.map((w) => {
    const prev = existingMap[w.id];
    const wasActive = prev ? prev.active !== false : true;
    const isNowActive = w.active !== false;

    let deactivated_at = prev?.deactivated_at || null;
    if (wasActive && !isNowActive) {
      deactivated_at = new Date().toISOString();
    } else if (isNowActive) {
      deactivated_at = null;
    }

    return {
      id: w.id,
      name: w.name,
      active: isNowActive,
      deactivated_at,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("workflows")
    .upsert(rows, { onConflict: "id" });

  if (error) console.error("upsertWorkflows error:", error);
}

export async function loadWorkflows() {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name, active, deactivated_at")
    .order("name");

  if (error) {
    console.error("loadWorkflows error:", error);
    return {};
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - AUDIT_RETENTION_DAYS);

  const map = {};
  (data || []).forEach((w) => {
    const isActive = w.active !== false;
    if (!isActive && w.deactivated_at && new Date(w.deactivated_at) < cutoff) return;
    map[w.id] = {
      name: w.name,
      active: isActive,
      deactivatedAt: w.deactivated_at,
    };
  });
  return map;
}

// ── Executions ─────────────────────────────────────────────────────────

export async function upsertExecutions(executions) {
  if (executions.length === 0) return;

  const rows = executions.map((e) => ({
    id: String(e.id),
    workflow_id: String(e.workflowId),
    status: e.status,
    started_at: e.startedAt || null,
    stopped_at: e.stoppedAt || null,
    mode: e.mode || null,
  }));

  // Upsert in batches of 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("executions")
      .upsert(batch, { onConflict: "id" });
    if (error) console.error("upsertExecutions error:", error);
  }
}

export async function loadExecutions({ status, workflowId, workflowIds, limit = 500 } = {}) {
  let query = supabase
    .from("executions")
    .select("id, workflow_id, status, started_at, stopped_at, mode")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  if (workflowId && workflowId !== "all") {
    query = query.eq("workflow_id", workflowId);
  }
  if (workflowIds && workflowIds.length > 0) {
    query = query.in("workflow_id", workflowIds);
  }

  const { data, error } = await query;
  if (error) {
    console.error("loadExecutions error:", error);
    return [];
  }

  return (data || []).map((e) => ({
    id: e.id,
    workflowId: e.workflow_id,
    status: e.status,
    startedAt: e.started_at,
    stoppedAt: e.stopped_at,
    mode: e.mode,
  }));
}

export async function countExecutions({ workflowIds } = {}) {
  let totalQ = supabase.from("executions").select("*", { count: "exact", head: true });
  let errQ = supabase.from("executions").select("*", { count: "exact", head: true }).eq("status", "error");
  let successQ = supabase.from("executions").select("*", { count: "exact", head: true }).eq("status", "success");

  if (workflowIds && workflowIds.length > 0) {
    totalQ = totalQ.in("workflow_id", workflowIds);
    errQ = errQ.in("workflow_id", workflowIds);
    successQ = successQ.in("workflow_id", workflowIds);
  }

  const [{ count: total }, { count: errors }, { count: success }] = await Promise.all([
    totalQ, errQ, successQ,
  ]);

  return {
    total: total || 0,
    errors: errors || 0,
    success: success || 0,
  };
}

// ── Execution Details ──────────────────────────────────────────────────

export async function saveExecutionDetail(executionId, detail) {
  const result = detail.data?.resultData;
  const topError = result?.error;

  const failedNodes = [];
  if (result?.runData) {
    for (const [nodeName, nodeRuns] of Object.entries(result.runData)) {
      for (const run of nodeRuns) {
        if (run.error) {
          failedNodes.push({
            name: nodeName,
            message: run.error.message || run.error.description || "",
            type: run.error.name || "Error",
          });
        }
      }
    }
  }

  const row = {
    execution_id: String(executionId),
    error_message: topError?.message || null,
    error_description: topError?.description || null,
    error_node: topError?.node?.name || topError?.node || null,
    failed_nodes: failedNodes,
    run_data: result?.runData ? preserveRunData(result.runData) : null,
    fetched_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("execution_details")
    .upsert(row, { onConflict: "execution_id" });

  if (error) console.error("saveExecutionDetail error:", error);
}

export async function loadExecutionDetail(executionId) {
  const { data, error } = await supabase
    .from("execution_details")
    .select("*")
    .eq("execution_id", String(executionId))
    .single();

  if (error || !data) return null;
  return data;
}

export async function getExistingDetailIds(executionIds) {
  if (executionIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("execution_details")
    .select("execution_id")
    .in("execution_id", executionIds.map(String));

  if (error) {
    console.error("getExistingDetailIds error:", error);
    return new Set();
  }
  return new Set((data || []).map((r) => r.execution_id));
}

export async function getExecutionsMissingDetails(limit = 200) {
  const { data, error } = await supabase.rpc("get_executions_missing_details", { row_limit: limit });

  if (!error && data) {
    return data.map((r) => r.id);
  }

  // Fallback: manual left join via two queries
  const { data: allExecs } = await supabase
    .from("executions")
    .select("id")
    .order("started_at", { ascending: false })
    .limit(limit * 2);

  if (!allExecs || allExecs.length === 0) return [];

  const allIds = allExecs.map((e) => e.id);
  const existing = await getExistingDetailIds(allIds);
  return allIds.filter((id) => !existing.has(id)).slice(0, limit);
}

const MAX_ITEMS_PER_NODE = 50;
const MAX_STRING_LENGTH = 5000;

function truncateValue(val) {
  if (typeof val === "string" && val.length > MAX_STRING_LENGTH) {
    return val.slice(0, MAX_STRING_LENGTH) + "… [truncado]";
  }
  if (Array.isArray(val)) {
    return val.slice(0, MAX_ITEMS_PER_NODE).map(truncateValue);
  }
  if (val && typeof val === "object") {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = truncateValue(v);
    }
    return out;
  }
  return val;
}

function preserveRunData(runData) {
  const preserved = {};
  for (const [nodeName, nodeRuns] of Object.entries(runData)) {
    preserved[nodeName] = nodeRuns.map((run) => {
      const outputItems = [];
      if (run.data?.main) {
        for (const output of run.data.main) {
          if (output) {
            for (const item of output.slice(0, MAX_ITEMS_PER_NODE)) {
              outputItems.push(truncateValue(item.json || item));
            }
          }
        }
      }

      return {
        startTime: run.startTime,
        executionTime: run.executionTime,
        error: run.error
          ? { name: run.error.name, message: run.error.message, description: run.error.description }
          : null,
        itemCount: run.data?.main
          ? run.data.main.reduce((acc, out) => acc + (out?.length || 0), 0)
          : 0,
        outputData: outputItems.length > 0 ? outputItems : null,
      };
    });
  }
  return preserved;
}
