import type { MetricName } from "@vitalscope/protocol";
import type { Comparison, ReleaseSide } from "../../../packages/cli/src/queries.js";
import { LoadError, RatingText, ViewLink, type Navigate } from "./components.js";
import { apiQuery, baseView, type Environment, type ViewState } from "./filters.js";
import { FORMATS } from "./format.js";
import { useData } from "./use-data.js";

/** Bundan az ölçümle "yavaşladı" denmez: birkaç sayfa yüklemesinin farkı çoğunlukla gürültüdür. */
const MIN_SAMPLES = 5;
/** Bu oranın altındaki fark "aynı" sayılır. */
const SAME_RATIO = 0.05;
/** Küçük değerlerde oran yanıltır: 9 ms'den 4 ms'ye düşmek %57 görünür ama yerel ölçümde gürültüdür. */
const MIN_TIME_DIFFERENCE = 20;
const MIN_CLS_DIFFERENCE = 0.01;

interface ViewProps {
  view: ViewState;
  env: Environment;
  navigate: Navigate;
}

export function describeChange(name: MetricName, a: ReleaseSide, b: ReleaseSide) {
  if (a.p75 === null || b.p75 === null) return { text: "No data", tone: "" };
  if (a.count < MIN_SAMPLES || b.count < MIN_SAMPLES) return { text: "Too few measurements", tone: "" };
  const difference = b.p75 - a.p75;
  const ratio = a.p75 === 0 ? (difference === 0 ? 0 : Infinity) : Math.abs(difference) / a.p75;
  if (ratio < SAME_RATIO || Math.abs(difference) < (name === "CLS" ? MIN_CLS_DIFFERENCE : MIN_TIME_DIFFERENCE)) return { text: "About the same", tone: "" };
  const amount = `${difference > 0 ? "+" : "−"}${FORMATS[name](Math.abs(difference))}`;
  const percent = Number.isFinite(ratio) ? ` (${difference > 0 ? "+" : "−"}${Math.round(ratio * 100)}%)` : "";
  const word = name === "CLS" ? (difference > 0 ? "Worse" : "Better") : difference > 0 ? "Slower" : "Faster";
  return { text: `${word}, ${amount}${percent}`, tone: difference > 0 ? "change-worse" : "change-better" };
}

function Side({ name, side }: { name: MetricName; side: ReleaseSide }) {
  if (side.p75 === null || side.rating === null) return <>-</>;
  return (
    <>
      {FORMATS[name](side.p75)} <RatingText rating={side.rating} />
      <div className="note">{side.count} measured</div>
    </>
  );
}

function ComparisonView({ data, a, b, view, navigate }: { data: Comparison; a: string; b: string; view: ViewState; navigate: Navigate }) {
  return (
    <>
      <section className="table-section">
        <h2>Metrics</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">{a}</th>
                <th scope="col">{b}</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((metric) => {
                const change = describeChange(metric.name, metric.a, metric.b);
                return (
                  <tr key={metric.name}>
                    <th scope="row">{metric.name} p75</th>
                    <td>
                      <Side name={metric.name} side={metric.a} />
                    </td>
                    <td>
                      <Side name={metric.name} side={metric.b} />
                    </td>
                    <td className={change.tone}>{change.text}</td>
                  </tr>
                );
              })}
              <tr>
                <th scope="row">Page views</th>
                <td>{data.views.a}</td>
                <td>{data.views.b}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="table-section">
        <h2>Errors</h2>
        {data.errors.length === 0 ? (
          <p className="note">Neither release has errors.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Error</th>
                  <th scope="col">{a}</th>
                  <th scope="col">{b}</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.errors.map((error) => (
                  <tr key={error.id}>
                    <th scope="row" className="error-cell">
                      <div className="error-title">
                        <ViewLink view={{ ...baseView(view), tab: "errors", error: error.id }} navigate={navigate}>
                          {`${error.type}: ${error.message}`}
                        </ViewLink>
                      </div>
                      {error.location && <div className="error-location">at {error.location}</div>}
                    </th>
                    <td>{error.a}</td>
                    <td>{error.b}</td>
                    <td className={error.a === 0 ? "change-worse" : error.b === 0 ? "change-better" : ""}>{error.a === 0 ? `New in ${b}` : error.b === 0 ? `Not seen in ${b}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.moreErrors > 0 && <p className="note">…and {data.moreErrors} more errors</p>}
      </section>
    </>
  );
}

export function ReleasesView({ view, env, navigate }: ViewProps) {
  const query = apiQuery(view, env);
  const { data: releases, failed } = useData<string[]>(`/api/releases?${query}`);
  const b = view.b ?? releases?.[0];
  const a = view.a ?? releases?.find((release) => release !== b);
  const ready = a !== undefined && b !== undefined && a !== b;
  const { data, failed: compareFailed, loading } = useData<Comparison>(ready ? `/api/compare?${query}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : undefined);

  if (failed || compareFailed) return <LoadError />;
  if (!releases) return null;
  if (releases.length < 2)
    return (
      <section className="notice">
        <h2>{releases.length === 0 ? "No releases yet" : `Only one release so far: ${releases[0]}`}</h2>
        <p>Pass a release, such as a commit hash, and measure two of them to compare.</p>
        <pre>
          <code>{'init({ release: "9f2c1ab" });'}</code>
        </pre>
      </section>
    );

  // Elle yazılmış ya da bu filtrelerde görünmeyen değer de seçili görünür.
  const options = [...new Set([...(a ? [a] : []), ...(b ? [b] : []), ...releases])];
  const picker = (label: string, value: string | undefined, key: "a" | "b") => (
    <label className="filter">
      {label}
      <select value={value} onChange={(event) => navigate({ ...view, [key]: event.target.value })}>
        {options.map((release) => (
          <option key={release} value={release}>
            {release}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={`detail${loading ? " stale" : ""}`} aria-busy={loading}>
      <form className="compare-picker" aria-label="Releases to compare" onSubmit={(event) => event.preventDefault()}>
        {picker("Baseline", a, "a")}
        {picker("Compare with", b, "b")}
      </form>
      {!ready && <p className="notice">Choose two different releases.</p>}
      {ready && data && <ComparisonView data={data} a={a} b={b} view={view} navigate={navigate} />}
    </div>
  );
}
