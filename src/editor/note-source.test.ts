import { describe, expect, it } from 'vitest';
import { keepSource, sourceBlocks } from './note-source';

describe('sourceBlocks', () => {
  it('splits a note into its top-level blocks; stray lines stay with the block above, blank lines go', () => {
    expect(sourceBlocks('Intro\n\n- a\n- b\n\n[ref]: http://x\n\n\nText')).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 6 },
      { from: 8, to: 9 },
    ]);
    expect(sourceBlocks('\n\nLate start\nsame paragraph\n> quote')).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 5 },
    ]);
    expect(sourceBlocks('')).toEqual([]);
  });
});

describe('keepSource', () => {
  const note = '> [!NOTE]\n> Keep me\n\nEdit me\n\n| a |\n|--:|\n| 1 |';
  const blocks = sourceBlocks(note);
  // What the editor writes for each block as loaded.
  const normalized = ['> [!NOTE] Keep me', 'Edit me', '| a |\n| ---: |\n| 1 |'];

  it('keeps every block the editor left alone exactly as written', () => {
    expect(keepSource(note, blocks, normalized, ['> [!NOTE] Keep me', 'Edited', '| a |\n| ---: |\n| 1 |'])).toBe(
      '> [!NOTE]\n> Keep me\n\nEdited\n\n| a |\n|--:|\n| 1 |',
    );
  });

  it('keeps the lines between neighbours that are both unchanged', () => {
    const tight = 'Steps:\n- one\n- two';
    expect(keepSource(tight, sourceBlocks(tight), ['Steps:', '- one\n- two'], ['Steps:', '- one\n- two'])).toBe(tight);
  });

  it('places added blocks and drops deleted ones', () => {
    expect(keepSource(note, blocks, normalized, ['New first', '> [!NOTE] Keep me', '| a |\n| ---: |\n| 1 |'])).toBe(
      'New first\n\n> [!NOTE]\n> Keep me\n\n| a |\n|--:|\n| 1 |',
    );
  });

  it('leaves out empty paragraphs the editor adds', () => {
    expect(keepSource(note, blocks, normalized, ['> [!NOTE] Keep me', '', 'Edit me'])).toBe('> [!NOTE]\n> Keep me\n\nEdit me');
  });

  it('gives up when nothing is left of the note as loaded', () => {
    expect(keepSource(note, blocks, normalized, ['All new'])).toBeNull();
  });
});
