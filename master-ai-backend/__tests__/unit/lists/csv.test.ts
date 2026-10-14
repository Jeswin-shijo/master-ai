import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../../src/lists/csv';

describe('CSV for Excel', () => {
  it('starts with a byte order mark and ends lines with CRLF', () => {
    expect(toCsv([['Name', 'Total'], ['Sri Ganesh, Kochi', '48260']])).toBe('﻿Name,Total\r\n"Sri Ganesh, Kochi",48260\r\n');
  });

  it('keeps a cell from becoming a formula when the file is opened', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+91 98470 12345')).toBe("'+91 98470 12345");
    expect(csvCell('-500')).toBe('-500');
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('plain')).toBe('plain');
  });
});
