import React, { useState } from "react";
import {
  LayoutDashboard, FileText, ClipboardList, CheckCircle2, Smartphone,
  AlertTriangle, Lock, MessageCircle, ChevronDown,
  X, Check, ArrowUpRight, ArrowDownRight,
  Settings, Bell, FileSpreadsheet, FileDown, BarChart3,
  Building2, Home,
} from "lucide-react";

type Screen = "dashboard" | "pnl" | "entry" | "approval" | "mobile";

// ── Formatting helpers ──────────────────────────────────────────────────────
const idr = (v: number) => Math.abs(v).toLocaleString("id-ID");
const pct = (curr: number, prev: number) =>
  prev === 0 ? 0 : ((curr - prev) / Math.abs(prev)) * 100;
const fmtPct = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";

// ── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ active, onNav }: { active: Screen; onNav: (s: Screen) => void }) {
  const items: { id: Screen; label: string; Icon: React.ElementType }[] = [
    { id: "dashboard", label: "Dasbor Eksekutif", Icon: LayoutDashboard },
    { id: "pnl",       label: "Laporan P&L",     Icon: FileText },
    { id: "entry",     label: "Input Laporan",    Icon: ClipboardList },
    { id: "approval",  label: "Persetujuan",      Icon: CheckCircle2 },
    { id: "mobile",    label: "Tampilan Mobile",  Icon: Smartphone },
  ];

  return (
    <aside className="w-[214px] shrink-0 flex flex-col h-screen border-r border-[#27272A] bg-[#0A0A0B]">
      {/* brand */}
      <div className="h-12 flex items-center gap-2.5 px-4 border-b border-[#27272A]">
        <div className="w-6 h-6 rounded-[6px] bg-blue-500 flex items-center justify-center shrink-0">
          <BarChart3 size={13} className="text-white" />
        </div>
        <div>
          <p className="text-[12px] font-semibold text-[#FAFAFA] leading-tight">Portal Keuangan</p>
          <p className="text-[10px] text-[#A1A1AA]">Grup Holding</p>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 p-2 space-y-px overflow-y-auto">
        {items.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => onNav(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] transition-colors text-left ${
              active === id
                ? "bg-blue-500/10 text-blue-400 font-medium"
                : "text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      {/* bottom */}
      <div className="border-t border-[#27272A] p-2 space-y-px">
        <button className="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] transition-colors">
          <Bell size={14} />
          Notifikasi
          <span className="ml-auto bg-amber-500 text-[#0A0A0B] text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">2</span>
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-md text-[13px] text-[#A1A1AA] hover:bg-[#18181B] hover:text-[#FAFAFA] transition-colors">
          <Settings size={14} />
          Pengaturan
        </button>
      </div>
      <div className="px-4 py-3 border-t border-[#27272A]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[#27272A] flex items-center justify-center text-[11px] font-semibold text-[#FAFAFA] shrink-0">DK</div>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[#FAFAFA] truncate">Direktur Keuangan</p>
            <p className="text-[11px] text-[#A1A1AA] truncate">superadmin</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ── Screen 1: Executive Dashboard ───────────────────────────────────────────
function DashboardScreen() {
  const [showBanner, setShowBanner] = useState(true);

  const kpis = [
    { label: "Pendapatan Konsolidasi", value: "Rp 7,15 M", change: "+12,4%", dir: "up",   sub: "vs. bulan lalu" },
    { label: "Laba Bersih",            value: "Rp 1,02 M", change: "−8,2%",  dir: "down", sub: "vs. bulan lalu" },
    { label: "Posisi Kas",             value: "Rp 2,31 M", change: null,      dir: null,   sub: "per 31 Juli 2025" },
    { label: "Kelengkapan",            value: "3/4",        change: null,      dir: "warn", sub: "entitas melapor" },
  ];

  const lini = [
    { name: "Logistik",  company: "PT Indra Langgeng Jaya", pct: 68, value: "Rp 4,86 M",  color: "#3B82F6" },
    { name: "AMDK",      company: "PT Tirta Nusantara",     pct: 14, value: "Rp 1,00 M",  color: "#8B5CF6" },
    { name: "Tambang",   company: "PT Makmur Jaya",         pct: 12, value: "Rp 858 Jt",  color: "#F59E0B" },
    { name: "Garam",     company: "PT Samudra Garam",       pct:  6, value: "Rp 429 Jt",  color: "#22C55E" },
  ];

  const alerts = [
    { company: "PT Makmur Jaya",     issue: "Margin bersih 2,1% — di bawah ambang 5%" },
    { company: "PT Samudra Garam",   issue: "Piutang belum tertagih >45 hari: Rp 145.000.000" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-[#27272A] shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold text-[#FAFAFA]">Dasbor Eksekutif</h1>
          <span className="text-[11px] text-[#A1A1AA]">Grup Holding · Konsolidasi</span>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[13px] text-[#FAFAFA] hover:bg-[#27272A] transition-colors tabular-nums">
          Juli 2025 <ChevronDown size={13} className="text-[#A1A1AA]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* amber banner */}
        {showBanner && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg">
            <AlertTriangle size={14} className="text-amber-400 shrink-0" />
            <span className="text-[13px] text-amber-200 flex-1">
              Data belum lengkap — 1 dari 4 entitas belum melapor (<span className="font-semibold text-amber-400">PT Liafa</span>)
            </span>
            <button onClick={() => setShowBanner(false)} className="text-amber-500/60 hover:text-amber-400 transition-colors">
              <X size={13} />
            </button>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <div key={i} className="bg-[#18181B] border border-[#27272A] rounded-lg p-4">
              <p className="text-[11px] font-medium text-[#A1A1AA] mb-1.5">{kpi.label}</p>
              <p className="text-[22px] font-semibold text-[#FAFAFA] tabular-nums leading-none mb-2">{kpi.value}</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {kpi.change && (
                  <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded tabular-nums ${
                    kpi.dir === "up"
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  }`}>
                    {kpi.dir === "up" ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    {kpi.change} MoM
                  </span>
                )}
                {kpi.dir === "warn" && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                    <AlertTriangle size={10} />1 belum lapor
                  </span>
                )}
                <p className="text-[11px] text-[#52525B]">{kpi.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* contributions + alerts */}
        <div className="grid grid-cols-3 gap-5">
          {/* horizontal bars */}
          <div className="col-span-2 bg-[#18181B] border border-[#27272A] rounded-lg p-5">
            <h2 className="text-[13px] font-semibold text-[#FAFAFA] mb-4">Kontribusi per Lini Usaha</h2>
            <div className="space-y-4">
              {lini.map((item, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[#FAFAFA]">{item.name}</span>
                      <span className="text-[11px] text-[#A1A1AA]">{item.company}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-[11px] text-[#A1A1AA] tabular-nums">{item.value}</span>
                      <span className="text-[12px] font-semibold text-[#FAFAFA] tabular-nums w-8 text-right">{item.pct}%</span>
                    </div>
                  </div>
                  <div className="h-[5px] bg-[#27272A] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${item.pct}%`, backgroundColor: item.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* alerts panel */}
          <div className="bg-[#18181B] border border-[#27272A] rounded-lg p-5">
            <h2 className="text-[13px] font-semibold text-[#FAFAFA] mb-4">Perlu Perhatian</h2>
            <div className="space-y-3">
              {alerts.map((a, i) => (
                <div key={i} className="border-l-2 border-red-500 pl-3 py-2.5 bg-red-500/5 rounded-r-lg">
                  <p className="text-[12px] font-semibold text-[#FAFAFA] mb-0.5">{a.company}</p>
                  <p className="text-[11px] text-[#A1A1AA] leading-relaxed mb-2.5">{a.issue}</p>
                  <button className="flex items-center gap-1.5 text-[11px] text-green-400 hover:text-green-300 font-medium px-2 py-1 bg-green-500/10 rounded border border-green-500/20 transition-colors">
                    <MessageCircle size={11} />Tegur Admin
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Screen 2: P&L Detail ─────────────────────────────────────────────────────
type RowKind = "section" | "item" | "subtotal" | "total";
interface PnLRow { kind: RowKind; label: string; jul?: number | null; jun?: number | null; indent?: number }

const pnlRows: PnLRow[] = [
  { kind: "section",  label: "Pendapatan" },
  { kind: "item",     label: "Pendapatan Jasa Angkut",   jul: 215_416_417, jun: 198_200_000, indent: 1 },
  { kind: "item",     label: "Pendapatan Lain-lain",      jul:  20_000_000, jun:  14_200_000, indent: 1 },
  { kind: "subtotal", label: "Total Pendapatan",          jul: 235_416_417, jun: 212_400_000 },
  { kind: "section",  label: "Beban Pokok Pendapatan" },
  { kind: "item",     label: "Pajak atas Tagihan",        jul:  85_000_000, jun:  78_000_000, indent: 1 },
  { kind: "item",     label: "Bagian Rekanan",            jul:  65_000_000, jun:  60_000_000, indent: 1 },
  { kind: "item",     label: "Terpal",                    jul:  22_000_000, jun:  20_000_000, indent: 1 },
  { kind: "item",     label: "Operasional Armada",        jul:  45_000_000, jun:  42_000_000, indent: 1 },
  { kind: "subtotal", label: "Total Beban Pokok",         jul: 217_000_000, jun: 200_000_000 },
  { kind: "subtotal", label: "Laba Kotor",                jul:  18_416_417, jun:  12_400_000 },
  { kind: "section",  label: "Beban Usaha" },
  { kind: "item",     label: "Gaji & Tunjangan",          jul:  12_000_000, jun:  11_000_000, indent: 1 },
  { kind: "item",     label: "Sewa Kantor",               jul:   4_500_000, jun:   4_500_000, indent: 1 },
  { kind: "item",     label: "Biaya Administrasi",        jul:   4_095_224, jun:   3_800_000, indent: 1 },
  { kind: "subtotal", label: "Total Beban Usaha",         jul:  20_595_224, jun:  19_300_000 },
  { kind: "total",    label: "Laba Bersih",               jul:  -2_178_807, jun:  -6_900_000 },
];

function PnLNum({ v }: { v: number | null | undefined }) {
  if (v == null) return <td className="py-2 px-4 text-right tabular-nums text-[#A1A1AA]">—</td>;
  const neg = v < 0;
  return (
    <td className={`py-2 px-4 text-right tabular-nums text-[13px] ${neg ? "text-red-400" : "text-[#FAFAFA]"}`}>
      {neg ? `(${idr(v)})` : idr(v)}
    </td>
  );
}

function PnLScreen() {
  const d = (row: PnLRow) =>
    row.jul != null && row.jun != null ? pct(row.jul, row.jun) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-[#27272A] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[13px] font-semibold text-[#FAFAFA] shrink-0">PT Indra Langgeng Jaya</h1>
          <span className="text-[11px] text-[#A1A1AA] tabular-nums shrink-0">NPWP 01.234.567.8-901.000</span>
          <span className="px-2 py-0.5 bg-[#27272A] text-[11px] font-medium text-[#A1A1AA] rounded-full shrink-0 flex items-center gap-1">
            <Lock size={10} />Terkunci
          </span>
          <span className="px-2 py-0.5 bg-[#18181B] border border-[#27272A] text-[10px] text-[#71717A] rounded shrink-0">
            Basis: Kas · Penyajian: Bruto
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[12px] text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#27272A] transition-colors">
            <FileSpreadsheet size={13} />Unduh Excel
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[12px] text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#27272A] transition-colors">
            <FileDown size={13} />Unduh PDF
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#27272A]">
              <th className="py-2.5 px-5 text-left text-[11px] font-medium text-[#A1A1AA] w-[50%]">Pos</th>
              <th className="py-2.5 px-4 text-right text-[11px] font-medium text-[#A1A1AA] tabular-nums w-[18%]">Juli 2025</th>
              <th className="py-2.5 px-4 text-right text-[11px] font-medium text-[#A1A1AA] tabular-nums w-[18%]">Juni 2025</th>
              <th className="py-2.5 px-4 text-right text-[11px] font-medium text-[#A1A1AA] w-[14%]">Δ%</th>
            </tr>
          </thead>
          <tbody>
            {pnlRows.map((row, i) => {
              const delta = d(row);
              if (row.kind === "section") {
                return (
                  <tr key={i} className="border-t border-[#27272A] mt-2">
                    <td colSpan={4} className="py-2 px-5 text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider pt-4">
                      {row.label}
                    </td>
                  </tr>
                );
              }
              if (row.kind === "subtotal") {
                return (
                  <tr key={i} className="bg-[#18181B] border-t border-b border-[#27272A]">
                    <td className="py-2.5 px-5 text-[13px] font-semibold text-[#FAFAFA]">{row.label}</td>
                    <PnLNum v={row.jul} />
                    <PnLNum v={row.jun} />
                    <td className={`py-2.5 px-4 text-right tabular-nums text-[12px] font-medium ${
                      delta == null ? "" : delta >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      {delta != null ? fmtPct(delta) : "—"}
                    </td>
                  </tr>
                );
              }
              if (row.kind === "total") {
                const neg = (row.jul ?? 0) < 0;
                return (
                  <tr key={i} className="bg-[#1C1C1E] border-t-2 border-[#3F3F46]">
                    <td className="py-3 px-5 text-[13px] font-bold text-[#FAFAFA]">{row.label}</td>
                    <td className={`py-3 px-4 text-right tabular-nums text-[13px] font-bold ${neg ? "text-red-400" : "text-green-400"}`}>
                      {(row.jul ?? 0) < 0 ? `(Rp ${idr(row.jul!)})` : `Rp ${idr(row.jul!)}`}
                    </td>
                    <td className={`py-3 px-4 text-right tabular-nums text-[13px] font-bold ${(row.jun ?? 0) < 0 ? "text-red-400" : "text-green-400"}`}>
                      {(row.jun ?? 0) < 0 ? `(Rp ${idr(row.jun!)})` : `Rp ${idr(row.jun!)}`}
                    </td>
                    <td className={`py-3 px-4 text-right tabular-nums text-[12px] font-semibold ${
                      delta == null ? "" : delta >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      {delta != null ? fmtPct(delta) : "—"}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={i} className="border-b border-[#27272A]/50 hover:bg-[#18181B]/40 transition-colors">
                  <td className="py-2 text-[13px] text-[#FAFAFA]" style={{ paddingLeft: `${(row.indent ?? 0) * 20 + 20}px` }}>
                    {row.label}
                  </td>
                  <PnLNum v={row.jul} />
                  <PnLNum v={row.jun} />
                  <td className={`py-2 px-4 text-right tabular-nums text-[12px] ${
                    delta == null ? "text-[#A1A1AA]" : delta >= 0 ? "text-green-400" : "text-red-400"
                  }`}>
                    {delta != null ? fmtPct(delta) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Screen 3: Entry Form ─────────────────────────────────────────────────────
interface EntryRow {
  id: string; kind: "section" | "item" | "subtotal";
  kode?: string; label: string; amount?: number; catatan?: string;
  indent?: number; warn?: boolean;
}

const initialRows: EntryRow[] = [
  { id: "s1",    kind: "section",  label: "Pendapatan" },
  { id: "4-001", kind: "item",     kode: "4-001", label: "Pendapatan Jasa Angkut", amount: 215_416_417, catatan: "", indent: 1 },
  { id: "4-002", kind: "item",     kode: "4-002", label: "Pendapatan Lain-lain",   amount:  20_000_000, catatan: "", indent: 1 },
  { id: "sp1",   kind: "subtotal", label: "Total Pendapatan", amount: 235_416_417 },
  { id: "s2",    kind: "section",  label: "Beban Pokok Pendapatan" },
  { id: "5-001", kind: "item",     kode: "5-001", label: "Pajak atas Tagihan",  amount: 70_000_000, catatan: "", indent: 1 },
  { id: "5-002", kind: "item",     kode: "5-002", label: "Bagian Rekanan",      amount: 55_000_000, catatan: "", indent: 1 },
  { id: "5-003", kind: "item",     kode: "5-003", label: "Terpal",              amount: 15_000_000, catatan: "", indent: 1, warn: true },
  { id: "5-004", kind: "item",     kode: "5-004", label: "Operasional Armada",  amount: 40_000_000, catatan: "", indent: 1 },
  { id: "sp2",   kind: "subtotal", label: "Total Beban Pokok", amount: 180_000_000 },
  { id: "s3",    kind: "section",  label: "Beban Usaha" },
  { id: "6-001", kind: "item",     kode: "6-001", label: "Gaji & Tunjangan",   amount: 12_000_000, catatan: "", indent: 1 },
  { id: "6-002", kind: "item",     kode: "6-002", label: "Sewa Kantor",        amount:  4_500_000, catatan: "", indent: 1 },
  { id: "6-003", kind: "item",     kode: "6-003", label: "Biaya Administrasi", amount:  5_300_224, catatan: "", indent: 1 },
  { id: "sp3",   kind: "subtotal", label: "Total Beban Usaha", amount: 21_800_224 },
];

function EntryScreen() {
  const [rows, setRows] = useState(initialRows);
  const [infoVisible, setInfoVisible] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [rawVal, setRawVal] = useState("");

  const totalPendapatan = 235_416_417;
  const totalBeban = 201_800_224;
  const labaBersih = 33_616_193;

  const updateAmount = (id: string, raw: string) => {
    const parsed = parseInt(raw.replace(/\D/g, ""), 10);
    if (!isNaN(parsed)) {
      setRows(r => r.map(row => row.id === id ? { ...row, amount: parsed } : row));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-[#27272A] shrink-0">
        <div>
          <h1 className="text-[13px] font-semibold text-[#FAFAFA]">Input Laporan — Juli 2025</h1>
          <p className="text-[11px] text-[#A1A1AA]">PT Indra Langgeng Jaya · Draft</p>
        </div>
      </div>

      {/* info strip */}
      {infoVisible && (
        <div className="flex items-center gap-2 px-5 py-2 bg-blue-500/5 border-b border-blue-500/15 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
          <p className="text-[12px] text-blue-300 flex-1">Tersimpan otomatis 30 detik lalu</p>
          <button onClick={() => setInfoVisible(false)} className="text-blue-400/50 hover:text-blue-400 transition-colors">
            <X size={12} />
          </button>
        </div>
      )}

      {/* table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-[#0A0A0B] z-10">
            <tr className="border-b border-[#27272A]">
              <th className="py-2.5 px-4 text-left text-[11px] font-medium text-[#A1A1AA] w-[110px]">Kode Akun</th>
              <th className="py-2.5 px-4 text-left text-[11px] font-medium text-[#A1A1AA]">Nama Pos</th>
              <th className="py-2.5 px-4 text-right text-[11px] font-medium text-[#A1A1AA] w-[200px]">Jumlah (Rp)</th>
              <th className="py-2.5 px-4 text-left text-[11px] font-medium text-[#A1A1AA] w-[220px]">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "section") {
                return (
                  <tr key={row.id} className="border-t border-[#27272A]">
                    <td colSpan={4} className="py-2 px-4 text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider pt-4 pb-1">
                      {row.label}
                    </td>
                  </tr>
                );
              }
              if (row.kind === "subtotal") {
                return (
                  <tr key={row.id} className="bg-[#18181B] border-t border-b border-[#27272A]">
                    <td className="py-2.5 px-4 text-[#52525B]"><Lock size={11} /></td>
                    <td className="py-2.5 px-4 text-[13px] font-semibold text-[#A1A1AA]">{row.label}</td>
                    <td className="py-2.5 px-4 text-right text-[13px] font-semibold text-[#A1A1AA] tabular-nums">{idr(row.amount ?? 0)}</td>
                    <td />
                  </tr>
                );
              }
              const focused = focusedId === row.id;
              return (
                <tr key={row.id} className={`border-b border-[#27272A]/40 hover:bg-[#18181B]/30 transition-colors ${row.warn ? "bg-amber-500/[0.03]" : ""}`}>
                  <td className="py-2 px-4 text-[12px] text-[#A1A1AA] tabular-nums" style={{ paddingLeft: `${(row.indent ?? 0) * 16 + 16}px` }}>
                    {row.kode}
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      {row.warn && (
                        <div className="group relative">
                          <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                          <div className="absolute left-5 top-0 z-20 hidden group-hover:block bg-[#27272A] text-[11px] text-amber-300 px-2 py-1 rounded whitespace-nowrap shadow-lg">
                            Isi 0 bila diperlakukan sebagai uang muka
                          </div>
                        </div>
                      )}
                      <span className="text-[13px] text-[#FAFAFA]">{row.label}</span>
                    </div>
                    {row.warn && (
                      <p className="text-[11px] text-amber-400/70 mt-0.5" style={{ paddingLeft: "18px" }}>
                        Isi 0 bila diperlakukan sebagai uang muka
                      </p>
                    )}
                  </td>
                  <td className="py-2 px-4 text-right">
                    <input
                      type="text"
                      className="w-full text-right text-[13px] tabular-nums bg-transparent text-[#FAFAFA] border-b border-transparent hover:border-[#27272A] focus:border-blue-500 focus:outline-none transition-colors py-0.5 px-0"
                      value={focused ? rawVal : idr(row.amount ?? 0)}
                      onFocus={() => { setFocusedId(row.id); setRawVal(String(row.amount ?? 0)); }}
                      onBlur={() => { updateAmount(row.id, rawVal); setFocusedId(null); }}
                      onChange={(e) => setRawVal(e.target.value)}
                    />
                  </td>
                  <td className="py-2 px-4">
                    <input
                      type="text"
                      placeholder="Tambah catatan..."
                      className="w-full text-[12px] bg-transparent text-[#A1A1AA] placeholder:text-[#52525B] border-b border-transparent hover:border-[#27272A] focus:border-blue-500 focus:outline-none transition-colors py-0.5 px-0"
                      defaultValue={row.catatan}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* sticky footer */}
      <div className="shrink-0 border-t border-[#27272A] bg-[#0A0A0B] px-5 py-3 flex items-center gap-5">
        <div className="flex items-center gap-5 flex-1">
          <div className="border-r border-[#27272A] pr-5">
            <p className="text-[10px] text-[#A1A1AA] mb-0.5">Total Pendapatan</p>
            <p className="text-[13px] font-semibold text-green-400 tabular-nums">Rp {idr(totalPendapatan)}</p>
          </div>
          <div className="border-r border-[#27272A] pr-5">
            <p className="text-[10px] text-[#A1A1AA] mb-0.5">Total Beban</p>
            <p className="text-[13px] font-semibold text-[#FAFAFA] tabular-nums">Rp {idr(totalBeban)}</p>
          </div>
          <div>
            <p className="text-[10px] text-[#A1A1AA] mb-0.5">Laba Bersih</p>
            <p className="text-[13px] font-semibold text-green-400 tabular-nums">Rp {idr(labaBersih)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-4 py-2 rounded-lg bg-[#18181B] border border-[#27272A] text-[13px] font-medium text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-[#27272A] transition-colors">
            Simpan Draft
          </button>
          <button className="px-4 py-2 rounded-lg bg-blue-500 text-[13px] font-medium text-white hover:bg-blue-600 transition-colors flex items-center gap-1.5">
            <Check size={13} />Ajukan
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Screen 4: Approval Queue ─────────────────────────────────────────────────
const statusConfig = {
  "Draft":     { bg: "bg-[#27272A]",        text: "text-[#A1A1AA]" },
  "Diajukan":  { bg: "bg-blue-500/15",      text: "text-blue-400" },
  "Disetujui": { bg: "bg-green-500/15",     text: "text-green-400" },
  "Terkunci":  { bg: "bg-[#18181B] border border-[#27272A]", text: "text-[#71717A]" },
} as const;
type Status = keyof typeof statusConfig;

const approvalRows = [
  { entity: "PT Indra Langgeng Jaya", period: "Juli 2025", status: "Terkunci"  as Status, by: "Budi Santoso",  date: "15 Jul 2025" },
  { entity: "PT Tirta Nusantara",     period: "Juli 2025", status: "Disetujui" as Status, by: "Siti Rahayu",   date: "18 Jul 2025" },
  { entity: "PT Makmur Jaya",         period: "Juli 2025", status: "Diajukan"  as Status, by: "Ahmad Fauzi",   date: "20 Jul 2025" },
  { entity: "PT Samudra Garam",       period: "Juli 2025", status: "Draft"     as Status, by: "—",             date: "—" },
];

const comparisonRows = [
  { label: "Pendapatan",   jul: 185_250_000, jun: 152_000_000 },
  { label: "Beban Pokok",  jul: 141_000_000, jun: 118_500_000 },
  { label: "Laba Kotor",   jul:  44_250_000, jun:  33_500_000 },
  { label: "Beban Usaha",  jul:  40_400_000, jun:  31_650_000 },
  { label: "Laba Bersih",  jul:   3_850_000, jun:   1_850_000 },
  { label: "Margin Bersih (%):", julStr: "2,08%", junStr: "1,22%", pctChange: 70.5 },
];

function ApprovalScreen() {
  const [expanded, setExpanded] = useState<string | null>("PT Makmur Jaya");
  const [note, setNote] = useState("");
  const [approved, setApproved] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-[#27272A] shrink-0">
        <h1 className="text-[13px] font-semibold text-[#FAFAFA]">Persetujuan Laporan</h1>
        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[13px] text-[#FAFAFA] hover:bg-[#27272A] transition-colors tabular-nums">
          Juli 2025 <ChevronDown size={13} className="text-[#A1A1AA]" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* table */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[#27272A]">
              {["Entitas", "Periode", "Status", "Diajukan Oleh", "Tanggal", "Aksi"].map((h) => (
                <th key={h} className="py-2.5 px-4 text-left text-[11px] font-medium text-[#A1A1AA]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {approvalRows.map((row) => {
              const cfg = statusConfig[row.status];
              const isExpanded = expanded === row.entity;
              return (
                <React.Fragment key={row.entity}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : row.entity)}
                    className={`border-b border-[#27272A]/50 cursor-pointer transition-colors ${
                      isExpanded ? "bg-[#18181B]" : "hover:bg-[#18181B]/40"
                    }`}
                  >
                    <td className="py-3 px-4 text-[13px] font-medium text-[#FAFAFA]">{row.entity}</td>
                    <td className="py-3 px-4 text-[13px] text-[#A1A1AA] tabular-nums">{row.period}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}>
                        {row.status === "Terkunci" && <Lock size={9} />}
                        {row.status === "Disetujui" && <Check size={9} />}
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[13px] text-[#A1A1AA]">{row.by}</td>
                    <td className="py-3 px-4 text-[13px] text-[#A1A1AA] tabular-nums">{row.date}</td>
                    <td className="py-3 px-4">
                      {row.status === "Diajukan" && !approved && (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setApproved(true)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-green-500/15 border border-green-500/30 text-green-400 text-[12px] font-medium rounded-md hover:bg-green-500/25 transition-colors"
                          >
                            <Check size={11} />Setujui
                          </button>
                          <button className="flex items-center gap-1 px-2.5 py-1 border border-[#27272A] text-[#A1A1AA] text-[12px] font-medium rounded-md hover:bg-[#27272A] transition-colors">
                            Tolak
                          </button>
                        </div>
                      )}
                      {row.status === "Diajukan" && approved && (
                        <span className="text-[12px] text-green-400 font-medium flex items-center gap-1">
                          <Check size={11} />Disetujui
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* expanded review panel */}
                  {isExpanded && (
                    <tr className="border-b border-[#27272A]">
                      <td colSpan={6} className="p-0">
                        <div className="bg-[#111113] px-5 py-4 border-t border-[#27272A]">
                          <p className="text-[12px] font-semibold text-[#A1A1AA] mb-3">
                            Perbandingan Bulan Ini vs. Bulan Lalu — {row.entity}
                          </p>
                          <div className="grid grid-cols-2 gap-5">
                            {/* comparison table */}
                            <div>
                              <table className="w-full text-[12px]">
                                <thead>
                                  <tr className="border-b border-[#27272A]">
                                    <th className="pb-2 text-left text-[11px] font-medium text-[#52525B]">Pos</th>
                                    <th className="pb-2 px-3 text-right text-[11px] font-medium text-[#52525B] tabular-nums">Juli 2025</th>
                                    <th className="pb-2 px-3 text-right text-[11px] font-medium text-[#52525B] tabular-nums">Juni 2025</th>
                                    <th className="pb-2 text-right text-[11px] font-medium text-[#52525B]">Δ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {comparisonRows.map((cr, ci) => {
                                    const change = "pctChange" in cr
                                      ? cr.pctChange
                                      : pct(cr.jul, cr.jun);
                                    const isAmber = Math.abs(change) > 20;
                                    return (
                                      <tr key={ci} className={`border-b border-[#27272A]/30 ${isAmber ? "bg-amber-500/5" : ""}`}>
                                        <td className="py-1.5 text-[#A1A1AA]">{cr.label}</td>
                                        <td className="py-1.5 px-3 text-right text-[#FAFAFA] tabular-nums">
                                          {"julStr" in cr ? cr.julStr : idr(cr.jul)}
                                        </td>
                                        <td className="py-1.5 px-3 text-right text-[#A1A1AA] tabular-nums">
                                          {"junStr" in cr ? cr.junStr : idr(cr.jun)}
                                        </td>
                                        <td className={`py-1.5 text-right tabular-nums font-medium ${
                                          isAmber ? "text-amber-400" : change >= 0 ? "text-green-400" : "text-red-400"
                                        }`}>
                                          {fmtPct(change)}
                                          {isAmber && " ⚑"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              <p className="mt-2 text-[10px] text-amber-400/60 flex items-center gap-1">
                                <AlertTriangle size={10} />Perubahan ⚑ melebihi ambang 20%
                              </p>
                            </div>

                            {/* rejection notes */}
                            <div className="flex flex-col gap-2">
                              <label className="text-[11px] font-medium text-[#A1A1AA]">
                                Catatan Penolakan <span className="text-[#52525B]">(wajib bila menolak)</span>
                              </label>
                              <textarea
                                className="flex-1 min-h-[120px] bg-[#18181B] border border-[#27272A] rounded-lg p-3 text-[13px] text-[#FAFAFA] placeholder:text-[#52525B] resize-none focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="Tulis alasan penolakan..."
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                              />
                              <p className="text-[11px] text-[#52525B]">
                                Catatan akan dikirim ke admin pelapor setelah penolakan dikonfirmasi.
                              </p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Screen 5: Mobile Executive View ─────────────────────────────────────────
function MobileScreen() {
  const [activeTab, setActiveTab] = useState<"ringkasan" | "entitas" | "laporan" | "pengaturan">("ringkasan");

  const kpis = [
    { label: "Pendapatan Konsolidasi", value: "Rp 7,15 M",  change: "+12,4%", dir: "up" },
    { label: "Laba Bersih",            value: "Rp 1,02 M",  change: "−8,2%",  dir: "down" },
    { label: "Posisi Kas",             value: "Rp 2,31 M",  change: null,      dir: null },
    { label: "Kelengkapan",            value: "3 / 4",       change: null,      dir: "warn" },
  ];

  const companies = [
    { name: "PT Indra Langgeng Jaya", sector: "Logistik",  revenue: "Rp 4,86 M", trend: "up",   color: "#3B82F6", alert: false },
    { name: "PT Tirta Nusantara",     sector: "AMDK",      revenue: "Rp 1,00 M", trend: "up",   color: "#8B5CF6", alert: false },
    { name: "PT Makmur Jaya",         sector: "Tambang",   revenue: "Rp 858 Jt", trend: "up",   color: "#F59E0B", alert: true  },
    { name: "PT Samudra Garam",       sector: "Garam",     revenue: "—",          trend: null,   color: "#27272A", alert: false },
  ];

  const tabs = [
    { id: "ringkasan"   as const, label: "Ringkasan",  Icon: Home },
    { id: "entitas"     as const, label: "Entitas",    Icon: Building2 },
    { id: "laporan"     as const, label: "Laporan",    Icon: FileText },
    { id: "pengaturan"  as const, label: "Pengaturan", Icon: Settings },
  ];

  return (
    <div className="flex flex-col h-full overflow-auto items-center justify-start pt-6 pb-6 bg-[#0A0A0B]">
      <p className="text-[11px] text-[#52525B] mb-4 tracking-widest uppercase">Pratinjau Tampilan Mobile</p>

      {/* phone frame */}
      <div
        className="relative overflow-hidden shadow-2xl"
        style={{
          width: 390,
          height: 844,
          borderRadius: 44,
          border: "2px solid #27272A",
          background: "#0A0A0B",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {/* status bar */}
        <div className="flex items-center justify-between px-7 pt-3 pb-1 shrink-0">
          <span className="text-[13px] font-semibold text-[#FAFAFA] tabular-nums">9:41</span>
          <div className="w-[120px] h-7 bg-[#0A0A0B] rounded-full mx-auto absolute left-1/2 -translate-x-1/2 top-1" />
          <div className="flex items-center gap-1.5">
            <div className="flex gap-px items-end h-3">
              {[3, 4, 5, 6].map((h, i) => (
                <div key={i} className="w-[3px] rounded-sm bg-[#FAFAFA]" style={{ height: h * 2 }} />
              ))}
            </div>
            <div className="w-4 h-3 border border-[#FAFAFA] rounded-[2px] relative">
              <div className="absolute inset-0.5 right-1.5 bg-[#FAFAFA] rounded-sm" />
              <div className="absolute right-[-2px] top-1/2 -translate-y-1/2 w-[2px] h-1.5 bg-[#FAFAFA]/40 rounded-r-sm" />
            </div>
          </div>
        </div>

        {/* scrollable content */}
        <div className="overflow-y-auto px-4 space-y-4" style={{ height: "calc(844px - 44px - 83px)", paddingBottom: 8 }}>
          {/* month selector */}
          <div className="flex items-center justify-between pt-2">
            <h2 className="text-[17px] font-semibold text-[#FAFAFA]">Ringkasan Grup</h2>
            <button className="flex items-center gap-1 px-3 py-1.5 bg-[#18181B] border border-[#27272A] rounded-lg text-[13px] text-[#FAFAFA] tabular-nums">
              Juli 2025 <ChevronDown size={12} className="text-[#A1A1AA]" />
            </button>
          </div>

          {/* amber banner */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-500/10 border border-amber-500/25 rounded-xl">
            <AlertTriangle size={13} className="text-amber-400 shrink-0" />
            <p className="text-[12px] text-amber-200 leading-snug">
              <span className="font-semibold text-amber-400">PT Liafa</span> belum melapor — data tidak lengkap
            </p>
          </div>

          {/* KPI cards */}
          <div className="space-y-2">
            {kpis.map((kpi, i) => (
              <button key={i} className="w-full bg-[#18181B] border border-[#27272A] rounded-xl p-4 text-left active:bg-[#27272A] transition-colors">
                <p className="text-[12px] font-medium text-[#A1A1AA] mb-1">{kpi.label}</p>
                <p className="text-[28px] font-bold text-[#FAFAFA] tabular-nums leading-none tracking-tight mb-2">{kpi.value}</p>
                {kpi.change && (
                  <span className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-md tabular-nums ${
                    kpi.dir === "up" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                  }`}>
                    {kpi.dir === "up" ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                    {kpi.change} MoM
                  </span>
                )}
                {kpi.dir === "warn" && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
                    <AlertTriangle size={12} />1 belum lapor
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* company list */}
          <div>
            <p className="text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-wider mb-2">Entitas</p>
            <div className="space-y-1.5">
              {companies.map((c, i) => (
                <button key={i} className="w-full flex items-center gap-3 bg-[#18181B] border border-[#27272A] rounded-xl px-4 py-3 text-left hover:bg-[#1E1E21] transition-colors">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-bold" style={{ background: c.color }}>
                    {c.name.replace("PT ", "").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#FAFAFA] truncate">{c.name}</p>
                    <p className="text-[11px] text-[#A1A1AA]">{c.sector}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[13px] font-semibold text-[#FAFAFA] tabular-nums">{c.revenue}</p>
                    {c.trend === "up" && <ArrowUpRight size={14} className="text-green-400 ml-auto" />}
                    {c.trend === null && <span className="text-[11px] text-[#52525B]">Belum lapor</span>}
                  </div>
                  {c.alert && (
                    <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 shadow-[0_0_6px_#ef4444]" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* bottom tab bar */}
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center border-t border-[#27272A]"
          style={{ background: "#18181B", height: 83, paddingBottom: 16 }}
        >
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="flex-1 flex flex-col items-center justify-center gap-1 pt-2 transition-colors"
            >
              <Icon size={20} className={activeTab === id ? "text-blue-400" : "text-[#52525B]"} />
              <span className={`text-[10px] font-medium ${activeTab === id ? "text-blue-400" : "text-[#52525B]"}`}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");

  return (
    <div
      className="flex h-screen overflow-hidden bg-[#0A0A0B] text-[#FAFAFA]"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <Sidebar active={screen} onNav={setScreen} />
      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {screen === "dashboard" && <DashboardScreen />}
        {screen === "pnl"       && <PnLScreen />}
        {screen === "entry"     && <EntryScreen />}
        {screen === "approval"  && <ApprovalScreen />}
        {screen === "mobile"    && <MobileScreen />}
      </main>
    </div>
  );
}
