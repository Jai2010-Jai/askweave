"use client";

import type { InputHTMLAttributes, ReactNode } from "react";

/** A labelled input. Pass `multiline` for a textarea. */
export function Field({
  label,
  aside,
  hint,
  multiline,
  ...input
}: {
  label: string;
  aside?: ReactNode;
  hint?: ReactNode;
  multiline?: boolean;
} & InputHTMLAttributes<HTMLInputElement & HTMLTextAreaElement>) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {aside && <small>{aside}</small>}
      </span>
      {multiline ? <textarea {...input} /> : <input {...input} />}
      {hint && <p className="field-hint">{hint}</p>}
    </label>
  );
}
