import test from 'node:test';
import assert from 'node:assert/strict';

const history=()=>import('../../js/folder-history.js');
const localDate=(day,hour=12,minute=0)=>new Date(2026,0,day,hour,minute);

function inTimeZone(zone,check) {
  const previous=process.env.TZ;
  process.env.TZ=zone;
  try {check();}
  finally {
    if(previous===undefined)delete process.env.TZ;
    else process.env.TZ=previous;
  }
}

test('P1.1 daily history uses the seven ISO weekday filenames twice in 14 days',async()=>{
  const {HISTORY_DIR,historySlots}=await history();
  assert.equal(HISTORY_DIR,'keeplocal-history');
  const weekdays=['mon','tue','wed','thu','fri','sat','sun'];
  for(let offset=0;offset<14;offset++){
    const position=offset%7,day=5+offset;
    assert.deepEqual(historySlots(localDate(day)).day,{
      key:`2026-01-${String(day).padStart(2,'0')}`,
      name:`keeplocal-day-${position+1}-${weekdays[position]}.keeplocal`,
    });
  }
});

test('P1.1 weekly history uses four slots and returns to the first on week five',async()=>{
  const {historySlots}=await history();
  const weeks=Array.from({length:5},(_,index)=>historySlots(localDate(12+index*7)).week);
  assert.deepEqual(weeks.map(({key})=>key),[2924,2925,2926,2927,2928]);
  assert.deepEqual(weeks.map(({name})=>name),
    [1,2,3,4,1].map(slot=>`keeplocal-week-${slot}.keeplocal`));
});

test('P1.1 consecutive weeks across new year never use the same slot',async()=>{
  const {historySlots}=await history();
  for(let year=1990;year<=2040;year++){
    const weeks=[24,31,38].map(day=>historySlots(new Date(year,11,day,12)).week);
    assert.equal(new Set(weeks.map(({name})=>name)).size,3,`year end ${year}`);
    assert.equal(weeks[2].key-weeks[0].key,2);
  }
});

test('P1.1 local midnight opens a new day and Monday opens a new week',async()=>{
  const {historySlots}=await history();
  inTimeZone('America/Sao_Paulo',()=>{
    const sunday=historySlots(localDate(11,23,59));
    const monday=historySlots(localDate(12,0,0));
    assert.equal(sunday.day.key,'2026-01-11');
    assert.equal(monday.day.key,'2026-01-12');
    assert.equal(monday.week.key,sunday.week.key+1);
    assert.notEqual(monday.week.name,sunday.week.name);
    assert.deepEqual(historySlots(localDate(10,23,59)).week,sunday.week);
  });
});

test('P1.1 local day and week keys survive DST in Berlin and São Paulo',async()=>{
  const {historySlots}=await history();
  for(const [zone,year,month,start,keys] of [
    ['Europe/Berlin',2026,2,28,['2026-03-28','2026-03-29','2026-03-30']],
    ['America/Sao_Paulo',2018,10,3,['2018-11-03','2018-11-04','2018-11-05']],
  ]){
    inTimeZone(zone,()=>{
      const dates=[0,1,2].map(offset=>new Date(year,month,start+offset,12));
      assert.notEqual(dates[0].getTimezoneOffset(),dates[2].getTimezoneOffset(),zone);
      const slots=dates.map(historySlots);
      assert.deepEqual(slots.map(({day})=>day.key),keys);
      assert.equal(slots[0].week.key,slots[1].week.key);
      assert.equal(slots[2].week.key,slots[1].week.key+1);
    });
  }
});
