export const PI_PRESENTATION_STATUS = "t3.pi.presentation.v1";
export const PI_PLAN_STATUS = "t3.pi.plan.v1";
export const PI_JOBS_STATUS = "t3.pi.jobs.v1";

export function decodePiJobs(input: string) {
  if (input.length > 4096) return null;
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  return value.slice(0, 16).flatMap((job: unknown) => {
    if (
      !job ||
      typeof job !== "object" ||
      !("id" in job) ||
      !("kind" in job) ||
      !("status" in job) ||
      !("background" in job) ||
      typeof job.id !== "string" ||
      !/^[a-z\d_.:-]{1,128}$/i.test(job.id) ||
      typeof job.background !== "boolean" ||
      (job.kind !== "shell" && job.kind !== "subagent") ||
      (job.status !== "running" &&
        job.status !== "completed" &&
        job.status !== "failed" &&
        job.status !== "cancelled")
    )
      return [];
    return [{ id: job.id, kind: job.kind, status: job.status, background: job.background }];
  });
}

export function normalizePiJobs(input: string): string | null {
  const jobs = decodePiJobs(input);
  return jobs === null ? null : JSON.stringify(jobs);
}

function positiveMetric(value: unknown, maximum = 1e9): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

export function normalizePiPresentation(input: string): string | null {
  const stats = decodePiPresentation(input);
  return stats === null ? null : JSON.stringify(stats);
}

export function decodePiPresentation(input: string) {
  if (input.length > 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || !("composition" in value)) return null;
  const { composition } = value;
  const counts =
    Array.isArray(composition) && composition.length === 6
      ? composition.map((count: unknown) => positiveMetric(count))
      : null;
  const model = "physicalModel" in value ? value.physicalModel : null;
  const effort = "effort" in value ? value.effort : null;
  return {
    composition: counts?.every((count) => count !== null) ? counts : null,
    decode: positiveMetric("decode" in value ? value.decode : null),
    ttft: positiveMetric("ttft" in value ? value.ttft : null),
    cache: positiveMetric("cache" in value ? value.cache : null, 100),
    prefill: positiveMetric("prefill" in value ? value.prefill : null),
    effort:
      typeof effort === "string" && /^(off|minimal|low|medium|high|xhigh|max)$/.test(effort)
        ? effort
        : null,
    physicalModel:
      typeof model === "string" && /^[a-zA-Z0-9_.:@-]{1,128}$/.test(model) ? model : null,
  };
}
