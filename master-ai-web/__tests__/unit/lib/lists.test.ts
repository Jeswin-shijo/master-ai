import { describe, expect, it } from 'vitest';
import * as sdk from '@onehuman/sdk';
import { amountText, csvFileName, dayLabel, followUpLine, initialView, listParams, lowerWords, NOTE_LABELS, nextSort, RANGE_LABELS, referenceText, SHOW_LABELS, SOURCE_LABELS, withBom } from '../../../src/lib/lists';
import { itemCell, recordCell } from '../../../src/lib/record-cell';

describe('the shared wording', () => {
  it("is the SDK's own, so the phone and the web say the same", () => {
    expect([recordCell, itemCell, listParams, initialView, referenceText, followUpLine, dayLabel, amountText, lowerWords]).toEqual([
      sdk.recordCell,
      sdk.itemCell,
      sdk.listParams,
      sdk.initialView,
      sdk.referenceText,
      sdk.followUpLine,
      sdk.dayLabel,
      sdk.amountText,
      sdk.lowerWords,
    ]);
    expect([NOTE_LABELS, RANGE_LABELS, SHOW_LABELS, SOURCE_LABELS]).toEqual([sdk.NOTE_LABELS, sdk.RANGE_LABELS, sdk.SHOW_LABELS, sdk.SOURCE_LABELS]);
  });
});

describe('sorting by a column', () => {
  it('cycles a column through ascending, descending and off', () => {
    expect(nextSort('', 'total')).toBe('total:asc');
    expect(nextSort('total:asc', 'total')).toBe('total:desc');
    expect(nextSort('total:desc', 'total')).toBe('');
    expect(nextSort('total:desc', 'billNo')).toBe('billNo:asc');
  });
});

describe('the download', () => {
  it('names the file after the list and the day', () => {
    expect(csvFileName('Contractor bills', new Date(2026, 9, 14, 12))).toBe('contractor-bills-2026-10-14.csv');
  });

  it('puts back the byte order mark Excel needs, once', () => {
    expect(withBom('a,b')).toBe('﻿a,b');
    expect(withBom('﻿a,b')).toBe('﻿a,b');
  });
});
