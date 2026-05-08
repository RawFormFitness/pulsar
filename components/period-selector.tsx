"use client";

// components/period-selector.tsx
//
// Period selector — three modes: Month-to-Date, Year-to-Date, Custom Range.
//
// Level 1 (universal): every gym has a period selector with these three
// options. The labels/locale could be Level 2 in the future, but for v1 the
// strings are universal.
//
// This component is intentionally NOT wired to data fetching in Task 1.
// The parent supplies an onChange callback (no-op is fine) and the value
// flows back through state. Task 3 will wire it to the analytics-engine
// fetch path.

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format as formatDate } from "date-fns";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PeriodType = "mtd" | "ytd" | "custom";

export type Period = {
  type: PeriodType;
  start: Date;
  end: Date;
};

export type PeriodSelectorProps = {
  value: Period;
  onChange: (next: Period) => void;
  /** Optional: today's date, injectable for testing or fixed-clock previews. */
  now?: Date;
  className?: string;
};

/** Start of the current month at 00:00:00 local time. */
export function monthToDate(now: Date = new Date()): Period {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now);
  return { type: "mtd", start, end };
}

/** Start of the current year at 00:00:00 local time. */
export function yearToDate(now: Date = new Date()): Period {
  const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const end = new Date(now);
  return { type: "ytd", start, end };
}

export function PeriodSelector({
  value,
  onChange,
  now,
  className,
}: PeriodSelectorProps) {
  const today = now ?? new Date();

  const setType = (type: PeriodType) => {
    if (type === "mtd") onChange(monthToDate(today));
    else if (type === "ytd") onChange(yearToDate(today));
    else onChange({ type: "custom", start: value.start, end: value.end });
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Tabs
        value={value.type}
        onValueChange={(v) => setType(v as PeriodType)}
      >
        <TabsList>
          <TabsTrigger value="mtd">Month to date</TabsTrigger>
          <TabsTrigger value="ytd">Year to date</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>
      </Tabs>

      {value.type === "custom" && (
        <div className="flex items-center gap-2">
          <DateField
            label="Start"
            date={value.start}
            onSelect={(d) =>
              onChange({ type: "custom", start: d, end: value.end })
            }
          />
          <span className="text-sm text-muted-foreground">→</span>
          <DateField
            label="End"
            date={value.end}
            onSelect={(d) =>
              onChange({ type: "custom", start: value.start, end: d })
            }
          />
        </div>
      )}
    </div>
  );
}

function DateField({
  label,
  date,
  onSelect,
}: {
  label: string;
  date: Date;
  onSelect: (d: Date) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <CalendarIcon />
            <span className="font-normal text-muted-foreground mr-1">
              {label}:
            </span>
            <span>{formatDate(date, "MMM d, yyyy")}</span>
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            if (d) {
              onSelect(d);
              setOpen(false);
            }
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
