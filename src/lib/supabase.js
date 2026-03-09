import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Workflows ──────────────────────────────────────────────────────────

export async function upsertWorkflows(wfMap) {
  const rows = Object.entries(wfMap).map(([id, name]) => ({
    id,
    name,
    updated_at: new Date().toISOString(),
  }));
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("workflows")
    .upsert(rows, { onConflict: "id" });

  if (error) console.error("upsertWorkflows error:", error);
}

export async function loadWorkflows() {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name")
    .order("name");

  if (error) {
    console.error("loadWorkflows error:", error);
    return {};
  }
  const map = {};
  (data || []).forEach((w) => (map[w.id] = w.name));
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

export async function loadExecutions({ status, workflowId, limit = 500 } = {}) {
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

  const { data, error } = await query;
  if (error) {
    console.error("loadExecutions error:", error);
    return [];
  }

  // Map back to the format the app expects
  return (data || []).map((e) => ({
    id: e.id,
    workflowId: e.workflow_id,
    status: e.status,
    startedAt: e.started_at,
    stoppedAt: e.stopped_at,
    mode: e.mode,
  }));
}

export async function countExecutions() {
  const { count: total } = await supabase
    .from("executions")
    .select("*", { count: "exact", head: true });

  const { count: errors } = await supabase
    .from("executions")
    .select("*", { count: "exact", head: true })
    .eq("status", "error");

  const { count: success } = await supabase
    .from("executions")
    .select("*", { count: "exact", head: true })
    .eq("status", "success");

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
    run_data: result?.runData ? summarizeRunData(result.runData) : null,
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

// Summarize runData to save space (strip large payloads, keep structure)
function summarizeRunData(runData) {
  const summary = {};
  for (const [nodeName, nodeRuns] of Object.entries(runData)) {
    summary[nodeName] = nodeRuns.map((run) => ({
      startTime: run.startTime,
      executionTime: run.executionTime,
      error: run.error
        ? { name: run.error.name, message: run.error.message, description: run.error.description }
        : null,
      itemCount: run.data?.main
        ? run.data.main.reduce((acc, out) => acc + (out?.length || 0), 0)
        : 0,
    }));
  }
  return summary;
}
