export const categories = ['Development', 'Design', 'Bug Fixing', 'Content Update', 'SEO', 'Maintenance', 'Other'];
export function dateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function monthKey(year, month) { return `${year}-${String(month).padStart(2, '0')}`; }
export function duration(minutes) { const sign = minutes < 0 ? '−' : ''; const m = Math.abs(Math.round(minutes)); return `${sign}${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`; }
export function allocationMinutes(website, allocations, year, month) {
  const override = allocations.find(a => String(a.websiteId) === String(website.id) && a.year === year && a.month === month);
  return Math.round((override ? override.allocatedHours : website.defaultMonthlyHours) * 60);
}
export function monthlyStats(websites, logs, allocations, year, month, includeInactive = false) {
  const key = monthKey(year, month);
  const rows = websites.filter(w => (includeInactive || w.status === 'Active') && w.startDate.slice(0, 7) <= key).map(w => {
    const allocated = allocationMinutes(w, allocations, year, month);
    const actual = logs.filter(l => String(l.websiteId) === String(w.id) && l.date.startsWith(key)).reduce((n, l) => n + l.totalMinutes, 0);
    return { ...w, allocated, actual, remaining: allocated - actual, extra: Math.max(0, actual - allocated), percent: allocated ? Math.round(actual / allocated * 100) : actual ? 100 : 0 };
  });
  const allocated = rows.reduce((n, w) => n + w.allocated, 0), actual = rows.reduce((n, w) => n + w.actual, 0);
  return { rows, allocated, actual, remaining: allocated - actual, percent: allocated ? Math.round(actual / allocated * 100) : actual ? 100 : 0 };
}
export function reportRows(logs, { websiteId = '', category = '', from = '', to = '' } = {}) {
  return logs.filter(l => (!websiteId || l.websiteId === websiteId) && (!category || l.category === category) && (!from || l.date >= from) && (!to || l.date <= to)).sort((a, b) => b.date.localeCompare(a.date));
}
export function csvCell(value) { const s = String(value ?? ''); return `"${/^[=+@\-\t\r]/.test(s) ? "'" : ''}${s.replaceAll('"', '""')}"`; }
