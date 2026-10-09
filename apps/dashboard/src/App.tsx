import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Blocks,
  Box,
  ChevronDown,
  Cpu,
  ExternalLink,
  Globe2,
  LayoutDashboard,
  Menu,
  Network,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import "./App.css";
import {
  fetchJobs,
  fetchWorkers,
  fetchWorkerTelemetry,
  fetchCoordinatorHealth,
  type TrainingJob,
  type Worker,
  type WorkerTelemetry,
} from "./api";
// These events are illustrative until a live on-chain events endpoint is available.
const events = [
  {
    title: "Model registered",
    detail: "Model Registry",
    time: "Example event",
    status: "success",
  },
  {
    title: "Training round recorded",
    detail: "TrainingJob",
    time: "Example event",
    status: "success",
  },
  {
    title: "Worker registration",
    detail: "Network",
    time: "Example event",
    status: "success",
  },
];
const navigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Training", icon: Activity },
  { label: "Compute Nodes", icon: Cpu },
  { label: "Model Registry", icon: Box },
  { label: "Network Ledger", icon: Blocks },
];
function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "—";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
function formatMegabytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}
function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(1)}%`;
}
function formatStatus(status: TrainingJob["status"]): string {
  const labels: Record<TrainingJob["status"], string> = {
    pending: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}
function App() {
  const [page, setPage] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [liveJobs, setLiveJobs] = useState<TrainingJob[]>([]);
  const [liveWorkers, setLiveWorkers] = useState<Worker[]>([]);
  const [liveTelemetry, setLiveTelemetry] = useState<WorkerTelemetry[]>([]);
  const [telemetryHistory, setTelemetryHistory] = useState<{ time: string; cpu: number }[]>([]);
  const [apiState, setApiState] = useState<"loading" | "connected" | "error">(
    "loading",
  );
  const [apiError, setApiError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      try {
        const [jobsResult, workersResult, healthy] = await Promise.all([
          fetchJobs(),
          fetchWorkers(),
          fetchCoordinatorHealth(),
        ]);
        let telemetryResult: WorkerTelemetry[] = [];
        try {
          telemetryResult = await fetchWorkerTelemetry();
        } catch (telemetryFetchError) {
          console.warn("Worker telemetry is temporarily unavailable", telemetryFetchError);
        }
        if (!healthy) {
          throw new Error("Coordinator health check failed");
        }
        if (!cancelled) {
          setLiveJobs(jobsResult);
          setLiveWorkers(workersResult);
          setLiveTelemetry(telemetryResult);
          setTelemetryHistory((previous) => {
            const onlineIds = new Set(workersResult.filter((worker) => worker.status === "online").map((worker) => worker.workerId));
            const now = Date.now();
            const readings = telemetryResult.filter((item) => {
              const receivedAt = new Date(item.receivedAt).getTime();
              return onlineIds.has(item.workerId) && item.cpuUsagePercent !== null && Number.isFinite(receivedAt) && now - receivedAt >= 0 && now - receivedAt <= 45_000;
            });
            if (readings.length === 0) return previous;
            const cpu = readings.reduce((sum, item) => sum + (item.cpuUsagePercent ?? 0), 0) / readings.length;
            const point = { time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), cpu: Math.round(cpu * 10) / 10 };
            return [...previous, point].slice(-20);
          });
          setApiState("connected");
          setApiError("");
          setLastUpdated(new Date().toISOString());
        }
      } catch (error) {
        if (!cancelled) {
          setApiState("error");
          setApiError(
            error instanceof Error
              ? error.message
              : "Unable to reach the Coordinator",
          );
        }
      }
    }
    void loadDashboard();
    const intervalId = window.setInterval(() => {
      void loadDashboard();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);
  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return liveJobs;
    return liveJobs.filter((job) =>
      [
        job.jobId,
        job.name,
        job.modelName,
        job.jobType,
        job.status,
        job.datasetName ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [liveJobs, search]);
  const activeWorkers = liveWorkers.filter(
    (worker) => worker.status === "online",
  ).length;
  // const runningJobs = liveJobs.filter((job) => job.status === "running").length;
  // The API currently has no model-list endpoint; this counts distinct models referenced by jobs.
  const modelsInJobs = new Set(
    liveJobs.map((job) => job.modelName).filter(Boolean),
  ).size;
  const freshTelemetry = useMemo(() => {
    const now = Date.now();
    const onlineWorkerIds = new Set(liveWorkers.filter((worker) => worker.status === "online").map((worker) => worker.workerId));
    return liveTelemetry.filter((item) => {
      const receivedAt = new Date(item.receivedAt).getTime();
      return onlineWorkerIds.has(item.workerId) && Number.isFinite(receivedAt) && now - receivedAt >= 0 && now - receivedAt <= 45_000;
    });
  }, [liveTelemetry, liveWorkers]);
  const cpuReadings = freshTelemetry.map((item) => item.cpuUsagePercent).filter((value): value is number => value !== null);
  const gpuReadings = freshTelemetry.map((item) => item.gpuUtilizationPercent).filter((value): value is number => value !== null);
  const cpuUtilization = cpuReadings.length ? cpuReadings.reduce((sum, value) => sum + value, 0) / cpuReadings.length : null;
  const gpuUtilization = gpuReadings.length ? gpuReadings.reduce((sum, value) => sum + value, 0) / gpuReadings.length : null;
  const memoryReadings = freshTelemetry.filter((item) => item.memoryUsedMb !== null && item.memoryTotalMb !== null && item.memoryTotalMb > 0);
  const memoryUsedMb = memoryReadings.reduce((sum, item) => sum + (item.memoryUsedMb ?? 0), 0);
  const memoryTotalMb = memoryReadings.reduce((sum, item) => sum + (item.memoryTotalMb ?? 0), 0);
  const memoryPercent = memoryTotalMb > 0 ? (memoryUsedMb / memoryTotalMb) * 100 : null;
  const telemetryByWorker = useMemo(
    () => new Map(liveTelemetry.map((item) => [item.workerId, item])),
    [liveTelemetry],
  );
  const onlineTelemetryCount = liveWorkers.filter((worker) => {
    const item = telemetryByWorker.get(worker.workerId);
    if (worker.status !== "online" || !item) return false;
    const age = Date.now() - new Date(item.receivedAt).getTime();
    return Number.isFinite(age) && age >= 0 && age <= 45_000;
  }).length;
  function navigate(label: string) {
    setPage(label);
    setMenuOpen(false);
  }
  return (
    <main className="lux-app">
      {menuOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <header className="lux-header">
        <button
          className="mobile-menu"
          aria-label="Toggle navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <button className="wordmark" onClick={() => navigate("Overview")}>
          <span className="wordmark-name">VELARA</span>
          <span className="wordmark-sub">DECENTRALLM</span>
        </button>
        <nav className={`lux-nav ${menuOpen ? "lux-nav-open" : ""}`}>
          {navigation.map(({ label }) => (
            <button
              key={label}
              onClick={() => navigate(label)}
              className={page === label ? "lux-nav-active" : ""}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-tools">
          {searchOpen && (
            <input
              className="header-search"
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs..."
              aria-label="Search jobs"
            />
          )}
          <button
            className="header-icon"
            aria-label={searchOpen ? "Close job search" : "Search training jobs"}
            onClick={() => {
              setSearchOpen((open) => !open);
              if (searchOpen) setSearch("");
            }}
          >
            <Search size={19} />
          </button>
          <button
            className="header-icon notification-button"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell size={19} />
            <span />
          </button>
          <button className="account-button" aria-label="Account menu">
            P <ChevronDown size={14} />
          </button>
        </div>
      </header>
      {page !== "Compute Nodes" && <>
      <section className="hero">
        <div className="hero-image" />
        <div className="hero-vignette" />
        <div className="hero-copy">
          <div className="eyebrow">
            <span>THE NEXT GENERATION OF AI</span>
            <i />
          </div>
          <h1>
            INTELLIGENCE,
            <br />
            <span>DISTRIBUTED.</span>
          </h1>
          <p>
            Decentralized model training. Global compute.
            <br />
            Open innovation. A more capable tomorrow.
          </p>
          <button className="launch-button" onClick={() => navigate("Training")}>
            LAUNCH TRAINING JOB <ArrowRight size={17} />
          </button>
          <div className="hero-tags">
            <span>PEOPLE</span>
            <b>×</b>
            <span>COMPUTE</span>
            <b>×</b>
            <span>MODELS</span>
            <b>×</b>
            <span>A FAIRER AI FUTURE</span>
          </div>
        </div>
        <div className="hero-side-note">
          <span>DECENTRALIZED</span>
          <span>INTELLIGENCE</span>
          <span>FOR A MORE OPEN</span>
          <span>TOMORROW</span>
        </div>
        <div className="hero-index">
          <span className="hero-index-active">01</span>
          <span>02</span>
          <span>03</span>
          <span>04</span>
        </div>
        <div className="hero-bottom-note">
          <span>BUILT BY</span>
          <span>A GLOBAL NETWORK</span>
          <span>OF CREATORS</span>
        </div>
      </section>
      {apiState === "error" && (
        <div className="api-error" role="alert">
          <strong>Live data unavailable.</strong> {apiError}. Check that the
          Coordinator is running and the dashboard API URL/CORS settings are
          correct.
        </div>
      )}
      <section className="metrics-strip">
        <Metric
          icon={<Network size={23} />}
          label="ACTIVE COMPUTE NODES"
          value={String(activeWorkers).padStart(2, "0")}
          change={`${liveWorkers.length} registered worker${liveWorkers.length === 1 ? "" : "s"}`}
        />
        <Metric
          icon={<Box size={24} />}
          label="MODELS IN JOBS"
          value={String(modelsInJobs).padStart(2, "0")}
          change="Distinct models referenced by jobs"
        />
        <div className="metric metric-utilization">
          <div className="utilization-ring" style={{ background: `radial-gradient(circle at center, #0b0c10 61%, transparent 63%), conic-gradient(var(--blue) 0 ${cpuUtilization ?? 0}%, #363840 ${cpuUtilization ?? 0}% 100%)` }} title={cpuUtilization === null ? "No fresh CPU telemetry" : `Average CPU utilization: ${cpuUtilization.toFixed(1)}%`}>
            <span>{cpuUtilization === null ? "—" : `${Math.round(cpuUtilization)}%`}</span>
          </div>
          <div className="utilization-copy">
            <div className="metric-label">AVG CPU UTILIZATION</div>
            <div className="util-line"><i /><span>{freshTelemetry.length} fresh worker snapshot{freshTelemetry.length === 1 ? "" : "s"}</span></div>
            <div className="util-line"><i /><span>{gpuUtilization === null ? "GPU —" : `GPU ${gpuUtilization.toFixed(1)}% average`}</span></div>
            <div className="util-line"><i /><span>{memoryPercent === null ? "RAM —" : `RAM ${memoryPercent.toFixed(1)}% used`}</span></div>
          </div>
        </div>
        <div className="metric activity-metric">
          <div className="metric-icon"><Activity size={22} /></div>
          <div className="activity-content">
            <div className="metric-label">LIVE CPU TELEMETRY</div>
            <div className="activity-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={telemetryHistory}>
                  <defs>
                    <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#347cff" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#347cff" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <Tooltip contentStyle={{ background: "#101117", border: "1px solid #30313b", borderRadius: 4, fontSize: 11 }} formatter={(value) => [`${value}%`, "Average CPU"]} labelFormatter={(label) => `Sample ${label}`} />
                  <Area type="monotone" dataKey="cpu" stroke="#397fff" strokeWidth={1.5} fill="url(#activityFill)" connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="activity-total">
            <strong>{cpuUtilization === null ? "—" : `${cpuUtilization.toFixed(1)}%`}</strong>
            <span>average CPU</span>
            <small><ArrowUpRight size={13} /> {telemetryHistory.length} samples</small>
          </div>
        </div>
      </section>
      </>}
      {page === "Compute Nodes" && (
        <section style={{ padding: "34px clamp(22px, 4vw, 58px) 48px", borderBottom: "1px solid #25262d" }}>
          <div className="section-heading" style={{ marginBottom: 24 }}>
            <div>
              <div className="eyebrow"><span>LIVE INFRASTRUCTURE</span><i /></div>
              <h2 style={{ marginTop: 10, fontSize: 28 }}>COMPUTE NODES</h2>
              <span>Per-worker resource telemetry from the Coordinator</span>
            </div>
            <div style={{ textAlign: "right", color: "#9697a0", fontSize: 11 }}>
              <div>{onlineTelemetryCount} fresh snapshots</div>
              <div style={{ marginTop: 5 }}>Refreshes every 15 seconds</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16 }}>
            {liveWorkers.map((worker) => {
              const telemetry = telemetryByWorker.get(worker.workerId);
              const receivedAt = telemetry ? new Date(telemetry.receivedAt).getTime() : NaN;
              const age = Date.now() - receivedAt;
              const fresh = Boolean(telemetry && Number.isFinite(age) && age >= 0 && age <= 45_000);
              const cpu = telemetry?.cpuUsagePercent ?? null;
              const ramUsed = telemetry?.memoryUsedMb ?? null;
              const ramTotal = telemetry?.memoryTotalMb ?? null;
              const ramPercent = ramUsed !== null && ramTotal !== null && ramTotal > 0 ? Math.min(100, (ramUsed / ramTotal) * 100) : null;
              const gpu = telemetry?.gpuUtilizationPercent ?? null;
              const vramUsed = telemetry?.gpuMemoryUsedMb ?? null;
              const vramTotal = telemetry?.gpuMemoryTotalMb ?? null;
              const vramPercent = vramUsed !== null && vramTotal !== null && vramTotal > 0 ? Math.min(100, (vramUsed / vramTotal) * 100) : null;
              const bar = (_percent: number | null) => ({ height: 5, borderRadius: 8, background: "#30323a", overflow: "hidden" as const, marginTop: 8, marginBottom: 14, });
              const fill = (percent: number | null) => ({ height: "100%", width: `${percent === null ? 0 : Math.max(0, Math.min(100, percent))}%`, background: "#397fff", borderRadius: 8 });
              return (
                <article key={worker.workerId} style={{ background: "#0d0e13", border: "1px solid #292b34", borderRadius: 8, padding: 22, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 22 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <div style={{ width: 42, height: 42, display: "grid", placeItems: "center", border: "1px solid #292b34", borderRadius: 6, color: "#397fff", flexShrink: 0 }}><Cpu size={21} /></div>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ margin: 0, fontSize: 16, overflowWrap: "anywhere" }}>{worker.workerId}</h3>
                        <div style={{ marginTop: 5, color: "#9697a0", fontSize: 11, overflowWrap: "anywhere" }}>{worker.hostname || "Hostname unavailable"}</div>
                      </div>
                    </div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: worker.status === "online" ? "#65e6a4" : "#9697a0", fontSize: 10, whiteSpace: "nowrap" }}>
                      <i style={{ width: 6, height: 6, borderRadius: "50%", background: worker.status === "online" ? "#65e6a4" : "#777983" }} />
                      {worker.status.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, paddingBottom: 16, borderBottom: "1px solid #25262d" }}>
                    <div><div className="metric-label">CPU UTILIZATION</div><strong style={{ display: "block", marginTop: 7, fontSize: 24, fontWeight: 400 }}>{fresh ? formatPercent(cpu) : "—"}</strong><div style={bar(fresh ? cpu : null)}><div style={fill(fresh ? cpu : null)} /></div></div>
                    <div><div className="metric-label">RAM USAGE</div><strong style={{ display: "block", marginTop: 7, fontSize: 24, fontWeight: 400 }}>{fresh ? formatPercent(ramPercent) : "—"}</strong><div style={bar(fresh ? ramPercent : null)}><div style={fill(fresh ? ramPercent : null)} /></div></div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, paddingTop: 16 }}>
                    <div><div className="metric-label">MEMORY</div><div style={{ marginTop: 7, fontSize: 13 }}>{fresh ? `${formatMegabytes(ramUsed)} / ${formatMegabytes(ramTotal)}` : "—"}</div></div>
                    <div><div className="metric-label">GPU UTILIZATION</div><div style={{ marginTop: 7, fontSize: 13 }}>{fresh ? formatPercent(gpu) : "—"}</div></div>
                    <div><div className="metric-label">GPU MODEL</div><div style={{ marginTop: 7, fontSize: 12, color: "#c3c5ce", overflowWrap: "anywhere" }}>{worker.capabilities.gpuModel || (worker.capabilities.gpu ? "GPU detected" : "No GPU reported")}</div></div>
                    <div><div className="metric-label">GPU MEMORY</div><div style={{ marginTop: 7, fontSize: 13 }}>{fresh ? `${formatMegabytes(vramUsed)} / ${formatMegabytes(vramTotal)}` : "—"}</div><div style={bar(fresh ? vramPercent : null)}><div style={fill(fresh ? vramPercent : null)} /></div></div>
                  </div>
                  <div style={{ borderTop: "1px solid #25262d", paddingTop: 13, marginTop: 2, display: "flex", justifyContent: "space-between", gap: 10, color: "#9697a0", fontSize: 10 }}>
                    <span>{fresh ? "TELEMETRY FRESH" : telemetry ? "TELEMETRY STALE" : "NO TELEMETRY"}</span>
                    <span title={telemetry?.receivedAt ?? "No telemetry received"}>{telemetry ? `Received ${formatRelativeTime(telemetry.receivedAt)}` : "Awaiting first report"}</span>
                  </div>
                </article>
              );
            })}
            {liveWorkers.length === 0 && (
              <div className="empty-row" style={{ padding: 32 }}>
                {apiState === "loading" ? "Loading registered workers…" : "No workers have been registered with the Coordinator."}
              </div>
            )}
          </div>
          <p className="demo-note" style={{ marginTop: 18 }}>
            Telemetry is marked fresh only when its received timestamp is within the last 45 seconds. Offline workers remain listed; unavailable readings are shown as em dashes.
          </p>
        </section>
      )}
      {page !== "Compute Nodes" && <section className="lower-grid">
        <article className="mission-panel">
          <div className="mission-art" />
          <div className="mission-content">
            <div className="eyebrow">
              <span>OUR MISSION</span>
              <i />
            </div>
            <h2>
              A MORE
              <br />
              OPEN AI FUTURE.
            </h2>
            <p>
              Decentralizing compute. Democratizing model training. Empowering
              a global community to build, learn, and innovate together.
            </p>
            <button
              className="learn-link"
              onClick={() => navigate("Compute Nodes")}
            >
              EXPLORE THE NETWORK <ArrowRight size={16} />
            </button>
          </div>
          <span className="mission-coordinate">DISTRIBUTED COMPUTE NETWORK</span>
        </article>
        <article className="jobs-panel">
          <div className="section-heading">
            <div>
              <h2>RECENT TRAINING JOBS</h2>
              <span>Workloads reported by the Coordinator</span>
            </div>
            <button onClick={() => navigate("Training")}>
              View all <ArrowRight size={15} />
            </button>
          </div>
          <div className="lux-table-wrap">
            <table className="lux-table">
              <thead>
                <tr>
                  <th>JOB ID</th>
                  <th>MODEL</th>
                  <th>STATUS</th>
                  <th>TYPE</th>
                  <th>DATASET</th>
                  <th>CREATED</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr key={job.jobId}>
                    <td className="job-id" title={job.jobId}>
                      {job.jobId.length > 14
                        ? `${job.jobId.slice(0, 11)}…`
                        : job.jobId}
                    </td>
                    <td>{job.modelName || "—"}</td>
                    <td>
                      <span
                        className={`job-status job-${job.status.toLowerCase()}`}
                      >
                        <i />
                        {formatStatus(job.status)}
                      </span>
                    </td>
                    <td>{job.jobType}</td>
                    <td>{job.datasetName || "—"}</td>
                    <td className="time-cell">
                      {formatRelativeTime(job.createdAt)}
                    </td>
                    <td>
                      <button
                        className="row-action"
                        aria-label={`Open ${job.jobId}`}
                        title={`Job: ${job.name}`}
                        onClick={() => setSearch(job.jobId)}
                      >
                        ···
                      </button>
                    </td>
                  </tr>
                ))}
                {visibleJobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-row">
                      {apiState === "loading"
                        ? "Loading jobs…"
                        : search
                          ? "No matching jobs."
                          : "No training jobs have been returned by the Coordinator."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="jobs-footnote">
            <span>
              SHOWING {visibleJobs.length} OF {liveJobs.length} LIVE JOBS
            </span>
            <span>
              {lastUpdated
                ? `UPDATED ${new Date(lastUpdated).toLocaleTimeString()}`
                : "WAITING FOR API"}
            </span>
          </div>
        </article>
        <aside className="right-panels">
          <article className="status-panel">
            <div className="section-heading">
              <h2>NETWORK STATUS</h2>
              <ShieldCheck size={17} />
            </div>
            <div className={`all-systems all-systems-${apiState}`}>
              <i />
              {apiState === "connected"
                ? "Coordinator reachable"
                : apiState === "loading"
                  ? "Checking Coordinator…"
                  : "Coordinator unavailable"}
            </div>
            <div className="status-line">
              <span>Coordinator API</span>
              <strong>{apiState === "connected" ? "Connected" : apiState}</strong>
            </div>
            <div className="status-line">
              <span>Workers online</span>
              <strong>{activeWorkers} / {liveWorkers.length}</strong>
            </div>
            <div className="status-line">
              <span>Training jobs</span>
              <strong>{liveJobs.length}</strong>
            </div>
            <div className="status-line">
              <span>Blockchain (Devnet)</span>
              <strong>Not checked here</strong>
            </div>
            <p className="demo-note">
              Database and Redis status require dedicated health checks.
            </p>
          </article>
          <article className="events-panel">
            <div className="section-heading">
              <h2>LATEST ON-CHAIN EVENTS</h2>
              <button onClick={() => navigate("Network Ledger")}>
                View all <ArrowRight size={14} />
              </button>
            </div>
            {events.map((event) => (
              <div className="event-row" key={event.title}>
                <span className="event-dot" />
                <div className="event-copy">
                  <strong>{event.title}</strong>
                  <small>{event.detail}</small>
                </div>
                <span className="event-time">{event.time}</span>
                <ExternalLink size={13} className="event-external" />
              </div>
            ))}
            <p className="demo-note">
              Illustrative placeholders — no live blockchain event endpoint is
              connected.
            </p>
          </article>
        </aside>
      </section>}
      <footer className="lux-footer">
        <span>
          VELARA <i>·</i> DECENTRALLM
        </span>
        <span>
          <Globe2 size={13} /> DISTRIBUTED INTELLIGENCE, TOGETHER
        </span>
        <span>
          <span className={`footer-dot footer-dot-${apiState}`} />{" "}
          {apiState === "connected" ? "API CONNECTED" : apiState.toUpperCase()}
        </span>
      </footer>
    </main>
  );
}
function Metric({
  icon,
  label,
  value,
  change,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  change: string;
}) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div className="metric-copy">
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        <div className="metric-change">
          <ArrowUpRight size={13} /> {change}
        </div>
      </div>
    </div>
  );
}
export default App;
