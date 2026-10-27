import { useMemo, useState } from "react";
import { isNoDataDay } from "../utils/reportBuilder";

function getMonthYearStr(year, month) {
  const date = new Date(Date.UTC(year, month, 1));
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function getAhiClass(record) {
  if (!record || isNoDataDay(record)) return "cal-nodata";
  const ahi = record.ahi;
  if (ahi == null) return "cal-nodata";
  if (ahi < 5) return "cal-normal";
  if (ahi < 15) return "cal-mild";
  if (ahi < 30) return "cal-moderate";
  return "cal-severe";
}

export function SleepCalendar({ data }) {
  const [selectedDay, setSelectedDay] = useState(null);

  const monthsGrid = useMemo(() => {
    if (!data || data.length === 0) return [];

    const sorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const firstDate = new Date(sorted[0].date);
    const lastDate = new Date(sorted[sorted.length - 1].date);

    const dataMap = new Map();
    sorted.forEach((d) => dataMap.set(d.date, d));

    const startYear = firstDate.getUTCFullYear();
    const startMonth = firstDate.getUTCMonth();
    const endYear = lastDate.getUTCFullYear();
    const endMonth = lastDate.getUTCMonth();

    const grids = [];
    let currentYear = startYear;
    let currentMonth = startMonth;

    while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
      const monthTitle = getMonthYearStr(currentYear, currentMonth);
      const firstDayOfMonth = new Date(Date.UTC(currentYear, currentMonth, 1));
      const startDow = firstDayOfMonth.getUTCDay();
      const daysInMonth = new Date(Date.UTC(currentYear, currentMonth + 1, 0)).getUTCDate();
      const days = [];

      for (let i = 0; i < startDow; i++) {
        days.push(null);
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const yyyy = currentYear;
        const mm = String(currentMonth + 1).padStart(2, "0");
        const dd = String(day).padStart(2, "0");
        const dateKey = `${yyyy}-${mm}-${dd}`;
        days.push({
          date: dateKey,
          record: dataMap.get(dateKey) || null
        });
      }

      grids.push({ title: monthTitle, days });
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
    }

    return grids;
  }, [data]);

  return (
    <div className="sleep-calendar">
      <div className="sleep-calendar-head">
        <h3 className="section-title">Sleep calendar</h3>
        <p className="section-note">
          Gray nights indicate no therapy data. They stay excluded from therapy-quality scores, but still count in
          usage-based metrics such as adherence.
        </p>

        <div className="cal-legend">
          <span className="cal-legend-title">AHI</span>
          <span className="cal-legend-item">
            <span className="cal-swatch cal-normal" /> &lt;5 Normal
          </span>
          <span className="cal-legend-item">
            <span className="cal-swatch cal-mild" /> 5-15 Mild
          </span>
          <span className="cal-legend-item">
            <span className="cal-swatch cal-moderate" /> 15-30 Moderate
          </span>
          <span className="cal-legend-item">
            <span className="cal-swatch cal-severe" /> 30+ Severe
          </span>
          <span className="cal-legend-item">
            <span className="cal-swatch cal-nodata" /> No data
          </span>
        </div>
      </div>

      <div className="calendar-container">
        {monthsGrid.map((month) => (
          <div key={month.title} className="calendar-month">
            <h4>{month.title}</h4>
            <div className="calendar-dow">
              <span>S</span>
              <span>M</span>
              <span>T</span>
              <span>W</span>
              <span>T</span>
              <span>F</span>
              <span>S</span>
            </div>
            <div className="calendar-grid">
              {month.days.map((dayItem, index) => {
                if (!dayItem) {
                  return <div key={`empty-${index}`} className="calendar-day empty" />;
                }
                const record = dayItem.record;
                const hasRecord = !!record;
                const noData = hasRecord && isNoDataDay(record);
                const statusClass = getAhiClass(record);
                const title = !hasRecord
                  ? dayItem.date
                  : noData
                    ? `${dayItem.date}: No data`
                    : `${dayItem.date}: AHI ${Number(record.ahi || 0).toFixed(1)}`;

                return (
                  <div
                    key={dayItem.date}
                    className={`calendar-day ${statusClass} ${selectedDay?.date === dayItem.date ? "is-selected" : ""}`}
                    title={title}
                    onClick={() => {
                      if (hasRecord) {
                        setSelectedDay(selectedDay?.date === dayItem.date ? null : record);
                      } else {
                        setSelectedDay(null);
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedDay &&
        (() => {
          const noData = isNoDataDay(selectedDay);
          return (
            <div className="day-popover-scrim" onClick={() => setSelectedDay(null)}>
              <div className="day-popover" onClick={(e) => e.stopPropagation()}>
                <div className="day-popover-head">
                  <div>
                    <div className="section-eyebrow">Night of</div>
                    <div className="day-popover-date">{selectedDay.date}</div>
                  </div>
                  <div className="day-popover-figure">
                    <div className="day-popover-value">
                      {noData ? "\u2014" : Number(selectedDay.ahi || 0).toFixed(1)}
                    </div>
                    <div className="day-popover-caption">{noData ? "No therapy data" : "AHI (events/hr)"}</div>
                  </div>
                </div>
                <div className="day-popover-grid">
                  {[
                    ["Usage", noData ? "No data" : `${Number(selectedDay.usageHours || 0).toFixed(1)} hrs`],
                    ["Leak (P50)", noData ? "\u2014" : `${Number(selectedDay.leak50 || 0).toFixed(1)} L/min`],
                    ["Pressure", noData ? "\u2014" : `${Number(selectedDay.pressure || 0).toFixed(1)} cmH\u2082O`],
                    [
                      "Score",
                      noData
                        ? "Excluded"
                        : selectedDay.therapy_stability_score == null
                          ? "N/A"
                          : Math.round(selectedDay.therapy_stability_score)
                    ]
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="section-eyebrow">{k}</div>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
                {noData && (
                  <p className="day-popover-note">
                    Usage was recorded as 0.0 hours for this date, so it is marked as no data for therapy metrics while
                    still counting toward usage-based measures such as adherence.
                  </p>
                )}
                <div className="day-popover-dismiss">Click outside to close</div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
