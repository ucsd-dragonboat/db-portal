"use client";

import { useState } from "react";
import Icon from "@/components/icon";

/** Copy-to-clipboard button with the standard 2.5s "Copied" flash. `text` is lazy so it can read `location`. */
export default function CopyButton({ text, label = "Copy", copiedLabel, className = "btn-primary whitespace-nowrap", title }: {
  text: () => string; label?: React.ReactNode; copiedLabel?: React.ReactNode; className?: string; title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(text()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  return (
    <button type="button" onClick={copy} className={className} title={title}>
      {copied ? (copiedLabel ?? <><Icon name="check" /> Copied</>) : label}
    </button>
  );
}
