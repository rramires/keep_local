export const HISTORY_DIR='keeplocal-history';
const WEEKDAYS=['mon','tue','wed','thu','fri','sat','sun'];
const DAY_MS=86_400_000;

export function localWeekdayIndex(date) {
  return (date.getDay()+6)%7;
}

export function historySlots(date) {
  const year=date.getFullYear(),month=date.getMonth(),day=date.getDate();
  const dayNumber=Date.UTC(year,month,day)/DAY_MS;
  const weekday=localWeekdayIndex(date)+1;
  const week=Math.floor((dayNumber+3)/7);
  const weekSlot=((week%4+4)%4)+1;
  const dayKey=[String(year).padStart(4,'0'),String(month+1).padStart(2,'0'),
    String(day).padStart(2,'0')].join('-');
  return {
    day:{key:dayKey,name:`keeplocal-day-${weekday}-${WEEKDAYS[weekday-1]}.keeplocal`},
    week:{key:week,name:`keeplocal-week-${weekSlot}.keeplocal`},
  };
}
