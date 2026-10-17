"use client";

import { useState, type ReactNode } from "react";
import { PiCaretUpDown, PiCheck } from "react-icons/pi";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@campus/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@campus/components/ui/popover";

const ITEM_CLASS = "min-h-11 cursor-pointer text-base";

export interface SearchSelectItem {
  id: string;
  name: string;
  keywords?: string[];
}

export interface SearchSelectGroup {
  label: string;
  items: SearchSelectItem[];
}

interface Props {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  groups: SearchSelectGroup[];
  other: { id: string; label: string; heading: string };
  selected: { id: string; name: string } | null;
  disabled?: boolean;
  status?: ReactNode;
  onSelect: (id: string) => void;
}

export function SearchSelect({ id, label, placeholder, searchPlaceholder, emptyText, groups, other, selected, disabled, status, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  function pick(next: string) {
    setOpen(false);
    if (next !== selected?.id) onSelect(next);
  }

  return (
    <div className="school-field">
      <label htmlFor={id}>{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button id={id} type="button" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-describedby={`${id}-status`} className="school-trigger" disabled={disabled}>
            <span className={selected ? "school-trigger-text" : "school-trigger-text placeholder"}>{selected?.name ?? placeholder}</span>
            <PiCaretUpDown aria-hidden size={18} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
          <Command>
            <CommandInput placeholder={searchPlaceholder} className="text-base select-text" />
            <CommandList id={`${id}-list`} className="touch-pan-y overscroll-contain">
              <CommandEmpty>{emptyText}</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.label} heading={group.label}>
                  {group.items.map((item) => (
                    <CommandItem key={item.id} value={`${item.name} ${item.id}`} keywords={item.keywords} onSelect={() => pick(item.id)} className={ITEM_CLASS}>
                      <span className="flex-1">{item.name}</span>
                      {item.id === selected?.id && <PiCheck aria-hidden />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              <CommandGroup heading={other.heading} forceMount>
                <CommandItem value={other.label} forceMount onSelect={() => pick(other.id)} className={ITEM_CLASS}>
                  <span className="flex-1">{other.label}</span>
                  {selected?.id === other.id && <PiCheck aria-hidden />}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <p id={`${id}-status`} className="school-status" role="status">
        {status}
      </p>
    </div>
  );
}
