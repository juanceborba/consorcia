import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props} />
  );
}

function TabsList({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props} />
  );
}

// El tab activo expone data-active (Base UI); mantiene foco visible y
// estados disabled acordes al resto de los componentes base-nova.
function TabsTab({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-active:bg-background data-active:text-foreground data-active:shadow-sm",
        className
      )}
      {...props} />
  );
}

function TabsPanel({
  className,
  ...props
}) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("flex-1 outline-none", className)}
      {...props} />
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel }
