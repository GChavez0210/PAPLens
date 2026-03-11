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
        sorted.forEach(d => dataMap.set(d.date, d));

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
        <div style={{ position: "relative", marginTop: 20 }}>
            <div style={{ marginBottom: 16 }}>
                <h4 style={{ margin: "0 0 4px 0", fontSize: "1rem", fontWeight: 700, color: "var(--text)" }}>Sleep Calendar</h4>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 12 }}>Gray nights indicate no therapy data. They stay excluded from therapy-quality scores, but still count in usage-based metrics such as adherence.</div>

                <div className="cal-legend">
                    <div style={{ fontWeight: 600 }}>AHI</div>
                    <div className="cal-legend-item"><div className="cal-swatch cal-normal" /> &lt;5 Normal</div>
                    <div className="cal-legend-item"><div className="cal-swatch cal-mild" /> 5-15 Mild</div>
                    <div className="cal-legend-item"><div className="cal-swatch cal-moderate" /> 15-30 Moderate</div>
                    <div className="cal-legend-item"><div className="cal-swatch cal-severe" /> 30+ Severe</div>
                    <div className="cal-legend-item"><div className="cal-swatch cal-nodata" /> No data</div>
                </div>
            </div>

            <div className="calendar-container">
                {monthsGrid.map((month) => (
                    <div key={month.title} className="calendar-month">
                        <h4>{month.title}</h4>
                        <div className="calendar-dow">
                            <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
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
                                        className={`calendar-day ${statusClass}`}
                                        title={title}
                                        onClick={() => {
                                            if (hasRecord) {
                                                setSelectedDay(selectedDay?.date === dayItem.date ? null : record);
                                            } else {
                                                setSelectedDay(null);
                                            }
                                        }}
                                        style={{ outline: selectedDay?.date === dayItem.date ? "2px solid var(--brand)" : "none", outlineOffset: 2 }}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {selectedDay && (() => {
                const noData = isNoDataDay(selectedDay);
                return (
                    <div onClick={() => setSelectedDay(null)} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, cursor: "default" }}>
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 22px", minWidth: 280, boxShadow: "0 20px 60px var(--shadow-lg)", cursor: "default" }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                                <div>
                                    <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>Night of</div>
                                    <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)" }}>{selectedDay.date}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: "2rem", fontWeight: 900, color: "var(--text)", lineHeight: 1 }}>{noData ? "-" : Number(selectedDay.ahi || 0).toFixed(1)}</div>
                                    <div style={{ fontSize: "0.65rem", color: "var(--muted)" }}>{noData ? "No therapy data" : "AHI (Events/hr)"}</div>
                                </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
                                {[
                                    ["Usage", noData ? "No data" : `${Number(selectedDay.usageHours || 0).toFixed(1)} hrs`],
                                    ["Leak (P50)", noData ? "-" : `${Number(selectedDay.leak50 || 0).toFixed(1)} L/min`],
                                    ["Pressure", noData ? "-" : `${Number(selectedDay.pressure || 0).toFixed(1)} cmH2O`],
                                    ["Score", noData ? "Excluded" : selectedDay.therapy_stability_score == null ? "N/A" : Math.round(selectedDay.therapy_stability_score)]
                                ].map(([k, v]) => (
                                    <div key={k}>
                                        <div style={{ fontSize: "0.65rem", color: "var(--muted)", textTransform: "uppercase" }}>{k}</div>
                                        <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)" }}>{v}</div>
                                    </div>
                                ))}
                            </div>
                            {noData && (
                                <div style={{ marginTop: 12, fontSize: "0.75rem", color: "var(--muted)", lineHeight: 1.5 }}>
                                    Usage was recorded as 0.0 hours for this date, so it is marked as no data for therapy metrics while still counting toward usage-based measures such as adherence.
                                </div>
                            )}
                            <div style={{ marginTop: 12, fontSize: "0.7rem", color: "var(--muted)", textAlign: "center" }}>Click outside to close</div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
