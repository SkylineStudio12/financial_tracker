"use client";

/**
 * Component gallery — every starter-set primitive rendered with our design
 * tokens, plus the foundations proof and the expansion backlog.
 * Static local sample data only. Dev/reference route; not in app navigation.
 */
import * as React from "react";
import {
  Building2Icon,
  CalendarIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  HomeIcon,
  PlusIcon,
  ReceiptIcon,
  WalletIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/* ---------------------------------------------------------------- helpers */

/** Local-date formatter — toISOString would shift the day across timezones. */
const formatLocalDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-card-title text-text-primary border-b border-border-hairline pb-2">
      {children}
    </h2>
  );
}

function Demo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-micro uppercase text-text-muted">{label}</h3>
      <div className="rounded-card border border-border-hairline bg-surface p-[var(--density-card-padding)]">
        {children}
      </div>
    </div>
  );
}

const CATEGORIES = [
  "Dining",
  "Groceries",
  "Health",
  "Housing",
  "Leisure",
  "Subscriptions",
  "Transport",
  "Travel",
  "Utilities",
];

const SAMPLE_ROWS = [
  { date: "2026-07-01", description: "Client invoice paid", category: "Revenue", amount: "+12.500,00 RON", tone: "text-status-positive-text" },
  { date: "2026-07-02", description: "Kaufland groceries", category: "Groceries", amount: "-284,50 RON", tone: "text-status-negative-text" },
  { date: "2026-07-03", description: "Transfer between accounts", category: "—", amount: "0,00 RON", tone: "text-status-neutral-text" },
];

/* ------------------------------------------------------------ foundations */

const TYPE_SCALE = [
  { cls: "text-display", label: "text-display · 36px · Light · shadcn text-4xl (h1)" },
  { cls: "text-title", label: "text-title · 30px · Light · shadcn text-3xl (h2)" },
  { cls: "text-number-lg", label: "text-number-lg · 24px · Regular · shadcn text-2xl (h3)" },
  { cls: "text-card-title", label: "text-card-title · 20px · Regular · shadcn text-xl (h4)" },
  { cls: "text-body", label: "text-body · 16px · Regular · shadcn text-base (p)" },
  { cls: "text-secondary", label: "text-secondary · 14px · Regular · shadcn text-sm" },
  { cls: "text-caption", label: "text-caption · 12px · Regular · shadcn text-xs" },
  { cls: "text-micro uppercase", label: "text-micro · 11px · Regular · uppercase" },
];

const MONEY_SAMPLES = [
  { token: "status-positive-text", cls: "text-status-positive-text", value: "+12.345,67 RON" },
  { token: "status-negative-text", cls: "text-status-negative-text", value: "-4.821,00 RON" },
  { token: "status-neutral-text", cls: "text-status-neutral-text", value: "0,00 RON" },
];

function MoneyBlock({ surface }: { surface: "canvas" | "surface" }) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-card p-[var(--density-card-padding)] ${
        surface === "canvas" ? "bg-canvas" : "bg-surface border border-border-hairline"
      }`}
    >
      <div className="text-micro uppercase text-text-muted">on {surface}</div>
      {MONEY_SAMPLES.map((m) => (
        <div key={m.token} className="flex items-baseline justify-between gap-6">
          <span className="text-caption text-text-muted">{m.token}</span>
          <span className={`text-number-lg font-numeric tabular-nums ${m.cls}`}>{m.value}</span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-6 border-t border-border-hairline pt-2">
        <span className="text-caption text-text-muted">amount-sm (14px)</span>
        <span className="flex gap-4 text-secondary font-numeric tabular-nums">
          {MONEY_SAMPLES.map((m) => (
            <span key={m.token} className={m.cls}>
              {m.value}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- sidebar */

const ENTITIES = ["Household", "Company A", "Company B"];

function SidebarDemo() {
  const [entity, setEntity] = React.useState("Household");
  const [switcherOpen, setSwitcherOpen] = React.useState(false);
  return (
    <div className="h-[420px] overflow-hidden rounded-card border border-border-hairline">
      <SidebarProvider className="min-h-0 h-full">
        <Sidebar collapsible="none" className="h-full w-64 border-r border-border-hairline">
          <SidebarHeader className="border-b border-border-hairline">
            <Popover open={switcherOpen} onOpenChange={setSwitcherOpen}>
              <PopoverTrigger
                render={
                  <Button variant="secondary" className="w-full justify-between px-3" />
                }
              >
                <span className="flex items-center gap-2">
                  <Building2Icon className="size-4" absoluteStrokeWidth strokeWidth={1.5} />
                  {entity}
                </span>
                <ChevronsUpDownIcon className="size-4 text-text-muted" absoluteStrokeWidth strokeWidth={1.5} />
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                {ENTITIES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="flex w-full items-center justify-between rounded-badge px-2 py-1.5 text-secondary text-text-primary hover:bg-surface-inactive"
                    onClick={() => {
                      setEntity(name);
                      setSwitcherOpen(false);
                    }}
                  >
                    {name}
                    {name === entity && (
                      <CheckIcon className="size-4" absoluteStrokeWidth strokeWidth={1.5} />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Views</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive>
                      <ReceiptIcon absoluteStrokeWidth strokeWidth={1.5} />
                      Transactions
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <HomeIcon absoluteStrokeWidth strokeWidth={1.5} />
                      Dashboard
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton>
                      <WalletIcon absoluteStrokeWidth strokeWidth={1.5} />
                      Accounts
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <div className="flex flex-1 items-center justify-center bg-canvas text-secondary text-text-muted">
          Content area — active entity: {entity}
        </div>
      </SidebarProvider>
    </div>
  );
}

/* ---------------------------------------------------------------- gallery */

export function Gallery() {
  const [date, setDate] = React.useState<Date | undefined>(new Date(2026, 6, 4));

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-canvas">
        <div className="mx-auto flex max-w-5xl flex-col gap-[var(--density-section-gap)] p-[var(--density-card-padding)] pb-24">
          <header className="flex flex-col gap-1 pt-4">
            <h1 className="text-title text-text-primary">Components</h1>
            <p className="text-secondary text-text-muted">
              Design-system reference — every starter-set primitive styled with our tokens.
              Static sample data; dev route only.
            </p>
          </header>

          {/* ------------------------------------------------ Foundations */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Foundations</SectionTitle>
            <Demo label="Type scale — Geist, shadcn sizes, Light + Regular only">
              <div className="flex flex-col gap-4">
                {TYPE_SCALE.map((t) => (
                  <div key={t.cls} className="flex items-baseline gap-6">
                    <span className={`${t.cls} text-text-primary min-w-0 shrink-0`}>
                      Net cash 4.210,00
                    </span>
                    <span className="text-caption text-text-muted whitespace-nowrap">{t.label}</span>
                  </div>
                ))}
              </div>
            </Demo>
            <Demo label="Money colors as text — AA on both surfaces (font-numeric + tabular-nums)">
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyBlock surface="canvas" />
                <MoneyBlock surface="surface" />
              </div>
            </Demo>
          </section>

          {/* --------------------------------------------- Form controls */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Form controls</SectionTitle>
            <div className="grid gap-4 lg:grid-cols-2">
              <Demo label="Checkbox — unchecked / checked / disabled">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox id="cb1" />
                    <Label htmlFor="cb1">Unchecked</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="cb2" defaultChecked />
                    <Label htmlFor="cb2">Checked</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="cb3" disabled />
                    <Label htmlFor="cb3" className="text-text-disabled">Disabled</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="cb4" disabled defaultChecked />
                    <Label htmlFor="cb4" className="text-text-disabled">Disabled checked</Label>
                  </div>
                </div>
              </Demo>

              <Demo label="Combobox — type to filter">
                <Combobox items={CATEGORIES}>
                  <ComboboxInput placeholder="Search category…" />
                  <ComboboxContent>
                    <ComboboxEmpty>No category found.</ComboboxEmpty>
                    <ComboboxList>
                      {(item: string) => (
                        <ComboboxItem key={item} value={item}>
                          {item}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </Demo>

              <Demo label="Date picker — Popover + Calendar">
                <Popover>
                  <PopoverTrigger
                    render={<Button variant="secondary" className="w-56 justify-start gap-2" />}
                  >
                    <CalendarIcon className="size-4 text-text-muted" absoluteStrokeWidth strokeWidth={1.5} />
                    {date ? formatLocalDate(date) : "Pick a date"}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={date} onSelect={setDate} />
                  </PopoverContent>
                </Popover>
              </Demo>

              <Demo label="Input — default / filled / disabled / error">
                <div className="flex flex-col gap-3">
                  <Input placeholder="0,00" />
                  <Input defaultValue="1.234,56" />
                  <Input disabled placeholder="Disabled" />
                  <div className="flex flex-col gap-1">
                    <Input aria-invalid defaultValue="not-a-number" />
                    <p className="text-caption text-status-negative-text">Enter a valid amount.</p>
                  </div>
                </div>
              </Demo>

              <Demo label="Label">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="labelled">Counterparty</Label>
                  <Input id="labelled" placeholder="Kaufland" />
                </div>
              </Demo>

              <Demo label="Radio group">
                <RadioGroup defaultValue="expense" className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="expense" id="r1" />
                    <Label htmlFor="r1">Expense</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="income" id="r2" />
                    <Label htmlFor="r2">Income</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="transfer" id="r3" disabled />
                    <Label htmlFor="r3" className="text-text-disabled">Transfer (disabled)</Label>
                  </div>
                </RadioGroup>
              </Demo>

              <Demo label="Select — default / filled / disabled">
                <div className="flex flex-col gap-3">
                  <Select items={CATEGORIES.map((c) => ({ value: c, label: c }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a category…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select items={CATEGORIES.map((c) => ({ value: c, label: c }))} defaultValue="Groceries">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select items={[]} disabled>
                    <SelectTrigger>
                      <SelectValue placeholder="Disabled" />
                    </SelectTrigger>
                  </Select>
                </div>
              </Demo>

              <Demo label="Switch — off / on / disabled">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Switch id="s1" />
                    <Label htmlFor="s1">Off</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="s2" defaultChecked />
                    <Label htmlFor="s2">On</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="s3" disabled />
                    <Label htmlFor="s3" className="text-text-disabled">Disabled</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="s4" disabled defaultChecked />
                    <Label htmlFor="s4" className="text-text-disabled">Disabled on</Label>
                  </div>
                </div>
              </Demo>

              <Demo label="Textarea — default / filled / disabled / error">
                <div className="flex flex-col gap-3">
                  <Textarea placeholder="Notes…" />
                  <Textarea defaultValue="Quarterly dividend, net of withholding." />
                  <Textarea disabled placeholder="Disabled" />
                  <div className="flex flex-col gap-1">
                    <Textarea aria-invalid defaultValue="Too long…" />
                    <p className="text-caption text-status-negative-text">Keep notes under 500 characters.</p>
                  </div>
                </div>
              </Demo>
            </div>
          </section>

          {/* -------------------------------------------------- Buttons */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Buttons</SectionTitle>
            <Demo label="Variants and states">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button disabled>Disabled</Button>
                <Button>
                  <PlusIcon absoluteStrokeWidth strokeWidth={1.5} />
                  With icon
                </Button>
                <Button disabled>
                  <Spinner className="size-4" />
                  Saving…
                </Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
            </Demo>
          </section>

          {/* ------------------------------------------------- Overlays */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Overlays</SectionTitle>
            <Demo label="Dialog · Drawer · Dropdown menu · Popover · Sheet · Tooltip">
              <div className="flex flex-wrap items-center gap-3">
                <Dialog>
                  <DialogTrigger render={<Button variant="secondary" />}>Open dialog</DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Confirm action</DialogTitle>
                      <DialogDescription>
                        This is the dialog primitive with our scrim, radius, and shadow tokens.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
                      <DialogClose render={<Button />}>Confirm</DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Drawer>
                  <DrawerTrigger render={<Button variant="secondary" />}>Open drawer</DrawerTrigger>
                  <DrawerContent>
                    <DrawerHeader>
                      <DrawerTitle>Drawer</DrawerTitle>
                      <DrawerDescription>Bottom drawer with sample content.</DrawerDescription>
                    </DrawerHeader>
                    <div className="p-4 pt-0 text-secondary text-text-secondary">
                      Swipe down or press Escape to close.
                    </div>
                  </DrawerContent>
                </Drawer>

                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="secondary" />}>
                    Dropdown menu
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {/* GroupLabel MUST live inside a Group — Base UI crashes otherwise */}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Transaction</DropdownMenuLabel>
                      <DropdownMenuItem>
                        Edit
                        <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
                      </DropdownMenuItem>
                      <DropdownMenuItem>Duplicate</DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Popover>
                  <PopoverTrigger render={<Button variant="secondary" />}>Open popover</PopoverTrigger>
                  <PopoverContent>
                    <PopoverHeader>
                      <PopoverTitle>Popover</PopoverTitle>
                      <PopoverDescription>Raised surface with hairline and shadow.</PopoverDescription>
                    </PopoverHeader>
                  </PopoverContent>
                </Popover>

                <Sheet>
                  <SheetTrigger render={<Button variant="secondary" />}>Open sheet</SheetTrigger>
                  <SheetContent side="right">
                    <SheetHeader>
                      <SheetTitle>Sheet</SheetTitle>
                      <SheetDescription>Side panel for secondary workflows.</SheetDescription>
                    </SheetHeader>
                    <div className="px-4 text-secondary text-text-secondary">Sample content.</div>
                    <SheetFooter>
                      <Button>Save</Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>

                <Tooltip>
                  <TooltipTrigger render={<Button variant="secondary" />}>Hover me</TooltipTrigger>
                  <TooltipContent>Tooltip on our tokens</TooltipContent>
                </Tooltip>
              </div>
            </Demo>
          </section>

          {/* --------------------------------------------- Data display */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Data display</SectionTitle>
            <div className="grid gap-4 lg:grid-cols-2">
              <Demo label="Avatar">
                <div className="flex items-center gap-4">
                  <Avatar>
                    <AvatarFallback>FG</AvatarFallback>
                  </Avatar>
                  <Avatar className="size-10">
                    <AvatarFallback>CA</AvatarFallback>
                  </Avatar>
                  <AvatarGroup>
                    <Avatar>
                      <AvatarFallback>FG</AvatarFallback>
                    </Avatar>
                    <Avatar>
                      <AvatarFallback>MB</AvatarFallback>
                    </Avatar>
                    <AvatarGroupCount>+2</AvatarGroupCount>
                  </AvatarGroup>
                </div>
              </Demo>

              <Demo label="Badge — neutral + money states (neon fills, black text)">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Neutral</Badge>
                  <Badge variant="outline">Outline</Badge>
                  <Badge className="bg-status-positive-fill text-accent">Positive</Badge>
                  <Badge className="bg-status-negative-fill text-accent">Negative</Badge>
                  <Badge className="bg-status-neutral-fill text-accent">Transfer</Badge>
                  <Badge variant="secondary" className="uppercase text-micro">
                    <span className="text-status-warning-text">Estimate</span>
                  </Badge>
                </div>
              </Demo>

              <Demo label="Card">
                <Card className="max-w-sm">
                  <CardHeader>
                    <CardTitle>Net cash</CardTitle>
                    <CardDescription>All entities, after accrued taxes</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <span className="text-number-lg font-numeric tabular-nums text-text-primary">
                      4.210,00 RON
                    </span>
                  </CardContent>
                  <CardFooter>
                    <span className="text-caption text-text-muted">Updated moments ago</span>
                  </CardFooter>
                </Card>
              </Demo>

              <Demo label="Separator">
                <div className="flex flex-col gap-3">
                  <span className="text-secondary text-text-secondary">Above the line</span>
                  <Separator />
                  <div className="flex h-6 items-center gap-3 text-secondary text-text-secondary">
                    <span>Left</span>
                    <Separator orientation="vertical" />
                    <span>Right</span>
                  </div>
                </div>
              </Demo>

              <Demo label="Table — money colors together, tabular figures">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SAMPLE_ROWS.map((row) => (
                      <TableRow key={row.description}>
                        <TableCell className="text-text-muted">{row.date}</TableCell>
                        <TableCell>{row.description}</TableCell>
                        <TableCell className="text-text-secondary">{row.category}</TableCell>
                        <TableCell className={`text-right font-numeric tabular-nums ${row.tone}`}>
                          {row.amount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Demo>

              <Demo label="Data table — static sample (sortable affordance, selected row)">
                <Table>
                  <TableCaption>Static demo — TanStack wiring comes with real usage.</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox aria-label="Select all" />
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Date
                          <ChevronsUpDownIcon className="size-3 text-text-muted" absoluteStrokeWidth strokeWidth={1.5} />
                        </span>
                      </TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SAMPLE_ROWS.map((row, index) => (
                      <TableRow key={row.description} data-state={index === 1 ? "selected" : undefined}>
                        <TableCell>
                          <Checkbox defaultChecked={index === 1} aria-label="Select row" />
                        </TableCell>
                        <TableCell className="text-text-muted">{row.date}</TableCell>
                        <TableCell>{row.description}</TableCell>
                        <TableCell className={`text-right font-numeric tabular-nums ${row.tone}`}>
                          {row.amount}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Demo>
            </div>
          </section>

          {/* ------------------------------------------------- Feedback */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Feedback</SectionTitle>
            <div className="grid gap-4 lg:grid-cols-2">
              <Demo label="Alert — default / destructive">
                <div className="flex flex-col gap-3">
                  <Alert>
                    <CalendarIcon className="size-4" absoluteStrokeWidth strokeWidth={1.5} />
                    <AlertTitle>BNR rates synced</AlertTitle>
                    <AlertDescription>Rates for 2026-07-03 are available.</AlertDescription>
                  </Alert>
                  <Alert variant="destructive">
                    <AlertTitle>Postings do not balance</AlertTitle>
                    <AlertDescription>The RON amounts must sum to zero.</AlertDescription>
                  </Alert>
                </div>
              </Demo>

              <Demo label="Progress · Skeleton · Spinner">
                <div className="flex flex-col gap-5">
                  <Progress value={64} />
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-16 w-full rounded-input" />
                  </div>
                  <div className="flex items-center gap-4">
                    <Spinner className="size-4" />
                    <Spinner className="size-6" />
                    <span className="text-caption text-text-muted">Spinner sizes</span>
                  </div>
                </div>
              </Demo>

              <Demo label="Sonner (toast)">
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={() => toast("Transaction saved")}>
                    Default toast
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => toast.success("Salary posted", { description: "7 postings created" })}
                  >
                    Success toast
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => toast.error("Postings must sum to zero")}
                  >
                    Error toast
                  </Button>
                </div>
              </Demo>
            </div>
          </section>

          {/* ----------------------------------------------- Navigation */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Navigation</SectionTitle>
            <div className="grid gap-4 lg:grid-cols-2">
              <Demo label="Breadcrumb">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbLink href="#">Household</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbLink href="#">Transactions</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Kaufland groceries</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </Demo>

              <Demo label="Pagination">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious href="#" />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#">1</PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#" isActive>
                        2
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink href="#">3</PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext href="#" />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </Demo>

              <Demo label="Tabs">
                <Tabs defaultValue="overview">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="postings">Postings</TabsTrigger>
                    <TabsTrigger value="accruals">Accruals</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="pt-3 text-secondary text-text-secondary">
                    Balances and net cash at a glance.
                  </TabsContent>
                  <TabsContent value="postings" className="pt-3 text-secondary text-text-secondary">
                    Double-entry legs of the selected transaction.
                  </TabsContent>
                  <TabsContent value="accruals" className="pt-3 text-secondary text-text-secondary">
                    Linked tax accruals with period and rule.
                  </TabsContent>
                </Tabs>
              </Demo>
            </div>
            <Demo label="Sidebar — with entity switcher header (styled demo; real nav unchanged)">
              <SidebarDemo />
            </Demo>
          </section>

          {/* -------------------------------------------------- Backlog */}
          <section className="flex flex-col gap-4">
            <SectionTitle>Backlog — available to add later</SectionTitle>
            <p className="text-secondary text-text-muted">
              shadcn components not in the starter set. Nothing below is installed; add via{" "}
              <code className="text-caption">npx shadcn add &lt;name&gt;</code> and restyle to tokens.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {[
                "Accordion",
                "Alert Dialog",
                "Aspect Ratio",
                "Button Group",
                "Carousel",
                "Chart",
                "Collapsible",
                "Command",
                "Context Menu",
                "Empty",
                "Field",
                "Hover Card",
                "Input OTP",
                "Item",
                "Kbd",
                "Menubar",
                "Native Select",
                "Navigation Menu",
                "Resizable",
                "Scroll Area",
                "Slider",
                "Toggle",
                "Toggle Group",
                "Typography",
              ].map((name) => (
                <div
                  key={name}
                  className="rounded-input border border-border-hairline bg-surface px-3 py-2 text-secondary text-text-secondary"
                >
                  {name}
                </div>
              ))}
            </div>
          </section>

          {/* --------------------------------------------------- Footer */}
          <footer className="border-t border-border-hairline pt-4 text-caption text-text-muted">
            <p>
              <strong className="font-medium text-text-secondary">Already present</strong> (phase 2.6):
              Button, Dialog, Select.{" "}
              <strong className="font-medium text-text-secondary">Newly added</strong>: Alert, Avatar,
              Badge, Breadcrumb, Calendar, Card, Checkbox, Combobox, Drawer, Dropdown Menu, Input,
              Label, Pagination, Popover, Progress, Radio Group, Separator, Sheet, Sidebar, Skeleton,
              Sonner, Spinner, Switch, Table, Tabs, Textarea, Tooltip — all restyled to semantic
              tokens. Input Group and Calendar arrived as dependencies (Combobox, Date Picker);
              Date Picker and Data Table are composition patterns, not registry items.
            </p>
          </footer>
        </div>
        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}
