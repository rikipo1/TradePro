import React from 'react';

export function Ic({ d, size, extra }){
  return (
    <svg width={size||20} height={size||20} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {d.map((p,i) => <path key={i} d={p} />)}
      {extra || null}
    </svg>
  );
}
export const IC = {
  back:    ['M15 18l-6-6 6-6'],
  plus:    ['M12 5v14', 'M5 12h14'],
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6'],
  edit:    ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  check:   ['M20 6L9 17l-5-5'],
  search:  ['M20 20l-3.2-3.2'],
  rows:    ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  candle:  ['M7 3v3', 'M7 18v3', 'M5 6h4v12H5Z', 'M17 5v3', 'M17 16v3', 'M15 8h4v8h-4Z'],
  info:    ['M12 10.5V17', 'M12 7h.01'],
  bell:    ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z', 'M13.7 21a2 2 0 0 1-3.4 0'],
  book:    ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M20 22H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20Z'],
  download:['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
};
