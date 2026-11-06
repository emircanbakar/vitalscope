import { useMemo } from "react";
import { TimeSeriesChart } from "@vitalscope/charts";
import type { CountRow, ErrorDetail, ErrorList } from "../../../packages/cli/src/queries.js";
import { LoadError, ViewLink, type Navigate } from "./components.js";
import { apiQuery, type Environment, type ViewState } from "./filters.js";
import { useData } from "./use-data.js";

interface ViewProps {
  view: ViewState;
  env: Environment;
  navigate: Navigate;
}

const count = (value: number) => String(Math.round(value));

function NoErrors() {
  return <p className="notice">No errors match these filters.</p>;
}

export function ErrorListView({ view, env, navigate }: ViewProps) {
  const { data, failed, loading } = useData<ErrorList>(`/api/errors?${apiQuery(view, env)}`);
  if (failed) return <LoadError />;
  if (!data) return null;
  if (data.errors.length === 0) return <NoErrors />;
  return (
    <section className={`table-section${loading ? " stale" : ""}`} aria-busy={loading}>
      <h2>Errors</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Error</th>
              <th scope="col">Count</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {data.errors.map((error) => (
              <tr key={error.id}>
                <th scope="row" className="error-cell">
                  <div className="error-title">
                    <ViewLink view={{ ...view, error: error.id }} navigate={navigate}>
                      {`${error.type}: ${error.message}`}
                    </ViewLink>
                  </div>
                  {error.location && <div className="error-location">at {error.location}</div>}
                </th>
                <td>{error.count}</td>
                <td>{new Date(error.lastSeen).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.moreErrors > 0 && <p className="note">…and {data.moreErrors} more errors</p>}
    </section>
  );
}

function CountTable({ title, rows, empty }: { title: string; rows: readonly CountRow[]; empty?: string }) {
  return (
    <section className="table-section">
      <h2>{title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.key || empty}</th>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ErrorDetailView({ id, view, env, navigate }: ViewProps & { id: string }) {
  const { data, failed, loading } = useData<ErrorDetail | null>(`/api/errors/${id}?${apiQuery(view, env)}`);
  const series = useMemo(() => (data ? [{ name: "Count", values: data.series.counts }] : []), [data]);
  const list = { ...view };
  delete list.error;
  const back = (
    <ViewLink view={list} navigate={navigate}>
      ← All errors
    </ViewLink>
  );
  if (failed) return <LoadError />;
  if (data === undefined) return null;
  if (data === null)
    return (
      <>
        <p>{back}</p>
        <NoErrors />
      </>
    );
  return (
    <div className={`detail${loading ? " stale" : ""}`} aria-busy={loading}>
      <p>{back}</p>
      <header className="detail-header">
        <h2>{`${data.type}: ${data.message}`}</h2>
        {data.location && <p className="error-location">at {data.location}</p>}
        <dl className="facts">
          <div>
            <dt>Count</dt>
            <dd>{data.count}</dd>
          </div>
          <div>
            <dt>First seen</dt>
            <dd>{new Date(data.firstSeen).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{new Date(data.lastSeen).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Reported by</dt>
            <dd>{data.handled ? "captureError" : "uncaught"}</dd>
          </div>
        </dl>
      </header>
      {data.stack.length > 0 && (
        <section className="table-section">
          <h2>Latest stack</h2>
          <pre className="stack">
            <code>{data.stack.join("\n")}</code>
          </pre>
        </section>
      )}
      <TimeSeriesChart title="Occurrences over time" x={data.series.x} series={series} formatValue={count} />
      <div className="breakdowns">
        <CountTable title="Page" rows={data.pages} />
        <CountTable title="Device" rows={data.devices} />
        <CountTable title="Release" rows={data.releases} empty="No release set" />
      </div>
    </div>
  );
}
