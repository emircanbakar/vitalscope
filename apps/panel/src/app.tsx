import { useMemo, type ReactNode } from "react";
import { Histogram, RatingBar, RatingLegend, TimeSeriesChart } from "@vitalscope/charts";
import { METRIC_NAMES, THRESHOLDS, getRating, type MetricName } from "@vitalscope/protocol";
import type { BreakdownRow, MetricDetail, MetricSummary, Options, Overview } from "../../../packages/cli/src/queries.js";
import { LoadError, NoMatches, RatingText, ViewLink, type Navigate } from "./components.js";
import { ErrorDetailView, ErrorListView } from "./errors.js";
import { RANGES, apiQuery, baseView, useView, type Environment, type Range, type ViewState } from "./filters.js";
import { FORMATS, METRIC_TITLES, RATING_LABELS } from "./format.js";
import { ReleasesView } from "./releases.js";
import { useData } from "./use-data.js";
import { LiveVersion, useLive, type LiveStatus } from "./use-live.js";

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <label className="filter">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function FilterRow({ view, env, options, navigate }: { view: ViewState; env: Environment; options: Options; navigate: Navigate }) {
  // Elle yazılmış ya da artık ölçümü olmayan bir değer de seçili görünür.
  const pages = view.page && !options.pages.includes(view.page) ? [view.page, ...options.pages] : options.pages;
  const devices = view.device && !options.devices.includes(view.device) ? [view.device, ...options.devices] : options.devices;
  const cleared = { ...view };
  delete cleared.page;
  delete cleared.device;
  return (
    <form className="filters" aria-label="Filters" onSubmit={(event) => event.preventDefault()}>
      <Select label="Range" value={view.range} onChange={(range) => navigate({ ...view, range: range as Range })}>
        {Object.entries(RANGES).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select label="Environment" value={env} onChange={(next) => navigate({ ...view, env: next as Environment })}>
        {options.environments.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </Select>
      <Select label="Page" value={view.page ?? ""} onChange={(page) => navigate({ ...view, page: page || undefined } as ViewState)}>
        <option value="">All pages</option>
        {pages.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </Select>
      <Select label="Device" value={view.device ?? ""} onChange={(device) => navigate({ ...view, device: device || undefined } as ViewState)}>
        <option value="">All devices</option>
        {devices.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </Select>
      {(view.page || view.device) && (
        <button type="button" onClick={() => navigate(cleared)}>
          Clear page and device
        </button>
      )}
    </form>
  );
}

function EmptyState() {
  return (
    <section className="notice">
      <h2>No measurements yet</h2>
      <p>Load the SDK in your app while it runs in development, then open a page.</p>
      <pre>
        <code>{`if (import.meta.env.DEV) {
  void import("@vitalscope/sdk").then(({ init }) => init());
}`}</code>
      </pre>
      <p>Results appear here as soon as they arrive.</p>
    </section>
  );
}

function MetricCard({ metric, view, navigate }: { metric: MetricSummary; view: ViewState; navigate: Navigate }) {
  return (
    <article className="card">
      <h3>
        <ViewLink view={{ ...view, metric: metric.name }} navigate={navigate}>
          {metric.name}
        </ViewLink>
      </h3>
      <p className="card-title">{METRIC_TITLES[metric.name]}</p>
      {metric.p75 === null || metric.rating === null ? (
        <p className="card-empty">No measurements</p>
      ) : (
        <>
          <p className="card-value">{FORMATS[metric.name](metric.p75)}</p>
          <p className="card-label">
            p75, <RatingText rating={metric.rating} />
          </p>
        </>
      )}
      <RatingBar title={`${metric.name} ratings`} counts={metric.counts} compact />
    </article>
  );
}

function PagesTable({ overview, view, navigate }: { overview: Overview; view: ViewState; navigate: Navigate }) {
  return (
    <section className="table-section">
      <h2>Pages</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Views</th>
              {METRIC_NAMES.map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overview.pages.map((row) => (
              <tr key={row.page}>
                <th scope="row">
                  <ViewLink view={{ ...view, page: row.page }} navigate={navigate}>
                    {row.page}
                  </ViewLink>
                </th>
                <td>{row.views}</td>
                {METRIC_NAMES.map((name) => {
                  const value = row.p75[name];
                  if (value === undefined) return <td key={name}>-</td>;
                  const rating = getRating(name, value);
                  return (
                    <td key={name} title={RATING_LABELS[rating].label}>
                      {FORMATS[name](value)} <span className={`rating rating-${rating}`}>{rating === "good" ? "" : RATING_LABELS[rating].mark}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {overview.morePages > 0 && <p className="note">…and {overview.morePages} more pages</p>}
    </section>
  );
}

function OverviewView({ view, env, navigate }: { view: ViewState; env: Environment; navigate: Navigate }) {
  const { data, failed, loading } = useData<Overview>(`/api/overview?${apiQuery(view, env)}`);
  if (failed) return <LoadError />;
  if (!data) return null;
  const empty = data.pages.length === 0;
  return (
    <div className={`overview${loading ? " stale" : ""}`} aria-busy={loading}>
      {empty ? (
        <NoMatches />
      ) : (
        <>
          <RatingLegend />
          <div className="cards">
            {data.metrics.map((metric) => (
              <MetricCard key={metric.name} metric={metric} view={view} navigate={navigate} />
            ))}
          </div>
          <PagesTable overview={data} view={view} navigate={navigate} />
        </>
      )}
    </div>
  );
}

function BreakdownTable({ title, name, rows, onSelect }: { title: string; name: MetricName; rows: readonly BreakdownRow[]; onSelect: (row: BreakdownRow) => ReactNode }) {
  return (
    <section className="table-section">
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col">Measurements</th>
              <th scope="col">p75</th>
              <th scope="col">Rating</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{onSelect(row)}</th>
                <td>{row.count}</td>
                <td>{FORMATS[name](row.p75)}</td>
                <td>
                  <RatingText rating={row.rating} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricView({ name, view, env, navigate }: { name: MetricName; view: ViewState; env: Environment; navigate: Navigate }) {
  const { data, failed, loading } = useData<MetricDetail>(`/api/metrics/${name}?${apiQuery(view, env)}`);
  const series = useMemo(
    () =>
      data
        ? [
            { name: "p50", values: data.series.p50 },
            { name: "p75", values: data.series.p75 },
            { name: "p95", values: data.series.p95 },
          ]
        : [],
    [data],
  );
  const percentiles = useMemo(
    () => (data?.histogram.percentiles ? [{ label: "p50", value: data.histogram.percentiles.p50 }, { label: "p75", value: data.histogram.percentiles.p75 }, { label: "p95", value: data.histogram.percentiles.p95 }] : []),
    [data],
  );
  const format = FORMATS[name];
  if (failed) return <LoadError />;
  if (!data) return null;
  if (data.summary.count === 0) return <NoMatches />;
  return (
    <div className={`detail${loading ? " stale" : ""}`} aria-busy={loading}>
      {name === "CLS" && <p className="note">Only Chromium-based browsers measure CLS.</p>}
      <p className="detail-value">
        <strong>{format(data.summary.p75!)}</strong> p75, <RatingText rating={data.summary.rating!} />
      </p>
      <RatingBar title={`${name} ratings`} counts={data.summary.counts} />
      <TimeSeriesChart title={`${name} over time`} x={data.series.x} series={series} formatValue={format} />
      <Histogram title={`${name} distribution`} bins={data.histogram.bins} thresholds={THRESHOLDS[name]} percentiles={percentiles} formatValue={format} />
      {data.histogram.above > 0 && <p className="note">{data.histogram.above} slower measurements are off the chart. The ratings and percentiles include them.</p>}
      <div className="breakdowns">
        <BreakdownTable
          title="Page"
          name={name}
          rows={data.pages}
          onSelect={(row) => (
            <ViewLink view={{ ...view, page: row.key }} navigate={navigate}>
              {row.key}
            </ViewLink>
          )}
        />
        <BreakdownTable
          title="Device"
          name={name}
          rows={data.devices}
          onSelect={(row) => (
            <ViewLink view={{ ...view, device: row.key }} navigate={navigate}>
              {row.key}
            </ViewLink>
          )}
        />
      </div>
    </div>
  );
}

const LIVE_LABELS: Record<LiveStatus, string> = { connecting: "Connecting…", live: "Live", offline: "Not connected, retrying…" };

function LiveIndicator({ status }: { status: LiveStatus }) {
  return (
    <p className={`live live-${status}`} role="status">
      {LIVE_LABELS[status]}
    </p>
  );
}

/** Canlı yenileme bütün `useData` çağrılarına buradan ulaşır. */
export function App() {
  const { version, status } = useLive();
  return (
    <LiveVersion.Provider value={version}>
      <Panel status={status} />
    </LiveVersion.Provider>
  );
}

function Panel({ status }: { status: LiveStatus }) {
  const [view, navigate] = useView();
  const { data: options, failed } = useData<Options>("/api/options");

  const env = view.env ?? (options?.environments.includes("production") ? "production" : options?.environments[0]);
  const overview = baseView(view);
  const { metric, tab, error } = view;

  return (
    <>
      <header className="header">
        <h1>
          <ViewLink view={overview} navigate={navigate}>
            Vitalscope
          </ViewLink>
        </h1>
        {options && env && (
          <nav aria-label="Metrics" className="tabs">
            <ViewLink view={overview} navigate={navigate} current={!metric && !tab}>
              Overview
            </ViewLink>
            {METRIC_NAMES.map((name) => (
              <ViewLink key={name} view={{ ...overview, metric: name }} navigate={navigate} current={metric === name}>
                {name}
              </ViewLink>
            ))}
            <ViewLink view={{ ...overview, tab: "errors" }} navigate={navigate} current={tab === "errors"}>
              Errors
            </ViewLink>
            <ViewLink view={{ ...overview, tab: "releases" }} navigate={navigate} current={tab === "releases"}>
              Releases
            </ViewLink>
          </nav>
        )}
        <LiveIndicator status={status} />
      </header>
      <main>
        {failed && <LoadError />}
        {options && !env && <EmptyState />}
        {options && env && (
          <>
            <FilterRow view={view} env={env} options={options} navigate={navigate} />
            {env === "development" && (
              <p className="warning" role="note">
                <strong>Development numbers.</strong> Development servers run unminified code with HMR, so these numbers differ from a production build. Use them to spot changes, and measure a production build before
                trusting a value.
              </p>
            )}
            {tab === "errors" && error && <ErrorDetailView id={error} view={view} env={env} navigate={navigate} />}
            {tab === "errors" && !error && <ErrorListView view={view} env={env} navigate={navigate} />}
            {tab === "releases" && <ReleasesView view={view} env={env} navigate={navigate} />}
            {!tab && metric && <MetricView name={metric} view={view} env={env} navigate={navigate} />}
            {!tab && !metric && <OverviewView view={view} env={env} navigate={navigate} />}
          </>
        )}
      </main>
    </>
  );
}
