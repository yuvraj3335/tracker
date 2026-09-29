import { Card, CardContent, CardHeader } from './ui/card';
import { Skeleton, LoadingRegion } from './ui/skeleton';

/** Mirrors the real layout closely, so nothing jumps when data arrives. */
function TileRow() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skin-card border border-hairline bg-surface p-3 sm:p-4">
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="mt-2.5 h-7 w-16" />
          <Skeleton className="mt-2 h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

function Rows({ n = 5 }: { n?: number }) {
  return (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-hairline px-4 py-3 last:border-0">
          <Skeleton className="size-[18px] shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5" style={{ width: `${58 + ((i * 13) % 34)}%` }} />
            <Skeleton className="mt-2 h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Header() {
  return (
    <div className="px-1">
      <Skeleton className="h-6 w-28" />
      <Skeleton className="mt-2 h-3 w-48" />
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading your dashboard">
      <div className="space-y-4 sm:space-y-5">
        <Header />
        <TileRow />
        <Card>
          <CardHeader>
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2 h-2.5 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-2 w-full rounded-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-3.5 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[116px] w-full" />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <Skeleton className="h-3.5 w-36" />
          </CardHeader>
          <Rows n={3} />
        </Card>
      </div>
    </LoadingRegion>
  );
}

export function SheetSkeleton() {
  return (
    <LoadingRegion label="Loading the sheet">
      <div className="space-y-4">
        <div className="px-1">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="mt-2 h-3 w-56" />
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
        </div>
        <div className="flex gap-1.5 px-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-4 shrink-0 rounded" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="mt-2 h-1 w-full rounded-full" />
                </div>
                <Skeleton className="h-3 w-10 shrink-0" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

export function DailySkeleton() {
  return (
    <LoadingRegion label="Loading your day">
      <div className="space-y-4">
        <Header />
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex-1 space-y-1.5 text-center">
            <Skeleton className="mx-auto h-3.5 w-20" />
            <Skeleton className="mx-auto h-2.5 w-28" />
          </div>
          <Skeleton className="size-9 rounded-lg" />
        </div>
        <Card className="overflow-hidden">
          <CardHeader>
            <Skeleton className="h-3.5 w-28" />
          </CardHeader>
          <Rows n={4} />
        </Card>
      </div>
    </LoadingRegion>
  );
}

export function AnalyticsSkeleton() {
  return (
    <LoadingRegion label="Loading analytics">
      <div className="space-y-4">
        <Header />
        <TileRow />
        <Card>
          <CardHeader>
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-2 h-2.5 w-52" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[150px] w-full" />
          </CardContent>
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-3.5 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-2 w-full rounded-full" />
                <Skeleton className="h-2 w-full rounded-full" />
                <Skeleton className="h-2 w-full rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}

/** The job pipeline: header, tabs, the funnel card, then the board. */
export function JobsSkeleton() {
  return (
    <LoadingRegion label="Loading your jobs">
      <div className="space-y-4">
        <Header />
        <Skeleton className="h-8 w-80 max-w-full rounded-full" />
        <Card>
          <CardContent className="space-y-3.5 pt-4 sm:pt-5">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="h-2.5 w-14" />
                  <Skeleton className="mt-1.5 h-5 w-8" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="hidden gap-2.5 lg:grid lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, c) => (
            <div key={c} className="space-y-2 rounded-xl bg-surface-2/60 p-2">
              <Skeleton className="h-3 w-20" />
              {Array.from({ length: 3 - (c % 2) }).map((_, i) => (
                <div key={i} className="skin-card space-y-2 border border-hairline bg-surface p-3">
                  <div className="flex gap-2.5">
                    <Skeleton className="size-7 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-2.5 w-2/3" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-24 rounded-full" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <Card className="lg:hidden">
          <Rows n={6} />
        </Card>
      </div>
    </LoadingRegion>
  );
}

/** One job: header with the stepper, then the two columns. */
export function JobDetailSkeleton() {
  return (
    <LoadingRegion label="Loading the job">
      <div className="space-y-4">
        <Skeleton className="h-3 w-20" />
        <Card>
          <CardContent className="space-y-4 pt-4 sm:pt-5">
            <div className="flex gap-3.5">
              <Skeleton className="size-13 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              </div>
            </div>
            <Skeleton className="h-8 w-40 rounded-full" />
            <div className="flex justify-between gap-2 border-t border-hairline pt-3.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="size-6 rounded-full" />
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card>
            <CardContent className="space-y-2.5 pt-4 sm:pt-5">
              <Skeleton className="h-3.5 w-28" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-3" style={{ width: `${70 + ((i * 11) % 25)}%` }} />
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2.5 pt-4 sm:pt-5">
              <Skeleton className="h-3.5 w-24" />
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </LoadingRegion>
  );
}
