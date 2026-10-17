"use client";
import { Select } from "radix-ui";
import { PiCaretDown, PiCheck } from "react-icons/pi";
export function CampusDropdown({ id, value, onChange, options, label, className = "" }: { id?: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string; className?: string }) {
  return <Select.Root value={value} onValueChange={onChange}>
    <Select.Trigger id={id} aria-label={label} className={`campus-dropdown-trigger ${className}`}><Select.Value /><Select.Icon><PiCaretDown aria-hidden /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content position="popper" sideOffset={6} className="campus-dropdown-content"><Select.Viewport>
      {options.map((option) => <Select.Item key={option.value} value={option.value} className="campus-dropdown-option"><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><PiCheck aria-hidden /></Select.ItemIndicator></Select.Item>)}
    </Select.Viewport></Select.Content></Select.Portal>
  </Select.Root>;
}
