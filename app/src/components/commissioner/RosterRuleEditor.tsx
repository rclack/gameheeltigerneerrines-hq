"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { saveDraftRosterRulesAction } from "@/app/commissioner/draft-actions";
import Button from "@/components/ui/Button";
import { CLASSIFICATION_OPTIONS, CONFERENCE_OPTIONS, eightOwnerRules, fourOwnerRules, rulesSummary, type DraftRosterSlotDetail, type RosterRuleInput } from "@/lib/draft/roster-rules";
import type { Draft } from "@/types/database";

function blankRules(count: number): RosterRuleInput[] {
  return Array.from({ length: count }, (_, index) => ({ label: `Roster Slot ${index + 1}`, unrestricted: false, criteria: [] }));
}

function savedInputs(saved: DraftRosterSlotDetail[]): RosterRuleInput[] {
  return saved.map((slot) => ({ label: slot.label, unrestricted: slot.unrestricted, criteria: slot.criteria.map(({ dimension, value }) => ({ dimension, value })) }));
}

export default function RosterRuleEditor({ leagueId, ownerCount, teamsPerOwner, draftStatus, savedRules }: { leagueId: string; ownerCount: number; teamsPerOwner: number; draftStatus: Draft["status"]; savedRules: DraftRosterSlotDetail[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rules, setRules] = useState<RosterRuleInput[]>(() => savedInputs(savedRules));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = draftStatus !== "not_started";

  function preset(value: "none" | "real-8" | "real-4" | "custom") {
    setRules(value === "none" ? [] : value === "real-8" ? eightOwnerRules() : value === "real-4" ? fourOwnerRules() : blankRules(teamsPerOwner));
    setEditing(true); setMessage(null); setError(null);
  }

  function updateRule(index: number, update: (rule: RosterRuleInput) => RosterRuleInput) {
    setRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? update(rule) : rule));
  }

  function toggleCriterion(index: number, dimension: "conference" | "classification", value: string) {
    updateRule(index, (rule) => {
      const exists = rule.criteria.some((criterion) => criterion.dimension === dimension && criterion.value === value);
      return { ...rule, criteria: exists ? rule.criteria.filter((criterion) => criterion.dimension !== dimension || criterion.value !== value) : [...rule.criteria, { dimension, value }] };
    });
  }

  async function save() {
    if (pending) return;
    setPending(true); setMessage(null); setError(null);
    const result = await saveDraftRosterRulesAction(leagueId, rules);
    setPending(false); setMessage(result.success ?? null); setError(result.error ?? null);
    if (!result.error) { setEditing(false); router.refresh(); }
  }

  return <section className="mt-6 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 sm:p-5" aria-labelledby="roster-rules-title">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Roster construction</p><h3 id="roster-rules-title" className="mt-1 text-lg font-black text-[#0b2b59]">Draft Roster Rules</h3><p className="mt-1 text-sm text-slate-600">{rulesSummary(savedRules)}. Factual team conferences remain unchanged.</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-black ${savedRules.length ? "bg-orange-200 text-orange-900" : "bg-slate-200 text-slate-700"}`}>{savedRules.length ? `${savedRules.length} required slots` : "Unrestricted"}</span></div>
    {savedRules.length ? <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900"><strong>Independent Team Rule:</strong> Notre Dame remains officially Independent and counts as ACC/Power for roster requirements. UConn remains officially Independent and counts as G5. Both also qualify for an explicit Independent slot.</p> : null}
    {!editing ? <div className="mt-4 flex flex-wrap gap-2"><Button className="sm:w-auto" variant="secondary" disabled={locked} onClick={() => { setRules(savedInputs(savedRules)); setEditing(true); }}>Configure Rules</Button>{locked ? <p className="self-center text-sm font-semibold text-slate-600">Rules are frozen after the draft starts.</p> : null}</div> : <div className="mt-4">
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => preset("none")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold">No restrictions</button>{ownerCount === 8 && teamsPerOwner === 3 ? <button type="button" onClick={() => preset("real-8")} className="rounded-lg bg-[#0b2b59] px-3 py-2 text-sm font-bold text-white">8-owner league preset</button> : null}{ownerCount === 4 && teamsPerOwner === 6 ? <button type="button" onClick={() => preset("real-4")} className="rounded-lg bg-[#0b2b59] px-3 py-2 text-sm font-bold text-white">4-owner league preset</button> : null}<button type="button" onClick={() => preset("custom")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold">Custom {teamsPerOwner}-slot rules</button></div>
      {rules.length ? <div className="mt-4 space-y-3">{rules.map((rule, index) => <details key={index} className="rounded-xl border border-slate-200 bg-white p-3" open={rule.criteria.length === 0 && !rule.unrestricted}><summary className="cursor-pointer font-black text-slate-900">{index + 1}. {rule.label} <span className="font-normal text-slate-500">· {rule.unrestricted ? "Any active FBS team" : `${rule.criteria.length} eligibility choice${rule.criteria.length === 1 ? "" : "s"}`}</span></summary><div className="mt-3"><label className="text-sm font-bold">Commissioner label<input value={rule.label} onChange={(event) => updateRule(index, (item) => ({ ...item, label: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="mt-3 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={rule.unrestricted} onChange={(event) => updateRule(index, (item) => ({ ...item, unrestricted: event.target.checked, criteria: event.target.checked ? [] : item.criteria }))} /> Unrestricted Wild Card</label>{!rule.unrestricted ? <div className="mt-3 grid gap-3 md:grid-cols-2"><fieldset><legend className="text-xs font-black uppercase text-slate-500">Conferences</legend><div className="mt-2 grid grid-cols-2 gap-1">{CONFERENCE_OPTIONS.map((value) => <label key={value} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rule.criteria.some((item) => item.dimension === "conference" && item.value === value)} onChange={() => toggleCriterion(index, "conference", value)} /> {value}</label>)}</div></fieldset><fieldset><legend className="text-xs font-black uppercase text-slate-500">Groups</legend><div className="mt-2 space-y-1">{CLASSIFICATION_OPTIONS.map((value) => <label key={value} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rule.criteria.some((item) => item.dimension === "classification" && item.value === value)} onChange={() => toggleCriterion(index, "classification", value)} /> {value}</label>)}</div></fieldset></div> : null}</div></details>)}</div> : <p className="mt-4 rounded-lg bg-white p-3 text-sm font-semibold text-slate-700">Every active FBS team remains eligible. Picks do not consume roster-rule slots.</p>}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button className="sm:w-auto" variant="secondary" disabled={pending} onClick={() => { setEditing(false); setRules(savedInputs(savedRules)); }}>Cancel</Button><Button className="sm:w-auto" variant="sports" disabled={pending || (rules.length !== 0 && rules.length !== teamsPerOwner)} onClick={save}>{pending ? "Validating…" : "Save Roster Rules"}</Button></div>
    </div>}
    {message ? <p role="status" className="mt-3 rounded-lg bg-emerald-100 p-3 text-sm font-semibold text-emerald-800">{message}</p> : null}{error ? <p role="alert" className="mt-3 rounded-lg bg-red-100 p-3 text-sm font-semibold text-red-800">{error}</p> : null}
  </section>;
}
