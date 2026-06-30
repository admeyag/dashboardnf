import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  Legend,
  LineChart,
  Line,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Download,
  Filter,
  Loader2,
  Users,
  Package,
  Boxes,
  Table as TableIcon,
  Zap,
} from "lucide-react";

import { loadNFData, type NFRow, REMARK_COLORS, dateKey, rackBucket, severityBucket } from "@/lib/nf-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NF Dashboard — Not Found Root Cause Board" },
      {
        name: "description",
        content:
          "Light, modern dashboard for Not Found incidents with bucket breakdown, false NF tracking, user coaching insights, and raw data export.",
      },
    ],
  }),
  component: NFDashboard,
});

function NFDashboard() {
  const [rows, setRows] = useState<NFRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange | undefined>();
  const [search, setSearch] = useState("");
  const [activeRemark, setActiveRemark] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadNFData()
      .then((d) => {
        setRows(d);
        const dated = d.map((r) => r.date.getTime()).filter((t) => t > 0);
        if (dated.length) {
          setRange({ from: new Date(Math.min(...dated)), to: new Date(Math.max(...dated)) });
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const fromTs = range?.from
      ? new Date(range.from.getFullYear(), range.from.getMonth(), range.from.getDate()).getTime()
      : -Infinity;
    const toTs = range?.to
      ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), 23, 59, 59).getTime()
      : Infinity;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const t = r.date.getTime();
      // Undated rows (sentinel = 0) are always included; they can't be filtered by date.
      if (t > 0 && (t < fromTs || t > toTs)) return false;
      if (activeRemark && r.remark !== activeRemark) return false;
      if (
        q &&
        !r.username.toLowerCase().includes(q) &&
        !r.product_sku.toLowerCase().includes(q) &&
        !r.bin_name.toLowerCase().includes(q) &&
        !r.item_code.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, range, search, activeRemark]);

  // Reset selection when filters change
  useEffect(() => setSelected(new Set()), [range, search, activeRemark]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Failed to load data</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-[color:var(--primary)]" />
          Loading NF dataset…
        </div>
      </div>
    );
  }

  const rawRows = filtered.filter((r) => r.source === "raw");
  const total = rawRows.length;
  const falseNF = filtered.filter((r) => r.source === "false").length;
  const trueNF = filtered.filter((r) => r.source === "true").length;
  const falseRate = total ? (falseNF / total) * 100 : 0;

  // Impact Location (severity buckets) from raw rows
  const sevCounts = aggCount(rawRows, (r) => severityBucket(r.rack_name));
  const sevOrder: Array<"High" | "Medium" | "Low" | "Very Low"> = ["High", "Medium", "Low", "Very Low"];
  const sevColors: Record<string, string> = {
    High: "var(--chart-4)",
    Medium: "var(--chart-3)",
    Low: "var(--chart-2)",
    "Very Low": "var(--chart-1)",
  };
  const impactData = sevOrder.map((k) => ({
    name: k,
    value: sevCounts.get(k) ?? 0,
    pct: total ? Math.round(((sevCounts.get(k) ?? 0) / total) * 100) : 0,
  }));

  // Summary of Remarks (pie)
  const remarkCounts = aggCount(rawRows, (r) => r.remark);
  const remarkData = [...remarkCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name, value }));

  // User-wise False NF
  const falseRowsArr = filtered.filter((r) => r.source === "false");
  const userFalse = aggCount(falseRowsArr, (r) => r.username || "—");
  const userTotalsRaw = aggCount(rawRows, (r) => r.username || "—");
  const topFalseUsers = [...userFalse.entries()]
    .map(([u, n]) => {
      const t = userTotalsRaw.get(u) ?? n;
      return [u, n, t ? (n / t) * 100 : 0] as [string, number, number];
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Trend (24 buckets) from filtered
  const trend = buildDailyTrend(filtered);

  // Actual / True NF quick numbers
  const trueRowsArr = filtered.filter((r) => r.source === "true");
  const trueUniqueUsers = new Set(trueRowsArr.map((r) => r.username || "—")).size;
  const trueAffectedItems = new Set(trueRowsArr.map((r) => r.item_code)).size;

  // Refilling Issue & Misplaced SKU by rack bucket
  const refillData = bucketByRack(rawRows, (r) => /refill/i.test(r.remark));
  const misplacedData = bucketByRack(rawRows, (r) => /misplace/i.test(r.remark));

  const exportRows = selected.size
    ? filtered.filter((_, i) => selected.has(i))
    : filtered;

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-[color:var(--background)]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className="relative grid h-11 w-11 place-items-center rounded-2xl shadow-[var(--shadow-glow)]"
              style={{ background: "var(--gradient-hero)" }}
            >
              <Zap className="h-5 w-5 text-white" />
              <span className="absolute -top-1 -right-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> LIVE
              </span>
            </div>
            <div>
              <h1 className="text-base font-extrabold uppercase tracking-[0.18em] text-foreground/90 sm:text-lg">
                Real Time NF Dashboard
              </h1>
              <p className="text-xs text-muted-foreground">Not Found incidents · Root cause board</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search user, SKU, item, bin…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-60"
            />
            <DateRangePicker range={range} onChange={setRange} />
            {activeRemark && (
              <Button variant="secondary" size="sm" onClick={() => setActiveRemark(null)} className="gap-2">
                <Filter className="h-3.5 w-3.5" />
                {activeRemark}
                <span className="ml-1 opacity-60">×</span>
              </Button>
            )}
            <Button size="sm" className="gap-2" onClick={() => downloadCSV(exportRows)}>
              <Download className="h-4 w-4" />
              Export {selected.size ? `(${selected.size})` : "All"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-6 px-6 pt-6">
        {/* Row 1 — three big tiles */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <GaugeCard label="Total NF Posted (Count)" value={total} max={Math.max(total, 1)} />
          <ImpactLocationCard data={impactData} colors={sevColors} />
          <RemarksPieCard data={remarkData} />
        </section>

        {/* Row 2 — False NF userwise + trend */}
        <Card className="border-border bg-card shadow-[var(--shadow-card)]">
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <span className="section-badge">2</span>
            <CardTitle className="text-base font-bold tracking-tight">
              Level of False NF — User wise
            </CardTitle>
            <Badge variant="secondary" className="ml-auto font-mono">
              {falseNF.toLocaleString()} False · {falseRate.toFixed(1)}%
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <FalseUserTable rows={topFalseUsers} />
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--border)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="falseNF" name="False NF" stroke="var(--chart-4)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="trueNF" name="True NF" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Row 3 — Actual NF Quick Numbers */}
        <Card
          className="border-border shadow-[var(--shadow-card)]"
          style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--chart-1) 18%, var(--card)), var(--card))" }}
        >
          <CardHeader className="flex flex-row items-center gap-3 pb-3">
            <span className="section-badge">3</span>
            <CardTitle className="text-base font-bold tracking-tight">
              Actual NF Only — Quick Numbers
              <span className="ml-2 inline-block text-[color:var(--chart-3)]">★</span>
            </CardTitle>
            <Badge variant="secondary" className="ml-auto font-mono">unique by item_code</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <QuickStat label="Count" value={trueNF.toLocaleString()} icon={<Activity className="h-4 w-4" />} color="var(--chart-1)" />
            <QuickStat label="Unique Users" value={trueUniqueUsers.toLocaleString()} icon={<Users className="h-4 w-4" />} color="var(--chart-3)" />
            <QuickStat label="Affected Items" value={trueAffectedItems.toLocaleString()} icon={<Package className="h-4 w-4" />} color="var(--chart-2)" />
          </CardContent>
        </Card>

        {/* Row 4 — Refilling Issue & Misplaced SKU */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LocationImpactCard
            num={4}
            title="Refilling Issue — Impact of Location"
            data={refillData}
            color="var(--chart-1)"
          />
          <LocationImpactCard
            num={5}
            title="Misplaced SKU — Impact Location"
            data={misplacedData}
            color="var(--chart-3)"
          />
        </section>

        {/* Raw data */}
        <RawDataTable rows={filtered} selected={selected} setSelected={setSelected} />

        <p className="pt-2 text-center text-xs text-muted-foreground">
          {filtered.length.toLocaleString()} rows · {rows.length.toLocaleString()} total in dataset
          {selected.size ? ` · ${selected.size} selected` : ""}
        </p>
      </main>
    </div>
  );
}

/* ────────────────── helpers & subcomponents ────────────────── */

function bucketByRack(rows: NFRow[], pred: (r: NFRow) => boolean) {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!pred(r)) continue;
    const k = rackBucket(r.rack_name);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name, value }));
}

function GaugeCard({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(1, value / max);
  const R = 80;
  const C = Math.PI * R; // half-circle circumference
  const dash = C * pct;
  return (
    <Card className="border-border bg-card shadow-[var(--shadow-card)]">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <div className="relative mx-auto h-44 w-full max-w-[280px]">
          <svg viewBox="0 0 200 120" className="h-full w-full">
            <defs>
              <linearGradient id="gauge-grad" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="var(--chart-1)" />
                <stop offset="100%" stopColor="var(--chart-5)" />
              </linearGradient>
            </defs>
            <path d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke="var(--muted)" strokeWidth="16" strokeLinecap="round" />
            <path
              d="M20,100 A80,80 0 0 1 180,100"
              fill="none"
              stroke="url(#gauge-grad)"
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${C}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
            <div className="text-4xl font-extrabold tracking-tight">{value.toLocaleString()}</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">incidents</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ImpactLocationCard({
  data,
  colors,
}: {
  data: { name: string; value: number; pct: number }[];
  colors: Record<string, string>;
}) {
  return (
    <Card className="border-border bg-card shadow-[var(--shadow-card)]">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-muted-foreground">Impact Location</CardTitle></CardHeader>
      <CardContent>
        <div className="h-44">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="value" radius={[10, 10, 0, 0]} label={{ position: "top", fill: "var(--foreground)", fontSize: 11 }}>
                {data.map((d) => <Cell key={d.name} fill={colors[d.name] || "var(--chart-1)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function RemarksPieCard({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <Card className="border-border bg-card shadow-[var(--shadow-card)]">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-muted-foreground">Summary of Remarks</CardTitle></CardHeader>
      <CardContent>
        <div className="flex h-44 items-center gap-2">
          <div className="h-full flex-1">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={2} stroke="var(--card)">
                  {data.map((d) => <Cell key={d.name} fill={REMARK_COLORS[d.name] || "var(--chart-1)"} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-44 space-y-1.5 text-xs">
            {data.map((d) => (
              <li key={d.name} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: REMARK_COLORS[d.name] || "var(--chart-1)" }} />
                <span className="truncate flex-1">{d.name}</span>
                <span className="font-mono text-muted-foreground">{Math.round((d.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function FalseUserTable({ rows }: { rows: [string, number, number][] }) {
  if (!rows.length) {
    return <div className="grid h-full place-items-center text-sm text-muted-foreground">No False NF in range.</div>;
  }
  const palette = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)", "var(--chart-5)", "var(--chart-4)", "var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-[1fr_70px_80px] gap-2 bg-[color:var(--muted)] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>User Name</span><span className="text-right">%</span><span className="text-right">Count</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map(([u, n, p], i) => (
          <div key={u} className="grid grid-cols-[1fr_70px_80px] items-center gap-2 px-3 py-2 text-sm">
            <span className="flex items-center gap-2 truncate">
              <span className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: palette[i % palette.length] }}>
                {(u[0] || "?").toUpperCase()}
              </span>
              <span className="truncate">{u}</span>
            </span>
            <span className="text-right font-mono text-xs text-muted-foreground">{p.toFixed(1)}%</span>
            <span className="text-right font-mono font-semibold">{n.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickStat({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-2xl border border-border bg-[color:var(--card)]/60 p-5 backdrop-blur">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
          {icon}
        </span>
      </div>
      <div className="mt-3 text-4xl font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

function LocationImpactCard({
  num,
  title,
  data,
  color,
}: {
  num: number;
  title: string;
  data: { name: string; value: number }[];
  color: string;
}) {
  return (
    <Card className="border-border bg-card shadow-[var(--shadow-card)]">
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <span className="section-badge">{num}</span>
        <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
        <Badge variant="secondary" className="ml-auto font-mono">
          {data.reduce((s, x) => s + x.value, 0).toLocaleString()}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="h-56">
          {data.length ? (
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="value" radius={[10, 10, 0, 0]} fill={color} label={{ position: "top", fill: "var(--foreground)", fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">No data in range.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}



const tooltipStyle: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
  color: "var(--popover-foreground)",
  boxShadow: "0 10px 30px -10px oklch(0.2 0.05 260 / 0.18)",
};

function aggCount<T>(arr: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = key(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function buildDailyTrend(rows: NFRow[]) {
  const map = new Map<string, { total: number; falseNF: number; trueNF: number }>();
  for (const r of rows) {
    if (r.date.getTime() <= 0) continue;
    const k = dateKey(r.date);
    const cur = map.get(k) ?? { total: 0, falseNF: 0, trueNF: 0 };
    cur.total++;
    if (r.remark === "False NF") cur.falseNF++;
    if (r.remark === "True NF") cur.trueNF++;
    map.set(k, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ label: format(new Date(k), "MMM d"), ...v }));
}

function buildSparklines(rows: NFRow[], users: string[], dayKeys: string[]) {
  const out = new Map<string, { d: string; v: number }[]>();
  for (const u of users) out.set(u, dayKeys.map((d) => ({ d, v: 0 })));
  for (const r of rows) {
    const u = r.username || "—";
    const arr = out.get(u);
    if (!arr) continue;
    const k = dateKey(r.date);
    const slot = arr.find((x) => x.d === k);
    if (slot) slot.v++;
  }
  return out;
}

function KpiCard({
  label,
  value,
  sub,
  icon,
  accent,
  progress,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: "indigo" | "emerald" | "coral" | "amber";
  progress?: number;
  mono?: boolean;
}) {
  const accentVar = {
    indigo: "var(--chart-1)",
    emerald: "var(--chart-2)",
    coral: "var(--chart-4)",
    amber: "var(--chart-3)",
  }[accent];
  return (
    <Card className="relative overflow-hidden border-border bg-card shadow-[var(--shadow-card)]">
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accentVar }} />
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
          <span
            className="grid h-8 w-8 place-items-center rounded-lg"
            style={{ background: `color-mix(in oklab, ${accentVar} 14%, transparent)`, color: accentVar }}
          >
            {icon}
          </span>
        </div>
        <div
          className={`mt-3 ${mono ? "truncate font-mono text-lg font-semibold" : "text-3xl font-extrabold tracking-tight"}`}
          title={value}
        >
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        {typeof progress === "number" && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, progress)}%`, background: accentVar }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UserTable({
  title,
  icon,
  entries,
  sparkByUser,
  color,
}: {
  title: string;
  icon: React.ReactNode;
  entries: [string, number][];
  sparkByUser: Map<string, { d: string; v: number }[]>;
  color: string;
}) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <Card className="border-border bg-card shadow-[var(--shadow-card)]">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span style={{ color }}>{icon}</span> {title}
        </CardTitle>
        <Badge variant="secondary" className="font-mono">{entries.length}</Badge>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[420px] pr-2">
          <div className="space-y-1">
            {entries.map(([u, n], i) => {
              const spark = sparkByUser.get(u) ?? [];
              return (
                <div
                  key={u}
                  className="grid grid-cols-[28px_minmax(0,1fr)_90px_60px] items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[color:var(--muted)]"
                >
                  <span className="text-xs font-mono text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{u}</div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[color:var(--muted)]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(n / max) * 100}%`, background: color }}
                      />
                    </div>
                  </div>
                  <div className="h-8">
                    <Sparkline data={spark.map((s) => s.v)} color={color} />
                  </div>
                  <div className="text-right font-mono text-sm font-semibold">{n}</div>
                </div>
              );
            })}
            {!entries.length && (
              <p className="py-12 text-center text-sm text-muted-foreground">No data in selected range.</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const max = Math.max(1, ...data);
  const w = 90;
  const h = 28;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  const fillPts = `0,${h} ${pts} ${(data.length - 1) * step},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline points={fillPts} fill={color} fillOpacity={0.18} stroke="none" />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DateRangePicker({
  range,
  onChange,
}: {
  range: DateRange | undefined;
  onChange: (r: DateRange | undefined) => void;
}) {
  const fromLbl = range?.from ? format(range.from, "MMM d, yyyy") : "Start date";
  const toLbl = range?.to ? format(range.to, "MMM d, yyyy") : "End date";
  const active = !!(range?.from || range?.to);

  const setPreset = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    onChange({ from, to });
  };

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <CalendarDays className="h-4 w-4 text-[color:var(--primary)]" />
            <span className="font-mono text-xs">
              <span className={range?.from ? "" : "text-muted-foreground"}>{fromLbl}</span>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className={range?.to ? "" : "text-muted-foreground"}>{toLbl}</span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <Button size="sm" variant="secondary" onClick={() => setPreset(7)}>Last 7 days</Button>
            <Button size="sm" variant="secondary" onClick={() => setPreset(30)}>Last 30 days</Button>
            <Button size="sm" variant="secondary" onClick={() => setPreset(90)}>Last 90 days</Button>
          </div>
          <DayPicker
            mode="range"
            numberOfMonths={2}
            selected={range}
            onSelect={onChange}
            className="rdp-nf p-3"
          />
          <div className="flex items-center justify-between gap-2 border-t border-border p-3">
            <span className="text-xs text-muted-foreground">
              Pick start date, then end date.
            </span>
            <Button size="sm" variant="destructive" onClick={() => onChange(undefined)}>
              Clear dates
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {active && (
        <Button
          size="sm"
          variant="ghost"
          className="h-9 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => onChange(undefined)}
          title="Clear date filter"
        >
          ✕
        </Button>
      )}
    </div>
  );
}

function RawDataTable({
  rows,
  selected,
  setSelected,
}: {
  rows: NFRow[];
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
}) {
  const PAGE = 200;
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [remarkF, setRemarkF] = useState<string>("");
  const [statusF, setStatusF] = useState<string>("");
  const [sourceF, setSourceF] = useState<string>("");

  const remarkOpts = useMemo(
    () => [...new Set(rows.map((r) => r.remark))].sort(),
    [rows],
  );
  const statusOpts = useMemo(
    () => [...new Set(rows.map((r) => r.status).filter(Boolean))].sort(),
    [rows],
  );

  const indexedRows = useMemo(
    () => rows.map((r, i) => ({ r, i })),
    [rows],
  );

  const filteredIdx = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return indexedRows.filter(({ r }) => {
      if (remarkF && r.remark !== remarkF) return false;
      if (statusF && r.status !== statusF) return false;
      if (sourceF && r.source !== sourceF) return false;
      if (ql) {
        const hay = `${r.username} ${r.product_sku} ${r.item_code} ${r.bin_name} ${r.rack_name} ${r.picklist_id}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [indexedRows, q, remarkF, statusF, sourceF]);

  useEffect(() => { setPage(0); }, [q, remarkF, statusF, sourceF]);

  const totalFiltered = filteredIdx.length;
  const pagesNow = Math.max(1, Math.ceil(totalFiltered / PAGE));
  const safePage = Math.min(page, pagesNow - 1);
  const viewSlice = filteredIdx.slice(safePage * PAGE, safePage * PAGE + PAGE);

  const allOnViewSelected =
    viewSlice.length > 0 && viewSlice.every(({ i }) => selected.has(i));

  const toggle = (i: number) => {
    const n = new Set(selected);
    n.has(i) ? n.delete(i) : n.add(i);
    setSelected(n);
  };
  const toggleAllPageNew = () => {
    const n = new Set(selected);
    if (allOnViewSelected) viewSlice.forEach(({ i }) => n.delete(i));
    else viewSlice.forEach(({ i }) => n.add(i));
    setSelected(n);
  };
  const selectAllFiltered = () => setSelected(new Set(filteredIdx.map(({ i }) => i)));
  const clearSel = () => setSelected(new Set());
  const clearFilters = () => { setQ(""); setRemarkF(""); setStatusF(""); setSourceF(""); };

  const exportRows = selected.size
    ? rows.filter((_, i) => selected.has(i))
    : filteredIdx.map(({ r }) => r);

  return (
    <Card className="border-border bg-card shadow-[var(--shadow-card)]">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
        <div className="flex items-center gap-2">
          <TableIcon className="h-4 w-4 text-[color:var(--primary)]" />
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Raw Data
          </CardTitle>
          <Badge variant="secondary" className="font-mono">{totalFiltered.toLocaleString()} / {rows.length.toLocaleString()}</Badge>
          {selected.size > 0 && (
            <Badge className="font-mono" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {selected.size} selected
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={selectAllFiltered}>Select all filtered</Button>
          <Button size="sm" variant="outline" onClick={clearSel} disabled={!selected.size}>Clear selection</Button>
          <Button size="sm" className="gap-2" onClick={() => downloadCSV(exportRows)}>
            <Download className="h-4 w-4" />
            Export {selected.size ? `Selected (${selected.size})` : `Filtered (${totalFiltered})`}
          </Button>
        </div>
      </CardHeader>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
        <Input
          placeholder="Search user / SKU / item / bin / picklist…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 w-64"
        />
        <select
          value={sourceF}
          onChange={(e) => setSourceF(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All sources</option>
          <option value="raw">Raw Data</option>
          <option value="true">True NF</option>
          <option value="false">False NF</option>
        </select>
        <select
          value={remarkF}
          onChange={(e) => setRemarkF(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All remarks</option>
          {remarkOpts.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={statusF}
          onChange={(e) => setStatusF(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">All statuses</option>
          {statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(q || remarkF || statusF || sourceF) && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>
        )}
      </div>
      <CardContent>
        <div className="overflow-hidden rounded-lg border border-border">
          <ScrollArea className="h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[color:var(--muted)] text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">
                    <Checkbox
                      checked={allOnViewSelected}
                      onCheckedChange={toggleAllPageNew}
                      aria-label="Select page"
                    />
                  </th>
                  <Th>NF DateTime</Th>
                  <Th>User</Th>
                  <Th>Remark</Th>
                  <Th>SKU</Th>
                  <Th>Item</Th>
                  <Th>Bin</Th>
                  <Th>Rack</Th>
                  <Th>Status</Th>
                  <Th>Picklist</Th>
                </tr>
              </thead>
              <tbody>
                {viewSlice.map(({ r, i: idx }) => {
                  const isSel = selected.has(idx);
                  return (
                    <tr
                      key={idx}
                      className={`border-t border-border transition-colors ${isSel ? "bg-[color:color-mix(in_oklab,var(--primary)_8%,transparent)]" : "hover:bg-[color:var(--muted)]"}`}
                    >
                      <td className="px-3 py-2">
                        <Checkbox checked={isSel} onCheckedChange={() => toggle(idx)} />
                      </td>
                      <Td mono>{format(r.date, "dd-MMM-yyyy HH:mm")}</Td>
                      <Td>{r.username || "—"}</Td>
                      <Td>
                        <span
                          className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                          style={{
                            background: `color-mix(in oklab, ${REMARK_COLORS[r.remark] || "var(--chart-1)"} 14%, transparent)`,
                            color: REMARK_COLORS[r.remark] || "var(--chart-1)",
                          }}
                        >
                          {r.remark}
                        </span>
                      </Td>
                      <Td mono>{r.product_sku}</Td>
                      <Td mono>{r.item_code}</Td>
                      <Td mono>{r.bin_name}</Td>
                      <Td mono>{r.rack_name}</Td>
                      <Td>{r.status}</Td>
                      <Td mono>{r.picklist_id}</Td>
                    </tr>
                  );
                })}
                {!viewSlice.length && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-sm text-muted-foreground">
                      No rows match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </div>
        {pagesNow > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Showing {safePage * PAGE + 1}–{Math.min(safePage * PAGE + PAGE, totalFiltered)} of {totalFiltered.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                Prev
              </Button>
              <span className="font-mono">
                {safePage + 1} / {pagesNow}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage >= pagesNow - 1}
                onClick={() => setPage(safePage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-3 py-2 ${mono ? "font-mono text-xs" : ""}`}>{children}</td>
  );
}

function downloadCSV(rows: NFRow[]) {
  const header = [
    "NF DateTime",
    "username",
    "remark",
    "product_sku",
    "item_code",
    "bin_name",
    "rack_name",
    "status",
    "picklist_id",
    "warehouse_id",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        format(r.date, "yyyy-MM-dd HH:mm"),
        r.username,
        r.remark,
        r.product_sku,
        r.item_code,
        r.bin_name,
        r.rack_name,
        r.status,
        r.picklist_id,
        r.warehouse_id,
      ]
        .map((x) => `"${String(x).replace(/"/g, '""')}"`)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nf-export-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
