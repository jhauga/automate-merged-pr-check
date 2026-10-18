const pad = (value, width = 2) => String(value).padStart(width, '0');

/** Day folder name for failure reports and proposed solutions: MM-DD-YYYY in local time. */
export function dayFolder(date = new Date()) {
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getFullYear(), 4)}`;
}

/** Sortable, file-system-safe local timestamp: YYYY-MM-DDTHH-MM-SS. */
export function fileTimestamp(date = new Date()) {
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${day}T${time}`;
}
