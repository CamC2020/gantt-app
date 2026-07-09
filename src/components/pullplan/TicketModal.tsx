"use client";

import { useState } from "react";
import type { Profile, PullLane, PullTicket, PullRole, PullLocation } from "@/lib/supabase/types";
import { STATUS_LABEL } from "./TicketCard";

export default function TicketModal({
  ticket, lanes, roles, locations, members, allTickets, predIds, editable,
  onPatch, onSetDeps, onPromise, onStart, onComplete, onDelete, onClose,
}: {
  ticket: PullTicket;
  lanes: PullLane[];
  roles: PullRole[];
  locations: PullLocation[];
  members: Profile[];
  allTickets: PullTicket[];
  predIds: string[];
  editable: boolean;
  onPatch: (patch: Partial<PullTicket>) => void;
  onSetDeps: (predIds: string[]) => void;
  onPromise: () => void;
  onStart: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [desc, setDesc] = useState(ticket.description);
  const [dur, setDur] = useState(String(ticket.duration));
  const [crew, setCrew] = useState(ticket.crew_size != null ? String(ticket.crew_size) : "");
  const [start, setStart] = useState(ticket.start_date ?? "");
  const [laneId, setLaneId] = useState(ticket.lane_id ?? "");
  const [roleId, setRoleId] = useState(ticket.role_id ?? "");
  const [respId, setRespId] = useState(ticket.responsible_id ?? "");
  const [locationId, setLocationId] = useState(ticket.location_id ?? "");
  const [rb, setRb] = useState(ticket.roadblock);
  const [rbNote, setRbNote] = useState(ticket.roadblock_note);
  const [preds, setPreds] = useState<string[]>(predIds);

  const isDone = ticket.status.startsWith("done_");
  const candidates = allTickets.filter(t => t.id !== ticket.id);

  function save() {
    onPatch({
      description: desc.trim() || "Untitled",
      duration: Math.max(1, parseInt(dur, 10) || 1),
      crew_size: crew.trim() === "" ? null : Math.max(1, parseInt(crew, 10) || 1),
      start_date: start || null,
      lane_id: laneId || null,
      role_id: roleId || null,
      responsible_id: respId || null,
      location_id: locationId || null,
      roadblock: rb,
      roadblock_note: rb ? rbNote : "",
    });
    onSetDeps(preds);
    onClose();
  }

  function togglePred(id: string) {
    setPreds(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  }

  const inputCls = "rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:border-[#2E6EA6] disabled:bg-zinc-50";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1A3560]">Ticket</h2>
          <span className="text-[11px] text-zinc-400">{STATUS_LABEL[ticket.status]}</span>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Description</span>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} disabled={!editable} className={inputCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Role / Trade</span>
              <select value={roleId} onChange={e => setRoleId(e.target.value)} disabled={!editable} className={inputCls}>
                <option value="">— none —</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Responsible</span>
              <select value={respId} onChange={e => setRespId(e.target.value)} disabled={!editable} className={inputCls}>
                <option value="">— unassigned —</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Location</span>
              <select value={locationId} onChange={e => setLocationId(e.target.value)} disabled={!editable} className={inputCls}>
                <option value="">— none —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Duration (work days)</span>
              <input type="number" min={1} value={dur} onChange={e => setDur(e.target.value)} disabled={!editable} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Crew size</span>
              <input type="number" min={1} value={crew} onChange={e => setCrew(e.target.value)} disabled={!editable} className={inputCls} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Start date</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} disabled={!editable} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Swimlane</span>
              <select value={laneId} onChange={e => setLaneId(e.target.value)} disabled={!editable} className={inputCls}>
                <option value="">— tray —</option>
                {lanes.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">Predecessors (work that must finish first)</span>
            {candidates.length === 0 ? (
              <span className="text-xs italic text-zinc-400">No other tickets yet.</span>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded border border-zinc-200 p-2">
                {candidates.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-0.5 text-xs text-zinc-700">
                    <input type="checkbox" checked={preds.includes(c.id)} onChange={() => togglePred(c.id)} disabled={!editable} />
                    <span className="truncate">{c.description}{c.start_date ? ` (${c.start_date})` : " (tray)"}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {ticket.promised_end && (
            <p className="text-xs text-zinc-500">📌 Promised finish: <span className="font-semibold">{ticket.promised_end}</span></p>
          )}

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={rb} onChange={e => setRb(e.target.checked)} disabled={!editable} />
            🚧 Roadblock / constraint
          </label>
          {rb && (
            <input value={rbNote} onChange={e => setRbNote(e.target.value)} placeholder="What's blocking this work?" disabled={!editable}
              className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm outline-none focus:border-amber-500" />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editable && !isDone && ticket.status === "planned" && ticket.start_date && (
            <button onClick={onPromise} className="rounded bg-[#2A6B35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#235a2c]">
              📌 Promise
            </button>
          )}
          {editable && ticket.status === "promised" && (
            <button onClick={onStart} className="rounded bg-[#2E6EA6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#265d8d]">
              ▶ Start Work
            </button>
          )}
          {editable && !isDone && (ticket.status === "promised" || ticket.status === "in_progress") && (
            <button onClick={onComplete} className="rounded bg-[#1A3560] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">
              ✓ Complete
            </button>
          )}
          <span className="flex-1" />
          {editable && <button onClick={onDelete} className="text-xs text-red-400 hover:text-red-600">Delete</button>}
          <button onClick={onClose} className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50">Cancel</button>
          {editable && (
            <button onClick={save} className="rounded bg-[#1A3560] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#152b4e]">Save</button>
          )}
        </div>
      </div>
    </div>
  );
}
