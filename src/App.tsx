import { useState, useEffect, useCallback } from "react";

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRK2-o2zUYccClexMlZlYQRqcAu5BuCECMTnI9UYmZu0xKpqWdg2IclcX-sroV1ieWUdOH0gahoBwOy/pub?gid=306047208&single=true&output=csv";
const REFRESH_INTERVAL = 60000;
const ADMIN_PASSWORD = "reserve2026";

const COLS: Record<string, string> = {
  date: "Timestamp",
  rep: "Name",
  totalCalls: "Total calls",
  noShows: "No Shows",
  shows: "Show ups",
  closes: "Total Deals Closed",
  revenue: "Cash Collected",
};

const GREEN = "#22C55E";
const RED = "#EF4444";
const WHITE = "#FFFFFF";
const GRAY = "#FFFFFF";
const BORDER = "#1E1E1E";
const BG = "#000000";
const SURFACE = "#0C0C0C";
const TARGET_MONTHLY = 110000;
const FONT_URL = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap";

type FilterMode = "today" | "this_week" | "this_month" | "last_month" | "7D" | "14D" | "30D" | "90D";

interface Row {
  id: string; date: string; rep: string; totalCalls: number;
  shows: number; noShows: number; closes: number; revenue: number;
}
interface Stats {
  totalCalls: number; shows: number; noShows: number; closes: number; revenue: number;
}
interface Override {
  id: string; field: string; value: number;
}
interface ManualEntry {
  id: string; date: string; rep: string; totalCalls: number;
  shows: number; noShows: number; closes: number; revenue: number;
}

function getDateRange(mode: FilterMode): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (mode) {
    case "today":
      return { start: today, end: new Date(today.getTime() + 86400000 - 1) };
    case "this_week": {
      const day = today.getDay();
      const start = new Date(today); start.setDate(today.getDate() - day);
      const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59);
      return { start, end };
    }
    case "this_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
      };
    case "last_month":
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      };
    default: {
      const days = parseInt(mode);
      const start = new Date(today); start.setDate(today.getDate() - days);
      return { start, end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59) };
    }
  }
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map(line => {
    const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) || [];
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").replace(/^"|"$/g, "").trim(); });
    return obj;
  });
}

function getVal(row: Record<string, string>, key: string): string { return row[COLS[key]] || ""; }
function num(v: unknown): number { const n = parseFloat(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) ? 0 : n; }
function pct(a: number, b: number): number { if (!b) return 0; return Math.round((a / b) * 100); }
function money(n: number): string { return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 }); }

function applyOverrides(rows: Row[], overrides: Override[]): Row[] {
  return rows.map(row => {
    const rowOverrides = overrides.filter(o => o.id === row.id);
    if (!rowOverrides.length) return row;
    const updated = { ...row };
    rowOverrides.forEach(o => { (updated as any)[o.field] = o.value; });
    return updated;
  });
}

function computeStats(rows: Row[], seedRevenue = 0): Stats {
  return {
    totalCalls: rows.reduce((s, r) => s + r.totalCalls, 0),
    shows: rows.reduce((s, r) => s + r.shows, 0),
    noShows: rows.reduce((s, r) => s + r.noShows, 0),
    closes: rows.reduce((s, r) => s + r.closes, 0),
    revenue: rows.reduce((s, r) => s + r.revenue, seedRevenue),
  };
}

function repStats(rows: Row[]) {
  const map: Record<string, any> = {};
  rows.forEach(r => {
    const name = r.rep || "Unknown";
    if (!map[name]) map[name] = { rep: name, totalCalls: 0, shows: 0, noShows: 0, closes: 0, revenue: 0 };
    (["totalCalls","shows","noShows","closes","revenue"]).forEach(k => { map[name][k] += (r as any)[k]; });
  });
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

function dailyTrend(rows: Row[]) {
  const map: Record<string, { date: string; closes: number; revenue: number; shows: number }> = {};
  rows.forEach(r => {
    const d = r.date ? r.date.split(",")[0].trim() : "?";
    if (!map[d]) map[d] = { date: d, closes: 0, revenue: 0, shows: 0 };
    map[d].closes += r.closes;
    map[d].revenue += r.revenue;
    map[d].shows += r.shows;
  });
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
}

function Bar({ value, max, color = GREEN, h = 3 }: { value: number; max: number; color?: string; h?: number }) {
  const w = max ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height: h, background: "#181818", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: color, borderRadius: 999, transition: "width 0.7s ease" }} />
    </div>
  );
}

function SparkBars({ data, valueKey, color = GREEN }: { data: any[]; valueKey: string; color?: string }) {
  if (!data.length) return null;
  const vals = data.map(d => d[valueKey] as number);
  const max = Math.max(...vals, 1);
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 40 }}>
      {vals.map((v, i) => (
        <div key={i} style={{
          flex: 1, background: i === vals.length - 1 ? color : color + "33",
          borderRadius: 3, height: `${Math.max((v / max) * 100, 5)}%`, transition: "height 0.5s ease",
        }} />
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "18px 20px" }}>
      <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", fontFamily: "'DM Mono'", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: color || WHITE, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: GRAY, marginTop: 6, fontFamily: "'DM Mono'" }}>{sub}</div>}
    </div>
  );
}

const FILTER_GROUPS = [
  { label: "TODAY", value: "today" as FilterMode },
  { label: "THIS WEEK", value: "this_week" as FilterMode },
  { label: "THIS MONTH", value: "this_month" as FilterMode },
  { label: "LAST MONTH", value: "last_month" as FilterMode },
  { label: "7D", value: "7D" as FilterMode },
  { label: "14D", value: "14D" as FilterMode },
  { label: "30D", value: "30D" as FilterMode },
  { label: "90D", value: "90D" as FilterMode },
];

const FIELDS = ["totalCalls","shows","noShows","closes","revenue"];

export default function ReserveDashboard() {
  const [rawRows, setRawRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filterRep, setFilterRep] = useState("All");
  const [filterMode, setFilterMode] = useState<FilterMode>("this_month");
  const [seedRevenue, setSeedRevenue] = useState(11700);

  // Admin state
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminPwInput, setAdminPwInput] = useState("");
  const [adminPwError, setAdminPwError] = useState(false);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<Record<string, string>>({});
  const [newEntry, setNewEntry] = useState({ date: "", rep: "", totalCalls: "", shows: "", noShows: "", closes: "", revenue: "" });
  const [activeAdminTab, setActiveAdminTab] = useState<"overrides"|"manual"|"settings">("overrides");

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = FONT_URL;
    document.head.appendChild(link);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(SHEET_CSV_URL + "&t=" + Date.now());
      if (!res.ok) throw new Error("Fetch failed");
      const text = await res.text();
      const parsed = parseCSV(text);
      const normalized: Row[] = parsed.map((r, i) => ({
        id: `row_${i}`,
        date: getVal(r, "date"),
        rep: getVal(r, "rep"),
        totalCalls: num(getVal(r, "totalCalls")),
        shows: num(getVal(r, "shows")),
        noShows: num(getVal(r, "noShows")),
        closes: num(getVal(r, "closes")),
        revenue: num(getVal(r, "revenue")),
      }));
      setRawRows(normalized); setError(null);
    } catch (e) { setError((e as Error).message); }
    setLoading(false); setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(t);
  }, [fetchData]);

  const allRows: Row[] = [
    ...applyOverrides(rawRows, overrides),
    ...manualEntries.map(m => ({ ...m })),
  ];

  const { start, end } = getDateRange(filterMode);
  const isThisMonth = filterMode === "this_month";

  const filtered = allRows.filter(r => {
    if (filterRep !== "All" && r.rep !== filterRep) return false;
    if (!r.date) return true;
    const d = new Date(r.date);
    return d >= start && d <= end;
  });

  const seedForFilter = isThisMonth ? seedRevenue : 0;
  const stats = computeStats(filtered, seedForFilter);
  const reps = repStats(filtered);
  const trend = dailyTrend(filtered);
  const allReps = ["All", ...Array.from(new Set(allRows.map(r => r.rep).filter(Boolean)))];

  const monthPct = pct(stats.revenue, TARGET_MONTHLY);
  const showRate = pct(stats.shows, stats.totalCalls);
  const closeRate = pct(stats.closes, stats.shows);
  const avgDeal = stats.closes ? Math.round(stats.revenue / stats.closes) : 6000;
  const closesNeeded = Math.max(0, Math.ceil((TARGET_MONTHLY - stats.revenue) / avgDeal));
  const maxRepRev = Math.max(...reps.map(r => r.revenue), 1);

  const nowDate = new Date();
  const totalDaysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const dayOfMonth = nowDate.getDate();
  const daysElapsed = Math.max(dayOfMonth - 1, 1);
  const daysRemaining = Math.max(totalDaysInMonth - dayOfMonth + 1, 1);

  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
  const monthEnd = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0, 23, 59, 59);
  const monthRows = allRows.filter(r => { if (!r.date) return false; const d = new Date(r.date); return d >= monthStart && d <= monthEnd; });
  const monthStats = computeStats(monthRows, seedRevenue);
  const revenueThisMonth = monthStats.revenue;
  const closesThisMonth = monthStats.closes || 0;

  const dailyActual = revenueThisMonth / daysElapsed;
  const dailyNeeded = (TARGET_MONTHLY - revenueThisMonth) / daysRemaining;
  const projectedEOM = Math.round(revenueThisMonth + dailyActual * daysRemaining);
  const expectedByNow = (TARGET_MONTHLY / totalDaysInMonth) * dayOfMonth;
  const pacingPct = Math.round((revenueThisMonth / expectedByNow) * 100);
  const isAhead = pacingPct >= 100;
  const closesPerDayActual = (closesThisMonth / daysElapsed).toFixed(1);
  const closesPerDayNeeded = Math.ceil((TARGET_MONTHLY - revenueThisMonth) / avgDeal / daysRemaining);
  const callsPerClose = stats.closes > 0 ? (stats.totalCalls / stats.closes).toFixed(1) : "—";
  const filterLabel = FILTER_GROUPS.find(f => f.value === filterMode)?.label || "";

  const chip = (active: boolean, onClick: () => void, label: string) => (
    <button onClick={onClick} style={{
      background: active ? WHITE : "transparent", border: `1px solid ${active ? WHITE : BORDER}`,
      color: active ? BG : GRAY, borderRadius: 6, padding: "4px 11px", fontSize: 10, cursor: "pointer",
      fontFamily: "'DM Mono', monospace", letterSpacing: "0.06em", transition: "all 0.12s",
    }}>{label}</button>
  );

  const inputStyle: React.CSSProperties = {
    background: "#111", border: `1px solid ${BORDER}`, color: WHITE, borderRadius: 6,
    padding: "6px 10px", fontSize: 11, fontFamily: "'DM Mono'", width: "100%", outline: "none",
  };

  function startEdit(row: Row) {
    setEditingRow(row.id);
    setEditVals({
      totalCalls: String(row.totalCalls), shows: String(row.shows),
      noShows: String(row.noShows), closes: String(row.closes), revenue: String(row.revenue),
    });
  }

  function saveEdit(rowId: string) {
    const newOverrides = overrides.filter(o => o.id !== rowId);
    FIELDS.forEach(field => {
      if (editVals[field] !== undefined) {
        newOverrides.push({ id: rowId, field, value: num(editVals[field]) });
      }
    });
    setOverrides(newOverrides);
    setEditingRow(null);
  }

  function addManualEntry() {
    if (!newEntry.rep || !newEntry.date) return;
    const entry: ManualEntry = {
      id: `manual_${Date.now()}`,
      date: newEntry.date, rep: newEntry.rep,
      totalCalls: num(newEntry.totalCalls), shows: num(newEntry.shows),
      noShows: num(newEntry.noShows), closes: num(newEntry.closes), revenue: num(newEntry.revenue),
    };
    setManualEntries([...manualEntries, entry]);
    setNewEntry({ date: "", rep: "", totalCalls: "", shows: "", noShows: "", closes: "", revenue: "" });
  }

  const adminTabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? WHITE : "transparent", border: `1px solid ${active ? WHITE : BORDER}`,
    color: active ? BG : GRAY, borderRadius: 6, padding: "5px 14px", fontSize: 10,
    cursor: "pointer", fontFamily: "'DM Mono'", letterSpacing: "0.08em",
  });

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", background: BG, minHeight: "100vh", color: WHITE }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes up { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .fade { animation: up 0.35s ease both; }
        input::placeholder { color: #444; }
      `}</style>

      {/* NAV */}
      <nav style={{ borderBottom: `1px solid ${BORDER}`, height: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", position: "sticky", top: 0, zIndex: 20, background: "rgba(0,0,0,0.95)", backdropFilter: "blur(16px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: GREEN, boxShadow: `0 0 10px ${GREEN}80`, animation: "blink 2.5s ease infinite" }} />
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: "0.14em" }}>THE RESERVE</span>
          <span style={{ color: BORDER }}>·</span>
          <span style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em" }}>SALES DASHBOARD</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {lastRefresh && <span style={{ fontSize: 9, color: "#666" }}>{lastRefresh.toLocaleTimeString()}</span>}
          <button onClick={() => setShowAdmin(!showAdmin)} style={{ background: showAdmin ? "#1a1a1a" : "transparent", border: `1px solid ${showAdmin ? WHITE : BORDER}`, color: showAdmin ? WHITE : "#666", borderRadius: 6, padding: "4px 10px", fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono'", letterSpacing: "0.1em" }}>⚙ ADMIN</button>
          <button onClick={fetchData} style={{ background: "transparent", border: `1px solid ${BORDER}`, color: GRAY, borderRadius: 6, padding: "4px 10px", fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono'", letterSpacing: "0.1em" }}>↻ SYNC</button>
        </div>
      </nav>

      {/* ADMIN PANEL */}
      {showAdmin && (
        <div style={{ borderBottom: `1px solid ${BORDER}`, background: "#050505", padding: "20px 24px" }}>
          {!adminAuthed ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", maxWidth: 400 }}>
              <input
                type="password" placeholder="Enter admin password" value={adminPwInput}
                onChange={e => setAdminPwInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    if (adminPwInput === ADMIN_PASSWORD) { setAdminAuthed(true); setAdminPwError(false); }
                    else { setAdminPwError(true); }
                  }
                }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={() => {
                if (adminPwInput === ADMIN_PASSWORD) { setAdminAuthed(true); setAdminPwError(false); }
                else setAdminPwError(true);
              }} style={{ background: WHITE, color: BG, border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 10, cursor: "pointer", fontFamily: "'DM Mono'", fontWeight: 700 }}>ENTER</button>
              {adminPwError && <span style={{ fontSize: 10, color: RED }}>Wrong password</span>}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center" }}>
                <span style={{ fontSize: 9, color: GREEN, letterSpacing: "0.14em", marginRight: 8 }}>✓ ADMIN ACCESS</span>
                <button style={adminTabStyle(activeAdminTab === "overrides")} onClick={() => setActiveAdminTab("overrides")}>EDIT ROWS</button>
                <button style={adminTabStyle(activeAdminTab === "manual")} onClick={() => setActiveAdminTab("manual")}>ADD ENTRY</button>
                <button style={adminTabStyle(activeAdminTab === "settings")} onClick={() => setActiveAdminTab("settings")}>SETTINGS</button>
                <button onClick={() => { setAdminAuthed(false); setShowAdmin(false); }} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${BORDER}`, color: "#666", borderRadius: 6, padding: "5px 12px", fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono'" }}>LOCK</button>
              </div>

              {/* EDIT ROWS TAB */}
              {activeAdminTab === "overrides" && (
                <div>
                  <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 12 }}>EDIT / OVERRIDE FORM SUBMISSIONS</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                    {rawRows.length === 0 && <div style={{ fontSize: 11, color: "#555" }}>No form submissions yet.</div>}
                    {rawRows.map(row => {
                      const overridden = applyOverrides([row], overrides)[0];
                      const isEditing = editingRow === row.id;
                      return (
                        <div key={row.id} style={{ background: "#0a0a0a", border: `1px solid ${isEditing ? WHITE + "44" : BORDER}`, borderRadius: 8, padding: "12px 14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isEditing ? 12 : 0 }}>
                            <div style={{ display: "flex", gap: 16 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: WHITE }}>{row.rep}</span>
                              <span style={{ fontSize: 10, color: "#555" }}>{row.date}</span>
                            </div>
                            {!isEditing ? (
                              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                                {FIELDS.map(f => (
                                  <span key={f} style={{ fontSize: 10, color: overrides.find(o => o.id === row.id && o.field === f) ? GREEN : "#666" }}>
                                    {f}: <span style={{ color: WHITE }}>{(overridden as any)[f]}</span>
                                  </span>
                                ))}
                                <button onClick={() => startEdit(row)} style={{ background: "transparent", border: `1px solid ${BORDER}`, color: GRAY, borderRadius: 5, padding: "3px 10px", fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono'" }}>EDIT</button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => saveEdit(row.id)} style={{ background: GREEN, color: BG, border: "none", borderRadius: 5, padding: "4px 12px", fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono'", fontWeight: 700 }}>SAVE</button>
                                <button onClick={() => setEditingRow(null)} style={{ background: "transparent", border: `1px solid ${BORDER}`, color: GRAY, borderRadius: 5, padding: "4px 10px", fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono'" }}>CANCEL</button>
                              </div>
                            )}
                          </div>
                          {isEditing && (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                              {FIELDS.map(f => (
                                <div key={f}>
                                  <div style={{ fontSize: 8, color: "#555", letterSpacing: "0.1em", marginBottom: 4 }}>{f.toUpperCase()}</div>
                                  <input
                                    value={editVals[f] || ""}
                                    onChange={e => setEditVals({ ...editVals, [f]: e.target.value })}
                                    style={{ ...inputStyle }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ADD MANUAL ENTRY TAB */}
              {activeAdminTab === "manual" && (
                <div>
                  <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 12 }}>ADD MANUAL ENTRY</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8, marginBottom: 10 }}>
                    {[
                      { key: "date", label: "DATE", placeholder: "3/9/2026" },
                      { key: "rep", label: "REP NAME", placeholder: "Cobe" },
                      { key: "totalCalls", label: "TOTAL CALLS", placeholder: "0" },
                      { key: "shows", label: "SHOW UPS", placeholder: "0" },
                      { key: "noShows", label: "NO SHOWS", placeholder: "0" },
                      { key: "closes", label: "CLOSES", placeholder: "0" },
                      { key: "revenue", label: "CASH ($)", placeholder: "0" },
                    ].map(({ key, label, placeholder }) => (
                      <div key={key}>
                        <div style={{ fontSize: 8, color: "#555", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
                        <input
                          value={(newEntry as any)[key]}
                          placeholder={placeholder}
                          onChange={e => setNewEntry({ ...newEntry, [key]: e.target.value })}
                          style={inputStyle}
                        />
                      </div>
                    ))}
                  </div>
                  <button onClick={addManualEntry} style={{ background: GREEN, color: BG, border: "none", borderRadius: 6, padding: "8px 20px", fontSize: 10, cursor: "pointer", fontFamily: "'DM Mono'", fontWeight: 700, letterSpacing: "0.08em" }}>+ ADD ENTRY</button>

                  {manualEntries.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.14em", marginBottom: 8 }}>MANUAL ENTRIES ({manualEntries.length})</div>
                      {manualEntries.map(m => (
                        <div key={m.id} style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                          <span style={{ fontSize: 11, color: WHITE, minWidth: 80 }}>{m.rep}</span>
                          <span style={{ fontSize: 10, color: "#555", minWidth: 100 }}>{m.date}</span>
                          {FIELDS.map(f => (
                            <span key={f} style={{ fontSize: 10, color: "#666" }}>{f}: <span style={{ color: WHITE }}>{(m as any)[f]}</span></span>
                          ))}
                          <button onClick={() => setManualEntries(manualEntries.filter(e => e.id !== m.id))} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${RED}44`, color: RED, borderRadius: 5, padding: "2px 8px", fontSize: 9, cursor: "pointer", fontFamily: "'DM Mono'" }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeAdminTab === "settings" && (
                <div>
                  <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 16 }}>DASHBOARD SETTINGS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, maxWidth: 600 }}>
                    <div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.1em", marginBottom: 6 }}>SEED REVENUE ($)</div>
                      <div style={{ fontSize: 8, color: "#444", marginBottom: 6 }}>Pre-dashboard cash to include in this month</div>
                      <input
                        value={seedRevenue}
                        onChange={e => setSeedRevenue(num(e.target.value))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.1em", marginBottom: 6 }}>MONTHLY TARGET ($)</div>
                      <div style={{ fontSize: 8, color: "#444", marginBottom: 6 }}>Currently hardcoded at $110,000</div>
                      <input value={TARGET_MONTHLY} disabled style={{ ...inputStyle, opacity: 0.4 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: "0.1em", marginBottom: 6 }}>CLEAR OVERRIDES</div>
                      <div style={{ fontSize: 8, color: "#444", marginBottom: 6 }}>Reset all row edits back to original</div>
                      <button onClick={() => setOverrides([])} style={{ background: RED + "22", border: `1px solid ${RED}44`, color: RED, borderRadius: 6, padding: "7px 16px", fontSize: 10, cursor: "pointer", fontFamily: "'DM Mono'" }}>CLEAR ALL</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* FILTER BAR */}
        <div className="fade" style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, color: GRAY, letterSpacing: "0.12em", marginRight: 4 }}>VIEW</span>
            {FILTER_GROUPS.slice(0, 4).map(f => chip(filterMode === f.value, () => setFilterMode(f.value), f.label))}
            <div style={{ width: 1, height: 14, background: BORDER, margin: "0 4px" }} />
            {FILTER_GROUPS.slice(4).map(f => chip(filterMode === f.value, () => setFilterMode(f.value), f.label))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 9, color: GRAY, letterSpacing: "0.12em", marginRight: 4 }}>REP</span>
            {allReps.map(r => chip(filterRep === r, () => setFilterRep(r), r))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 80, textAlign: "center", fontSize: 9, color: GRAY, letterSpacing: "0.2em" }}>LOADING...</div>
        ) : error ? (
          <div style={{ padding: 60, textAlign: "center", fontSize: 12, color: RED }}>{error}</div>
        ) : (<>

          {/* GOAL CARD */}
          <div className="fade" style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "22px 26px", position: "relative", overflow: "hidden", animationDelay: "0.04s" }}>
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `linear-gradient(90deg, ${monthPct >= 50 ? GREEN : RED}0A 0%, transparent 55%)`, width: `${monthPct}%`, transition: "width 1.2s ease" }} />
            <div style={{ position: "relative", display: "flex", gap: 36, alignItems: "center" }}>
              <div style={{ minWidth: 200 }}>
                <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 5 }}>CASH COLLECTED — {filterLabel}</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: WHITE }}>{money(stats.revenue)}</div>
                <div style={{ fontSize: 10, color: GRAY, marginTop: 5 }}>of {money(TARGET_MONTHLY)} monthly goal</div>
              </div>
              <div style={{ width: 1, height: 56, background: BORDER, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ fontSize: 9, color: GRAY, letterSpacing: "0.12em" }}>TO $110K/MONTH</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: monthPct >= 75 ? GREEN : monthPct >= 40 ? WHITE : RED }}>{monthPct}%</span>
                </div>
                <div style={{ height: 5, background: "#181818", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(monthPct, 100)}%`, background: monthPct >= 75 ? GREEN : monthPct >= 40 ? WHITE : RED, transition: "width 1.2s ease" }} />
                </div>
                <div style={{ display: "flex", gap: 28, marginTop: 14 }}>
                  {([["GAP", money(Math.max(0, TARGET_MONTHLY - stats.revenue))], ["CLOSES LEFT", closesNeeded], ["AVG DEAL", money(avgDeal)], ["CLOSES", stats.closes]] as [string, string|number][]).map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 8, color: GRAY, letterSpacing: "0.14em", marginBottom: 3 }}>{k}</div>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 700, color: WHITE }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* PACING CARD */}
          <div className="fade" style={{ background: SURFACE, border: `1px solid ${isAhead ? GREEN + "44" : RED + "44"}`, borderRadius: 14, padding: "20px 26px", animationDelay: "0.06s", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: isAhead ? GREEN : RED }} />
            <div style={{ fontSize: 8, color: GRAY, letterSpacing: "0.14em", marginBottom: 12 }}>MONTH PACING — {nowDate.toLocaleString("default", { month: "long" }).toUpperCase()} {nowDate.getFullYear()}</div>
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <div style={{ minWidth: 160, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, paddingRight: 28, borderRight: `1px solid ${BORDER}` }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: isAhead ? GREEN + "18" : RED + "18", border: `1px solid ${isAhead ? GREEN + "55" : RED + "55"}`, borderRadius: 6, padding: "5px 10px", width: "fit-content" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: isAhead ? GREEN : RED, boxShadow: `0 0 8px ${isAhead ? GREEN : RED}` }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: isAhead ? GREEN : RED, fontFamily: "'Syne', sans-serif", letterSpacing: "0.05em" }}>{isAhead ? "AHEAD" : "BEHIND"}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: isAhead ? GREEN : RED, marginTop: 4 }}>{pacingPct}%</div>
                <div style={{ fontSize: 9, color: WHITE, letterSpacing: "0.06em" }}>of expected pace</div>
              </div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", paddingLeft: 28 }}>
                {[
                  { label: "DAYS LEFT", value: daysRemaining, sub: `of ${totalDaysInMonth} in month`, color: daysRemaining <= 5 ? RED : WHITE },
                  { label: "MTD CASH", value: money(revenueThisMonth), sub: `day ${dayOfMonth} of ${totalDaysInMonth}`, color: WHITE },
                  { label: "DAILY RUN RATE", value: money(Math.round(dailyActual)), sub: `need ${money(Math.round(dailyNeeded))}/day`, color: dailyActual >= dailyNeeded ? GREEN : RED },
                  { label: "CLOSES/DAY", value: closesPerDayActual, sub: `need ${closesPerDayNeeded}/day`, color: parseFloat(closesPerDayActual) >= closesPerDayNeeded ? GREEN : RED },
                  { label: "PROJ. MONTH END", value: money(projectedEOM), sub: projectedEOM >= TARGET_MONTHLY ? "✓ on track" : `gap: ${money(TARGET_MONTHLY - projectedEOM)}`, color: projectedEOM >= TARGET_MONTHLY ? GREEN : RED },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} style={{ display: "flex", flexDirection: "column", justifyContent: "center", borderRight: `1px solid ${BORDER}`, padding: "0 20px" }}>
                    <div style={{ fontSize: 8, color: WHITE, letterSpacing: "0.14em", marginBottom: 5 }}>{label}</div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color, lineHeight: 1, letterSpacing: "-0.01em" }}>{value}</div>
                    <div style={{ fontSize: 9, color: WHITE, marginTop: 4, letterSpacing: "0.04em" }}>{sub}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${BORDER}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 8, color: WHITE, letterSpacing: "0.12em" }}>MONTH TIMELINE — DAY {dayOfMonth} / {totalDaysInMonth}</span>
                <span style={{ fontSize: 8, color: WHITE }}>calls/close: {callsPerClose}</span>
              </div>
              <div style={{ position: "relative", height: 6, background: "#181818", borderRadius: 999 }}>
                <div style={{ position: "absolute", top: -3, bottom: -3, left: `${(dayOfMonth / totalDaysInMonth) * 100}%`, width: 2, background: WHITE + "30", borderRadius: 1 }} />
                <div style={{ height: "100%", borderRadius: 999, width: `${Math.min((revenueThisMonth / TARGET_MONTHLY) * 100, 100)}%`, background: isAhead ? GREEN : RED, transition: "width 1s ease" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
                <span style={{ fontSize: 7, color: WHITE }}>$0</span>
                <span style={{ fontSize: 7, color: WHITE }}>$55K</span>
                <span style={{ fontSize: 7, color: WHITE }}>$110K</span>
              </div>
            </div>
          </div>

          {/* KPI STRIP */}
          <div className="fade" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, animationDelay: "0.08s" }}>
            <KpiCard label="TOTAL CALLS" value={stats.totalCalls} sub="conducted" />
            <KpiCard label="SHOW UPS" value={stats.shows} sub={`${stats.noShows} no-shows`} />
            <KpiCard label="SHOW RATE" value={showRate + "%"} sub={`${stats.shows} show ups · ${stats.noShows} no-shows`} color={showRate >= 70 ? GREEN : stats.totalCalls > 0 ? RED : WHITE} />
            <KpiCard label="CLOSE RATE" value={closeRate + "%"} sub={`${stats.closes} deals / ${stats.shows} show ups`} color={closeRate >= 25 ? GREEN : stats.shows > 0 ? RED : WHITE} />
            <KpiCard label="CASH COLLECTED" value={money(stats.revenue)} sub={filterLabel} />
          </div>

          {/* LEADERBOARD + CHARTS */}
          <div className="fade" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, animationDelay: "0.12s" }}>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "20px 22px" }}>
              <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 18 }}>REP LEADERBOARD — {filterLabel}</div>
              {reps.length === 0 && <div style={{ fontSize: 11, color: "#444" }}>No data for this period yet.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {reps.map((r, i) => {
                  const cr = pct(r.closes, r.shows);
                  const sr = pct(r.shows, r.totalCalls);
                  return (
                    <div key={r.rep}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 9, color: i === 0 ? GREEN : GRAY, fontWeight: 500 }}>#{i+1}</span>
                          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: WHITE }}>{r.rep}</span>
                        </div>
                        <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16, color: i === 0 ? GREEN : WHITE }}>{money(r.revenue)}</span>
                      </div>
                      <Bar value={r.revenue} max={maxRepRev} color={i === 0 ? GREEN : "#282828"} h={3} />
                      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                        {([
                          { k: "Calls", v: r.totalCalls, c: null },
                          { k: "Show Ups", v: r.shows, c: null },
                          { k: "No Shows", v: r.noShows, c: null },
                          { k: "Deals", v: r.closes, c: null },
                          { k: "Show%", v: sr+"%", c: sr>=70?GREEN:RED },
                          { k: "CR%", v: cr+"%", c: cr>=25?GREEN:RED },
                        ] as { k: string; v: string|number; c: string|null }[]).map(({ k, v, c }) => (
                          <div key={k} style={{ fontSize: 10, color: GRAY }}>
                            {k} <span style={{ color: c || "#999" }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 12 }}>DAILY CLOSES — {filterLabel}</div>
                <SparkBars data={trend} valueKey="closes" color={GREEN} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
                  <span style={{ fontSize: 8, color: "#888" }}>{trend[0]?.date}</span>
                  <span style={{ fontSize: 8, color: "#888" }}>{trend[trend.length-1]?.date}</span>
                </div>
              </div>
              <div style={{ height: 1, background: BORDER }} />
              <div>
                <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 12 }}>DAILY CASH — {filterLabel}</div>
                <SparkBars data={trend} valueKey="revenue" color={WHITE} />
              </div>
              <div style={{ height: 1, background: BORDER }} />
              <div>
                <div style={{ fontSize: 9, color: GRAY, letterSpacing: "0.14em", marginBottom: 12 }}>BENCHMARKS TO $110K</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {([
                    { label: "Closes / month", cur: stats.closes, target: 19, u: "" },
                    { label: "Show rate", cur: showRate, target: 75, u: "%" },
                    { label: "Close rate", cur: closeRate, target: 25, u: "%" },
                  ]).map(({ label, cur, target, u }) => {
                    const ok = cur >= target;
                    return (
                      <div key={label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 10, color: GRAY }}>{label}</span>
                          <div style={{ display: "flex", gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: ok ? GREEN : RED }}>{cur}{u}</span>
                            <span style={{ fontSize: 10, color: "#888" }}>/ {target}{u}</span>
                          </div>
                        </div>
                        <Bar value={cur} max={target * 1.5} color={ok ? GREEN : RED} h={2} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>)}
      </div>

      <div style={{ borderTop: `1px solid ${BORDER}`, padding: "11px 24px", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 8, color: "#888", letterSpacing: "0.14em" }}>THE RESERVE — CONFIDENTIAL</span>
        <span style={{ fontSize: 8, color: "#888", letterSpacing: "0.1em" }}>AUTO-REFRESH 60S</span>
      </div>
    </div>
  );
}
