"use client";

import { useEffect, useState, type FormEvent } from "react";
import { sanitizeLevel, type SchoolSummary } from "@campuslife/shared/levels";
import type { Department } from "@campuslife/shared/departments";
import { STORAGE_KEYS } from "@campus/lib/storage";
import { DepartmentPicker, parseDepartment } from "../DepartmentPicker";
import { GameIcon } from "../GameIcon";
import { LevelPicker } from "../LevelPicker";
import { SchoolPicker, parseSchool } from "../SchoolPicker";

export interface StudentDetails {
  school: string;
  level: string;
  department: string;
}

const COPY = {
  title: "New student",
  submit: "Enter campus",
  wipe: "Your saved progress will be wiped when you enter.",
  keep: "Keep my save",
};

export function StudentForm({ handle, wipes, onKeepSave, onSubmit }: { handle: string; wipes: boolean; onKeepSave: () => void; onSubmit: (details: StudentDetails) => void }) {
  const [school, setSchool] = useState<SchoolSummary | null>(null);
  const [level, setLevel] = useState("");
  const [department, setDepartment] = useState<Department | null>(null);

  useEffect(() => {
    try {
      const saved = parseSchool(localStorage.getItem(STORAGE_KEYS.school));
      if (!saved) return;
      setSchool(saved);
      setLevel(sanitizeLevel(saved.type, localStorage.getItem(STORAGE_KEYS.level)));
      setDepartment(parseDepartment(localStorage.getItem(STORAGE_KEYS.department)));
    } catch {
      /* storage unavailable */
    }
  }, []);

  function chooseSchool(next: SchoolSummary) {
    setSchool(next);
    setLevel("");
    setDepartment(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!school || !level || !department) return;
    try {
      localStorage.setItem(STORAGE_KEYS.school, JSON.stringify(school));
      localStorage.setItem(STORAGE_KEYS.level, level);
      localStorage.setItem(STORAGE_KEYS.department, JSON.stringify(department));
    } catch {
      /* storage unavailable */
    }
    onSubmit({ school: school.id, level, department: department.id });
  }

  return (
    <form className="start-card" onSubmit={submit}>
      <div className="start-card-head">
        <h2>{COPY.title}</h2>
        <GameIcon name="game" />
      </div>
      <p className="start-handle">{handle}</p>
      <SchoolPicker school={school} onSchool={chooseSchool} />
      {school && <DepartmentPicker schoolType={school.type} department={department} onDepartment={setDepartment} />}
      {school && <LevelPicker schoolType={school.type} level={level} onLevel={setLevel} />}
      {wipes && (
        <p className="start-saved">
          <span className="start-warn">{COPY.wipe}</span>{" "}
          <button type="button" className="link-btn" onClick={onKeepSave}>
            {COPY.keep}
          </button>
        </p>
      )}
      <button className="btn start-enter" type="submit" disabled={!school || !level || !department}>
        {COPY.submit}
        <GameIcon name="arrow" />
      </button>
    </form>
  );
}
