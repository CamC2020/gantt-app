"use client";

import { useState } from "react";
import type { Profile, PullRole, PullLocation, PullTicket } from "@/lib/supabase/types";

export type PanelId = "constraints" | "members" | "roles" | "locations" | "snapshots" | "filters" | "overview" | null;

export const ROLE_COLORS = [
  "#3ec66d", "#f07f4e", "#8f5bd9", "#4a90e2", "#39c2c9",
  "#e05a9a", "#eab308", "#e14b4b", "#6366f1", "#84cc16",
];

const ITEMS: { id: Exclude<PanelId, null>; icon: string; label: string }[] = [
  { id: "constraints", icon: "🚧", label: "Constraints" },
  { id: "members",     icon: "👤", label: "Members" },
  { id: "roles",       icon: "🎨", label: "Roles" },
  { id: "locations",   icon: "📍", label: "Locations" },
  { id: "snapshots",   icon: "📷", label: "Snapshots" },
  { id: "filters",     icon: "🔍", label: "Filters" },
  { id: "overview",    icon: "📊", label: "Overview" },
];

export function IconRail({ open, onToggle }: { open: PanelId; onToggle: (p: Exclude<PanelId, null>) => void }) {
  return (
    <div className="flex w-[58px] shrink-0 flex-col items-center gap-1 bg-[#3a3f44] py-2">
      {ITEMS.map(it => (
        <button key={it.id} onClick={() => onToggle(it.id)}
          className={`flex w-full flex-col items-center gap-0.5 py-2 text-[8px] font-semibold text-white transition-colors ${open === it.id ? "bg-[#54595f]" : "hover:bg-[#484d52]"}`}>
          <span className="text-base leading-none">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ─── Panels ───────────────────────────────────────────────────────────────────

export function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="flex w-[250px] shrink-0 flex-col border-r border-zinc-300 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-zinc-600">{title}</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">{children}</div>
    </div>
  );
}

export function RolesPanel({ roles, onAdd, onRemove }: {
  roles: PullRole[];
  onAdd: (name: string, color: string) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(ROLE_COLORS[0]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {roles.length === 0 && <span className="text-xs italic text-zinc-400">No roles yet — add trades below.</span>}
        {roles.map(r => (
          <div key={r.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: r.color }}>
            <span className="flex-1 truncate">{r.name}</span>
            <button onClick={() => onRemove(r.id)} className="text-white/60 hover:text-white">✕</button>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-zinc-100 pt-2">
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onAdd(name.trim(), color); setName(""); } }}
          placeholder="Role name (e.g. Sitework)"
          className="rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-[#2E6EA6]" />
        <div className="flex flex-wrap items-center gap-1">
          {ROLE_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border-2 ${color === c ? "border-zinc-800" : "border-transparent"}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
        <button onClick={() => { if (name.trim()) { onAdd(name.trim(), color); setName(""); } }}
          className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white">Add Role</button>
      </div>
    </div>
  );
}

export function LocationsPanel({ locations, onAdd, onRemove }: {
  locations: PullLocation[];
  onAdd: (name: string, color: string) => void;
  onRemove: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(ROLE_COLORS[2]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {locations.length === 0 && <span className="text-xs italic text-zinc-400">No locations yet (e.g. Zone A, North Yard).</span>}
        {locations.map(l => (
          <div key={l.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs font-semibold text-white" style={{ backgroundColor: l.color }}>
            <span className="flex-1 truncate">{l.name}</span>
            <button onClick={() => onRemove(l.id)} className="text-white/60 hover:text-white">✕</button>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-zinc-100 pt-2">
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim()) { onAdd(name.trim(), color); setName(""); } }}
          placeholder="Location name"
          className="rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-[#2E6EA6]" />
        <div className="flex flex-wrap items-center gap-1">
          {ROLE_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border-2 ${color === c ? "border-zinc-800" : "border-transparent"}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
        <button onClick={() => { if (name.trim()) { onAdd(name.trim(), color); setName(""); } }}
          className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white">Add Location</button>
      </div>
    </div>
  );
}

export function MembersPanel({ members }: { members: Profile[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      {members.map(m => (
        <div key={m.id} className="flex items-center gap-2 rounded border border-zinc-100 px-2 py-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1A3560] text-[10px] font-bold text-white">
            {(m.full_name || m.email)[0].toUpperCase()}
          </span>
          <span className="flex-1 truncate text-xs text-zinc-700">{m.full_name || m.email}</span>
          {m.is_admin && <span className="text-[9px] font-bold uppercase text-purple-500">admin</span>}
        </div>
      ))}
    </div>
  );
}

const PRIORITY_STYLE: Record<string, { label: string; cls: string }> = {
  on_track:        { label: "On Track",        cls: "bg-green-100 text-green-700" },
  needs_attention: { label: "Needs Attention", cls: "bg-amber-200 text-amber-800" },
  critical:        { label: "Critical",        cls: "bg-red-200 text-red-800" },
};

export function ConstraintsPanel({ tickets, constraints = [], onOpen, onOpenConstraint }: {
  tickets: PullTicket[];
  constraints?: { id: string; description: string; date: string | null; need_by: string | null; priority: string; note: string; resolved: boolean }[];
  onOpen: (id: string) => void;
  onOpenConstraint?: (id: string) => void;
}) {
  const open = constraints.filter(c => !c.resolved)
    .sort((a, b) => ((a.need_by ?? "9999") < (b.need_by ?? "9999") ? -1 : 1));
  const resolved = constraints.filter(c => c.resolved);
  const blocked = tickets
    .filter(t => t.roadblock)
    .sort((a, b) => (a.roadblock_need_by ?? "9999") < (b.roadblock_need_by ?? "9999") ? -1 : 1);
  return (
    <div className="flex flex-col gap-1.5">
      {open.length === 0 && blocked.length === 0 && <span className="text-xs italic text-zinc-400">No open constraints. 🎉</span>}
      {open.map(c => {
        const pr = PRIORITY_STYLE[c.priority] ?? PRIORITY_STYLE.on_track;
        return (
          <button key={c.id} onClick={() => onOpenConstraint?.(c.id)}
            className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-left hover:bg-zinc-100">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 truncate text-xs font-semibold text-zinc-800">⚠ {c.description}</span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${pr.cls}`}>{pr.label}</span>
            </div>
            {c.note && <div className="text-[10px] text-zinc-500">{c.note}</div>}
            <div className="text-[10px] text-zinc-400">
              {c.need_by ? <>need by <span className="font-semibold text-amber-700">{c.need_by}</span></> : "no need-by date"}
              {c.date ? <> · planned {c.date}</> : <> · in tray</>}
            </div>
          </button>
        );
      })}
      {resolved.length > 0 && (
        <>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Resolved</div>
          {resolved.map(c => (
            <button key={c.id} onClick={() => onOpenConstraint?.(c.id)}
              className="rounded border border-green-100 bg-green-50/50 px-2 py-1 text-left opacity-70 hover:opacity-100">
              <span className="text-xs text-zinc-600">✓ {c.description}</span>
            </button>
          ))}
        </>
      )}
      {blocked.length > 0 && (
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Flagged tickets</div>
      )}
      {blocked.map(t => {
        const pr = PRIORITY_STYLE[t.roadblock_priority] ?? PRIORITY_STYLE.on_track;
        return (
          <button key={t.id} onClick={() => onOpen(t.id)}
            className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-left hover:bg-amber-100">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 truncate text-xs font-semibold text-zinc-800">🚧 {t.description}</span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${pr.cls}`}>{pr.label}</span>
            </div>
            {t.roadblock_note && <div className="text-[10px] text-zinc-500">{t.roadblock_note}</div>}
            <div className="text-[10px] text-zinc-400">
              {t.roadblock_need_by ? <>need by <span className="font-semibold text-amber-700">{t.roadblock_need_by}</span></> : "no need-by date"}
              {t.start_date && <> · planned {t.start_date}</>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function SnapshotsPanel({ snapshots, members, isAdmin, currentUserId, busy, onTake, onRestore, onDelete }: {
  snapshots: { id: string; name: string; created_by: string; created_at: string }[];
  members: Profile[];
  isAdmin: boolean;
  currentUserId: string;
  busy: boolean;
  onTake: (name: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const memberMap = new Map(members.map(m => [m.id, m]));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 border-b border-zinc-100 pb-3">
        <input value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && name.trim() && !busy) { onTake(name.trim()); setName(""); } }}
          placeholder="Snapshot name (e.g. Before re-sequence)"
          className="rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-[#2E6EA6]" />
        <button onClick={() => { if (name.trim()) { onTake(name.trim()); setName(""); } }} disabled={busy || !name.trim()}
          className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
          {busy ? "Working…" : "📷 Take Snapshot"}
        </button>
        <p className="text-[10px] text-zinc-400">Saves a copy of the whole board. {isAdmin ? "Restoring replaces the current board." : "Only admins can restore."}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {snapshots.length === 0 && <span className="text-xs italic text-zinc-400">No snapshots yet.</span>}
        {snapshots.map(s => {
          const author = memberMap.get(s.created_by);
          const canDelete = isAdmin || s.created_by === currentUserId;
          return (
            <div key={s.id} className="rounded border border-zinc-200 px-2 py-1.5">
              <div className="text-xs font-semibold text-zinc-800">{s.name}</div>
              <div className="text-[10px] text-zinc-400">
                {new Date(s.created_at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {author && <> · {author.full_name?.split(" ")[0] || author.email.split("@")[0]}</>}
              </div>
              <div className="mt-1 flex items-center gap-2">
                {isAdmin && (
                  <button onClick={() => onRestore(s.id)} disabled={busy}
                    className="rounded bg-[#2E6EA6] px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-40">
                    Restore
                  </button>
                )}
                {canDelete && (
                  <button onClick={() => onDelete(s.id)} disabled={busy}
                    className="text-[10px] text-red-400 hover:text-red-600 disabled:opacity-40">
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface Filters {
  roleIds: Set<string>;
  memberIds: Set<string>;
  locationIds: Set<string>;
}

export function FilterPanel({ roles, members, locations, filters, onChange }: {
  roles: PullRole[];
  members: Profile[];
  locations: PullLocation[];
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  function toggle(set: Set<string>, id: string): Set<string> {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }
  const active = filters.roleIds.size + filters.memberIds.size + filters.locationIds.size > 0;
  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-[10px] text-zinc-400">Check items to show only their tickets. Unmatched tickets gray out as “(hid)”.</p>
      {active && (
        <button onClick={() => onChange({ roleIds: new Set(), memberIds: new Set(), locationIds: new Set() })}
          className="self-start rounded border border-zinc-300 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-50">
          Clear all filters
        </button>
      )}
      <div>
        <div className="mb-1 font-bold uppercase tracking-wide text-zinc-400 text-[10px]">Roles</div>
        {roles.map(r => (
          <label key={r.id} className="flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={filters.roleIds.has(r.id)}
              onChange={() => onChange({ ...filters, roleIds: toggle(filters.roleIds, r.id) })} />
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: r.color }} />
            {r.name}
          </label>
        ))}
      </div>
      <div>
        <div className="mb-1 font-bold uppercase tracking-wide text-zinc-400 text-[10px]">Members</div>
        {members.map(m => (
          <label key={m.id} className="flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={filters.memberIds.has(m.id)}
              onChange={() => onChange({ ...filters, memberIds: toggle(filters.memberIds, m.id) })} />
            {m.full_name || m.email}
          </label>
        ))}
      </div>
      <div>
        <div className="mb-1 font-bold uppercase tracking-wide text-zinc-400 text-[10px]">Locations</div>
        {locations.map(l => (
          <label key={l.id} className="flex items-center gap-2 py-0.5">
            <input type="checkbox" checked={filters.locationIds.has(l.id)}
              onChange={() => onChange({ ...filters, locationIds: toggle(filters.locationIds, l.id) })} />
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: l.color }} />
            {l.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export function OverviewPanel({ tickets }: { tickets: PullTicket[] }) {
  const done = tickets.filter(t => t.status.startsWith("done_"));
  const kept = done.filter(t => t.status !== "done_late").length;
  const ppc = done.length ? Math.round((kept / done.length) * 100) : null;
  const counts = {
    planned: tickets.filter(t => t.status === "planned").length,
    promised: tickets.filter(t => t.status === "promised").length,
    inProgress: tickets.filter(t => t.status === "in_progress").length,
    done: done.length,
    roadblocks: tickets.filter(t => t.roadblock).length,
  };
  return (
    <div className="flex flex-col gap-2 text-xs text-zinc-700">
      <div className="rounded-lg border border-zinc-200 p-3 text-center">
        <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">PPC</div>
        <div className={`text-2xl font-bold ${ppc === null ? "text-zinc-300" : ppc >= 80 ? "text-green-600" : ppc >= 60 ? "text-amber-600" : "text-red-600"}`}>
          {ppc === null ? "—" : `${ppc}%`}
        </div>
        <div className="text-[10px] text-zinc-400">Percent Promises Complete</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Planned" v={counts.planned} />
        <Stat label="Promised" v={counts.promised} />
        <Stat label="In Progress" v={counts.inProgress} />
        <Stat label="Complete" v={counts.done} />
      </div>
      <Stat label="🚧 Open constraints" v={counts.roadblocks} />
      {(() => {
        const reasons = new Map<string, number>();
        for (const t of done) if (t.variance_reason) reasons.set(t.variance_reason, (reasons.get(t.variance_reason) ?? 0) + 1);
        if (reasons.size === 0) return null;
        return (
          <div className="mt-1">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Variance reasons</div>
            {[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => (
              <div key={r} className="flex items-center justify-between border-b border-zinc-50 py-0.5 text-[11px]">
                <span className="text-zinc-600">{r}</span>
                <span className="font-bold text-[#1A3560]">{n}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded border border-zinc-100 bg-zinc-50 px-2 py-1.5">
      <div className="text-sm font-bold text-[#1A3560]">{v}</div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}
