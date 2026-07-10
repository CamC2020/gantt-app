// Parser for Microsoft Project XML exports (File → Save As → XML Format).
// The binary .mpp format is proprietary and cannot be read in the browser —
// users export to XML from MS Project first, which preserves tasks, outline
// numbers, dates, predecessors, milestones, and resource assignments.

export interface MsProjectTask {
  uid: string;
  name: string;
  outlineNumber: string;   // e.g. "1.2.3" — used as the "#" prefix
  outlineLevel: number;
  start: string;           // YYYY-MM-DD
  finish: string;          // YYYY-MM-DD
  isMilestone: boolean;
  isSummary: boolean;
  predecessorUids: string[];
  resourceNames: string[]; // assigned resource names, first = responsible
}

export interface MsProjectFile {
  projectName: string;
  tasks: MsProjectTask[];  // leaf tasks + milestones only (summaries excluded)
}

function text(el: Element, tag: string): string {
  // :scope > direct child only — Task contains nested elements (e.g.
  // PredecessorLink) that have their own UID tags.
  for (const child of el.children) {
    if (child.tagName === tag) return child.textContent ?? "";
  }
  return "";
}

function isoDate(value: string): string {
  // "2026-06-02T08:00:00" → "2026-06-02"
  return value.slice(0, 10);
}

export function parseMsProjectXml(xmlText: string): MsProjectFile {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Not a valid XML file. In MS Project use File → Save As → “XML Format (*.xml)”, then upload that file.");
  }
  const project = doc.documentElement;
  if (project.tagName !== "Project") {
    throw new Error("This XML is not a Microsoft Project export (missing <Project> root).");
  }

  // Prefer <Title> (the project's display name) over <Name> (the file name)
  const projectName =
    project.querySelector(":scope > Title")?.textContent?.trim()
    || project.querySelector(":scope > Name")?.textContent?.trim()
    || "MS Project import";

  // Resources: UID → Name
  const resourceName = new Map<string, string>();
  for (const r of project.querySelectorAll(":scope > Resources > Resource")) {
    const uid = text(r, "UID");
    const name = text(r, "Name").trim();
    if (uid && name) resourceName.set(uid, name);
  }

  // Assignments: TaskUID → resource names
  const taskResources = new Map<string, string[]>();
  for (const a of project.querySelectorAll(":scope > Assignments > Assignment")) {
    const taskUid = text(a, "TaskUID");
    const resUid = text(a, "ResourceUID");
    const name = resourceName.get(resUid);
    if (!taskUid || !name) continue;
    if (!taskResources.has(taskUid)) taskResources.set(taskUid, []);
    taskResources.get(taskUid)!.push(name);
  }

  const tasks: MsProjectTask[] = [];
  for (const t of project.querySelectorAll(":scope > Tasks > Task")) {
    const uid = text(t, "UID");
    const name = text(t, "Name").trim();
    const isNull = text(t, "IsNull") === "1";
    const active = text(t, "Active") !== "0"; // missing tag = active
    const isSummary = text(t, "Summary") === "1";
    const start = isoDate(text(t, "Start"));
    const finish = isoDate(text(t, "Finish"));
    // UID 0 is the project summary row; blank rows come through as IsNull
    if (!uid || uid === "0" || isNull || !active || !name || !start || !finish) continue;

    const predecessorUids: string[] = [];
    for (const p of t.querySelectorAll(":scope > PredecessorLink")) {
      const predUid = text(p, "PredecessorUID");
      if (predUid && predUid !== "0") predecessorUids.push(predUid);
    }

    tasks.push({
      uid,
      name,
      outlineNumber: text(t, "OutlineNumber"),
      outlineLevel: parseInt(text(t, "OutlineLevel") || "1", 10),
      start,
      finish,
      isMilestone: text(t, "Milestone") === "1",
      isSummary,
      predecessorUids,
      resourceNames: taskResources.get(uid) ?? [],
    });
  }

  // Keep only leaves (non-summary) — summaries are groupings, same rule as
  // Import Master.
  const leaves = tasks.filter(t => !t.isSummary);
  if (leaves.length === 0) {
    throw new Error("No importable tasks found in this file (only summary rows or the file is empty).");
  }
  return { projectName, tasks: leaves };
}
