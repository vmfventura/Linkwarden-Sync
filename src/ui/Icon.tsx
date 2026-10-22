// Original local line icons. Decorative SVGs inherit their control's accessible name.
const paths = {
  appearance: 'M21 12a9 9 0 1 1-9-9 7 7 0 0 0 9 9Z',
  bookmark: 'M6 4h12v17l-6-4-6 4V4Z M9 1h12v17',
  external: 'M14 3h7v7 M21 3 11 13 M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  lock: 'M6 10h12v11H6V10Z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  folder: 'M3 7V5h6l2 2h10v13H3V7Z M3 10h18',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  plus: 'M12 5v14 M5 12h14',
  edit: 'm15 4 5 5 M4 20l1-6L16 3l5 5L10 19l-6 1Z',
  trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  close: 'm6 6 12 12 M6 18 18 6',
  shield: 'm12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z m-4 10 3 3 5-6',
  key: 'M14 10a5 5 0 1 1-4-4 M14 10l8-8 M18 6l3 3 M15 9l3 3',
  link: 'm9 15 6-6 M7 14l-2 2a4 4 0 0 0 6 6l3-3 M10 5l3-3a4 4 0 0 1 6 6l-2 2',
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}
